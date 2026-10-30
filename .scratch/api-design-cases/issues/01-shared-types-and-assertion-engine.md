# 01: 共享类型、合并与断言引擎

**What to build:** 在 `src/shared` 增加设计与用例类型、请求合并逻辑、JSONPath 子集与断言求值。

**Blocked by:** 无

**Status:** ready-for-agent

- [ ] `DesignError`、`DesignModel`、`Assertion`、`ApiCase`、`CaseRunResult` 类型与 `Target.design/cases`
- [ ] 工厂函数：`createApiCase`、`createAssertion`、`createDesignError`
- [ ] `mergeCaseRequest(target, case)`：headers/query/restful 按 key 覆盖，body 继承或整体覆盖，URL 插值
- [ ] JSONPath 子集解析：`$.a.b[0].c`，返回 `{ found, value }`
- [ ] 操作符 equals / not_equals / contains / exists / gt / lt；类型不符返回失败而非抛错
- [ ] `evaluateAssertions(assertions, response)` 返回逐条结果与总状态
- [ ] 单元测试或 smoke 覆盖边界：空路径、数组越界、布尔/数字比较
- [ ] typecheck 通过
