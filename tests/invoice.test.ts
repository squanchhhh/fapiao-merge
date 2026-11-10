import { describe, expect, it } from 'vitest';
import { emptyFields, type PageResult } from '../src/core/types';
import {
  computeStats,
  dedupePages,
  formatCents,
  refreshDerived,
  sortPages,
} from '../src/core/invoice';
import { buildDetailCsv } from '../src/core/csv';

function makePage(
  id: string,
  overrides: Partial<PageResult> = {},
  fieldOverrides: Partial<PageResult['fields']> = {},
): PageResult {
  const fields = { ...emptyFields('digital-general'), ...fieldOverrides };
  return {
    id,
    fileId: 'file-1',
    fileName: '发票.pdf',
    pageIndex: 0,
    width: 595,
    height: 397,
    rotation: 0,
    isA4: false,
    fields,
    originalFields: { ...fields },
    isInvoice: true,
    parseNote: '',
    missing: [],
    confidence: 'high',
    manual: false,
    included: true,
    includeTouched: false,
    duplicate: false,
    duplicateOf: null,
    hasText: true,
    ...overrides,
  };
}

describe('去重', () => {
  it('相同发票号码只保留第一张', () => {
    const pages = dedupePages([
      makePage('a', {}, { number: '12345678901234567890', total: 100 }),
      makePage('b', {}, { number: '12345678901234567890', total: 100 }),
      makePage('c', {}, { number: '99999999999999999999', total: 200 }),
    ]);

    expect(pages[0].duplicate).toBe(false);
    expect(pages[0].included).toBe(true);
    expect(pages[1].duplicate).toBe(true);
    expect(pages[1].included).toBe(false);
    expect(pages[1].duplicateOf).toBe('a');
    expect(pages[2].duplicate).toBe(false);
    expect(pages[2].included).toBe(true);
  });

  it('用户手动勾选不会被自动覆盖', () => {
    const pages = dedupePages([
      makePage('a', {}, { number: '11111111111111111111' }),
      makePage('b', { includeTouched: true, included: true }, { number: '11111111111111111111' }),
    ]);

    expect(pages[1].duplicate).toBe(true);
    expect(pages[1].included).toBe(true);
  });

  it('没有号码的页面默认也计入合并', () => {
    const pages = dedupePages([makePage('blank', { isInvoice: false }, { number: '' })]);
    expect(pages[0].duplicate).toBe(false);
    expect(pages[0].included).toBe(true);
  });
});

describe('统计', () => {
  it('只统计已计入的发票，排除重复和非发票', () => {
    const pages = dedupePages([
      makePage('a', {}, { number: '1', amountExTax: 10000, taxAmount: 300, total: 10300 }),
      makePage('b', {}, { number: '1', amountExTax: 10000, taxAmount: 300, total: 10300 }),
      makePage('c', { isInvoice: false }, { number: '' }),
      makePage('d', {}, { number: '2', amountExTax: 20000, taxAmount: 600, total: 20600 }),
    ]);

    const stats = computeStats(pages);
    expect(stats.count).toBe(2);
    expect(stats.total).toBe(30900);
    expect(stats.tax).toBe(900);
    expect(stats.amountExTax).toBe(30000);
    expect(stats.duplicateCount).toBe(1);
  });

  it('铁路票只有价税合计也能统计', () => {
    const page = makePage(
      'rail',
      { fields: { ...emptyFields('railway'), total: 71000, number: '2634' }, originalFields: emptyFields('railway') },
    );
    const stats = computeStats([page]);
    expect(stats.count).toBe(1);
    expect(stats.total).toBe(71000);
    expect(stats.amountExTax).toBe(71000);
  });
});

describe('派生字段', () => {
  it('手工补录后重新判断为发票并清除待补录', () => {
    const page = makePage(
      'x',
      { isInvoice: false, missing: ['发票号码', '金额'], hasText: false },
      { number: '', total: null },
    );
    const refreshed = refreshDerived({
      ...page,
      fields: { ...page.fields, number: '12345678', total: 5000 },
    });
    expect(refreshed.isInvoice).toBe(true);
    expect(refreshed.missing).toEqual([]);
    expect(refreshed.confidence).toBe('high');
    expect(refreshed.parseNote).toBe('');
  });
});

describe('金额格式化', () => {
  it('保留两位小数', () => {
    expect(formatCents(434000)).toBe('¥4,340.00');
    expect(formatCents(null)).toBe('—');
  });
});

describe('CSV', () => {
  it('号码使用 Excel 文本公式，避免科学计数法', () => {
    const page = makePage('a', {}, { number: '26442000012720904291', total: 434000 });
    const csv = buildDetailCsv([page]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('="26442000012720904291"');
    expect(csv).toContain('4340.00');
    expect(csv.split('\r\n')[0]).toContain('发票号码');
  });
});

describe('排序', () => {
  it('按金额从高到低', () => {
    const order = new Map([['file-1', 0]]);
    const sorted = sortPages(
      [
        makePage('a', {}, { total: 100 }),
        makePage('b', {}, { total: 300 }),
        makePage('c', {}, { total: 200 }),
      ],
      'amount',
      order,
    );
    expect(sorted.map((page) => page.id)).toEqual(['b', 'c', 'a']);
  });
});
