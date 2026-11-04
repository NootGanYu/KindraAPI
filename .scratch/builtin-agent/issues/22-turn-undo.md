# 22: 整轮跨对象本地撤销与审计

**What to build:** 对一轮接口、用例和 Flow 的本地修改展示差异并安全撤销。

**Blocked by:** [15 编辑与保存 API Case](15-edit-api-case.md), [21 对象删除后的候选保留与恢复](21-deleted-object-candidates.md)

**Status:** claimed

父规格：[内置 Agent 规格](../spec.md)。22 张票共同构成已确认首版；新增工具复用两协议的协议无关工具契约。

验证约定：使用 Renderer 实际调用的应用命令/事件、隔离 userData、真实存储及业务能力；按需使用回环模型和目标 HTTP，关键用户旅程覆盖 Electron UI。

- [ ] 展示 Git Diff 风格变更及冲突；后续人工编辑冲突需确认，不覆盖无关修改。
- [ ] 恢复所有可编辑字段并保留对象身份、运行记录及候选审阅历史。
- [ ] 明确远端请求及外部副作用不能回滚；不声称整批原子撤销。
- [ ] 隔离真实存储和 Electron UI 覆盖混合对象、冲突与重启；Agent 记录不进 Git、可删除。
