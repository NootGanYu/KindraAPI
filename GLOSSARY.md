# 术语表（Apipost 单机版复刻）

本表锁定文档与实现使用的规范术语。**同一概念只用一个名字**；
括号内是原应用中的字段/标识，仅供对照，不是推荐命名。

## 对象

**Project（项目）**
一个独立的 API 工作空间，对应 `offline-data/<project_id>/` 一个目录。
字段标识：`project_id`。

**Target（目标）**
项目树里的任意节点，可能是目录、接口、WebSocket、gRPC 等。
字段标识：`target_id`、`target_type`。

**API（接口）**
`target_type = "api"` 的 Target，承载一次 HTTP 请求定义。
不要把“接口”泛指成所有 Target。

**Folder（目录）**
`target_type = "folder"` 的 Target，只用于组织与继承。
目录实体与接口实体的 `target_type` 必须各自一致。

**Request（请求定义）**
API 上的 `request` 对象：auth / header / query / restful / cookie / body / 前后置任务。

**Response Example（响应示例）**
API 的 `response.example[]`，是“设计态”的期望响应，不是某次调用的真实响应。

**Send Record（发送记录）**
一次真实调用产生的 request/response/assertions/console 快照。
原应用标识：`history_id`（索引）/ `result_id`（结果文件，实际等于 `history_id`）。
本文档不再使用 `record_id`。

**Sample（示例）**
API 的样例数据，可在测试用例里作为 `sample` 事件引用。
字段标识：`sample_id`。

**Environment（环境）**
一组变量与服务前缀。字段标识：`env_id`。
环境里的服务叫 **Server**（`server_id`），其 `uri` 作为请求前缀。

**Global Params（全局参数）**
项目级请求默认值，字段标识：`global_params.json`。它是“请求模板”，**不是变量**。

**Global Variables（全局变量）**
跨接口共享的变量，字段标识：`global_vars.json`。不要与 Global Params 混称。

**Mark（状态标记）**
接口的进度标记。原应用数值枚举：
`DEVELOPING="1"`、`COMPLATED="2"`、`MODIFYING="3"`。

## 自动化

**Testing（测试用例）**
一棵可执行的事件树，字段标识：`testing_id`、`event_list`。
UI 上也叫“接口用例/测试用例”。

**Event（事件）**
Testing 树中的节点，字段标识：`event_id`、`type`、`data`、`children`。
运行时可执行类型只有 14 种：`api/sample/sse/request/script/assert/assert_visual/sql/wait/if/assert_if/begin/loop/multi_if`。
`case` **不是**运行时可执行事件。

**Run（MCP 运行记录）**
一次 MCP 接口/流程执行的记录。字段标识：`run_id`。
Testing 的汇总报告用的是 `report_id`，不要与 `run_id` 混用。

**MCP Execution Flow（MCP 执行流程）**
由 MCP 工具创建、保存于 `executions/flows/` 的步骤序列。
字段标识：`flow_id`、`steps[].step_id`。
**不要**把它与 Testing 事件树都简称为“流程”；必要时写全称。

## 两个系统

**Original App（原应用）**
`/Applications/Apipost单机版.app`，分析对象。

**openPost（本仓库实现）**
当前仓库 `src/` 下的自研替代实现。文档中提到“现状/M1”时指它，
提到“分析/实测”时指 Original App。
