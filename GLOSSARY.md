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

## 字典

**Dictionary Module（字典模块）**
产品中承载数据字典、数据库管理与数据模型的模块。
_Avoid_: 数据字典（指整个模块时）

**Dictionary Entry（字段描述条目）**
一条“字段名 + 类型 + 描述”的记录，用于接口参数和模型字段的描述联想。
_Avoid_: 字典项、参数字典

**Built-in Dictionary Entry（系统内置描述）**
随应用发布、只读的常用字段描述；可以在联想中整体关闭，但不能逐条修改。
_Avoid_: 默认字典、官方字典

**Custom Dictionary Entry（自定义描述）**
项目内新增的字段描述条目，可编辑和删除。
_Avoid_: 用户字典

**Data Model（数据模型）**
项目级、可被接口引用的结构化数据定义；以 JSON Schema 描述字段，由模型目录组织。
_Avoid_: 数据结构、Schema（单独使用时）

**Model Folder（模型目录）**
组织数据模型的容器节点，不承载字段定义。
_Avoid_: 分组、文件夹

**Model Alias（模型别名）**
数据模型的可选搜索名，方便用业务叫法定位模型。
_Avoid_: 备注名

**Model Reference（模型引用）**
接口请求体或响应示例指向某个数据模型的关系；内容在使用时按模型生成，不是独立快照。
_Avoid_: 模型快照、模型副本

**Database Connection（数据库连接）**
项目级的 MySQL 连接配置，用于测试连接和把表结构导入为数据模型。
_Avoid_: 数据源、DB 配置

**Table Import（表结构导入）**
把 MySQL 表的列与类型转换为一个数据模型的动作。
_Avoid_: 反向生成、同步表

## MQTT

**MQTT Module（MQTT 模块）**
与 API 页面平行的项目级模块，管理 MQTT 连接、订阅、消息与运行记录；它不是 Target，也不参与接口树、环境变量、文档分享与 OpenAPI。
_Avoid_: MQTT 接口、MQTT Target、MQTT 目标

**Connection Profile（连接配置）**
一份持久化的 broker 连接参数：地址、端口、传输、协议版本、clientId、凭据、TLS、keepalive、clean session 与遗嘱。
_Avoid_: 连接、连接信息、MQTT 配置

**Connection Session（连接会话）**
由某个 Connection Profile 建立的一次运行时连接，具有连接中 / 已连接 / 重连中 / 已关闭状态。
_Avoid_: 连接、通道

**Connection Attempt（连接尝试）**
一次“连接 → 出结果 → 断开”的探针记录，含是否成功、CONNACK 码与各阶段耗时；「测试连接」与持久「连接」各产生一条。
_Avoid_: MQTT Run、发送记录、历史记录

**Round-trip Check（往返验证）**
Connection Attempt 内可选的一步：向唯一测试主题发布后订阅回收，用于验证发布、订阅与 ACL。
_Avoid_: 回声测试、发布测试

**Subscription（订阅）**
Connection Profile 上保存的一组 Topic Filter 与各自 QoS；会话重连后自动重新订阅。
_Avoid_: 订阅项、主题订阅

**Topic Filter（主题过滤器）**
MQTT 的主题匹配表达式，可包含 `+` 与 `#` 通配符。
_Avoid_: 主题、topic 规则

**Message Inbox（消息收件箱）**
展示当前会话消息的界面与数据视图，支持过滤、暂停、搜索、导出与重发。
_Avoid_: 消息列表、日志

**Message Record（消息记录）**
一条已落盘的收 / 发消息，含主题、载荷、QoS、retain 与时间戳。
_Avoid_: 消息、报文

**Profile Version（配置版本）**
MQTT 模块内的轻量快照，仅覆盖 Connection Profile；与 Target 的版本机制无关。
_Avoid_: 版本快照、接口版本

**Will（遗嘱消息）**
broker 在客户端异常断开时代为发布的消息；含主题、载荷、QoS、retain，MQTT 5 下还含延迟与 User Properties。
_Avoid_: 遗言、最后消息

**Shared Subscription（共享订阅）**
多个客户端分摊同一订阅的 MQTT 特性，主题以 `$share/<group>/` 开头；本期只做识别与展示。
_Avoid_: 集群订阅

## 两个系统

**Original App（原应用）**
`/Applications/Apipost单机版.app`，分析对象。

**KindraAPI（本仓库实现）**
当前仓库 `src/` 下的自研替代实现。文档中提到“现状/M1”时指它，
提到“分析/实测”时指 Original App。
