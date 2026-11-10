import { useMemo, useState } from 'react';
import type { InvoiceKind, PageResult } from '../core/types';
import { KIND_LABELS, KIND_SHORT } from '../core/types';
import { formatCents } from '../core/invoice';
import { EditIcon, SearchIcon, TrainIcon } from './Icons';

type Filter = 'all' | 'duplicate' | 'review' | 'excluded' | 'railway' | 'non-invoice';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'review', label: '待补录' },
  { value: 'duplicate', label: '重复' },
  { value: 'railway', label: '铁路票' },
  { value: 'non-invoice', label: '非发票' },
  { value: 'excluded', label: '未计入' },
];

function matchesQuery(page: PageResult, query: string): boolean {
  if (!query) return true;
  const haystack = [
    page.fields.number,
    page.fields.code,
    page.fields.buyerName,
    page.fields.sellerName,
    page.fields.buyerTaxId,
    page.fields.sellerTaxId,
    page.fields.trainNumber,
    page.fields.passenger,
    page.fields.remark,
    page.fileName,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function matchesFilter(page: PageResult, filter: Filter): boolean {
  if (filter === 'duplicate') return page.duplicate;
  if (filter === 'review') return page.included && page.isInvoice && page.missing.length > 0;
  if (filter === 'excluded') return !page.included;
  if (filter === 'railway') return page.fields.kind === 'railway';
  if (filter === 'non-invoice') return !page.isInvoice;
  return true;
}

export function InvoiceTable({
  pages,
  onToggleInclude,
  onEdit,
  onSetAll,
}: {
  pages: PageResult[];
  onToggleInclude: (id: string) => void;
  onEdit: (id: string) => void;
  onSetAll: (included: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | InvoiceKind>('all');
  const [filter, setFilter] = useState<Filter>('all');

  const kinds = useMemo(() => {
    const set = new Set<InvoiceKind>();
    pages.forEach((page) => set.add(page.fields.kind));
    return [...set];
  }, [pages]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pages.filter(
      (page) =>
        matchesQuery(page, q) &&
        matchesFilter(page, filter) &&
        (kind === 'all' || page.fields.kind === kind),
    );
  }, [pages, query, filter, kind]);

  const includedCount = pages.filter((page) => page.included).length;

  return (
    <div className="view table-view">
      <div className="view-head">
        <div>
          <h2 className="panel-title">发票明细</h2>
          <p className="panel-sub">
            共 {pages.length} 页 · 已计入 {includedCount} 页
            {visible.length !== pages.length ? ` · 当前筛选 ${visible.length} 页` : ''}
          </p>
        </div>
        <div className="table-head-actions">
          <button className="btn btn-text btn-sm" onClick={() => onSetAll(true)}>
            全部计入
          </button>
          <button className="btn btn-text btn-sm" onClick={() => onSetAll(false)}>
            全部不计入
          </button>
        </div>
      </div>

      <div className="table-toolbar">
        <label className="search-box">
          <SearchIcon width={15} height={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索号码、购买方、销售方、车次、文件名…"
            aria-label="搜索发票"
          />
        </label>
        <select
          className="select"
          value={kind}
          onChange={(event) => setKind(event.target.value as 'all' | InvoiceKind)}
          aria-label="按票种筛选"
        >
          <option value="all">全部票种</option>
          {kinds.map((item) => (
            <option key={item} value={item}>
              {KIND_LABELS[item]}
            </option>
          ))}
        </select>
      </div>

      <div className="chip-row">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            className={`chip ${filter === item.value ? 'is-active' : ''}`}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="table-scroll">
        <table className="invoice-table">
          <thead>
            <tr>
              <th className="col-check">
                <span className="sr-only">计入</span>
              </th>
              <th>类型</th>
              <th>发票号码</th>
              <th>开票日期</th>
              <th>购买方</th>
              <th>销售方</th>
              <th className="num">价税合计</th>
              <th>来源</th>
              <th className="col-action">
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={9} className="table-empty">
                  {pages.length === 0 ? '添加 PDF 后自动识别发票信息' : '没有匹配的发票'}
                </td>
              </tr>
            ) : (
              visible.map((page) => {
                const fields = page.fields;
                const isRailway = fields.kind === 'railway';
                return (
                  <tr
                    key={page.id}
                    className={[
                      !page.included ? 'is-excluded' : '',
                      page.duplicate ? 'is-duplicate' : '',
                      !page.isInvoice ? 'is-noninvoice' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={page.included}
                        onChange={() => onToggleInclude(page.id)}
                        aria-label={`计入第 ${page.pageIndex + 1} 页`}
                      />
                    </td>
                    <td>
                      <span className={`kind-badge kind-${fields.kind}`}>
                        {isRailway && <TrainIcon width={12} height={12} />}
                        {KIND_SHORT[fields.kind]}
                      </span>
                    </td>
                    <td className="mono">
                      <span className="cell-ellipsis" title={fields.number || '未识别'}>
                        {fields.number || '—'}
                      </span>
                      <span className="cell-flags">
                        {page.duplicate && <span className="flag flag-dup">重复</span>}
                        {!page.isInvoice && <span className="flag flag-warn">非发票</span>}
                        {page.manual && <span className="flag flag-edit">已修改</span>}
                        {page.included && page.isInvoice && page.missing.length > 0 && (
                          <span className="flag flag-review">待补录</span>
                        )}
                      </span>
                    </td>
                    <td className="nowrap">
                      {fields.issueDate || '—'}
                      {isRailway && (
                        <div
                          className="cell-sub"
                          title={[fields.travelDate, fields.trainNumber, fields.departure && fields.arrival
                            ? `${fields.departure}→${fields.arrival}`
                            : '', fields.seatClass, fields.passenger]
                            .filter(Boolean)
                            .join(' · ')}
                        >
                          {[fields.travelDate, fields.trainNumber, fields.departure && fields.arrival
                            ? `${fields.departure}→${fields.arrival}`
                            : '']
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="cell-ellipsis" title={fields.buyerName || '未识别'}>
                        {fields.buyerName || '—'}
                      </span>
                    </td>
                    <td>
                      <span className="cell-ellipsis" title={fields.sellerName || '未识别'}>
                        {fields.sellerName || (isRailway ? '12306' : '—')}
                      </span>
                    </td>
                    <td className="num">
                      <span className="amount-main">{formatCents(fields.total)}</span>
                      <div
                        className="cell-sub"
                        title={
                          isRailway
                            ? '铁路电子客票只有票价，没有税额'
                            : `不含税 ${formatCents(fields.amountExTax)} · 税额 ${formatCents(fields.taxAmount)}`
                        }
                      >
                        {isRailway
                          ? '铁路票价'
                          : fields.taxAmount != null
                            ? `税 ${formatCents(fields.taxAmount)}`
                            : fields.amountExTax != null
                              ? '无税额'
                              : ''}
                      </div>
                    </td>
                    <td>
                      <span className="cell-ellipsis cell-file" title={`${page.fileName} 第 ${page.pageIndex + 1} 页`}>
                        {page.fileName}
                        <span className="cell-sub">第 {page.pageIndex + 1} 页</span>
                      </span>
                    </td>
                    <td className="col-action">
                      <button
                        className="icon-btn"
                        onClick={() => onEdit(page.id)}
                        title="编辑识别结果"
                      >
                        <EditIcon width={15} height={15} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pages.some((page) => !page.isInvoice) && (
        <p className="table-hint">
          标为「非发票」的页面不计入金额统计，但仍会默认合并；如不需要可在左侧取消勾选。
        </p>
      )}
    </div>
  );
}
