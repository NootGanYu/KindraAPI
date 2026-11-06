# 08: 暂停后保存并刷新剩余引用

**What to build:** 用户暂停后在 UI 编辑并主动保存 API，预览无冲突且未扩权的剩余引用更新，再手动继续；完整结果记录版本切换。

**Blocked by:** 05: 进度与本地中断记录；06: 完整步骤暂停并手动继续

**Status:** resolved

- [x] 暂停期间用户可主动保存 API；保存不自动继续。
- [x] 所有受影响的剩余引用均列出并可更新为新快照；已完成步骤保留原版本及结果。
- [x] 界面显示实际生效请求与版本切换，手动继续后报告持久记录切换点。
- [x] 保存失败、接口删除或 revision 并发变化时保持暂停；继续前重新校验 revision。
- [x] 有步骤覆盖冲突或授权范围扩大时保持暂停，不在本票静默采用；分别留待票 09、10。
- [x] Flow input 持久定义不因本轮刷新而隐式修改；token 和对象 ID 保留并校验前置条件。
- [x] 与循环票独立实现，刷新接口能表示未来迭代；组合验证不重放已完成迭代。
- [x] 真实存储、受控 loopback 和 UI 测试覆盖重复引用、保存、预览、继续与失败。
- [x] 执行本票相关类型检查及 build，保持现有检查通过。

## Answer

已实现暂停 Run 的剩余引用预览、采用和手动继续。执行上下文保留原始 API 基线及候选快照，展示数据统一脱敏；完整结果保留每次请求的 definition_revision，以及版本切换的时间、受影响引用和 after_instance_id。

- 实现提交：`7084acb`；与嵌套游标集成：`9623835`；取消集成：`170df8a`。
- `FlowRefreshController` 在采用及继续前校验 API revision、继承、模型、文件和必需运行变量。覆盖冲突与范围扩大保持暂停，后续由 09／10 扩展。
- 剩余引用按暂停游标遍历，包含尚未执行的所有未来迭代；已完成请求证据不改写。
- UI 的未保存／保存错误检查阻止继续；保存、预览、采用均不隐式继续。

验证通过：`test:flow-refresh`（重复引用、并发变更、删除、字段与 body 冲突、范围扩大、缺少输出、保存冲突、取消审阅、嵌套循环和变量保留）；`test:flow-refresh-ui`（真实 Electron 控件暂停、保存、预览、采用、手动继续与报告）；`test:flow-pause`、`test:flow-loop-resume`、`test:flow-progress`、`test:flow-dependencies`、`test:flow-cancel`、node/web typecheck、build。

公开测试边界沿用 spec 中已确认的真实存储、loopback 与 UI；未 push。
