import { useEffect } from 'react';
import { CloseIcon, ShieldIcon } from './Icons';

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: '隐私：文件不离开这台电脑',
    body: [
      '页面里没有任何上传接口，构建时也禁止了所有网络请求（CSP connect-src none）。',
      'PDF 只在浏览器内存中读取、合并和预览，关闭或刷新页面后即释放，不写入本地存储。',
      '断网后仍可完整使用，这可以作为最直接的验证。',
    ],
  },
  {
    title: '怎么用',
    body: [
      '把 PDF 发票拖进左上角的区域，支持一次多选。识别完成后会自动合并到 A4。',
      '在「发票明细」里核对号码、金额和购买方；识别错的点右侧铅笔修改。重复发票会自动标红并排除。',
      '选择排版后下载合并 PDF，或直接打印。统计和 CSV 只包含已勾选且识别为发票的页面。',
    ],
  },
  {
    title: '支持的票种',
    body: [
      '数电普通发票、数电专用发票、传统增值税电子普通/专用发票、铁路电子客票（12306）。',
      '有文字层的 PDF 可以直接识别；扫描件没有文字层，可手工补录号码和金额后照样合并。',
    ],
  },
  {
    title: '合并与打印',
    body: [
      'A4 两联：每张 A4 放两张发票，适合一张 A4 打两张再裁开。',
      'A4 四联：每张 A4 放四张，适合小票尺寸的发票。',
      '原尺寸：保留发票原始页面尺寸，不缩放、不拼接。',
      '打印时请选择「实际大小 / 100%」，不要勾选「适合页面」，否则会二次缩放。',
    ],
  },
];

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="使用说明"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div className="modal-title">
            <ShieldIcon width={20} height={20} />
            <h2>本地发票工具 · 使用说明</h2>
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭">
            <CloseIcon width={18} height={18} />
          </button>
        </header>
        <div className="modal-body">
          {SECTIONS.map((section) => (
            <section key={section.title} className="help-section">
              <h3>{section.title}</h3>
              {section.body.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </section>
          ))}
        </div>
        <footer className="modal-foot">
          <span className="muted">不需要登录，不需要微信扫码。</span>
          <button className="btn btn-filled" onClick={onClose}>
            知道了
          </button>
        </footer>
      </div>
    </div>
  );
}
