# KindraAPI

KindraAPI 是一个本地优先的 API 调试与协作工具：接口调试、请求历史、环境与 Cookie 管理、接口文档分享、流程自动化，以及供 AI Agent 使用的 MCP 服务。

所有数据默认保存在本机，不依赖云端账号。

## 功能

- **接口调试**：HTTP 请求、环境变量、路径/查询/Header/Cookie、多种 Body 类型、响应查看与 JSON 校验
- **接口管理**：项目 / 目录 / 接口树、标签页、拖拽排序、版本快照、克隆
- **文档与分享**：接口说明富文本、本地只读文档页、密码/有效期、Markdown 与 OpenAPI 导出
- **环境管理**：环境下拉搜索、全局参数、全局变量、Cookie 管理器
- **代码生成**：基于解析后的真实请求生成 curl
- **流程自动化**：请求、脚本、断言、条件、循环、等待等事件
- **字典与数据模型**：数据字典、模型可视化、MySQL 表结构导入
- **MCP**：通过 stdio / TCP 向 AI Agent 暴露项目、接口、执行与字典能力

## 技术栈

Electron 45 · electron-vite 6 · React 18 · Ant Design 5 · Zustand 5 · postman-runtime · TypeScript

## 环境要求

- Node.js >= 22.12
- npm >= 10

## 本地开发

```bash
npm install
npm run dev
```

常用命令：

```bash
npm run typecheck   # 类型检查
npm run build       # 构建主进程 / preload / 渲染层产物到 out/
npm run smoke       # 端到端冒烟测试
npm run demo        # 本地演示 HTTP 服务
```

## 打包

打包使用 [electron-builder](https://www.electron.build/)，配置见 `electron-builder.yml`，产物输出到 `release/`。

### macOS

```bash
npm run pack:mac
```

默认生成 Apple Silicon（arm64）的 `.dmg` 与 `.zip`。

### Windows

```bash
npm run pack:win
```

生成 x64 的 NSIS 安装包与免安装 `.zip`。

> 构建未签名、未公证。macOS 首次打开如被拦截，可在 Finder 中右键选择“打开”，或执行：
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/KindraAPI.app
> ```
>
> Windows 可能出现 SmartScreen 提示，选择“仍要运行”即可。

### 手动指定目标

```bash
npx electron-builder --mac dmg zip --arm64
npx electron-builder --win nsis zip --x64
```

## 发布到 GitHub Release

构建完成后，使用 GitHub CLI 创建 Release 并上传产物：

```bash
gh release create v0.1.0 \
  release/KindraAPI-0.1.0-mac-arm64.dmg \
  release/KindraAPI-0.1.0-mac-arm64.zip \
  release/KindraAPI-0.1.0-win-x64.exe \
  release/KindraAPI-0.1.0-win-x64.zip \
  --title "KindraAPI v0.1.0" \
  --notes "首个公开版本"
```

## 数据目录

- macOS：`~/Library/Application Support/KindraAPI`
- Windows：`%APPDATA%/KindraAPI`

项目数据、发送历史、分享文档与 MCP 配置均保存在该目录下。

## MCP

在应用「配置 → MCP」中开启服务后，可让 AI Agent 通过本地 MCP 访问 KindraAPI。仓库根目录提供 `mcp-stdio.cjs` 作为 stdio 桥接器，打包后的应用也会在资源目录中附带该文件。

## 许可

MIT
