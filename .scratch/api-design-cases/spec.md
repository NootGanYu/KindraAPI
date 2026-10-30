# 接口设计与用例 Spec

Status: ready-for-agent
Date: 2026-10-30
Feature: api-design-cases

## Problem Statement

ApisPage 的「设计」「用例」模式目前只是占位文案（`ModePlaceholder`），没有数据模型、编辑能力和执行能力。用户无法在应用内沉淀接口契约、错误码，也无法保存可重复执行的用例与断言。分享页也只能展示请求/响应，没有设计与用例信息。

本 spec 交付：可编辑的接口设计视图（与调试共用同一份数据）、可执行的单接口用例、若干断言、单条/全部运行、分享页展示，以及完整的 MCP CRUD + 运行工具。

## Solution

- 设计不是独立副本：直接复用 `Target.description / request / response`，仅新增可选 `design.errors[]`。
- 用例存于 `Target.cases[]`：名称、说明、请求覆盖、断言、`last_run`。
- 设计/用例作为 ApisPage 的模式，与调试共享当前标签与草稿。
- 运行沿用现有 executor 与当前环境；结果持久化但不把标签标脏。
- 分享页在接口页增加「设计」「用例」两个分区，由 `show_design/show_cases` 控制。
- MCP 新增设计与用例工具，写操作沿用现有写门控。

## User Stories

1. 作为用户，我在「设计」模式看到并编辑接口说明、请求参数、响应结构与示例。
2. 作为用户，我在设计页维护错误码表（code/message/description）。
3. 作为用户，我在设计页的修改与调试页共享同一份数据，切换模式不丢失。
4. 作为用户，我在「用例」模式为接口添加多条用例，每条有名称与说明。
5. 作为用户，我让用例按 key 覆盖 headers/query/restful，未覆盖的继承接口。
6. 作为用户，我让用例覆盖 body（继承或整体替换）。
7. 作为用户，我配置断言：状态码、耗时、JSONPath 的 equals/not_equals/contains/exists/gt/lt。
8. 作为用户，我单条运行用例并看到状态、耗时与每条断言结果。
9. 作为用户，我“运行全部”并按顺序看到汇总，单条失败不阻断后续。
10. 作为用户，我关闭重开后仍能看到上次运行结果，且运行不会触发未保存提示。
11. 作为用户，我在分享页看到接口的设计与用例（仅断言描述，不含运行结果）。
12. 作为 Agent，我通过 MCP 读写设计与用例并运行。

## Implementation Decisions

### 数据模型（`src/shared/types.ts`）

```ts
interface DesignError { code: string; message: string; description?: string }
interface DesignModel { errors?: DesignError[] }

type AssertionKind = 'status' | 'duration' | 'json'
type AssertionOp = 'equals' | 'not_equals' | 'contains' | 'exists' | 'gt' | 'lt'

interface Assertion {
  assertion_id: string
  kind: AssertionKind
  op: AssertionOp
  path?: string      // json 时必填，JSONPath 子集，如 $.data.items[0].id
  expected?: string  // equals/contains/gt/lt 使用；exists 忽略
  enabled: number
}

interface CaseRunAssertion { assertion_id: string; passed: boolean; actual?: string; message?: string }
interface CaseRunResult {
  ran_at: string
  status: 'passed' | 'failed' | 'error'
  http_status?: number
  duration_ms?: number
  error?: string
  assertions?: CaseRunAssertion[]
}
interface ApiCase {
  case_id: string
  name: string
  description?: string
  enabled: number
  override: {
    method?: string
    url?: string
    headers?: Param[]
    query?: Param[]
    restful?: Param[]
    body_mode?: BodyMode
    body?: string
    formdata?: Param[]
    urlencoded?: Param[]
  }
  assertions: Assertion[]
  last_run?: CaseRunResult
}

interface Target {
  // ...
  design?: DesignModel
  cases?: ApiCase[]
}
```

- `cases`、`design` 随 `targets.save` 一起持久化，克隆接口时一并复制。
- `last_run` 通过独立 IPC `target:save-case-run(projectId, targetId, caseId, result)` 写入，避免覆盖草稿且不置 dirty。

### 设计模式

- 布局：接口名/方法/URL、说明（复用 `ApiDescriptionDialog`）、请求参数/Headers/Body（复用现有编辑器组件，直接编辑草稿）、响应结构与示例（复用 ResponsePanel 的模型引用能力）、错误码表（可增删行，code/message/description）。
- 所有编辑走 `patchDraft`，与调试页共享草稿；保存仍走现有 `saveTarget`。
- 分享页设计分区：按 `show_request/show_response` 分别展示请求/响应结构，错误码表独立展示。

### 用例模式

- 左侧用例列表（新增/复制/删除/启用），右侧编辑：名称、说明、请求覆盖、断言表、运行按钮、最近结果。
- 请求合并：headers/query/restful 按 `key` 覆盖，未提供的继承；body 可继承或整体覆盖；URL 为空继承接口，支持绝对地址与 `{{var}}`。
- 断言：JSONPath 子集 `$.a.b[0]`；`exists` 只看路径是否存在；`equals` 做字符串/数字宽松比较；`contains` 字符串包含；`gt/lt` 数值比较。逐条判定，失败不阻断。
- 运行：单条与运行全部（串行、当前环境）。运行全部汇总 `{ total, passed, failed, error }`。
- 结果展示状态、HTTP 状态、耗时、每条断言实际值与消息。
- 运行不写入请求历史。

### 分享

- 接口页新增「设计」「用例」分区，由 `show_design/show_cases` 控制，默认开启。
- 用例只展示名称、说明、断言描述；不展示请求覆盖中的敏感值、不展示 `last_run`。

### MCP

新增工具（沿用现有写门控与返回风格）：

- `get_api_design(project_id, api_id)`
- `update_api_design(project_id, api_id, design)`
- `list_api_cases(project_id, api_id)`
- `get_api_case(project_id, api_id, case_id)`
- `create_api_case(project_id, api_id, case)`
- `update_api_case(project_id, api_id, case_id, case)`
- `delete_api_case(project_id, api_id, case_id)`
- `run_api_case(project_id, api_id, case_id)`
- `run_api_cases(project_id, api_id)`

## Testing Decisions

- 单元：请求合并、JSONPath 子集解析、每种操作符（含缺失路径/类型不符）、文件名与断言汇总。
- 集成（smoke）：设计字段往返保存；用例 CRUD；单条与全部运行（对 `scripts/demo-server.cjs`）；运行后 `last_run` 落盘且标签不 dirty；分享页开关。
- MCP：每个工具成功路径、未知 id、写门控关闭时拒绝。

## Out of Scope

- 集合级测试套件、环境矩阵、CI 报告。
- JS 脚本断言。
- 把用例接入自动化/flow 流程。
- 用例运行写入请求历史。

## Further Notes

- 设计页尽量复用现有编辑组件，避免出现第二套请求编辑器。
- 断言解析放在 `src/shared`，main 与 renderer 都能用。
