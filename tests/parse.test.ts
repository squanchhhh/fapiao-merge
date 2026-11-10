import { beforeAll, describe, expect, it } from 'vitest';
import { parseInvoicePage } from '../src/core/parser';
import type { ParseResult } from '../src/core/parser';
import { buildLines, type RawTextItem } from '../src/core/text';
import { hasSamples, readPdfPages, type SamplePage } from './helpers';

// 真实发票样例不入库：没有样例时跳过依赖它的用例，其余测试照常运行。
const sampleDescribe = hasSamples ? describe : describe.skip;

let railwayPage!: SamplePage;
let digitalPage!: SamplePage;
let railwayResult!: ParseResult;
let digitalResult!: ParseResult;
let nameSamples!: { file: string; result: ParseResult }[];

beforeAll(async () => {
  if (!hasSamples) return;
  const railway = await readPdfPages('fapiao_pdf/发票-1.pdf');
  const digital = await readPdfPages('fapiao_pdf/发票-4.pdf');
  railwayPage = railway[0];
  digitalPage = digital[0];
  railwayResult = parseInvoicePage(railwayPage.width, railwayPage.height, railwayPage.lines);
  digitalResult = parseInvoicePage(digitalPage.width, digitalPage.height, digitalPage.lines);

  const nameFiles = ['发票-3.pdf', '发票-9.pdf', '发票-10.pdf'];
  nameSamples = await Promise.all(
    nameFiles.map(async (file) => {
      const [page] = await readPdfPages(`fapiao_pdf/${file}`);
      return {
        file,
        result: parseInvoicePage(page.width, page.height, page.lines),
      };
    }),
  );
});

sampleDescribe('铁路电子客票', () => {
  it('识别为铁路票', () => {
    expect(railwayResult.kind).toBe('railway');
    expect(railwayResult.isInvoice).toBe(true);
    expect(railwayResult.confidence).toBe('high');
    expect(railwayResult.missing).toEqual([]);
  });

  it('提取号码、开票日期和票价', () => {
    expect(railwayResult.fields.number).toBe('26349119423007645968');
    expect(railwayResult.fields.issueDate).toBe('2026-11-10');
    expect(railwayResult.fields.total).toBe(71000);
    expect(railwayResult.fields.amountExTax).toBe(71000);
    expect(railwayResult.fields.taxAmount).toBeNull();
  });

  it('提取铁路行程字段', () => {
    expect(railwayResult.fields.travelDate).toBe('2026-10-08');
    expect(railwayResult.fields.trainNumber).toBe('G385');
    expect(railwayResult.fields.departure).toBe('合肥南');
    expect(railwayResult.fields.arrival).toBe('广州南');
    expect(railwayResult.fields.seatClass).toBe('二等座');
    expect(railwayResult.fields.passenger).toBe('张家豪');
  });

  it('提取购买方和税号', () => {
    expect(railwayResult.fields.buyerName).toBe('中国科学院高能物理研究所');
    expect(railwayResult.fields.buyerTaxId).toBe('12100000400012211J');
  });
});

sampleDescribe('数电普通发票', () => {
  it('识别为数电普票', () => {
    expect(digitalResult.kind).toBe('digital-general');
    expect(digitalResult.isInvoice).toBe(true);
    expect(digitalResult.confidence).toBe('high');
    expect(digitalResult.missing).toEqual([]);
  });

  it('提取号码和日期', () => {
    expect(digitalResult.fields.number).toBe('26442000012720904291');
    expect(digitalResult.fields.issueDate).toBe('2026-11-05');
  });

  it('提取买卖双方', () => {
    expect(digitalResult.fields.buyerName).toBe('中国科学院高能物理研究所');
    expect(digitalResult.fields.sellerName).toBe('台山市赤溪镇东新宾馆');
    expect(digitalResult.fields.buyerTaxId).toBe('12100000400012211J');
  });

  it('提取金额、税额和价税合计', () => {
    expect(digitalResult.fields.amountExTax).toBe(429703);
    expect(digitalResult.fields.taxAmount).toBe(4297);
    expect(digitalResult.fields.total).toBe(434000);
  });
});

sampleDescribe('不同文字层结构下的名称识别', () => {
  it('逐字拆分、名称换行、重复绘制都能提取购买方和销售方', () => {
    const expected: Record<string, [string, string]> = {
      '发票-3.pdf': ['中国科学院高能物理研究所', '苏州市吉利优行电子科技有限公司'],
      '发票-9.pdf': ['中国科学院高能物理研究所', '禧天龙(江苏)电子商务有限公司'],
      '发票-10.pdf': ['中国科学院高能物理研究所', '江门京东青资贸易有限公司'],
    };
    for (const sample of nameSamples) {
      expect(sample.result.fields.buyerName).toBe(expected[sample.file][0]);
      expect(sample.result.fields.sellerName).toBe(expected[sample.file][1]);
      expect(sample.result.fields.buyerTaxId).toBe('12100000400012211J');
    }
  });

  it('重复文字不会污染开票人和合计金额', () => {
    const sample = nameSamples.find((item) => item.file === '发票-10.pdf');
    expect(sample?.result.fields.issuer).toBe('李国泰');
    expect(sample?.result.fields.amountExTax).toBe(7230);
    expect(sample?.result.fields.taxAmount).toBe(940);
    expect(sample?.result.fields.total).toBe(8170);
  });
});

function line(str: string, x: number, y: number, width = Math.max(20, str.length * 8)): RawTextItem {
  return { str, x, y, width };
}

describe('传统增值税电子发票', () => {
  const items: RawTextItem[] = [
    line('增值税电子专用发票', 190, 700, 220),
    line('发票代码：034001900111', 380, 680, 130),
    line('发票号码：12345678', 380, 665, 110),
    line('开票日期：', 380, 650, 60),
    line('2023年05月06日', 440, 650, 80),
    line('购买方', 40, 610, 40),
    line('名称：某某科技有限公司', 40, 590, 150),
    line('统一社会信用代码：91340100MA2ABCDE12', 40, 570, 220),
    line('销售方', 330, 610, 40),
    line('名称：某某酒店管理有限公司', 330, 590, 180),
    line('统一社会信用代码：91340100MA2WXYZ987', 330, 570, 220),
    line('合计', 370, 420, 30),
    line('¥1000.00', 410, 420, 60),
    line('¥60.00', 500, 420, 50),
    line('价税合计（小写）', 340, 400, 100),
    line('¥1060.00', 470, 400, 60),
    line('开票人：张三', 40, 120, 90),
  ];
  const result = parseInvoicePage(595, 397, buildLines(items));

  it('识别为传统电子专票', () => {
    expect(result.kind).toBe('traditional-special');
  });

  it('提取代码、号码、日期和金额', () => {
    expect(result.fields.code).toBe('034001900111');
    expect(result.fields.number).toBe('12345678');
    expect(result.fields.issueDate).toBe('2023-05-06');
    expect(result.fields.amountExTax).toBe(100000);
    expect(result.fields.taxAmount).toBe(6000);
    expect(result.fields.total).toBe(106000);
  });

  it('提取双方名称和税号', () => {
    expect(result.fields.buyerName).toBe('某某科技有限公司');
    expect(result.fields.sellerName).toBe('某某酒店管理有限公司');
    expect(result.fields.buyerTaxId).toBe('91340100MA2ABCDE12');
    expect(result.fields.sellerTaxId).toBe('91340100MA2WXYZ987');
    expect(result.fields.issuer).toBe('张三');
  });
});
