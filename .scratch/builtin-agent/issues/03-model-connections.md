# 03: 多连接与任务绑定

**What to build:** 管理多个本机连接、项目默认及固定的本轮配置。

**Blocked by:** [01 配置模型并进行项目文本对话](01-model-chat.md)

**Status:** resolved

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [x] 可创建、修改、删除连接及设置项目默认，Key 不回传普通配置读取。
- [x] 进行中任务绑定配置快照，修改或删除连接不改变任务，也不自动切换服务。
- [x] 两项目默认相互独立；配置和会话不进项目 Git。
- [x] 回环服务与真实配置存储验证重启中断及运行中修改，不自动重启任务。

## Answer

新增本机多连接集合、独立项目默认与单轮连接选择。旧单连接配置迁移至新集合，Key 继续由系统安全存储加密；公开读取与任务配置快照不含凭据。运行开始即固定地址、协议、模型、Key 和 revision，后续编辑或删除不影响当前回复，删除默认不会切换至其他服务。能力探针按配置 revision 回写，修改 Key 后旧检测不得授予新连接工具能力。

界面可新增、编辑、删除连接及设置项目默认，显示运行中任务固定的模型。真实 Electron 进程重启保留两项目各自默认及会话，未完成回复标记中断且不重发。

验证：`npm run typecheck`、`npm run build`、`npm run test:agent-chat`、`npm run test:agent-connections`、`npm run test:agent-ui`、`npm run test:agent-connections-ui` 通过。新增测试从应用命令与实际 Renderer/preload IPC 入口验证真实存储、回环网络、运行中改删配置、过期能力探针、显式单轮选择、重启无重放及 Git 目录边界。

实现指针：`src/main/agent/store.ts`、`src/main/agent/service.ts`、`src/renderer/src/pages/AgentPage.tsx`；测试指针：`scripts/agent-connections-smoke.ts`、`scripts/agent-connections-ui-smoke.cjs`。

同步票据02后，`test:agent-responses`、`test:agent-ui -- --responses` 与多连接命令/UI回归再次通过，保留双协议选择与统一分发。
