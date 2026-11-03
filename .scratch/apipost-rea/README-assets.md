# Apipost 分析资产说明

## 先读

- `APIS-design-debug-handoff.md` — 设计/调试细粒度对照与 Mac 交接报告
- `APIS-page-gap-analysis.md` — APIS 页面全量功能对比

## 大文件

- `index.json`（约 67 MB）：REA 对 Apipost 主入口 bundle 的完整应用图，可直接读取。
- `work.json.gz`（约 22.5 MB）：REA 对 `work.asar` 全量分析的部分 Evidence（300s 超时截断）。
  使用前解压：

  ```bash
  gunzip -k work.json.gz
  ```

## 截图

`s-*.png`、`v-*.png`、`t-*.png` 为 Windows 真机截图。所有截图已裁掉底部 34px 状态栏，以移除软件序列号/授权信息；不影响设计/调试内容。

- `s-design2.png` / `s-design8.png`：设计页顶部与整体布局
- `s-dbg2.png`：设计页“数据结构”表
- `s-dbg4.png`：调试页 Body
- `v-header.png`：调试页 Header 表
- `v-cookie.png`：调试页认证（类型下拉）
- `v-pre.png` / `v-post.png`：预执行/后执行“添加操作项”

## 脚本

- `extract-strings.cjs`、`context.cjs`、`i18n.cjs`、`i18n-map.cjs`、`dump.cjs`、`keys.cjs`、`q.cjs`：从 ASAR 提取中文 i18n 与上下文
- `kindra-ui.cjs`：从 KindraAPI 组件中提取中文 UI 文案
- `capture.ps1`、`win.ps1`：Windows 窗口截图/坐标点击（仅 Windows 可用）

## 重新生成

```bash
npx -y rea-agents@6.7.0 analyze-javascript-application \
  "/path/to/work.asar" \
  --source-path "index-0d1d8198fa5a.js" \
  --format json --max-semantic-nodes 20000 --analysis-timeout-ms 600000
```

macOS 上可直接使用 REA 原生 UI 捕获（Windows 不支持）：

```bash
rea observe_native_ui --pid <PID> --window-id <WID> --screenshot --accessibility --max-nodes 2000
```
