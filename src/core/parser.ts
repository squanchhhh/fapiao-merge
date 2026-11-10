import { emptyFields, type InvoiceFields, type InvoiceKind } from './types';
import { compactText, normalizeText, textOf, type TextLine } from './text';

export interface ParseResult {
  fields: InvoiceFields;
  kind: InvoiceKind;
  isInvoice: boolean;
  confidence: 'high' | 'medium' | 'low';
  missing: string[];
  note: string;
}

interface PartyHit {
  role: 'buyer' | 'seller' | 'unknown';
  value: string;
  x: number;
}

interface TextRun {
  str: string;
  x: number;
  width: number;
}

/**
 * 部分 PDF 会把每个汉字当成独立的文本片段输出（发票-3 就是如此）。
 * 先按字间距把同一行里紧挨着的字符合并成 run，再做「名称：」「税号」匹配。
 */
function lineRuns(line: TextLine): TextRun[] {
  const runs: TextRun[] = [];
  for (const item of line.items) {
    const last = runs[runs.length - 1];
    if (last && item.x - (last.x + last.width) <= 2) {
      last.str += item.str;
      last.width = item.x + item.width - last.x;
      continue;
    }
    runs.push({ str: item.str, x: item.x, width: item.width });
  }
  return runs;
}

const TRAIN_RE = /[GDCZTKY]?\d{1,4}/;
const TRAIN_TOKEN_RE = /^(?:[GDCZTKY]\d{1,4}|\d{3,4})$/;

function parseMoney(value: string | undefined | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[,，\s]/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const yuan = Number(cleaned);
  if (!Number.isFinite(yuan) || yuan <= 0 || yuan > 1_000_000_000) return null;
  return Math.round(yuan * 100);
}

function isoDate(y: string, m: string, d: string): string {
  const mm = String(Number(m)).padStart(2, '0');
  const dd = String(Number(d)).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function detectKind(text: string): InvoiceKind {
  if (/铁路电子客票/.test(text)) return 'railway';
  if (/电子发票\s*\(\s*增值税专用发票\s*\)/.test(text)) return 'digital-special';
  if (/电子发票\s*\(\s*普通发票\s*\)/.test(text)) return 'digital-general';
  if (/增值税电子专用发票|增值税专用发票/.test(text)) return 'traditional-special';
  if (/增值税电子普通发票|增值税普通发票|电子普通发票/.test(text)) return 'traditional-general';
  return 'unknown';
}

function extractNumber(text: string): string {
  const patterns = [
    /发票号码[\s:：]*([0-9]{8,20})(?![0-9])/,
    /发票号码[^0-9]{0,10}([0-9]{8,20})(?![0-9])/,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match) return match[1];
  }
  return '';
}

function extractCode(text: string): string {
  const patterns = [
    /发票代码[\s:：]*([0-9]{10,12})(?![0-9])/,
    /发票代码[^0-9]{0,10}([0-9]{10,12})(?![0-9])/,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match) return match[1];
  }
  return '';
}

function extractIssueDate(text: string): string {
  const match = text.match(
    /开票日期[\s:：]*([0-9]{4})[年\-/\.]([0-9]{1,2})[月\-/\.]([0-9]{1,2})日?/,
  );
  if (match) return isoDate(match[1], match[2], match[3]);

  const fallback = text.match(/([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日/);
  return fallback ? isoDate(fallback[1], fallback[2], fallback[3]) : '';
}

function extractAmounts(text: string, kind: InvoiceKind) {
  const compact = compactText(text);
  let amountExTax: number | null = null;
  let taxAmount: number | null = null;
  let total: number | null = null;

  if (kind === 'railway') {
    const fare = compact.match(/票价[\s:：]*[¥]?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
    total = parseMoney(fare?.[1]);
    // 铁路票只有票价，没有单独列示税额；计入不含税金额便于合计对平。
    amountExTax = total;
    return { amountExTax, taxAmount, total };
  }

  const small = compact.match(/\(小写\)\s*[¥]?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
  if (small) total = parseMoney(small[1]);

  if (total == null) {
    const fallback = compact.match(
      /价税合计[^0-9¥]{0,40}[¥]?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/,
    );
    if (fallback) total = parseMoney(fallback[1]);
  }

  const both = compact.match(
    /(?<!价税)合计[¥]?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*[¥]?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/,
  );
  if (both) {
    amountExTax = parseMoney(both[1]);
    taxAmount = parseMoney(both[2]);
  } else {
    const one = compact.match(/(?<!价税)合计[¥]?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
    if (one) amountExTax = parseMoney(one[1]);
  }

  if (total == null) {
    if (amountExTax != null && taxAmount != null) total = amountExTax + taxAmount;
    else if (amountExTax != null) total = amountExTax;
  } else if (taxAmount != null && amountExTax == null) {
    amountExTax = Math.max(total - taxAmount, 0);
  }

  return { amountExTax, taxAmount, total };
}

function cleanupParty(value: string): string {
  return value
    .replace(/^[\s:：\-—]+/, '')
    // 重复绘制或逐字拆分时可能出现「名称:名称:某某公司」，全部去掉。
    .replace(/^(?:名称\s*[:：]?\s*)+/, '')
    .replace(/\s*(?:统一社会信用代码|纳税人识别号|税号)[\s\S]*$/, '')
    .replace(/\s+[0-9A-Za-z]{15,20}\s*$/, '')
    .replace(/[\s:：\-—]+$/, '')
    .trim();
}

function extractParties(lines: TextLine[], width: number): { buyer: string; seller: string } {
  const hits: PartyHit[] = [];
  const midpoint = width / 2;

  for (const line of lines) {
    const runs = lineRuns(line);
    for (let i = 0; i < runs.length; i += 1) {
      const item = runs[i];
      const label = normalizeText(item.str);
      if (!label.includes('名称')) continue;
      if (/项目名称|货物名称|商品名称|服务名称|规格型号/.test(label)) continue;

      const sideRole: 'buyer' | 'seller' = item.x < midpoint ? 'buyer' : 'seller';
      const explicitRole: PartyHit['role'] = /销售方|销方/.test(label)
        ? 'seller'
        : /购买方|购方/.test(label)
          ? 'buyer'
          : 'unknown';

      let value = label.replace(/^[\s\S]*?名称\s*[:：]?\s*/, '');
      for (let j = i + 1; j < runs.length; j += 1) {
        const next = runs[j];
        const nextText = normalizeText(next.str);
        if (nextText.includes('名称')) break;
        if (sideRole === 'buyer' && next.x >= midpoint) break;
        if (sideRole === 'seller' && next.x < midpoint) break;
        value += nextText;
      }
      value = cleanupParty(value);
      if (value.length < 2) continue;
      hits.push({ role: explicitRole === 'unknown' ? sideRole : explicitRole, value, x: item.x });
    }
  }

  const unique: PartyHit[] = [];
  for (const hit of hits) {
    if (!unique.some((item) => item.value === hit.value)) unique.push(hit);
  }
  unique.sort((a, b) => a.x - b.x);

  let buyer = unique.find((item) => item.role === 'buyer')?.value ?? '';
  let seller = unique.find((item) => item.role === 'seller' && item.value !== buyer)?.value ?? '';

  if (!buyer) {
    buyer = unique.find((item) => item.value !== seller)?.value ?? '';
  }
  if (!seller) {
    seller = unique.find((item) => item.value !== buyer)?.value ?? '';
  }

  return { buyer, seller };
}

function extractTaxIds(lines: TextLine[], width: number): { buyerTaxId: string; sellerTaxId: string } {
  const result = { buyerTaxId: '', sellerTaxId: '' };
  const midpoint = width / 2;

  for (const line of lines) {
    const runs = lineRuns(line);
    for (let i = 0; i < runs.length; i += 1) {
      const item = runs[i];
      const label = normalizeText(item.str);
      if (!/统一社会信用代码|纳税人识别号|税号/.test(label)) continue;
      if (/名称/.test(label)) continue;

      const side: 'buyer' | 'seller' = item.x < midpoint ? 'buyer' : 'seller';
      let rest = label.replace(
        /^[\s\S]*?(?:统一社会信用代码|纳税人识别号|税号)\s*[:：\/]?\s*/,
        '',
      );
      let match = rest.match(/([0-9A-Za-z]{15,20})/);

      for (let j = i + 1; !match && j < runs.length; j += 1) {
        const next = runs[j];
        if (side === 'buyer' && next.x >= midpoint) break;
        if (side === 'seller' && next.x < midpoint) break;
        rest += normalizeText(next.str);
        match = rest.match(/([0-9A-Za-z]{15,20})/);
      }

      if (match) {
        const value = match[1].toUpperCase();
        if (side === 'buyer' && !result.buyerTaxId) result.buyerTaxId = value;
        if (side === 'seller' && !result.sellerTaxId) result.sellerTaxId = value;
      }
    }
  }

  return result;
}

function extractRailway(text: string, lines: TextLine[], fields: InvoiceFields): void {
  const travel = text.match(
    /([0-9]{4})年([0-9]{1,2})月([0-9]{1,2})日\s*([0-9]{1,2}:[0-9]{2})\s*开/,
  );
  if (travel) fields.travelDate = isoDate(travel[1], travel[2], travel[3]);

  let trainLine: TextLine | undefined;
  for (const line of lines) {
    if (!line.text.includes('站')) continue;
    const token = line.items.find((item) => TRAIN_TOKEN_RE.test(normalizeText(item.str)));
    if (token) {
      trainLine = line;
      break;
    }
  }

  if (trainLine) {
    const tokenIndex = trainLine.items.findIndex((item) =>
      TRAIN_TOKEN_RE.test(normalizeText(item.str)),
    );
    if (tokenIndex >= 0) {
      fields.trainNumber = normalizeText(trainLine.items[tokenIndex].str);
      fields.departure = trainLine.items
        .slice(0, tokenIndex)
        .map((item) => normalizeText(item.str))
        .join('')
        .replace(/站$/, '')
        .trim();
      fields.arrival = trainLine.items
        .slice(tokenIndex + 1)
        .map((item) => normalizeText(item.str))
        .join('')
        .replace(/站$/, '')
        .trim();
    }
  }

  if (!fields.trainNumber) {
    fields.trainNumber = text.match(/\b([GDCZTKY]\d{1,4})\b/)?.[1] ?? '';
  }

  fields.seatClass =
    text.match(/(商务座|优选一等座|一等座|二等座|无座|硬座|软座|硬卧|软卧|动卧)/)?.[1] ?? '';

  const idMatch = text.match(
    /([0-9]{6,10}\*{2,}[0-9A-Za-z]{3,4}|[0-9]{17}[0-9Xx])\s*([\u4e00-\u9fa5·]{2,10})/,
  );
  if (idMatch) {
    fields.passenger = idMatch[2];
  } else {
    const nameLine = lines.find((line) => /\*{2,}/.test(line.text));
    if (nameLine) {
      fields.passenger = nameLine.text.match(/([\u4e00-\u9fa5·]{2,10})\s*$/)?.[1] ?? '';
    }
  }

  fields.eticketNumber =
    text.match(/电子客票号[\s:：]*([0-9]{15,30})/)?.[1] ?? '';

  fields.remark = [
    fields.travelDate,
    fields.trainNumber,
    fields.departure && fields.arrival ? `${fields.departure}→${fields.arrival}` : '',
    fields.seatClass,
    fields.passenger,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * 输入一页的文字行，输出结构化发票字段。纯函数，便于单元测试。
 */
export function parseInvoicePage(
  width: number,
  height: number,
  lines: TextLine[],
): ParseResult {
  const text = textOf(lines);
  const normalized = normalizeText(text);
  const kind = detectKind(normalized);
  const fields = emptyFields(kind);

  fields.number = extractNumber(normalized);
  fields.code = extractCode(normalized);
  fields.issueDate = extractIssueDate(normalized);

  const amounts = extractAmounts(normalized, kind);
  fields.amountExTax = amounts.amountExTax;
  fields.taxAmount = amounts.taxAmount;
  fields.total = amounts.total;

  if (kind === 'railway') {
    extractRailway(normalized, lines, fields);
    const buyer = normalized.match(
      /购买方名称[\s:：]*([^\n]+?)(?:\s+统一社会信用代码|\n|$)/,
    );
    if (buyer) fields.buyerName = cleanupParty(buyer[1]);
    fields.buyerTaxId =
      normalized.match(/统一社会信用代码[\s:：]*([0-9A-Za-z]{15,20})/)?.[1]?.toUpperCase() ?? '';
  } else {
    const parties = extractParties(lines, width);
    fields.buyerName = parties.buyer;
    fields.sellerName = parties.seller;

    const taxes = extractTaxIds(lines, width);
    fields.buyerTaxId = taxes.buyerTaxId;
    fields.sellerTaxId = taxes.sellerTaxId;
  }

  fields.issuer = normalized.match(/开票人[\s:：]*([^\s\n]{1,20})/)?.[1] ?? '';

  const missing: string[] = [];
  if (!fields.number) missing.push('发票号码');
  if (fields.total == null) missing.push('金额');

  const isInvoice =
    Boolean(fields.number) ||
    fields.total != null ||
    (kind !== 'unknown' && Boolean(fields.buyerName || fields.sellerName));

  let note = '';
  if (lines.length === 0) {
    note = '此页没有文字层，可能是扫描件；可手工补录后合并';
  } else if (!isInvoice) {
    note = '未识别到发票信息，可能不是发票页';
  } else if (!fields.number) {
    note = '未识别到发票号码，请核对或手工补录';
  } else if (fields.total == null) {
    note = '未识别到金额，请核对或手工补录';
  }

  const confidence: ParseResult['confidence'] =
    fields.number && fields.total != null ? 'high' : fields.number || fields.total != null ? 'medium' : 'low';

  return { fields, kind, isInvoice, confidence, missing, note };
}
