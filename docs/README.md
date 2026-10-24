# Apipost 单机版复刻分析文档

> 分析对象：`/Applications/Apipost单机版.app`
> Bundle ID：`com.apipost.offline.fe.desctop.cn.8.x`
> 版本：2.0.0（Build 2026-10-10；commit `c70703637` 来自构建信息，**未独立验证**）
> 目标：理解其实现，用于自研一个「接口调用 + 响应记录 + 简单流程自动化」的工具。

---

## 1. 范围声明

本套文档只做**架构与实现分析**，用于自研替代工具。

- 不包含、也不会提供任何破解/绕过授权（License）的方法。
- 授权机制只在 `01-授权机制分析.md` 中做架构层面的说明。

---

## 2. 应用基本信息

| 项 | 值 |
|---|---|
| 壳 | Electron |
| 主进程 | Node.js（Electron 内置） |
| 渲染层 | React 18.3 + Ant Design + Zustand + Axios + Monaco Editor |
| 请求执行 | `postman-runtime` + `postman-collection`（打包在 `send.asar`） |
| 本地存储 | 文件数据库（`utils/fileDB.jsc`），一项目一目录 |
| Mock | 内置原生 HTTP 服务（默认端口 30999） |
| 流程自动化 | 自研事件引擎，事件转换为 postman-collection 后交给 postman-runtime |
| 附加能力 | WebSocket / Socket.IO / gRPC / TCP / 数据库 / 压力测试 / MCP / 文档分享 |

---

## 3. 进程与模块总览

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer  (Resources/app/build/work.asar)                   │
│  React 18 + antd + zustand + Monaco                         │
│  - 项目管理 / 接口编辑 / 响应展示 / 测试用例 / Mock 配置      │
│  - 通过 preload 暴露的 window.app.* 与主进程通信              │
│  - 通过 apt://localhost/proxy/<method> 发起请求执行           │
└───────────────┬─────────────────────────────────────────────┘
                │ preload.js（白名单 IPC）
┌───────────────▼─────────────────────────────────────────────┐
│ Main Process (Resources/app/main.js)                        │
│  ├─ utils/protocol.js    apt:// 协议分发器                    │
│  ├─ utils/fileDB.jsc     本地文件数据库（项目数据）             │
│  ├─ utils/license/*.jsc  授权（见 01）                        │
│  ├─ utils/newElectronServer.js  Unix Socket（DB/脚本执行）     │
│  ├─ utils/autoImportTask.js     定时导入任务                  │
│  ├─ utils/mcpService.js / mcp-stdio.js  MCP 桥               │
│  └─ build/mock.asar/server.js   本地 Mock 服务                │
└───────┬──────────────────────┬──────────────────────────────┘
        │ worker_threads       │ http://127.0.0.1:30999
┌───────▼──────────────┐  ┌────▼─────────────────────────────┐
│ send.asar            │  │ mock.asar                        │
│  postman-runtime     │  │  原生 http 服务 + 分享文档服务     │
│  postman-collection  │  │  json-schema-faker-pro            │
│  grpc / ws / socket  │  │  本地 offline-data 读取            │
│  数据库驱动           │  └──────────────────────────────────┘
│  vm 沙箱脚本          │
└──────────────────────┘
```

### 三个 asar

| 文件 | 大小 | 作用 |
|---|---|---|
| `build/work.asar` | 55 MB | 渲染层 UI（Webpack 分包） |
| `build/send.asar` | 60 MB | 请求执行运行时（postman-runtime 等） |
| `build/mock.asar` | 98 MB | Mock 服务 + 文档分享前端 |

主进程入口 `Resources/app/main.js` 是明文；关键数据/授权模块是 `.jsc`（bytenode 字节码）。

---

## 4. 关键调用链（先看这里）

### 4.1 单次接口调试

```
UI 点击「发送」
  → 组装 option + test_events
  → POST apt://localhost/proxy/v2/http
  → main: protocol.js aptHandler 取最后一段 "http"
  → send.asar: send.http(buf, stream)
  → JSON.parse(buf) 得到 {test_events, option}
  → runner-runtime.run(test_events, option, cb)
      → 把 Apipost 模型转成 postman-collection Item
      → new postman-runtime.Runner().run(...)
      → 收集 request/response/console/assertions/timings
  → cb(last_msg)
  → HttpConvertResult → {code:0,msg:"success",data:last_msg}
  → 渲染层展示 + 写入 send_history / lately
```

### 4.2 流程自动化（测试用例）

```
UI 点击「运行」
  → 将事件树规范化为 test_events
  → POST apt://localhost/proxy/v2/runner
  → main: wrapSend("runner") 在 worker_threads 中执行（避免阻塞）
  → send.runner(buf, stream)
  → 逐个 executeEvent / iterationEvent
  → SSE 推送：event: request / process / complete / systemError / sse
  → UI 实时渲染执行树与报告
```

### 4.3 本地数据读写

```
window.app.fileDB.projectRead(projectId, "apis/<id>.json")
  → preload → ipcRenderer.invoke("filedb:projectRead")
  → main: fileDB.jsc
  → <项目目录>/apis/<id>.json
```

详见 `03-数据模型与本地存储.md`。

---

## 5. 文档索引

| 文档 | 内容 |
|---|---|
| `01-授权机制分析.md` | License 架构、状态机、存储、信任边界（不含绕过） |
| `02-整体架构与进程模型.md` | 进程、协议、启动流程、请求执行路径、安全机制 |
| `03-数据模型与本地存储.md` | 目录布局、project/api/env/history/testcase 等完整字段 |
| `04-请求执行引擎.md` | postman-runtime 集成、模型转换、变量、脚本、响应字段 |
| `05-流程自动化与测试.md` | 事件类型、执行算法、断言、SSE 协议、压测 |
| `06-Mock服务与文档分享.md` | Mock 路由、规则、期望匹配、生成器、管理 API |
| `07-复刻实现建议.md` | MVP 范围、技术选型、接口契约、里程碑与坑 |
| `08-MCP实现分析.md` | MCP 全链路：stdio → TCP 桥 → IPC → 执行引擎、30 个工具、权限与存储 |
| `09-UI设计与界面分析.md` | 设计令牌、应用外壳、路由与页面结构、交互规范、复刻建议、CSS 变量；含 10 张实机截图（`docs/images/`） |
| `10-字典模块实现计划.md` | 数据字典、数据模型、MySQL 连接与导入、API 引用、MCP 工具、存储与校验计划 |
| `adr/0001-model-reference-live-generation.md` | 模型引用采用实时生成而非快照 |
| `adr/0002-mysql-only-plaintext-credentials.md` | 首版仅 MySQL、凭据明文、SSH 仅记录 |
| `../GLOSSARY.md` | 规范术语表：Project / Target / API / Folder / Send Record / Testing / Event / Run / MCP Execution Flow / Dictionary / Data Model |

---

## 5.1 复核状态（2026-10-24）

已对 10 篇文档做逐条复核：以原始 `.app` 为准、`analysis/` 提取物交叉，
并对 `.jsc` 做了只读动态探针。每篇末尾新增“证据索引”；无法静态/动态
确认的断言均显式标注，不再写成既定事实。

术语与“测试用例 vs MCP 执行流程”的区分见根目录 `GLOSSARY.md`。
本仓库 M1 实现现状见 `07-复刻实现建议.md` §7.1。

---

## 6. 一句话总结

它本质上是一个 **Electron 壳 + React UI + Postman 运行时 + 本地文件数据库 + 自研 Mock 服务**：

- 用 postman-runtime 解决「HTTP 请求 + 脚本 + 断言 + 变量」这些最难的兼容性问题；
- 用「一项目一目录 + JSON 文件 + index.json」解决离线存储与 git 协同；
- 用自研事件树（api/if/loop/wait/script/assert/sql）解决简单流程自动化；
- 用本地 HTTP 服务解决 Mock 与文档分享。

复刻时最值得照搬的是**数据模型与请求契约**，最不值得照搬的是它的授权与热更新机制。
