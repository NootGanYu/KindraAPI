# 02: MCP 完整事件树与修订并发

**What to build:** 让 MCP 完整读写 Execution Flow 事件树并安全处理并发，同时兼容已有 steps 客户端和界面编辑。

**Blocked by:** None (can start immediately)

**Status:** claimed

- [ ] MCP 读取返回完整 events 树和 revision，条件、循环及脚本往返不丢失；现有 UI 可读写结果。
- [ ] events 与 legacy steps 输入互斥，未知节点明确拒绝，不静默截断。
- [ ] 完整事件树更新要求 expected revision；过期时拒绝且不写入。
- [ ] 已提供的 event、step 和逻辑步骤 ID 保留，新增节点才分配 ID；名称等局部更新不重建步骤。
- [ ] 未带 revision 的 legacy 更新仍可用并串行校验保存；无 ID 的 steps 是显式替换，不按位置猜测身份。
- [ ] 含条件或循环的流程拒绝 legacy steps 覆盖，并提示改用完整事件树。
- [ ] legacy 前置脚本、API 和后置脚本具有稳定逻辑分组，供完整步骤暂停使用；UI 更新同样携带 revision 并检查冲突。
- [ ] 真实存储及实际 MCP 适配测试覆盖并发、互斥、未知节点、旧客户端与 UI 往返。
- [ ] 执行本票相关类型检查及 build，保持现有检查通过。
