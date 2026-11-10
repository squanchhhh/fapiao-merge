/** 计算文件 SHA-256，用作文件级去重 id。 */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  // 极老环境兜底：用文件名+大小+时间戳，仍只在本地使用
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isPdfHeader(bytes: Uint8Array): boolean {
  // 个别 PDF 会在 %PDF- 前带 BOM 或空行，在前 1KB 内查找更稳妥。
  const limit = Math.min(bytes.length, 1024);
  let signature = '';
  for (let i = 0; i < limit; i += 1) {
    signature += String.fromCharCode(bytes[i]);
  }
  return signature.includes('%PDF-');
}
