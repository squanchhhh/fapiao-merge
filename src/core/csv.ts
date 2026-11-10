import type { PageResult, SummaryDimension } from './types';
import { KIND_LABELS } from './types';
import { computeStats, formatYuan, groupRowsFor } from './invoice';

function textCell(value: string): string {
  if (!value) return '';
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** 代码/号码用 Excel 公式包住，防止长数字变科学计数法、丢失前导零。 */
function codeCell(value: string): string {
  if (!value) return '';
  return `="${value.replace(/"/g, '""')}"`;
}

function moneyCell(cents: number | null | undefined): string {
  return cents == null ? '' : formatYuan(cents);
}

const DETAIL_HEADERS = [
  '序号',
  '发票类型',
  '发票代码',
  '发票号码',
  '开票日期',
  '购买方名称',
  '购买方税号',
  '销售方名称',
  '销售方税号',
  '金额(不含税)',
  '税额',
  '价税合计',
  '乘车日期',
  '车次',
  '出发站',
  '到达站',
  '座位等级',
  '乘车人',
  '电子客票号',
  '备注',
  '源文件',
  '页码',
  '是否重复',
  '是否计入',
];

export function buildDetailCsv(pages: PageResult[]): string {
  const rows = pages.map((page, index) => {
    const f = page.fields;
    return [
      String(index + 1),
      textCell(KIND_LABELS[f.kind]),
      codeCell(f.code),
      codeCell(f.number),
      textCell(f.issueDate),
      textCell(f.buyerName),
      codeCell(f.buyerTaxId),
      textCell(f.sellerName),
      codeCell(f.sellerTaxId),
      moneyCell(f.amountExTax),
      moneyCell(f.taxAmount),
      moneyCell(f.total),
      textCell(f.travelDate),
      textCell(f.trainNumber),
      textCell(f.departure),
      textCell(f.arrival),
      textCell(f.seatClass),
      textCell(f.passenger),
      codeCell(f.eticketNumber),
      textCell(f.remark),
      textCell(page.fileName),
      String(page.pageIndex + 1),
      page.duplicate ? '是' : '否',
      page.included ? '是' : '否',
    ].join(',');
  });

  return `\uFEFF${DETAIL_HEADERS.join(',')}\r\n${rows.join('\r\n')}\r\n`;
}

const DIMENSION_LABELS: Record<SummaryDimension, string> = {
  buyer: '购买方',
  month: '月份',
  kind: '发票类型',
};

export function buildSummaryCsv(pages: PageResult[], dimension: SummaryDimension): string {
  const stats = computeStats(pages);
  const rows = groupRowsFor(stats, dimension).map((row, index) => [
    String(index + 1),
    textCell(row.label),
    String(row.count),
    moneyCell(row.amountExTax),
    moneyCell(row.tax),
    moneyCell(row.total),
  ]);

  const header = ['序号', DIMENSION_LABELS[dimension], '张数', '金额(不含税)', '税额', '价税合计'];
  const totalRow = [
    '',
    '合计',
    String(stats.count),
    formatYuan(stats.amountExTax),
    formatYuan(stats.tax),
    formatYuan(stats.total),
  ];

  return `\uFEFF${header.join(',')}\r\n${rows.map((row) => row.join(',')).join('\r\n')}\r\n${totalRow.join(',')}\r\n`;
}
