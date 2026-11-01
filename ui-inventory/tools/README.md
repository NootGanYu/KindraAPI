# UI inventory 工具

四个脚本按顺序组成一条流水线：

| 脚本 | 作用 | 输出 |
| --- | --- | --- |
| `static-scan.mjs` | 用 TypeScript Compiler API 解析 `src/renderer/src/**/*.tsx`，提取 JSX 控件、按钮文案、message/Modal、菜单项、Tooltip、placeholder、Empty、快捷键与 `window.api.*` IPC 调用 | `tools/.cache/static-ui.json` |
| `capture.mjs` | 复制主项目真实数据到临时 `userData`，启动源码构建版 Electron，用 Playwright 逐路由/逐 Tab/逐弹窗截图并采集 DOM/AX、布局区域、设计令牌 | `inventory.json`、`screenshots/png|webp`、`baseline/*.json` |
| `compact-inventory.mjs` | 从完整 DOM/AX 转储中保留控件、提示、树节点，压缩入库体积；原始全量写入 `tools/.cache/inventory.raw.json` | 精简后的 `inventory.json` |
| `generate-docs.mjs` | 把 `inventory.json` 与 `static-ui.json` 合成人读清单 | `README.md`、`pages/`、`components/`、`flows/`、`observations.md`、`rea-ipc-evidence.md` |

## 前置条件

```bash
npm run build                      # 采集的是 out/ 源码构建产物
cp ui-inventory/tools/.env.example ui-inventory/.env.local
# 在 .env.local 填 MySQL 只读连接（host/port/user/password/database）
```

`.env.local` 已在 `.gitignore`，不会入库。`capture.mjs` 只读取它，不对数据库做任何写入。

真实 userData 默认从 `%APPDATA%/KindraAPI`（macOS 为 `~/Library/Application Support/KindraAPI`）推导；如装在别处，用 `KINDRAAPI_REAL_USER_DATA` 覆盖。

## 运行

```bash
npm run ui:inventory                 # 静态扫描 + 全量采集 + 生成文档
npm run ui:inventory:capture         # 只采集（不重新生成文档）
npm run ui:inventory:docs            # 只重新生成文档
```

### capture.mjs 参数

| 参数 | 作用 |
| --- | --- |
| `--only=apis` | 只采集匹配的路由（`apis` / `history` / `docs` / `schemas` / `mqtt` / `automation` / `git` / `settings`） |
| `--merge` | 读取已有 `inventory.json` 并追加新状态，不覆盖旧状态 |
| `--reuse` | 复用 `ui-inventory/.user-data`，不重新复制真实数据 |
| `--no-webp` | 跳过 ffmpeg 转 WebP |
| `--max-screens=20` | 限制本次新增状态数，便于调试 |

## 数据隔离

1. 只读复制真实 `%APPDATA%/KindraAPI/offline-data` 与 `offline-data-local` 到 `ui-inventory/.user-data/`。
2. 临时副本里的 `debug_config.json` 被改为 `{ "enabled": false }`，避免和你正在运行的 9222 实例抢端口。
3. 临时副本的 `offline-projects.json` 被重写为只指向副本中的主项目（真实注册表里是绝对路径）。
4. 临时仓库会自动 `git init` 并提交一次，用于 Git 页的真实状态截图。
5. 真实 userData 全程不被写入；删除 `ui-inventory/.user-data/` 即可彻底清理。

## REA IPC 取证

REA 的 `capture-electron-scenario` 只传固定白名单环境变量，无法继承 `KINDRAAPI_USER_DATA`。复现步骤：

```bash
cp out/main/index.js out/main/index.js.rea-backup
# 把 out/main/index.js 里
#   electron.app.setPath("userData", process.env.KINDRAAPI_USER_DATA || kindraAPIUserData)
# 临时改成绝对路径 .../ui-inventory/.user-data
npx -y rea-agents@6.7.0 capture-electron-scenario \
  ui-inventory/tools/rea-scenarios/open-api.json --format json \
  > ui-inventory/baseline/rea/open-api.json
mv out/main/index.js.rea-backup out/main/index.js   # 还原；或 npm run build
```

场景文件在 `tools/rea-scenarios/`；汇总见 `../rea-ipc-evidence.md`。

## 截图说明

- `screenshots/webp/` 入库，`screenshots/png/` 本地保留（`.gitignore`）。
- WebP 由 `ffmpeg -quality 92` 生成；如果本机没有 ffmpeg，用 `--no-webp` 只保留 PNG。
- 截图来自主项目真实数据，可能含接口名、URL、项目 ID、请求体；对外分享前先脱敏或改用空数据重跑。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| Electron 启动后 CDP 超时 | 检查临时 `debug_config.json` 是否为 `enabled: false`；确认 9222 未被其他进程占用 |
| 页面显示“暂无接口” | 检查临时 `offline-projects.json` 是否指向副本中的 `offline-data/<project_id>` |
| 数据库弹窗保存后列表为空 | 确认 `.env.local` 的 MySQL 参数；弹窗主按钮是“确定” |
| 截图数量异常少 | 用 `--only=<route>` 单独跑，看控制台里哪个 scenario 抛错 |
