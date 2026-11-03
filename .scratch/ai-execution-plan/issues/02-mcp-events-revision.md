# 02: MCP 完整事件树与修订并发

**What to build:** 让 MCP 完整读写 Execution Flow 事件树并安全处理并发，同时兼容已有 steps 客户端和界面编辑。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] MCP 读取返回完整 events 树和 revision，条件、循环及脚本往返不丢失；现有 UI 可读写结果。
- [x] events 与 legacy steps 输入互斥，未知节点明确拒绝，不静默截断。
- [x] 完整事件树更新要求 expected revision；过期时拒绝且不写入。
- [x] 已提供的 event、step 和逻辑步骤 ID 保留，新增节点才分配 ID；名称等局部更新不重建步骤。
- [x] 未带 revision 的 legacy 更新仍可用并串行校验保存；无 ID 的 steps 是显式替换，不按位置猜测身份。
- [x] 含条件或循环的流程拒绝 legacy steps 覆盖，并提示改用完整事件树。
- [x] legacy 前置脚本、API 和后置脚本具有稳定逻辑分组，供完整步骤暂停使用；UI 更新同样携带 revision 并检查冲突。
- [x] 真实存储及实际 MCP 适配测试覆盖并发、互斥、未知节点、旧客户端与 UI 往返。
- [x] 执行本票相关类型检查及 build，保持现有检查通过。

## Answer

提交 `99077d8` 实现完整 events 读写、递归未知类型/重复 ID 拒绝、legacy steps 显式替换与稳定逻辑分组，以及 UI/MCP 共享的同步 compare-and-save。已有文件读取时附带 revision，无需批量迁移。完整 events 更新要求 `expected_revision`，legacy 更新可省略；UI 通过 preload 与实际 IPC 传递读取到的 revision，冲突不落盘。

测试边界沿用 spec 的 Testing Decisions：真实临时项目存储、实际 MCP `callTool` 与 Electron renderer → IPC；见 `scripts/flow-definition-smoke.ts`。

- TDD：先观察完整 events 创建失败；实现后通过。再观察 legacy ID 丢失与 UI 过期保存覆盖失败；分别实现后通过。随后补充显式 step ID 稳定性失败测试并修复。
- `npm run test:flow-definitions` 通过：八类事件往返、稳定 IDs、两种输入互斥、嵌套未知节点与重复 ID 拒绝、禁止 legacy 覆盖结构、并发 revision 冲突，以及 UI/MCP 往返。
- `npm run test:flow-entry`、`npm run typecheck` 与 `npm run build` 通过（Node 使用 mise）。已将工单 01 的 UI 测试改为经公开 flow:create 创建后携带 revision 保存，与界面合同一致。
- 已合入集成分支 `b518257`，合并提交 `0473d00`。
- 集成分支基线 `npm run smoke` 已存在无关文档断言 `doc html excludes orphan field docs` 失败；本票未修改文档模块。
