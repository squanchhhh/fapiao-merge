import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  InvoiceFields,
  InvoiceFile,
  LayoutMode,
  PageResult,
  SortMode,
  ToastItem,
} from './core/types';
import { LAYOUT_LABELS, SORT_LABELS, cloneFields } from './core/types';
import { buildLines, type RawTextItem } from './core/text';
import { parseInvoicePage } from './core/parser';
import {
  computeStats,
  dateStamp,
  dedupeFiles,
  formatCents,
  refreshDerived,
  sortPages,
} from './core/invoice';
import { buildDetailCsv } from './core/csv';
import { sha256Hex, isPdfHeader } from './core/hash';
import { mergeInvoices, type MergePageRef } from './core/merge';
import {
  extractPageItems,
  loadPdfDocument,
  rasterizePageToPng,
} from './core/pdfBrowser';
import { DropZone } from './components/DropZone';
import { FileList } from './components/FileList';
import { InvoiceTable } from './components/InvoiceTable';
import { Summary } from './components/Summary';
import { PdfPreview } from './components/PdfPreview';
import { EditDrawer } from './components/EditDrawer';
import { HelpDialog } from './components/HelpDialog';
import { Toasts } from './components/Toasts';
import {
  AlertIcon,
  ChartIcon,
  DownloadIcon,
  FileIcon,
  HelpIcon,
  PrinterIcon,
  ReceiptIcon,
  ScissorsIcon,
  ShieldIcon,
  TableIcon,
} from './components/Icons';

const LAYOUT_OPTIONS: LayoutMode[] = ['two-up-line', 'two-up', 'four-up', 'original'];

type WorkspaceTab = 'detail' | 'summary' | 'preview';

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function toBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new Uint8Array(bytes);
  return new Blob([copy.buffer], { type });
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function saveText(text: string, filename: string): void {
  saveBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), filename);
}

export default function App() {
  const [files, setFiles] = useState<InvoiceFile[]>([]);
  const [layout, setLayout] = useState<LayoutMode>('two-up-line');
  const [divider, setDivider] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>('file');
  const [tab, setTab] = useState<WorkspaceTab>('detail');
  const [helpOpen, setHelpOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [merged, setMerged] = useState<Uint8Array | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const buffersRef = useRef(new Map<string, ArrayBuffer>());
  const mergeGen = useRef(0);
  const toastId = useRef(0);

  const toast = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = (toastId.current += 1);
    setToasts((previous) => [...previous, { id, message, tone }]);
    setTimeout(() => {
      setToasts((previous) => previous.filter((item) => item.id !== id));
    }, 4600);
  }, []);

  const allPages = useMemo(() => files.flatMap((file) => file.pages), [files]);
  const stats = useMemo(() => computeStats(allPages), [allPages]);
  const fileOrderKey = files.map((file) => file.id).join('|');
  const fileOrder = useMemo(() => {
    const map = new Map<string, number>();
    files.forEach((file, index) => map.set(file.id, index));
    return map;
    // 只有文件增删或排序变化时才需要重建，编辑字段不应触发重新合并。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileOrderKey]);
  const editingPage = useMemo(
    () => allPages.find((page) => page.id === editingId) ?? null,
    [allPages, editingId],
  );

  const updatePage = useCallback((id: string, updater: (page: PageResult) => PageResult) => {
    setFiles((previous) =>
      dedupeFiles(
        previous.map((file) => ({
          ...file,
          pages: file.pages.map((page) => (page.id === id ? updater(page) : page)),
        })),
      ),
    );
  }, []);

  const parseInto = useCallback(
    async (file: File, id: string, buffer: ArrayBuffer) => {
      const document = await loadPdfDocument(new Uint8Array(buffer));
      try {
        const pageCount = document.numPages;
        setFiles((previous) =>
          previous.map((item) =>
            item.id === id ? { ...item, pageCount, status: 'processing' as const } : item,
          ),
        );

        const pages: PageResult[] = [];
        for (let index = 0; index < pageCount; index += 1) {
          const page = await document.getPage(index + 1);
          const viewport = page.getViewport({ scale: 1 });
          let items: RawTextItem[] = [];
          try {
            items = await extractPageItems(page);
          } catch {
            items = [];
          }
          const lines = buildLines(items);
          const result = parseInvoicePage(viewport.width, viewport.height, lines);
          pages.push({
            id: `${id}:${index}`,
            fileId: id,
            fileName: file.name,
            pageIndex: index,
            width: viewport.width,
            height: viewport.height,
            rotation: page.rotate ?? 0,
            isA4:
              (Math.abs(viewport.width - 595.28) < 12 && Math.abs(viewport.height - 841.89) < 12) ||
              (Math.abs(viewport.width - 841.89) < 12 && Math.abs(viewport.height - 595.28) < 12),
            fields: result.fields,
            originalFields: cloneFields(result.fields),
            isInvoice: result.isInvoice,
            parseNote: result.note,
            missing: result.missing,
            confidence: result.confidence,
            manual: false,
            included: true,
            includeTouched: false,
            duplicate: false,
            duplicateOf: null,
            hasText: items.length > 0,
          });

          setFiles((previous) =>
            previous.map((item) =>
              item.id === id
                ? { ...item, pages: [...pages], progress: (index + 1) / pageCount }
                : item,
            ),
          );
        }

        setFiles((previous) =>
          dedupeFiles(
            previous.map((item) =>
              item.id === id
                ? { ...item, status: 'done' as const, progress: 1, pages, pageCount }
                : item,
            ),
          ),
        );
      } finally {
        try {
          await document.destroy();
        } catch {
          /* 忽略销毁异常 */
        }
      }
    },
    [],
  );

  const addFiles = useCallback(
    async (incoming: File[]) => {
      const pdfs = incoming.filter(
        (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name),
      );
      if (pdfs.length === 0) {
        toast('请选择 PDF 文件', 'warning');
        return;
      }

      for (const file of pdfs) {
        let buffer: ArrayBuffer;
        try {
          buffer = await file.arrayBuffer();
        } catch {
          toast(`无法读取 ${file.name}`, 'error');
          continue;
        }

        if (!isPdfHeader(new Uint8Array(buffer.slice(0, 1024)))) {
          toast(`${file.name} 不是有效的 PDF`, 'error');
          continue;
        }

        const id = await sha256Hex(buffer);
        if (buffersRef.current.has(id)) {
          toast(`已跳过重复文件：${file.name}`, 'warning');
          continue;
        }

        buffersRef.current.set(id, buffer);
        const placeholder: InvoiceFile = {
          id,
          file,
          name: file.name,
          size: file.size,
          status: 'processing',
          pageCount: 0,
          progress: 0,
          pages: [],
        };
        setFiles((previous) => [...previous, placeholder]);

        try {
          await parseInto(file, id, buffer);
        } catch (error) {
          setFiles((previous) =>
            previous.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: 'error' as const,
                    error: `无法解析：${errorText(error)}`,
                  }
                : item,
            ),
          );
          toast(`${file.name} 解析失败，可能是加密或损坏的 PDF`, 'error');
        }
      }
    },
    [parseInto, toast],
  );

  const removeFile = useCallback((id: string) => {
    buffersRef.current.delete(id);
    setFiles((previous) => dedupeFiles(previous.filter((file) => file.id !== id)));
  }, []);

  const reorderFiles = useCallback((from: number, to: number) => {
    setFiles((previous) => {
      if (from === to || from < 0 || to < 0 || from >= previous.length || to >= previous.length) {
        return previous;
      }
      const next = [...previous];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    if (files.length === 0) return;
    if (!window.confirm('清空所有文件和识别结果？此操作无法撤销。')) return;
    buffersRef.current.clear();
    mergeGen.current += 1;
    setFiles([]);
    setMerged(null);
    setMergeError('');
    setMerging(false);
    setEditingId(null);
  }, [files.length]);

  const toggleInclude = useCallback(
    (id: string) => {
      updatePage(id, (page) => ({
        ...page,
        included: !page.included,
        includeTouched: true,
      }));
    },
    [updatePage],
  );

  const setAllIncluded = useCallback(
    (included: boolean) => {
      setFiles((previous) =>
        dedupeFiles(
          previous.map((file) => ({
            ...file,
            pages: file.pages.map((page) => ({
              ...page,
              included: included && !page.duplicate,
              includeTouched: true,
            })),
          })),
        ),
      );
    },
    [],
  );

  const saveEdit = useCallback(
    (fields: InvoiceFields) => {
      if (!editingId) return;
      updatePage(editingId, (page) =>
        refreshDerived({ ...page, fields, manual: true }),
      );
      setEditingId(null);
      toast('已保存修改，统计和合并结果已更新', 'success');
    },
    [editingId, toast, updatePage],
  );

  const includedKey = allPages
    .filter((page) => page.included)
    .map((page) => `${page.fileId}:${page.pageIndex}`)
    .join('|');

  useEffect(() => {
    const included = allPages.filter((page) => page.included);
    // 依赖一变就作废上一次合并，避免旧结果在防抖窗口内被下载。
    const generation = (mergeGen.current += 1);

    if (included.length === 0) {
      setMerged(null);
      setMerging(false);
      setMergeError('');
      return;
    }

    setMerging(true);
    setMergeError('');

    const timer = setTimeout(() => {
      const run = async () => {
        try {
          const ordered = sortPages(included, sortMode, fileOrder);
          const refs: MergePageRef[] = ordered.map((page) => ({
            sourceId: page.fileId,
            pageIndex: page.pageIndex,
            rotation: page.rotation,
            isA4: page.isA4,
          }));

          const sources = new Map<string, ArrayBuffer>();
          for (const sourceId of new Set(refs.map((ref) => ref.sourceId))) {
            let buffer = buffersRef.current.get(sourceId);
            if (!buffer) {
              const source = files.find((file) => file.id === sourceId);
              if (source) {
                buffer = await source.file.arrayBuffer();
                buffersRef.current.set(sourceId, buffer);
              }
            }
            if (buffer) sources.set(sourceId, buffer);
          }

          const warnings: string[] = [];
          const bytes = await mergeInvoices(
            sources,
            refs,
            { layout, divider: layout === 'two-up-line' ? true : layout === 'original' ? false : divider },
            async (ref) => {
              let buffer = buffersRef.current.get(ref.sourceId);
              if (!buffer) {
                const source = files.find((file) => file.id === ref.sourceId);
                if (source) {
                  buffer = await source.file.arrayBuffer();
                  buffersRef.current.set(ref.sourceId, buffer);
                }
              }
              if (!buffer) throw new Error('源文件已释放，请重新添加');
              // 兜底图片会替代原页面的文字层，用 4 倍（约 288dpi）保证打印不发虚。
              return rasterizePageToPng(new Uint8Array(buffer), ref.pageIndex, 4);
            },
            undefined,
            (message) => warnings.push(message),
          );

          if (generation === mergeGen.current) {
            setMerged(bytes);
            setMerging(false);
            if (warnings.length > 0) {
              toast(
                `有 ${warnings.length} 页无法直接嵌入，已自动转成图片或空白占位（${warnings[0]}）`,
                'warning',
              );
            }
          }
        } catch (error) {
          if (generation === mergeGen.current) {
            setMerged(null);
            setMerging(false);
            setMergeError(`合并失败：${errorText(error)}`);
          }
        }
      };
      void run();
    }, 350);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includedKey, layout, divider, sortMode, fileOrder]);

  const downloadPdf = useCallback(() => {
    if (!merged) {
      toast('合并还没完成，请稍候', 'warning');
      return;
    }
    saveBlob(toBlob(merged, 'application/pdf'), `发票合并_${dateStamp()}.pdf`);
    toast('已下载合并 PDF', 'success');
  }, [merged, toast]);

  const printPdf = useCallback(() => {
    if (!merged) {
      toast('合并还没完成，请稍候', 'warning');
      return;
    }
    const url = URL.createObjectURL(toBlob(merged, 'application/pdf'));
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = url;
    iframe.onload = () => {
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          saveBlob(toBlob(merged, 'application/pdf'), `发票合并_${dateStamp()}.pdf`);
          toast('浏览器阻止了直接打印，已下载 PDF，请用 PDF 阅读器打印', 'warning');
        }
      }, 400);
    };
    document.body.appendChild(iframe);
    setTimeout(() => {
      URL.revokeObjectURL(url);
      iframe.remove();
    }, 90000);
    toast('已打开打印对话框；请选择「实际大小」', 'info');
  }, [merged, toast]);

  const downloadCsv = useCallback(() => {
    if (allPages.length === 0) {
      toast('还没有可导出的发票', 'warning');
      return;
    }
    const ordered = sortPages(allPages, sortMode, fileOrder);
    saveText(buildDetailCsv(ordered), `发票明细_${dateStamp()}.csv`);
    toast('已导出明细 CSV', 'success');
  }, [allPages, fileOrder, sortMode, toast]);

  const changeLayout = useCallback((next: LayoutMode) => {
    setLayout(next);
    if (next === 'four-up') setDivider(true);
    if (next === 'two-up') setDivider(false);
  }, []);

  const canOutput = Boolean(merged) && !merging && allPages.some((page) => page.included);

  return (
    <div className="app">
      <header className="top-app-bar">
        <div className="top-app-bar-leading">
          <span className="app-icon">
            <ReceiptIcon width={22} height={22} />
          </span>
          <div className="app-title-block">
            <h1>发票本地版</h1>
            <span>合并 · 识别 · 打印</span>
          </div>
        </div>
        <div className="top-app-bar-actions">
          <span className="assist-chip">
            <ShieldIcon width={15} height={15} />
            离线 · 零上传
          </span>
          <button
            className="icon-btn"
            onClick={() => setHelpOpen(true)}
            title="使用说明"
            aria-label="使用说明"
          >
            <HelpIcon width={20} height={20} />
          </button>
        </div>
      </header>

      <div className="app-shell">
        <aside className="side-rail">
          <DropZone onFiles={(incoming) => void addFiles(incoming)} />
          <FileList
            files={files}
            onRemove={removeFile}
            onReorder={reorderFiles}
            onClear={clearAll}
          />

          <section className="panel settings-panel">
            <div className="panel-head">
              <div>
                <h2 className="panel-title">合并设置</h2>
                <p className="panel-sub">修改后自动更新预览</p>
              </div>
            </div>
            <div className="settings-fields">
              <label className="form-field">
                <span>排版</span>
                <select
                  value={layout}
                  onChange={(event) => changeLayout(event.target.value as LayoutMode)}
                >
                  {LAYOUT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {LAYOUT_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>排序</span>
                <select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as SortMode)}
                >
                  {(Object.keys(SORT_LABELS) as SortMode[]).map((option) => (
                    <option key={option} value={option}>
                      {SORT_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {(layout === 'two-up' || layout === 'four-up') && (
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={divider}
                  onChange={(event) => setDivider(event.target.checked)}
                />
                <span>
                  <ScissorsIcon width={16} height={16} />
                  添加切割虚线
                </span>
              </label>
            )}
            <p className="settings-note">
              文件顺序只在「文件顺序」排序下生效。打印时请选择「实际大小 / 100%」。
            </p>
          </section>
        </aside>

        <main className="content">
          <section className="content-header">
            <div className="content-heading">
              <span className="eyebrow">已计入合计</span>
              <strong className="hero-metric">{formatCents(stats.total)}</strong>
              <div className="hero-meta">
                <span>
                  <strong>{stats.count}</strong> 张发票
                </span>
                {stats.duplicateCount > 0 && (
                  <span className="hero-warning">{stats.duplicateCount} 张重复已排除</span>
                )}
                {stats.reviewCount > 0 && (
                  <span className="hero-warning">{stats.reviewCount} 张待补录</span>
                )}
                {merging && <span className="hero-working">正在生成…</span>}
              </div>
            </div>
            <div className="content-actions">
              <button
                className="btn btn-text btn-sm"
                onClick={downloadCsv}
                disabled={allPages.length === 0}
              >
                <TableIcon width={16} height={16} />
                明细 CSV
              </button>
              <button className="btn btn-outlined btn-sm" onClick={printPdf} disabled={!canOutput}>
                <PrinterIcon width={16} height={16} />
                打印
              </button>
              <button className="btn btn-filled" onClick={downloadPdf} disabled={!canOutput}>
                <DownloadIcon width={17} height={17} />
                下载合并 PDF
              </button>
            </div>
          </section>

          {mergeError && (
            <div className="banner banner-error">
              <AlertIcon width={18} height={18} />
              <span>{mergeError}</span>
            </div>
          )}

          <section className="workspace">
            <div className="tab-bar" role="tablist" aria-label="工作区">
              <button
                role="tab"
                aria-selected={tab === 'detail'}
                className={`tab ${tab === 'detail' ? 'is-active' : ''}`}
                onClick={() => setTab('detail')}
              >
                <TableIcon width={18} height={18} />
                明细
                <span className="tab-badge">{allPages.length}</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === 'summary'}
                className={`tab ${tab === 'summary' ? 'is-active' : ''}`}
                onClick={() => setTab('summary')}
              >
                <ChartIcon width={18} height={18} />
                统计
                <span className="tab-badge">{stats.count}</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === 'preview'}
                className={`tab ${tab === 'preview' ? 'is-active' : ''}`}
                onClick={() => setTab('preview')}
              >
                <FileIcon width={18} height={18} />
                预览
              </button>
            </div>

            <div className="tab-panel" role="tabpanel">
              {tab === 'detail' && (
                <InvoiceTable
                  pages={allPages}
                  onToggleInclude={toggleInclude}
                  onEdit={setEditingId}
                  onSetAll={setAllIncluded}
                />
              )}
              {tab === 'summary' && <Summary pages={allPages} dateStamp={dateStamp()} />}
              {tab === 'preview' && (
                <PdfPreview
                  bytes={merged}
                  merging={merging}
                  error={mergeError}
                  hint={`${LAYOUT_LABELS[layout]} · 已计入 ${stats.count} 张 · ${
                    merged ? '预览为最终输出效果' : '等待生成'
                  }`}
                />
              )}
            </div>
          </section>
        </main>
      </div>

      <footer className="app-footer">
        <ShieldIcon width={15} height={15} />
        <span>所有 PDF 只在本机内存中处理，不上传、不保存。断网也能用。</span>
      </footer>

      <EditDrawer page={editingPage} onClose={() => setEditingId(null)} onSave={saveEdit} />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <Toasts
        toasts={toasts}
        onDismiss={(id) => setToasts((previous) => previous.filter((item) => item.id !== id))}
      />
    </div>
  );
}
