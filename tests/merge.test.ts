import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { mergeInvoices, type MergePageRef, type RasterizeFn } from '../src/core/merge';
import { hasSamples, readPdfData } from './helpers';

async function sampleBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await fs.readFile(path.resolve(process.cwd(), 'fapiao_pdf', name)));
}

// 1x1 透明 PNG，用于模拟 pdf.js 栅格化结果。
const PNG_1PX = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const rasterStub: RasterizeFn = async () => ({
  bytes: PNG_1PX,
  width: 595.28,
  height: 396.65,
});

/** 某些扫描件/生成器会产出没有 Contents 流的空页。 */
async function missingContentsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 396.65]);
  page.node.delete(PDFName.of('Contents'));
  return doc.save();
}

/** Contents 存在但不是流，让真正写入推迟到 save() 时才失败。 */
async function brokenContentsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 396.65]);
  page.node.set(PDFName.of('Contents'), PDFNumber.of(1));
  return doc.save();
}

async function buildRefs(
  sources: Map<string, Uint8Array>,
): Promise<MergePageRef[]> {
  const refs: MergePageRef[] = [];
  for (const [sourceId, bytes] of sources) {
    const doc = await PDFDocument.load(bytes);
    for (let index = 0; index < doc.getPageCount(); index += 1) {
      const size = doc.getPage(index).getSize();
      const isA4 =
        (Math.abs(size.width - 595.28) < 12 && Math.abs(size.height - 841.89) < 12) ||
        (Math.abs(size.width - 841.89) < 12 && Math.abs(size.height - 595.28) < 12);
      refs.push({ sourceId, pageIndex: index, rotation: 0, isA4 });
    }
  }
  return refs;
}

(hasSamples ? describe : describe.skip)('合并 PDF', () => {
  it('两张 210x140 发票合并成一张 A4 两联', async () => {
    const sources = new Map<string, Uint8Array>();
    sources.set('rail', await sampleBytes('发票-1.pdf'));
    sources.set('digital', await sampleBytes('发票-4.pdf'));
    const refs = await buildRefs(sources);

    const merged = await mergeInvoices(sources, refs, { layout: 'two-up-line', divider: true });
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(1);

    const size = doc.getPage(0).getSize();
    expect(size.width).toBeCloseTo(595.28, 1);
    expect(size.height).toBeCloseTo(841.89, 1);
  });

  it('合并后文字层仍可提取', async () => {
    const sources = new Map<string, Uint8Array>();
    sources.set('digital', await sampleBytes('发票-4.pdf'));
    const refs = await buildRefs(sources);
    const merged = await mergeInvoices(sources, refs, { layout: 'two-up', divider: false });

    const pages = await readPdfData(merged);
    expect(pages[0].text).toContain('26442000012720904291');
    expect(pages[0].text).toContain('台山市赤溪镇东新宾馆');
  });

  it('原尺寸模式保留每张发票单独一页', async () => {
    const sources = new Map<string, Uint8Array>();
    sources.set('rail', await sampleBytes('发票-1.pdf'));
    sources.set('digital', await sampleBytes('发票-4.pdf'));
    const refs = await buildRefs(sources);

    const merged = await mergeInvoices(sources, refs, { layout: 'original', divider: false });
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(595.27, 1);
    expect(doc.getPage(0).getSize().height).toBeCloseTo(396.65, 1);
  });

  it('四联模式两行两列', async () => {
    const sources = new Map<string, Uint8Array>();
    const single = await sampleBytes('发票-4.pdf');
    for (let index = 0; index < 4; index += 1) sources.set(`copy-${index}`, single);
    const refs: MergePageRef[] = [];
    for (let index = 0; index < 4; index += 1) {
      refs.push({ sourceId: `copy-${index}`, pageIndex: 0, rotation: 0, isA4: false });
    }

    const merged = await mergeInvoices(sources, refs, { layout: 'four-up', divider: true });
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(1);
  });

  it('缺少 Contents 的页面栅格化兜底，不影响同批其他发票', async () => {
    const sources = new Map<string, Uint8Array>();
    sources.set('blank', await missingContentsPdf());
    sources.set('digital', await sampleBytes('发票-4.pdf'));
    const refs: MergePageRef[] = [
      { sourceId: 'blank', pageIndex: 0, rotation: 0, isA4: false },
      { sourceId: 'digital', pageIndex: 0, rotation: 0, isA4: false },
    ];
    const rasterized: number[] = [];

    const merged = await mergeInvoices(
      sources,
      refs,
      { layout: 'two-up', divider: false },
      async (ref) => {
        rasterized.push(ref.pageIndex);
        return rasterStub(ref);
      },
    );

    expect(rasterized).toEqual([0]);
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(1);

    const pages = await readPdfData(merged);
    expect(pages[0].text).toContain('26442000012720904291');
  });

  it('嵌入推迟到 save() 才失败时也能逐页兜底', async () => {
    const sources = new Map<string, Uint8Array>([['broken', await brokenContentsPdf()]]);
    const refs: MergePageRef[] = [
      { sourceId: 'broken', pageIndex: 0, rotation: 0, isA4: false },
    ];

    const merged = await mergeInvoices(sources, refs, { layout: 'two-up', divider: false }, rasterStub);
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(1);
  });

  it('栅格化也失败时用空白页占位并给出提示', async () => {
    const sources = new Map<string, Uint8Array>([['blank', await missingContentsPdf()]]);
    const refs: MergePageRef[] = [
      { sourceId: 'blank', pageIndex: 0, rotation: 0, isA4: false },
    ];
    const warnings: string[] = [];

    const merged = await mergeInvoices(
      sources,
      refs,
      { layout: 'two-up', divider: false },
      async () => {
        throw new Error('render failed');
      },
      undefined,
      (message) => warnings.push(message),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('空白页占位');
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(1);
  });

  it('没有栅格化兜底时抛出明确错误', async () => {
    const sources = new Map<string, Uint8Array>([['blank', await missingContentsPdf()]]);
    const refs: MergePageRef[] = [
      { sourceId: 'blank', pageIndex: 0, rotation: 0, isA4: false },
    ];

    await expect(
      mergeInvoices(sources, refs, { layout: 'two-up', divider: false }),
    ).rejects.toThrow('该页没有内容流');
  });
});
