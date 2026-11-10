import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfDocument, renderPdfPage } from '../core/pdfBrowser';
import { FitIcon, MinusIcon, PlusIcon, ChevronLeftIcon, ChevronRightIcon } from './Icons';

function isCancelled(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name ?? '';
  return name === 'RenderingCancelledException' || /cancel/i.test(String((error as Error).message));
}

export function PdfPreview({
  bytes,
  merging,
  error,
  hint,
}: {
  bytes: Uint8Array | null;
  merging: boolean;
  error: string;
  hint: string;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [containerWidth, setContainerWidth] = useState(720);
  const [renderError, setRenderError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentScale = useRef(1);

  const zoomBy = (delta: number) => {
    setFit(false);
    setZoom(Math.min(3, Math.max(0.4, Number((currentScale.current + delta).toFixed(2)))));
  };

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setContainerWidth(width);
    });
    observer.observe(element);
    setContainerWidth(element.clientWidth || 720);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!bytes || bytes.byteLength === 0) {
      setDocument(null);
      setNumPages(0);
      return;
    }
    setDocument(null);
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    const run = async () => {
      try {
        loaded = await loadPdfDocument(bytes);
        if (cancelled) {
          await loaded.destroy().catch(() => undefined);
          return;
        }
        setDocument(loaded);
        setNumPages(loaded.numPages);
        setPageNumber(1);
        setRenderError('');
      } catch (loadError) {
        if (!cancelled) setRenderError(`预览加载失败：${String(loadError)}`);
      }
    };
    void run();
    return () => {
      cancelled = true;
      if (loaded) {
        void loaded.destroy().catch(() => undefined);
      }
    };
  }, [bytes]);

  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let cancelled = false;
    const run = async () => {
      try {
        const page = await document.getPage(pageNumber);
        const base = page.getViewport({ scale: 1 });
        const scale = fit
          ? Math.min(Math.max((containerWidth - 28) / base.width, 0.2), 1.8)
          : zoom;
        if (cancelled) return;
        currentScale.current = scale;
        await renderPdfPage(document, pageNumber, canvasRef.current as HTMLCanvasElement, scale);
        if (!cancelled) setRenderError('');
      } catch (renderFailure) {
        if (!cancelled && !isCancelled(renderFailure)) {
          setRenderError(`预览渲染失败：${String(renderFailure)}`);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [document, pageNumber, zoom, fit, containerWidth]);

  const hasDocument = Boolean(document) && numPages > 0;

  return (
    <div className="view preview-view">
      <div className="view-head">
        <div>
          <h2 className="panel-title">合并预览</h2>
          <p className="panel-sub">{hint}</p>
        </div>
        <div className="preview-controls">
          <button
            className="icon-btn"
            onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
            disabled={!hasDocument || pageNumber <= 1}
            title="上一页"
          >
            <ChevronLeftIcon width={16} height={16} />
          </button>
          <span className="preview-page">
            {hasDocument ? `${pageNumber} / ${numPages}` : '— / —'}
          </span>
          <button
            className="icon-btn"
            onClick={() => setPageNumber((value) => Math.min(numPages, value + 1))}
            disabled={!hasDocument || pageNumber >= numPages}
            title="下一页"
          >
            <ChevronRightIcon width={16} height={16} />
          </button>
          <span className="divider-v" />
          <button
            className="icon-btn"
            onClick={() => zoomBy(-0.15)}
            disabled={!hasDocument}
            title="缩小"
          >
            <MinusIcon width={16} height={16} />
          </button>
          <button
            className="icon-btn"
            onClick={() => zoomBy(0.15)}
            disabled={!hasDocument}
            title="放大"
          >
            <PlusIcon width={16} height={16} />
          </button>
          <button
            className={`btn btn-text btn-sm ${fit ? 'is-active' : ''}`}
            onClick={() => setFit(true)}
            disabled={!hasDocument}
            title="适应宽度"
          >
            <FitIcon width={15} height={15} />
            适宽
          </button>
        </div>
      </div>

      <div className="preview-stage" ref={containerRef}>
        {!bytes && !merging && (
          <div className="preview-empty">
            <p>添加发票后，会自动生成合并预览。</p>
            <p className="muted">只在你的浏览器里处理，文件不会离开这台电脑。</p>
          </div>
        )}
        {bytes && (
          <div className={`preview-canvas-wrap ${merging ? 'is-updating' : ''}`}>
            <canvas ref={canvasRef} className="preview-canvas" />
          </div>
        )}
        {merging && (
          <div className="preview-overlay">
            <span className="spinner" />
            正在生成合并 PDF…
          </div>
        )}
        {!merging && !bytes && error && <div className="preview-error">{error}</div>}
        {renderError && <div className="preview-error">{renderError}</div>}
      </div>
    </div>
  );
}
