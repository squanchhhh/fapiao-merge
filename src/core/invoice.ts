import type {
  InvoiceFile,
  InvoiceKind,
  PageResult,
  SortMode,
  SummaryDimension,
} from './types';
import { KIND_LABELS } from './types';
import { onlyDigits } from './text';

export function refreshDerived(page: PageResult): PageResult {
  const fields = page.fields;
  const isInvoice =
    Boolean(fields.number) ||
    fields.total != null ||
    (fields.kind !== 'unknown' && Boolean(fields.buyerName || fields.sellerName));

  const missing: string[] = [];
  if (!fields.number) missing.push('发票号码');
  if (fields.total == null) missing.push('金额');

  const confidence: PageResult['confidence'] =
    fields.number && fields.total != null
      ? 'high'
      : fields.number || fields.total != null
        ? 'medium'
        : 'low';

  let note = '';
  if (!isInvoice) {
    note = page.hasText
      ? '未识别到发票信息，可能不是发票页'
      : '此页没有文字层，可能是扫描件；可手工补录后合并';
  } else if (!fields.number) {
    note = page.hasText
      ? '未识别到发票号码，请核对或手工补录'
      : '此页没有文字层，可能是扫描件；可手工补录后合并';
  } else if (fields.total == null) {
    note = page.hasText
      ? '未识别到金额，请核对或手工补录'
      : '此页没有文字层，可能是扫描件；可手工补录后合并';
  }

  return { ...page, isInvoice, missing, confidence, parseNote: note };
}

/**
 * 同一批文件内按发票号码去重；号码相同只保留第一张计入合计和合并。
 * 用户手动勾选/取消的页面（includeTouched）不会被自动覆盖。
 */
export function dedupePages(pages: PageResult[]): PageResult[] {
  const seen = new Map<string, string>();
  return pages.map((page) => {
    const key = onlyDigits(page.fields.number);
    if (!key) {
      return {
        ...page,
        duplicate: false,
        duplicateOf: null,
        included: page.includeTouched ? page.included : true,
      };
    }
    const previous = seen.get(key);
    if (previous) {
      return {
        ...page,
        duplicate: true,
        duplicateOf: previous,
        included: page.includeTouched ? page.included : false,
      };
    }
    seen.set(key, page.id);
    return {
      ...page,
      duplicate: false,
      duplicateOf: null,
      included: page.includeTouched ? page.included : true,
    };
  });
}

export function dedupeFiles(files: InvoiceFile[]): InvoiceFile[] {
  const flat = files.flatMap((file) => file.pages);
  if (flat.length === 0) return files;
  const deduped = dedupePages(flat);
  const byId = new Map(deduped.map((page) => [page.id, page]));
  return files.map((file) => ({
    ...file,
    pages: file.pages.map((page) => byId.get(page.id)).filter((page): page is PageResult => Boolean(page)),
  }));
}

export function isA4Size(width: number, height: number, tolerance = 12): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= tolerance;
  return (
    (near(width, 595.28) && near(height, 841.89)) ||
    (near(width, 841.89) && near(height, 595.28))
  );
}

export function sortPages(
  pages: PageResult[],
  mode: SortMode,
  fileOrder: Map<string, number>,
): PageResult[] {
  const order = new Map<string, number>();
  pages.forEach((page, index) => order.set(page.id, index));
  const byFile = (a: PageResult, b: PageResult) => {
    const fa = fileOrder.get(a.fileId) ?? 0;
    const fb = fileOrder.get(b.fileId) ?? 0;
    return fa - fb || a.pageIndex - b.pageIndex || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  };

  return [...pages].sort((a, b) => {
    if (mode === 'date') {
      const da = a.fields.issueDate || '9999-99-99';
      const db = b.fields.issueDate || '9999-99-99';
      return da.localeCompare(db) || byFile(a, b);
    }
    if (mode === 'amount') {
      const ta = a.fields.total ?? -1;
      const tb = b.fields.total ?? -1;
      return tb - ta || byFile(a, b);
    }
    if (mode === 'buyer') {
      const na = a.fields.buyerName || '￿';
      const nb = b.fields.buyerName || '￿';
      return na.localeCompare(nb, 'zh-CN') || byFile(a, b);
    }
    return byFile(a, b);
  });
}

export interface GroupRow {
  key: string;
  label: string;
  count: number;
  amountExTax: number;
  tax: number;
  total: number;
}

export interface Stats {
  count: number;
  total: number;
  tax: number;
  amountExTax: number;
  duplicateCount: number;
  reviewCount: number;
  byKind: GroupRow[];
  byBuyer: GroupRow[];
  byMonth: GroupRow[];
}

function groupRows(
  pages: PageResult[],
  keyOf: (page: PageResult) => string,
  labelOf: (key: string, page: PageResult) => string,
): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const page of pages) {
    const key = keyOf(page) || '—';
    let row = map.get(key);
    if (!row) {
      row = { key, label: labelOf(key, page), count: 0, amountExTax: 0, tax: 0, total: 0 };
      map.set(key, row);
    }
    row.count += 1;
    row.amountExTax += page.fields.amountExTax ?? 0;
    row.tax += page.fields.taxAmount ?? 0;
    row.total += page.fields.total ?? 0;
  }
  return [...map.values()].sort((a, b) => b.total - a.total || b.count - a.count);
}

export function computeStats(allPages: PageResult[]): Stats {
  const included = allPages.filter((page) => page.included && page.isInvoice);
  const total = included.reduce((sum, page) => sum + (page.fields.total ?? 0), 0);
  const tax = included.reduce((sum, page) => sum + (page.fields.taxAmount ?? 0), 0);
  const amountExTax = included.reduce((sum, page) => {
    if (page.fields.amountExTax != null) return sum + page.fields.amountExTax;
    if (page.fields.total != null && page.fields.taxAmount != null) {
      return sum + Math.max(page.fields.total - page.fields.taxAmount, 0);
    }
    // 铁路票没有税额，票价本身就是该行的金额。
    if (page.fields.total != null) return sum + page.fields.total;
    return sum;
  }, 0);

  return {
    count: included.length,
    total,
    tax,
    amountExTax,
    duplicateCount: allPages.filter((page) => page.duplicate).length,
    reviewCount: allPages.filter(
      (page) => page.included && page.isInvoice && page.missing.length > 0,
    ).length,
    byKind: groupRows(
      included,
      (page) => page.fields.kind,
      (key) => KIND_LABELS[key as InvoiceKind] ?? key,
    ),
    byBuyer: groupRows(
      included,
      (page) => page.fields.buyerName.trim(),
      (key) => key,
    ),
    byMonth: groupRows(
      included,
      (page) => page.fields.issueDate.slice(0, 7),
      (key) => key,
    ),
  };
}

export function groupRowsFor(
  stats: Stats,
  dimension: SummaryDimension,
): GroupRow[] {
  if (dimension === 'month') return stats.byMonth;
  if (dimension === 'kind') return stats.byKind;
  return stats.byBuyer;
}

export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `¥${(cents / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatYuan(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}

export function dateStamp(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}_${m}_${d}`;
}
