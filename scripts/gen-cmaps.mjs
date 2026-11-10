import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cmapDir = path.join(root, 'node_modules/pdfjs-dist/cmaps');
const outFile = path.join(root, 'src/assets/cmaps.ts');

if (!fs.existsSync(cmapDir)) {
  console.error(`找不到 pdfjs 的 cmaps 目录: ${cmapDir}`);
  process.exit(1);
}

const names = fs
  .readdirSync(cmapDir)
  .filter((name) => /^(Adobe-GB1|GB|GBT|UniGB).*\.bcmap$/.test(name))
  .sort();

const entries = names.map((name) => {
  const base64 = fs.readFileSync(path.join(cmapDir, name)).toString('base64');
  const key = name.replace(/\.bcmap$/, '');
  return `  ${JSON.stringify(key)}: ${JSON.stringify(base64)},`;
});

const content = `// 由 scripts/gen-cmaps.mjs 生成，不要手工修改。
// 仅包含中文发票常用的 cMap，运行时不会发起任何网络请求。
export const CMAPS: Record<string, string> = {
${entries.join('\n')}
};

export function hasCMap(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(CMAPS, name);
}
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, content, 'utf8');
console.log(`已写入 ${names.length} 个 cMap -> ${path.relative(root, outFile)}（${(content.length / 1024).toFixed(0)} KB）`);
