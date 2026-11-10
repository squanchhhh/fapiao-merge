import { useRef, useState } from 'react';
import { UploadIcon } from './Icons';

export function DropZone({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`dropzone ${dragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''}`}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) onFiles(Array.from(event.dataTransfer.files));
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) onFiles(Array.from(event.target.files));
          event.target.value = '';
        }}
      />
      <div className="dropzone-icon">
        <UploadIcon width={26} height={26} />
      </div>
      <div className="dropzone-title">拖拽 PDF 发票到这里</div>
      <div className="dropzone-sub">或点击选择文件，支持多选</div>
      <div className="dropzone-note">只在浏览器内存中处理 · 不上传</div>
    </div>
  );
}
