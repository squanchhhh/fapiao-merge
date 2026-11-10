# 发票本地版（fapiao-merge）

批量合并电子发票、自动提取票面信息、去重统计、导出 CSV、打印 A4 —— 全部在浏览器里完成。

**发票 PDF 不会上传到任何服务器，断网也能用。** 拖进页面，处理，下载，关闭页面即释放。

> 适合需要每月贴票报销、又不想把发票传给第三方网站的人。
> 单文件交付：不需要安装 Node.js，不需要登录，不需要微信扫码。

## 直接使用

### 在线版

<https://squanchhhh.github.io/fapiao-merge/>

在线版由仓库的 `gh-pages` 分支提供。维护者更新时执行 `npm run build`，把 `dist/index.html` 覆盖到 `gh-pages` 分支根目录的 `index.html`，并保留 `.nojekyll` 文件。

如果想改用 GitHub Actions 自动部署，把 Pages 的 Source 改成 **GitHub Actions**，并确认仓库 **Settings → Actions → General** 里允许运行工作流。

### 离线单文件（推荐）

从 [Releases](../../releases) 下载 `fapiao-merge-*.html`，双击打开即可，推荐 Chrome 或 Edge。

- 不需要联网；可以先把网卡禁用再打开，验证零上传。
- 所有 PDF 只在当前页面内存中处理，刷新或关闭页面即释放。
- 打印时选择「实际大小 / 100%」，不要勾选「适合页面」。

## 功能

- 批量拖入 PDF，自动识别：数电普票、数电专票、传统增值税电子普票 / 专票、铁路电子客票（12306）。
- 文件列表支持拖拽排序，也可以用「上移 / 下移」按钮逐条调整合并顺序。
- 一张 A4 排两张（可加切割虚线）、两张 A4 四联、或保留原始尺寸。
- Material 3 风格界面：左侧固定操作栏，右侧「明细 / 统计 / 预览」三个标签页。
- 自动检测重复发票（按发票号码），默认排除出合计和合并；可手动恢复。
- 识别失败或扫描件可手工补录号码、金额、购买方等，仍按原页面合并。
- 按购买方 / 月份 / 票种分组汇总，导出明细 CSV 与汇总 CSV。
- 直接调用浏览器打印合并后的 A4 PDF。

## 隐私实现

这不是一句口号，而是构建时就写死的约束：

- 生产构建注入 CSP：`connect-src 'none'`，浏览器层面禁止一切网络请求。
- 中文 cMap 全部内嵌（`src/assets/cmaps.ts`），pdf.js 不需要从 CDN 下载字体映射。
- PDF 解析 worker 以经典 worker 内联进 HTML，兼容 `file://` 双击打开。
- 不写 `localStorage` / `IndexedDB`；没有上传接口，没有第三方脚本、统计或字体。

## 开发

需要 Node.js 20+。

```bash
npm install
npm run dev      # 本地开发
npm test         # 解析 / 合并 / 统计回归用例
npm run build    # 产出 dist/index.html（单文件）
```

交付物是 `dist/index.html`：所有 JS、CSS、worker、字体映射都内联在这一个文件里。

### 测试样例

`tests/` 里有两类用例：

- 纯逻辑用例（金额格式化、去重、统计、传统发票文字层）不依赖外部文件，随时可跑。
- 真实 PDF 用例读取 `fapiao_pdf/`，覆盖逐字拆分、名称换行、重复绘制三种文字层结构。

**真实发票含个人信息，不随仓库分发。** `fapiao_pdf/*.pdf` 已被 `.gitignore` 排除；缺少样例时相关用例自动跳过，其余用例照常运行。想跑完整测试，把自己的样例放进 `fapiao_pdf/`，文件名见 [fapiao_pdf/README.md](fapiao_pdf/README.md)。

提交前建议复核：

```bash
git status
git ls-files fapiao_pdf   # 只应看到 README.md
```

### 目录

- `src/core/parser.ts`：发票字段识别（号码、代码、日期、金额、购销方、铁路行程）。
- `src/core/merge.ts`：A4 排版与 pdf-lib 页面嵌入。
- `src/core/pdfBrowser.ts`：pdf.js worker、cMap、预览与栅格化兜底。
- `src/core/invoice.ts`：去重、统计、排序、金额格式化。
- `src/core/csv.ts`：明细 / 汇总 CSV。
- `src/components/`：界面组件。
- `scripts/gen-cmaps.mjs`：生成内嵌 cMap 的脚本。
- `tests/`：回归用例。

## 发布与部署

仓库已附带 GitHub Actions：

- `ci.yml`：推送和 PR 时跑测试与构建。
- `deploy.yml`：推送 `main` 后构建并部署到 GitHub Pages。
- `release.yml`：推送 `v*` 标签时创建 Release，并附上单文件 HTML。

发版：

```bash
git tag v1.0.0
git push origin v1.0.0
```

## 已知限制

- 只支持**有文字层**的 PDF。纯扫描件无法 OCR，但可以手工补录号码和金额后合并。
- 没有内容流的空页（少数扫描件或生成器会产出）会自动转成图片再合并；若图片也生成失败，会用空白页占位并在页面上提示。
- 加密 PDF 需要先在原软件中去掉密码。
- 红字（负数）发票目前不参与金额统计。
- 发票版式差异很大；识别结果请在表格里核对，必要时点右侧铅笔修改。

## 贡献

欢迎 Issue 和 PR，尤其是新票种的识别规则与脱敏后的版式样例。

- 不要提交真实发票、姓名、税号、行程等个人信息。
- 修 bug 时请附上脱敏说明：票种、版式特征、期望字段，不必附原文件。
- 新增识别规则请补对应的单元测试。

## 许可证

[MIT](LICENSE)
