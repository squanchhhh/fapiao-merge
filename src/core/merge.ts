import {
  PDFDocument,
  PDFName,
  rgb,
  type PDFEmbeddedPage,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type { LayoutMode } from './types';

export interface MergePageRef {
  sourceId: string;
  pageIndex: number;
  rotation: number;
  isA4: boolean;
}

export interface MergeOptions {
  layout: LayoutMode;
  divider: boolean;
}

export interface RasterizedPage {
  bytes: Uint8Array;
  /** 页面显示尺寸（pt） */
  width: number;
  height: number;
}

export type RasterizeFn = (ref: MergePageRef) => Promise<RasterizedPage>;

interface Drawable {
  kind: 'page' | 'image' | 'blank';
  page?: PDFEmbeddedPage;
  image?: PDFImage;
  width: number;
  height: number;
  isA4: boolean;
}

const A4: [number, number] = [595.28, 841.89];

/** Contents 不是可继承属性，直接看页面自身的字典即可。 */
function hasPageContents(page: PDFPage): boolean {
  return page.node.get(PDFName.of('Contents')) !== undefined;
}

/**
 * 有些开票软件（如 Suwell/ULC）会在文件头写成
 * `%%ULC:1.01.01 5 0 obj`：对象头和注释挤在同一行。
 * 按 PDF 规范注释到行尾结束，pdf-lib 顺序扫描时会把整个对象头当成注释跳过，
 * 于是该对象在内存里缺失（常见的是首页 Contents），embedPage 报
 * “Can't embed page with missing Contents”，只能退回栅格化，
 * 合并结果就失去文字层、变得模糊。
 *
 * 这里把对象头前的空白改成换行，并保持字节数不变，避免 xref 偏移失效。
 */
const COMMENT_JOINED_OBJECT = /(%[^\r\n]*?)([ \t]+)(\d+[ \t]+\d+[ \t]+obj\b)/g;

function bytesToBinaryString(bytes: Uint8Array): string {
  let result = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    result += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return result;
}

function repairCommentJoinedObjects(bytes: Uint8Array): Uint8Array | null {
  const text = bytesToBinaryString(bytes);
  let changed = false;
  const repaired = text.replace(
    COMMENT_JOINED_OBJECT,
    (_match, comment: string, space: string, header: string) => {
      changed = true;
      return `${comment}${' '.repeat(space.length - 1)}\n${header}`;
    },
  );
  if (!changed) return null;

  const output = new Uint8Array(repaired.length);
  for (let index = 0; index < repaired.length; index += 1) {
    output[index] = repaired.charCodeAt(index) & 0xff;
  }
  return output;
}

/** 页面声明了 Contents，但 pdf-lib 没解析出来，说明对象被扫描逻辑漏掉了。 */
function hasUnresolvedContents(doc: PDFDocument): boolean {
  return doc.getPages().some((page) => {
    if (page.node.get(PDFName.of('Contents')) === undefined) return false;
    return page.node.lookup(PDFName.of('Contents')) === undefined;
  });
}

async function loadSourceDocument(source: ArrayBuffer | Uint8Array): Promise<PDFDocument> {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const options = { ignoreEncryption: true, updateMetadata: false } as const;
  const doc = await PDFDocument.load(bytes, options);
  if (!hasUnresolvedContents(doc)) return doc;

  const repaired = repairCommentJoinedObjects(bytes);
  if (!repaired) return doc;
  return PDFDocument.load(repaired, options);
}

/**
 * pdf-lib 的 embedPage() 只做登记，真正的写入推迟到 save()。
 * 如果某一页嵌入失败，必须把它从待写列表里移除，否则 save() 会再次抛错，
 * 导致整个合并失败，逐页兜底也就失效了。
 */
function forgetEmbeddedPage(out: PDFDocument, embedded: PDFEmbeddedPage): void {
  const list = (out as unknown as { embeddedPages?: PDFEmbeddedPage[] }).embeddedPages;
  if (!Array.isArray(list)) return;
  const index = list.indexOf(embedded);
  if (index >= 0) list.splice(index, 1);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function drawItem(
  target: PDFPage,
  item: Drawable,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (item.kind === 'page' && item.page) {
    target.drawPage(item.page, { x, y, width, height });
  } else if (item.image) {
    target.drawImage(item.image, { x, y, width, height });
  }
}

function drawDivider(target: PDFPage, layout: LayoutMode): void {
  const { width, height } = target.getSize();
  const color = rgb(0.72, 0.74, 0.78);
  const line = {
    thickness: 0.6,
    color,
    dashArray: [5, 5],
    opacity: 0.9,
  };
  target.drawLine({ start: { x: 0, y: height / 2 }, end: { x: width, y: height / 2 }, ...line });
  if (layout === 'four-up') {
    target.drawLine({ start: { x: width / 2, y: 0 }, end: { x: width / 2, y: height }, ...line });
  }
}

export async function mergeInvoices(
  sources: Map<string, ArrayBuffer | Uint8Array>,
  pages: MergePageRef[],
  options: MergeOptions,
  rasterize?: RasterizeFn,
  onProgress?: (done: number, total: number) => void,
  onWarning?: (message: string) => void,
): Promise<Uint8Array> {
  if (pages.length === 0) {
    throw new Error('没有可合并的发票');
  }

  const out = await PDFDocument.create();
  const docCache = new Map<string, PDFDocument>();
  const items: Drawable[] = [];

  const rasterOrBlank = async (
    ref: MergePageRef,
    size: { width: number; height: number } | null,
  ): Promise<Drawable> => {
    if (rasterize) {
      try {
        const raster = await rasterize(ref);
        return {
          kind: 'image',
          image: await out.embedPng(raster.bytes),
          width: raster.width,
          height: raster.height,
          isA4: ref.isA4,
        };
      } catch (error) {
        onWarning?.(
          `第 ${ref.pageIndex + 1} 页无法转为图片，已用空白页占位：${errorMessage(error)}`,
        );
        return {
          kind: 'blank',
          width: size?.width ?? A4[0],
          height: size?.height ?? 396.65,
          isA4: ref.isA4,
        };
      }
    }
    throw new Error('该 PDF 页面无法直接嵌入，当前环境也无法转为图片');
  };

  for (let index = 0; index < pages.length; index += 1) {
    const ref = pages[index];
    let drawable: Drawable;
    let pageSize: { width: number; height: number } | null = null;

    if (ref.rotation % 360 !== 0) {
      drawable = await rasterOrBlank(ref, pageSize);
    } else {
      try {
        let doc = docCache.get(ref.sourceId);
        if (!doc) {
          const bytes = sources.get(ref.sourceId);
          if (!bytes) throw new Error('源文件已从内存中释放，请重新添加文件');
          doc = await loadSourceDocument(bytes);
          docCache.set(ref.sourceId, doc);
        }
        const sourcePage = doc.getPage(ref.pageIndex);
        pageSize = sourcePage.getSize();
        // pdf-lib 无法嵌入没有内容流的页面（空页、部分扫描件生成器），
        // 直接栅格化，避免到 save() 时才抛错并拖垮整批合并。
        if (!hasPageContents(sourcePage)) throw new Error('该页没有内容流');
        const embedded = await out.embedPage(sourcePage);
        try {
          // pdf-lib 把真正的写入推迟到 save()；这里立即嵌入，才能逐页捕获并兜底。
          await embedded.embed();
        } catch (embedError) {
          forgetEmbeddedPage(out, embedded);
          throw embedError;
        }
        drawable = {
          kind: 'page',
          page: embedded,
          width: pageSize.width,
          height: pageSize.height,
          isA4: ref.isA4,
        };
      } catch (error) {
        if (!rasterize) throw error;
        drawable = await rasterOrBlank(ref, pageSize);
      }
    }

    items.push(drawable);
    onProgress?.(index + 1, pages.length);
  }

  if (options.layout === 'original') {
    for (const item of items) {
      const page = out.addPage([item.width, item.height]);
      drawItem(page, item, 0, 0, item.width, item.height);
    }
    return out.save();
  }

  const cols = options.layout === 'four-up' ? 2 : 1;
  const rows = 2;
  const capacity = cols * rows;

  const addGridPage = (group: Drawable[]) => {
    if (group.length === 0) return;
    const page = out.addPage(A4);
    const margin = cols === 1 ? 6 : 8;
    const gap = cols === 1 ? 0 : 8;
    const slotWidth = (A4[0] - margin * 2 - (cols - 1) * gap) / cols;
    const slotHeight = (A4[1] - margin * 2 - (rows - 1) * gap) / rows;

    group.forEach((item, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const scale = Math.min((slotWidth - 4) / item.width, (slotHeight - 4) / item.height);
      const drawWidth = item.width * scale;
      const drawHeight = item.height * scale;
      const x = margin + col * (slotWidth + gap) + (slotWidth - drawWidth) / 2;
      const y =
        A4[1] - margin - (row + 1) * slotHeight - row * gap + (slotHeight - drawHeight) / 2;
      drawItem(page, item, x, y, drawWidth, drawHeight);
    });

    if (options.divider) drawDivider(page, options.layout);
  };

  const addFullPage = (item: Drawable) => {
    const page = out.addPage(A4);
    const margin = 10;
    const scale = Math.min(
      (A4[0] - margin * 2) / item.width,
      (A4[1] - margin * 2) / item.height,
    );
    const drawWidth = item.width * scale;
    const drawHeight = item.height * scale;
    drawItem(
      page,
      item,
      (A4[0] - drawWidth) / 2,
      (A4[1] - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
  };

  let buffer: Drawable[] = [];
  for (const item of items) {
    if (item.isA4) {
      if (buffer.length > 0) {
        addGridPage(buffer);
        buffer = [];
      }
      addFullPage(item);
      continue;
    }
    buffer.push(item);
    if (buffer.length === capacity) {
      addGridPage(buffer);
      buffer = [];
    }
  }
  if (buffer.length > 0) addGridPage(buffer);

  return out.save();
}
