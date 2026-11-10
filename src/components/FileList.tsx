import { useState } from 'react';
import type { InvoiceFile } from '../core/types';
import { formatCents } from '../core/invoice';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  FileIcon,
  GripIcon,
  TrashIcon,
} from './Icons';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const STATUS_LABEL: Record<InvoiceFile['status'], string> = {
  pending: '等待',
  processing: '解析中',
  done: '已解析',
  error: '失败',
};

export function FileList({
  files,
  onRemove,
  onReorder,
  onClear,
}: {
  files: InvoiceFile[];
  onRemove: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onClear: () => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  return (
    <section className="panel file-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">文件</h2>
          <p className="panel-sub">{files.length > 0 ? `${files.length} 个文件` : '还没有添加文件'}</p>
        </div>
        {files.length > 0 && (
          <button className="btn btn-text btn-sm" onClick={onClear}>
            清空
          </button>
        )}
      </div>

      {files.length === 0 ? (
        <div className="file-empty">添加 PDF 后，这里会列出每个文件的解析状态。</div>
      ) : (
        <div className="file-items">
          {files.map((file, index) => {
            const invoices = file.pages.filter((page) => page.isInvoice);
            const total = invoices.reduce((sum, page) => sum + (page.fields.total ?? 0), 0);
            const duplicates = file.pages.filter((page) => page.duplicate).length;
            const percent = Math.round(file.progress * 100);
            return (
              <div
                key={file.id}
                className={`file-item ${dragIndex === index ? 'is-dragging' : ''} ${
                  overIndex === index && dragIndex !== index ? 'is-over' : ''
                }`}
                draggable
                onDragStart={(event) => {
                  setDragIndex(index);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', String(index));
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setOverIndex(index);
                }}
                onDragLeave={() => setOverIndex((current) => (current === index ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragIndex != null && dragIndex !== index) onReorder(dragIndex, index);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
              >
                <div className="file-grip" title="拖拽调整顺序">
                  <GripIcon width={14} height={14} />
                </div>
                <div className="file-main">
                  <div className="file-name" title={file.name}>
                    <FileIcon width={14} height={14} />
                    <span>{file.name}</span>
                  </div>
                  <div className="file-meta">
                    <span>{formatSize(file.size)}</span>
                    {file.pageCount > 0 && <span>{file.pageCount} 页</span>}
                    {invoices.length > 0 && <span>{invoices.length} 张</span>}
                    {total > 0 && <span className="file-amount">{formatCents(total)}</span>}
                    {duplicates > 0 && <span className="file-dup">{duplicates} 重复</span>}
                  </div>
                  {file.status === 'processing' && (
                    <div className="file-progress" aria-label={`解析进度 ${percent}%`}>
                      <span style={{ width: `${percent}%` }} />
                    </div>
                  )}
                  {file.status === 'error' && <div className="file-error">{file.error}</div>}
                </div>
                <div className="file-side">
                  <span className={`status status-${file.status}`}>
                    {STATUS_LABEL[file.status]}
                    {file.status === 'processing' ? ` ${percent}%` : ''}
                  </span>
                  <div className="file-actions">
                    <button
                      className="icon-btn icon-btn-compact"
                      title="上移"
                      aria-label={`上移 ${file.name}`}
                      disabled={index === 0}
                      onClick={() => onReorder(index, index - 1)}
                    >
                      <ArrowUpIcon width={16} height={16} />
                    </button>
                    <button
                      className="icon-btn icon-btn-compact"
                      title="下移"
                      aria-label={`下移 ${file.name}`}
                      disabled={index === files.length - 1}
                      onClick={() => onReorder(index, index + 1)}
                    >
                      <ArrowDownIcon width={16} height={16} />
                    </button>
                    <button
                      className="icon-btn icon-btn-compact danger"
                      title="移除文件"
                      aria-label={`移除 ${file.name}`}
                      onClick={() => onRemove(file.id)}
                    >
                      <TrashIcon width={16} height={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
