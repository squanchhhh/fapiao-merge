import * as pdfjs from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline';
import { CMAPS } from '../assets/cmaps';
import type { RawTextItem } from './text';

const cmapCache = new Map<string, Uint8Array>();

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * pdf.js 默认会去 CDN 拉 cMap。这里改成从打包进 HTML 的 base64 读取，
 * 保证断网也能解析铁路票等使用 CID 字体的发票。
 */
class EmbeddedCMapReaderFactory {
  constructor(_options?: { baseUrl?: string | null; isCompressed?: boolean }) {}

  async fetch({ name }: { name: string }): Promise<{ cMapData: Uint8Array; isCompressed: boolean }> {
    if (!name) throw new Error('cMap 名称缺失');
    let data = cmapCache.get(name);
    if (!data) {
      const base64 = CMAPS[name];
      if (!base64) throw new Error(`缺少字体映射 ${name}`);
      data = decodeBase64(base64);
      cmapCache.set(name, data);
    }
    return { cMapData: data, isCompressed: true };
  }
}

/**
 * 每个文档使用独立的 worker。
 *
 * 共用一个 workerPort 时，销毁旧文档的 destroy() 是异步的；如果同时开始加载新文档，
 * pdf.js 会命中 `_pendingDestroy` 并抛出 “the worker is being destroyed”。
 * 预览每次重新生成都会触发这个竞态，因此改为一个文档一个 worker，销毁时一并终止。
 */
export function loadPdfDocument(data: Uint8Array) {
  const rawWorker = new PdfWorker() as unknown as Worker;
  let worker: pdfjs.PDFWorker;
  try {
    worker = pdfjs.PDFWorker.fromPort({ port: rawWorker });
  } catch (error) {
    rawWorker.terminate();
    throw error;
  }

  const options = {
    data: new Uint8Array(data),
    cMapPacked: true,
    CMapReaderFactory: EmbeddedCMapReaderFactory,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: false,
    verbosity: 0,
    worker,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0];

  const task = pdfjs.getDocument(options);
  return task.promise.then(
    (document) => {
      const originalDestroy = document.destroy.bind(document);
      let destroyed = false;
      document.destroy = async () => {
        if (destroyed) return;
        destroyed = true;
        try {
          await originalDestroy();
        } finally {
          rawWorker.terminate();
        }
      };
      return document;
    },
    (error) => {
      rawWorker.terminate();
      try {
        worker.destroy();
      } catch {
        /* 忽略重复销毁 */
      }
      throw error;
    },
  );
}

export async function extractPageItems(page: {
  getTextContent: () => Promise<{ items: unknown[] }>;
}): Promise<RawTextItem[]> {
  const content = await page.getTextContent();
  const items: RawTextItem[] = [];
  for (const raw of content.items) {
    const item = raw as {
      str?: unknown;
      transform?: number[];
      width?: number;
      height?: number;
    };
    if (typeof item.str !== 'string' || item.str.length === 0) continue;
    if (!Array.isArray(item.transform)) continue;
    items.push({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width ?? 0,
    });
  }
  return items;
}

export interface RenderResult {
  width: number;
  height: number;
}

type RenderTaskLike = { cancel: () => void; promise: Promise<void> };
const activeTasks = new WeakMap<HTMLCanvasElement, RenderTaskLike>();

export async function renderPdfPage(
  document: Awaited<ReturnType<typeof loadPdfDocument>>,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
): Promise<RenderResult> {
  // 同一个 canvas 上同时启动两次 render 会抛错，先把上一次取消掉。
  activeTasks.get(canvas)?.cancel();

  const page = await document.getPage(pageNumber);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const viewport = page.getViewport({ scale });
  const outputViewport = page.getViewport({ scale: scale * dpr });

  canvas.width = Math.max(1, Math.floor(outputViewport.width));
  canvas.height = Math.max(1, Math.floor(outputViewport.height));
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持 Canvas');

  const task = page.render({
    canvasContext: context,
    viewport: outputViewport,
  }) as unknown as RenderTaskLike;
  activeTasks.set(canvas, task);

  try {
    await task.promise;
  } finally {
    if (activeTasks.get(canvas) === task) activeTasks.delete(canvas);
  }

  return { width: viewport.width, height: viewport.height };
}

/** 将某一页渲染成 PNG，作为 pdf-lib 嵌入失败时的兜底。 */
export async function rasterizePageToPng(
  data: Uint8Array,
  pageIndex: number,
  scale = 2,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const doc = await loadPdfDocument(data);
  try {
    const page = await doc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器不支持 Canvas');
    await page.render({ canvasContext: context, viewport }).promise;

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), 'image/png');
    });
    if (!blob) throw new Error('页面转图片失败');
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: viewport.width / scale,
      height: viewport.height / scale,
    };
  } finally {
    await doc.destroy();
  }
}
