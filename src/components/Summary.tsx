import { useMemo, useState } from 'react';
import type { PageResult, SummaryDimension } from '../core/types';
import { computeStats, formatCents, groupRowsFor } from '../core/invoice';
import { buildSummaryCsv } from '../core/csv';
import { ChartIcon, DownloadIcon } from './Icons';

const DIMENSIONS: { value: SummaryDimension; label: string }[] = [
  { value: 'buyer', label: '按购买方' },
  { value: 'month', label: '按月份' },
  { value: 'kind', label: '按票种' },
];

function saveText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

export function Summary({ pages, dateStamp }: { pages: PageResult[]; dateStamp: string }) {
  const [dimension, setDimension] = useState<SummaryDimension>('buyer');
  const stats = useMemo(() => computeStats(pages), [pages]);
  const rows = groupRowsFor(stats, dimension);
  const maxTotal = Math.max(1, ...rows.map((row) => row.total));

  return (
    <div className="view summary-view">
      <div className="view-head">
        <div>
          <h2 className="panel-title">统计汇总</h2>
          <p className="panel-sub">
            仅统计已勾选且识别为发票的页面；重复发票和「非发票」页不计入。
          </p>
        </div>
        <button
          className="btn btn-text btn-sm"
          onClick={() => saveText(buildSummaryCsv(pages, dimension), `发票汇总_${dateStamp}.csv`)}
          disabled={rows.length === 0}
        >
          <DownloadIcon width={15} height={15} />
          汇总 CSV
        </button>
      </div>

      <div className="stat-grid">
        <div className="stat-card stat-primary">
          <span className="stat-label">价税合计</span>
          <strong className="stat-value">{formatCents(stats.total)}</strong>
          <span className="stat-note">{stats.count} 张发票</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">不含税金额</span>
          <strong className="stat-value">{formatCents(stats.amountExTax)}</strong>
          <span className="stat-note">按识别结果累加</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">税额</span>
          <strong className="stat-value">{formatCents(stats.tax)}</strong>
          <span className="stat-note">铁路票无税额</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">已排除重复</span>
          <strong className="stat-value">{stats.duplicateCount}</strong>
          <span className="stat-note">按发票号码判断</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">待补录</span>
          <strong className="stat-value">{stats.reviewCount}</strong>
          <span className="stat-note">缺少号码或金额</span>
        </div>
      </div>

      <div className="summary-tabs">
        <div className="segmented">
          {DIMENSIONS.map((item) => (
            <button
              key={item.value}
              className={dimension === item.value ? 'is-active' : ''}
              onClick={() => setDimension(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="summary-share">
          <ChartIcon width={14} height={14} />
          按金额占比排序
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="summary-empty">还没有可统计的发票</div>
      ) : (
        <div className="summary-table">
          <div className="summary-row summary-header">
            <span>{dimension === 'month' ? '月份' : dimension === 'kind' ? '票种' : '购买方'}</span>
            <span className="num">张数</span>
            <span className="num">不含税</span>
            <span className="num">税额</span>
            <span className="num">价税合计</span>
          </div>
          {rows.map((row) => (
            <div key={row.key} className="summary-row">
              <span className="summary-label">
                <span className="summary-name" title={row.label}>
                  {row.label}
                </span>
                <span className="summary-bar">
                  <span style={{ width: `${(row.total / maxTotal) * 100}%` }} />
                </span>
              </span>
              <span className="num">{row.count}</span>
              <span className="num">{formatCents(row.amountExTax)}</span>
              <span className="num">{formatCents(row.tax)}</span>
              <span className="num strong">{formatCents(row.total)}</span>
            </div>
          ))}
          <div className="summary-row summary-total">
            <span>合计</span>
            <span className="num">{stats.count}</span>
            <span className="num">{formatCents(stats.amountExTax)}</span>
            <span className="num">{formatCents(stats.tax)}</span>
            <span className="num strong">{formatCents(stats.total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
