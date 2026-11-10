import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CMAPS } from '../src/assets/cmaps';
import { buildLines, textOf, type RawTextItem } from '../src/core/text';

/** 需要真实发票样例的测试用例。样例含个人信息，不随仓库分发。 */
export const SAMPLE_FILES = [
  '发票-1.pdf',
  '发票-3.pdf',
  '发票-4.pdf',
  '发票-9.pdf',
  '发票-10.pdf',
] as const;

export const hasSamples = SAMPLE_FILES.every((name) =>
  existsSync(path.resolve(process.cwd(), 'fapiao_pdf', name)),
);

class TestCMapReaderFactory {
  async fetch({ name }: { name: string }) {
    const base64 = CMAPS[name];
    if (!base64) throw new Error(`缺少 cMap: ${name}`);
    return {
      cMapData: new Uint8Array(Buffer.from(base64, 'base64')),
      isCompressed: true,
    };
  }
}

export interface SamplePage {
  width: number;
  height: number;
  lines: ReturnType<typeof buildLines>;
  text: string;
}

/** 用 pdf.js 的 legacy 构建在 Node 中读取样例 PDF，输出与浏览器端一致的文字行。 */
export async function readPdfPages(relativePath: string): Promise<SamplePage[]> {
  const file = path.resolve(process.cwd(), relativePath);
  const data = new Uint8Array(await fs.readFile(file));
  return readPdfData(data);
}

export async function readPdfData(input: Uint8Array): Promise<SamplePage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(input);
  const doc = await pdfjs.getDocument({
    data,
    cMapPacked: true,
    CMapReaderFactory: TestCMapReaderFactory,
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;

  try {
    const pages: SamplePage[] = [];
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: RawTextItem[] = [];
      for (const raw of content.items) {
        const item = raw as { str?: unknown; transform?: number[]; width?: number };
        if (typeof item.str !== 'string' || item.str.length === 0) continue;
        if (!Array.isArray(item.transform)) continue;
        items.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width ?? 0,
        });
      }
      const lines = buildLines(items);
      pages.push({
        width: viewport.width,
        height: viewport.height,
        lines,
        text: textOf(lines),
      });
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
