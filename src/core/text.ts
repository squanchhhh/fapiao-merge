export interface RawTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

export interface TextLine {
  y: number;
  x: number;
  text: string;
  items: RawTextItem[];
}

/**
 * 统一全角数字、货币符号和标点。pdf.js 大多数情况下已经做了 NFKC，
 * 但不同 PDF 生成器差异很大，这里再兜底一次。
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/￥/g, '¥')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** 按 y 坐标把文字片段还原成行，再按 x 排序拼接。 */
export function buildLines(items: RawTextItem[]): TextLine[] {
  const groups: { y: number; items: RawTextItem[] }[] = [];
  // 有些 PDF 会把同一段文字重复绘制多遍（模拟加粗）。位置几乎相同的同文片段只保留一份。
  const seen = new Set<string>();

  for (const raw of items) {
    const str = normalizeText(raw.str ?? '');
    if (!str) continue;
    const key = `${str}|${Math.round(raw.x * 20)}|${Math.round(raw.y * 20)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const item: RawTextItem = { ...raw, str };

    // 取距离最近的分组，而不是第一个落在容差内的分组。
    // 竖排的「购买方信息」单字会和名称行基线接近，按最近分组才能让「名称：」和名称值留在同一行。
    let group: { y: number; items: RawTextItem[] } | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const candidate of groups) {
      const diff = Math.abs(candidate.y - raw.y);
      if (diff <= 2.5 && diff < bestDiff) {
        group = candidate;
        bestDiff = diff;
      }
    }

    if (group) {
      group.items.push(item);
      // 同一行的 y 取平均，避免个别字符基线略高造成分组漂移
      group.y = (group.y * (group.items.length - 1) + raw.y) / group.items.length;
    } else {
      groups.push({ y: raw.y, items: [item] });
    }
  }

  const lines: TextLine[] = groups.map((group) => {
    const sorted = group.items.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd = Number.NEGATIVE_INFINITY;
    for (const item of sorted) {
      const gap = item.x - prevEnd;
      if (text && gap > 1.2 && !text.endsWith(' ') && !item.str.startsWith(' ')) {
        text += ' ';
      }
      text += item.str;
      prevEnd = item.x + item.width;
    }
    return {
      y: group.y,
      x: sorted[0]?.x ?? 0,
      text: text.trim(),
      items: sorted,
    };
  });

  // PDF 坐标 y 向上，阅读顺序从大到小
  return lines.filter((line) => line.text.length > 0).sort((a, b) => b.y - a.y);
}

export function textOf(lines: TextLine[]): string {
  return lines.map((line) => line.text).join('\n');
}

/** 去掉数字之间的空格，便于金额/号码正则。 */
export function compactText(text: string): string {
  return text
    .replace(/[ \t]+/g, '')
    .replace(/(?<=\d)[ ]+(?=[\d.,])/g, '')
    .replace(/(?<=[¥])[ ]+(?=\d)/g, '');
}

export function onlyDigits(value: string): string {
  return value.replace(/[^0-9]/g, '');
}
