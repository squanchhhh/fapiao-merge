export type InvoiceKind =
  | 'digital-general'
  | 'digital-special'
  | 'traditional-general'
  | 'traditional-special'
  | 'railway'
  | 'unknown';

export const KIND_LABELS: Record<InvoiceKind, string> = {
  'digital-general': '数电普通发票',
  'digital-special': '数电专用发票',
  'traditional-general': '增值税电子普通发票',
  'traditional-special': '增值税电子专用发票',
  railway: '铁路电子客票',
  unknown: '未识别',
};

export const KIND_SHORT: Record<InvoiceKind, string> = {
  'digital-general': '数电普票',
  'digital-special': '数电专票',
  'traditional-general': '电子普票',
  'traditional-special': '电子专票',
  railway: '铁路票',
  unknown: '未识别',
};

export interface InvoiceFields {
  kind: InvoiceKind;
  code: string;
  number: string;
  issueDate: string;
  buyerName: string;
  buyerTaxId: string;
  sellerName: string;
  sellerTaxId: string;
  /** 不含税金额，单位：分 */
  amountExTax: number | null;
  /** 税额，单位：分 */
  taxAmount: number | null;
  /** 价税合计（铁路票为票价），单位：分 */
  total: number | null;
  travelDate: string;
  trainNumber: string;
  departure: string;
  arrival: string;
  seatClass: string;
  passenger: string;
  eticketNumber: string;
  issuer: string;
  remark: string;
}

export interface PageResult {
  id: string;
  fileId: string;
  fileName: string;
  pageIndex: number;
  width: number;
  height: number;
  rotation: number;
  isA4: boolean;
  fields: InvoiceFields;
  originalFields: InvoiceFields;
  isInvoice: boolean;
  parseNote: string;
  missing: string[];
  confidence: 'high' | 'medium' | 'low';
  manual: boolean;
  included: boolean;
  includeTouched: boolean;
  duplicate: boolean;
  duplicateOf: string | null;
  hasText: boolean;
}

export interface InvoiceFile {
  id: string;
  file: File;
  name: string;
  size: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
  pageCount: number;
  progress: number;
  pages: PageResult[];
}

export type LayoutMode = 'two-up-line' | 'two-up' | 'four-up' | 'original';

export const LAYOUT_LABELS: Record<LayoutMode, string> = {
  'two-up-line': 'A4 两联 + 切割线',
  'two-up': 'A4 两联',
  'four-up': 'A4 四联',
  original: '原尺寸',
};

export type SortMode = 'file' | 'date' | 'amount' | 'buyer';

export const SORT_LABELS: Record<SortMode, string> = {
  file: '文件顺序',
  date: '开票日期',
  amount: '金额从高到低',
  buyer: '购买方',
};

export type SummaryDimension = 'buyer' | 'month' | 'kind';

export interface ToastItem {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

export function emptyFields(kind: InvoiceKind = 'unknown'): InvoiceFields {
  return {
    kind,
    code: '',
    number: '',
    issueDate: '',
    buyerName: '',
    buyerTaxId: '',
    sellerName: '',
    sellerTaxId: '',
    amountExTax: null,
    taxAmount: null,
    total: null,
    travelDate: '',
    trainNumber: '',
    departure: '',
    arrival: '',
    seatClass: '',
    passenger: '',
    eticketNumber: '',
    issuer: '',
    remark: '',
  };
}

export function cloneFields(fields: InvoiceFields): InvoiceFields {
  return { ...fields };
}
