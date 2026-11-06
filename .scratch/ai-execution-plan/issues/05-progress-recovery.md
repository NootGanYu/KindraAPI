# 05: 进度与本地中断记录

**What to build:** 让用户在运行期间查看进度，并在退出或重启后查看已完成结果，不自动重放请求。

**Blocked by:** 04: 异步启动与查询 Run

**Status:** resolved

- [x] UI 与 MCP 查询逐步显示进度和已完成部分结果，并持久化到本机。
- [x] 新运行日志及快照证据不进入 Git，敏感值在展示和持久证据中脱敏。
- [x] 使用 token、Cookie、嵌套字段和 console 样例验证 UI、MCP 与持久证据脱敏一致。
- [x] 既有报告仍可读取，不批量迁移。
- [x] 切换项目后 Run 保持原项目绑定，可返回查看；活动 Run 绑定的 Flow 不可删除。
- [x] 退出时提示活动运行终止；重启显示中断和已有结果，不自动续跑或重发。
- [x] 无法确认远端结果时显示结果未知，不假标普通失败。
- [x] 真实存储和受控 loopback 测试验证逐步记录、退出重启及不重放；本票不要求取消能力。
- [x] 执行本票相关类型检查及 build，保持现有检查通过。

## Answer

已实现逐步本地进度记录、嵌套结果树、统一证据脱敏、重启中断识别、活动流程删除保护和退出确认。运行原始上下文保留在内存，UI/MCP/本地报告均采用同一脱敏投影；发送历史的备用 base64 数据不会泄漏原始响应，Cookie 数组保持可读结构。普通项目切换不会重绑 Run；退出后的运行只标记中断或远端结果未知，不重放请求。旧报告兼容读取且原文件不迁移。

实现提交：`035d33a`；快照集成：`51b51c2`。

验证通过：
- `npm run test:flow-progress`：真实临时存储、受控 loopback、实际 IPC/MCP；嵌套逐步进度、token/Cookie/嵌套字段/console 脱敏、发送历史备用编码、活动删除保护、跨项目查询、幂等元数据保留、独立进程中断恢复、无重放及旧报告读取。
- `npm run test:flow-progress-ui`：真实构建版 Electron 界面展示部分结果、脱敏 console、退出提示及取消退出后 Run 仍活动。
- `npm run test:flow-entry`、`npm run test:flow-snapshot`、`npm run test:flow-async`；与工单 11 合并后再次通过 `npm run test:flow-dependencies`。
- `npm run typecheck`、`npm run build`、`git diff --check`。

后续暂停工单扩充活动状态时需让恢复、删除保护和进度投影保留新状态；已向 06 实现者传递接缝。
