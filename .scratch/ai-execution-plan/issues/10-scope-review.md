# 10: 执行范围变更审阅

**What to build:** 用户在暂停后采用新定义时，清楚审阅授权范围变化，扩权需明确确认才能继续。

**Blocked by:** 08: 暂停后保存并刷新剩余引用

**Status:** resolved

- [x] 比较 method、origin、环境、脚本和文件范围并展示扩大项。
- [x] 扩大原授权范围时要求用户明确确认，拒绝或关闭审阅保持暂停。
- [x] 未扩大范围时不重复要求授权；保存本身不等于确认或继续。
- [x] 用户确认后仍需手动继续，并记录审阅的版本及范围。
- [x] 继续前重新校验权限和 revision；期间变化需重新审阅。
- [x] 若存在步骤覆盖冲突而票 09 尚不可用，保持暂停，不通过授权确认绕过冲突。
- [x] 真实存储、loopback 和 UI 测试验证扩大、未扩大、拒绝及并发变化。
- [x] 执行本票相关类型检查及 build，保持现有检查通过。


## Answer

已实现本轮范围审阅。预览展示 method、origin、接口脚本、文件变化及固定运行环境；明确确认绑定预览 ID、定义修订与有效请求指纹。确认后仍需分别采用更新、手动继续。冲突阻塞与范围阻塞独立，范围确认不能绕过覆盖冲突；API、继承、文件及 MCP 权限在继续前重新检查。Run 环境保持启动快照，保存环境的编辑不会隐式切换本轮环境。版本切换报告持久记录本次范围确认。

实现提交：`c75452d`、`898807a`；集成权限校验：`e706372`。所有运行证据保持本地脱敏。

验证通过：
- `npm run test:flow-scope`：真实存储及 loopback 验证批准后仍暂停、单独采用/继续、同范围无需批准、revision/文件/继承变化拒绝、覆盖冲突不可绕过、环境绑定及撤权后的继续检查。
- `npm run test:flow-scope-ui`：真实 Electron 按钮验证拒绝保持暂停、明确确认后采用、手动继续、最终版本证据。
- `test:flow-refresh`、`test:flow-refresh-ui`、`test:flow-pause`、`test:flow-cancel`、`test:flow-revocation` 回归通过。
- `npm run typecheck`（node/web）、`npm run build`、`git diff --check` 通过。

## Comments

UI 范围确认使用独立 IPC；MCP 无范围批准或解除用户暂停工具。工单09合并时，保留 `rebuildBlockers()` 中未解决冲突的判断及范围确认指纹校验；解决冲突改变有效请求时旧范围确认自动失效。
