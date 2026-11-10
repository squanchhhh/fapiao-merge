import { useEffect, useMemo, useState } from 'react';
import type { InvoiceFields, InvoiceKind, PageResult } from '../core/types';
import { KIND_LABELS } from '../core/types';
import { CloseIcon, RefreshIcon } from './Icons';

type MoneyKey = 'amountExTax' | 'taxAmount' | 'total';
type FormState = Omit<InvoiceFields, MoneyKey> & Record<MoneyKey, string>;

const KIND_ORDER: InvoiceKind[] = [
  'digital-general',
  'digital-special',
  'traditional-general',
  'traditional-special',
  'railway',
  'unknown',
];

function toInput(cents: number | null): string {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

function fromInput(value: string): number | null {
  const cleaned = value.replace(/[,，\s¥￥]/g, '');
  if (!cleaned) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

function toForm(page: PageResult): FormState {
  const fields = page.fields;
  return {
    ...fields,
    amountExTax: toInput(fields.amountExTax),
    taxAmount: toInput(fields.taxAmount),
    total: toInput(fields.total),
  };
}

function buildFields(form: FormState): InvoiceFields {
  return {
    ...form,
    amountExTax: fromInput(form.amountExTax),
    taxAmount: fromInput(form.taxAmount),
    total: fromInput(form.total),
  };
}

export function EditDrawer({
  page,
  onClose,
  onSave,
}: {
  page: PageResult | null;
  onClose: () => void;
  onSave: (fields: InvoiceFields) => void;
}) {
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!page) {
      setForm(null);
      return;
    }
    setForm(toForm(page));
    setError('');
  }, [page?.id]);

  useEffect(() => {
    if (!page) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [page, onClose]);

  const liveSum = useMemo(() => {
    if (!form) return null;
    const amount = fromInput(form.amountExTax);
    const tax = fromInput(form.taxAmount);
    if (amount == null && tax == null) return null;
    return (amount ?? 0) + (tax ?? 0);
  }, [form]);

  if (!page || !form) return null;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => (previous ? { ...previous, [key]: value } : previous));
    setError('');
  };

  const reset = () => {
    setForm(toForm({ ...page, fields: page.originalFields }));
    setError('');
  };

  const submit = () => {
    const fields = buildFields(form);
    if (!fields.number.trim() && fields.total == null) {
      setError('至少填写发票号码或价税合计，才能计入统计。');
      return;
    }
    if (form.total && fields.total == null) {
      setError('价税合计格式不正确，请填数字，例如 4340.00。');
      return;
    }
    onSave(fields);
  };

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="编辑发票识别结果"
      >
        <header className="drawer-head">
          <div>
            <h2>编辑识别结果</h2>
            <p>
              {page.fileName} · 第 {page.pageIndex + 1} 页
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭">
            <CloseIcon width={18} height={18} />
          </button>
        </header>

        <div className="drawer-body">
          <section className="form-section">
            <h3>基本信息</h3>
            <div className="form-grid">
              <label className="form-field form-span-2">
                <span>票种</span>
                <select
                  value={form.kind}
                  onChange={(event) => update('kind', event.target.value as InvoiceKind)}
                >
                  {KIND_ORDER.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>发票代码</span>
                <input
                  value={form.code}
                  onChange={(event) => update('code', event.target.value)}
                  placeholder="传统发票才有"
                  inputMode="numeric"
                />
              </label>
              <label className="form-field">
                <span>发票号码</span>
                <input
                  value={form.number}
                  onChange={(event) => update('number', event.target.value)}
                  placeholder="20 位数字"
                  inputMode="numeric"
                />
              </label>
              <label className="form-field">
                <span>开票日期</span>
                <input
                  type="date"
                  value={form.issueDate}
                  onChange={(event) => update('issueDate', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>开票人</span>
                <input
                  value={form.issuer}
                  onChange={(event) => update('issuer', event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="form-section">
            <h3>购买方 / 销售方</h3>
            <div className="form-grid">
              <label className="form-field form-span-2">
                <span>购买方名称</span>
                <input
                  value={form.buyerName}
                  onChange={(event) => update('buyerName', event.target.value)}
                />
              </label>
              <label className="form-field form-span-2">
                <span>购买方税号</span>
                <input
                  value={form.buyerTaxId}
                  onChange={(event) => update('buyerTaxId', event.target.value)}
                />
              </label>
              <label className="form-field form-span-2">
                <span>销售方名称</span>
                <input
                  value={form.sellerName}
                  onChange={(event) => update('sellerName', event.target.value)}
                />
              </label>
              <label className="form-field form-span-2">
                <span>销售方税号</span>
                <input
                  value={form.sellerTaxId}
                  onChange={(event) => update('sellerTaxId', event.target.value)}
                />
              </label>
            </div>
          </section>

          <section className="form-section">
            <h3>金额（元）</h3>
            <div className="form-grid">
              <label className="form-field">
                <span>不含税金额</span>
                <input
                  value={form.amountExTax}
                  onChange={(event) => update('amountExTax', event.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                />
              </label>
              <label className="form-field">
                <span>税额</span>
                <input
                  value={form.taxAmount}
                  onChange={(event) => update('taxAmount', event.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                />
              </label>
              <label className="form-field">
                <span>价税合计</span>
                <input
                  value={form.total}
                  onChange={(event) => update('total', event.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                />
              </label>
              <div className="form-field form-hint">
                <span>提示</span>
                <p>
                  {liveSum != null && form.total.trim() === ''
                    ? `不含税 + 税额 = ${(liveSum / 100).toFixed(2)}，可一键填入。`
                    : '铁路票只填「价税合计」即可，税额留空。'}
                </p>
                {liveSum != null && form.total.trim() === '' && (
                  <button
                    className="btn btn-text btn-sm"
                    onClick={() => update('total', (liveSum / 100).toFixed(2))}
                  >
                    填入 {(liveSum / 100).toFixed(2)}
                  </button>
                )}
              </div>
            </div>
          </section>

          <details className="form-section" open={form.kind === 'railway'}>
            <summary>
              <h3>铁路电子客票信息</h3>
            </summary>
            <div className="form-grid">
              <label className="form-field">
                <span>乘车日期</span>
                <input
                  type="date"
                  value={form.travelDate}
                  onChange={(event) => update('travelDate', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>车次</span>
                <input
                  value={form.trainNumber}
                  onChange={(event) => update('trainNumber', event.target.value)}
                  placeholder="G385"
                />
              </label>
              <label className="form-field">
                <span>出发站</span>
                <input
                  value={form.departure}
                  onChange={(event) => update('departure', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>到达站</span>
                <input
                  value={form.arrival}
                  onChange={(event) => update('arrival', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>座位等级</span>
                <input
                  value={form.seatClass}
                  onChange={(event) => update('seatClass', event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>乘车人</span>
                <input
                  value={form.passenger}
                  onChange={(event) => update('passenger', event.target.value)}
                />
              </label>
              <label className="form-field form-span-2">
                <span>电子客票号</span>
                <input
                  value={form.eticketNumber}
                  onChange={(event) => update('eticketNumber', event.target.value)}
                  inputMode="numeric"
                />
              </label>
            </div>
          </details>

          <section className="form-section">
            <label className="form-field">
              <span>备注</span>
              <textarea
                rows={3}
                value={form.remark}
                onChange={(event) => update('remark', event.target.value)}
                placeholder="可记录项目、报销说明等，会写入 CSV。"
              />
            </label>
          </section>

          {!page.hasText && (
            <p className="drawer-note">
              此页没有文字层（可能是扫描件）。识别结果为空时，请手工补录号码和金额；合并时仍使用原始页面图像。
            </p>
          )}
          {error && <p className="drawer-error">{error}</p>}
        </div>

        <footer className="drawer-foot">
          <button className="btn btn-text" onClick={reset}>
            <RefreshIcon width={16} height={16} />
            恢复识别值
          </button>
          <div className="drawer-foot-right">
            <button className="btn btn-outlined" onClick={onClose}>
              取消
            </button>
            <button className="btn btn-filled" onClick={submit}>
              保存修改
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
