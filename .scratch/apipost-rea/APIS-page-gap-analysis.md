# Apipost 单机版 APIS 页面 vs KindraAPI APIS 页面对比分析

> 后续细粒度「设计 / 调试」对照、真机截图与 Mac 交接方案见：`APIS-design-debug-handoff.md`。

## 分析对象与方法

- 目标：`D:\Program Files\Apipost\Apipost单机版.exe`（Electron，productName `Apipost单机版`，version 2.0.0，构建时间 2025-10-10）
- 渲染层：`resources/app/build/work.asar`（另有 `send.asar`、`mock.asar`）
- 工具：REA（`rea-agents@6.7.0`）
  - 全量 344 个 JS 文件的 `analyze-javascript-application` 超过 300s 超时（REA 返回 `provider_timeout`，保留部分 Evidence）
  - 改为只分析主入口 `index-0d1d8198fa5a.js`，成功完成（20,000 语义节点、14,590 关系）
  - 另从 asar 中提取 18,364 条 i18n 键值作为功能词表（`work-strings.json`）
- 结论来源：Apipost 自带中文语言包键名/文案 + REA 应用图，不是对 UI 的运行时录屏

## Apipost APIS 页面功能清单

### 1. 页面框架与接口树

| 能力 | Apipost 证据（i18n 键/文案） |
| --- | --- |
| 目录/接口树、根目录、子目录 | `new_folder=新建目录`、`new_subfolder=新建子目录`、`root_folder=根目录`、`folder_list=接口列表` |
| 搜索（关键字/URL/Method） | `api_search_tip=关键字/URL`、`search_tip=名称/url/method` |
| 筛选（全部/接口/用例/状态/标签） | `filter=筛选`、`all_api=全部接口`、`apis_and_cases=接口和接口用例`、`filter_tip` |
| 排序、展开/折叠、拖拽 | `move=移动`、`move_success`、`folder_open=目录折叠打开`、`expand/collapse` |
| 多标签页、克隆当前标签、关闭系列 | `clone_cur_tab=克隆当前标签`、`cur_tab_close_confirm`、`scroll_tab` |
| 新建类型 | HTTP、WebSocket、Socket.IO、GraphQL、Event Stream、TCP、Markdown、导入项目 |
| 批量操作 | `batch_operation=批量操作`、`batch_delete`、`batch_edit`、`batch_complete`、`batch_unarchive` |
| 回收站 | `trash=回收站`、`clear=清空回收站` |
| 归档 | `archive=归档保存`、`archive_list=归档管理`、`unarchive=取消归档` |
| 接口状态管理 | `api_status=接口状态`、`api_status_manage`、`set_default_status1/2/3` |
| 标签管理 | `tags=标签`、`add_tags`、`del_tags`、`edit_tag`、`tag_ver=Tag版本` |
| 复制/粘贴/移动/另存 | `copy`、`paste_to_folder=粘贴至该目录`、`move`、`clone_save=克隆并保存副本` |
| 导入 | cURL、Postman V2.1 + 环境、Swagger/OpenAPI、YApi、apiDoc、Apipost、Apifox、数据库、从响应、图片拖拽/粘贴、智能导入 |
| 导出 | OpenAPI/Swagger、Apipost 项目、按目录导出 Tags |
| 分享 | 自定义分享、分享管理、HTML 下载、在线文档 + Mock |

### 2. 设计 / 文档 Tab

| 能力 | Apipost 证据 |
| --- | --- |
| 设计/文档视图 | `design_doc=设计/文档`、`default_tab_design=设计` |
| 请求契约：Header/Query/Path/Cookie/Body/认证 | `request_header`、`query_params`、`path_params`、`cookie`、`body_format`、`auth` |
| 响应契约：状态码、Content-Type、Schema、示例、字段说明 | `response_want_code`、`response_want_type`、`response_want_success` |
| 错误码 | 设计页错误码定义 |
| 接口说明/富文本 | `api_desc=说明` |
| 数据模型引用 | `batch_tip=同步更新补全所有【引用模型】的数据` |
| 设计/调试差异确认 | `debug_difference_tag=调试数据未加入设计`、`debug_difference_summary` |
| 批量补全参数值/描述 | `batch_parameter`、`batch_desc_title`、`complete_desc`、`complete_value` |
| AI 补全 | `ai_complete`、`complete_btn=AI一键补全`、`complete_doc` |

### 3. 调试 Tab

| 能力 | Apipost 证据 |
| --- | --- |
| 发送/保存、cURL 粘贴 | `curl_placeholder=请输入URL或粘贴cURL文本` |
| 请求设置：超时/重定向/代理/证书 | `timeout=请求超时`、`redirect=请求自动重定向`、`redirect_time`、`proxy`、`client_certificates`、`certificate_verification` |
| 认证类型 | Bearer、Basic、Digest、OAuth1/2、Hawk、AWS SigV4、NTLM、JWT、ASAP、EdgeGrid、API Key |
| 前置/后置脚本（可执行 JS，`pm.environment.set`） | `pre_script`、`post_script`、`pre_script_placeholder` |
| 可视化断言/脚本断言 | `assert_visual=可视化断言`、`assert_global=脚本断言`、`assert_tip` |
| 变量提取（JSONPath/正则/Header/Cookie → 环境/全局变量） | `tag_set=提取变量`、`tag=变量提取`、`cur_res_get_cookie` |
| 响应区：实时响应/响应头/Cookie/响应示例/字段说明/实际请求/控制台 | `response_tab=实时响应`、`cur_res_header`、`cur_res_cookie`、`response_example`、`cur_res_*` |
| 响应搜索、保存为响应示例、新建期望 | `search_response=搜索响应区内容`、`save_response`、`new_response=新建期望` |
| 响应耗时/大小/状态码 | `cur_res_time`、`total_response_data`、`cur_res_code` |
| 发送历史、历史对比 | `send_history=发送历史`、`history_comparison=历史对比` |

### 4. 接口用例 Tab

| 能力 | Apipost 证据 |
| --- | --- |
| 用例列表、用例分组 | `new_case=新建接口用例`、`new_testcase`、`del_case_group` |
| 用例覆盖（Method/URL/Header/Query/Body） | `case_override`、`api_case_overwrite_mode` |
| 断言 | `assertions`、`assertion_rate`、`assertion_pass/fail` |
| 测试数据 | `case_data_count=测试数据总数`、`case_data_tip` |
| 批量测试、测试报告 | `case_test=测试`、`case_report=用例测试报告`、`execute_case` |
| 用例导入/导出、AI 补全 | `import_case`、`ai_complete_title=AI智能生成测试用例` |

### 5. 一键压测 Tab

- 压测设置：并发、时长、轮次（`stress=压测`、`stress_btn=执行`、`压测时长`、`压测轮次`）
- 执行/终止：`stop_stress=终止压测`
- 报告：TPS、成功率/失败率、平均/最小/最大响应时间、响应时间趋势、失败请求统计
- 公共压测数据：`public_data=公共压测数据`

### 6. Mock Tab

- 本地/云端 Mock：`本地Mock`、`云端Mock`、`mock_service=Mock服务`
- Mock 环境、Mock 地址、启用开关：`mock_environment`、`mock_url`、`enable_mock`
- Mock 规则/期望：`mock_rule=Mock规则`、`mock_expect=Mock期望`、`new_response=新建期望`
- 内置 Mock 变量/字段变量：`mock_field=内置Mock字段变量`
- 跟随项目/目录设置：`mock_project=项目Mock设置`、`跟随父级目录设置(推荐)`

## KindraAPI 当前实现状态

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 目录/接口树 | ✅ | 新建目录/接口、拖拽移动、删除、分享、筛选（全部/仅接口/仅目录）、搜索、排序、展开/折叠 |
| 多标签页 | ✅ | 右键关闭系列、未保存提示、滚动、克隆 |
| 新建类型 | ⚠️ | 仅 HTTP 可用；Event Stream、WebSocket、Socket.IO、GraphQL、TCP、Markdown 为占位 |
| 导入 | ❌ | cURL 导入、粘贴接口/文本、其他文件导入均为占位；仅 MCP `sync_openapi` 可导入 OpenAPI |
| 导出 | ⚠️ | 文档分享支持 Markdown/OpenAPI/HTML/ZIP；无 APIS 页面导出入口 |
| 批量操作 | ❌ | 仅目录详情页支持勾选删除；无批量编辑/补全/更新/归档 |
| 回收站/归档 | ❌ | 左侧导航“回收站（后续支持）” |
| 接口状态 | ⚠️ | 数据模型有 `status`，UI 固定显示“开发中”，无状态管理 |
| 标签 | ⚠️ | 数据模型有 `tags`，无 UI |
| 复制/粘贴 | ⚠️ | 克隆可用；复制为占位 |
| 设计/文档 | ✅ | 请求契约 + 响应契约 + 错误码 + 模型引用 + 字段说明 |
| 调试请求 | ✅ | 方法/URL/协议、Header/Query/Path/Cookie/Body、模型引用、发送/保存 |
| 认证 | ⚠️ | UI 仅 inherit/noauth/bearer/basic/kv；执行器也只实现这 4 类 |
| 前置/后置脚本 | ❌ | 有编辑框并落盘，但执行器未执行 JS |
| 断言/变量提取 | ❌ | 仅接口用例内支持 status/duration/JSON 断言；调试页无断言、无变量提取 |
| 请求设置 | ❌ | 无超时、重定向、代理、客户端证书、SSL 校验 |
| 响应面板 | ✅ | 实时响应/响应头/Cookie/响应示例/字段说明/实际请求/控制台、复制、可视化/表格 |
| 响应搜索 | ❌ | 无 |
| 保存为响应示例 | ✅ | 支持 |
| 发送历史 | ✅ | HistoryPage 列表/详情/删除/清空；无历史对比 |
| 版本管理 | ✅ | 版本列表、恢复、Tag；无版本对比 |
| 接口用例 | ⚠️ | 扁平用例 + 覆盖 + 断言 + 全部运行；无分组、测试数据、报告、导入导出、AI |
| 一键压测 | ❌ | 占位 |
| Mock | ❌ | 占位 |
| 环境/全局变量/全局参数/Cookie | ✅ | EnvironmentModal 已支持 |
| 证书/代理设置 | ❌ | 无 UI |

## 建议实现顺序

### 阶段 1：APIS 页面壳与接口管理（低风险、高频）
1. cURL 解析导入 + 粘贴接口/文本
2. Postman Collection V2.1 / OpenAPI 3 / Swagger 2 导入（复用 `sync_openapi` 的解析能力）
3. 接口状态管理（默认状态 + 自定义状态）与标签
4. 复制/粘贴、移动到目录、批量操作（删除/编辑/更新状态）
5. 回收站（软删除 + 恢复 + 清空）与归档
6. 筛选增强（状态/标签/Method）、显示列
7. 目录设置（继承、目录级 Header/Query/脚本、Mock 跟随）

### 阶段 2：调试能力对齐
1. 请求设置：超时、自动重定向次数、代理、客户端证书、SSL 校验
2. 完整认证类型：Digest、OAuth1/2、AWS SigV4、NTLM、JWT、API Key（header/query）
3. 前置/后置脚本执行（受限 `pm` 沙箱，超时与日志）
4. 调试页断言与变量提取（JSONPath/正则/Header/Cookie → 环境/全局变量）
5. 响应区搜索、历史对比

### 阶段 3：用例与压测
1. 用例分组、测试数据、批量执行、测试报告
2. 一键压测：并发/时长/轮次、终止、TPS/响应时间趋势/失败率

### 阶段 4：Mock 与多协议
1. 本地 Mock 服务、Mock 环境、规则/期望、内置 Mock 变量
2. WebSocket / Socket.IO / GraphQL / Event Stream / TCP 客户端 / Markdown 文档

## 关键差距（Top 10）

1. 导入（cURL/Postman/OpenAPI/Swagger）
2. 接口状态与标签
3. 批量操作 + 回收站/归档
4. Mock 服务与规则
5. 一键压测
6. 请求设置（超时/重定向/代理/证书）
7. 完整鉴权类型
8. 前置/后置脚本执行
9. 调试页断言 + 变量提取
10. 接口用例分组/测试数据/报告

## 证据文件

- `.scratch/apipost-rea/work-strings.json`：work.asar 提取的 18,493 条中文文案（含频次与来源文件）
- `.scratch/apipost-rea/work.json.gz`：REA 全量分析的部分 Evidence（超时；解压 `gunzip -k work.json.gz`）
- `.scratch/apipost-rea/index.json`：REA 对主入口 bundle 的完整应用图（67 MB）
- `.scratch/apipost-rea/index.err`：REA 分析进度与退出状态
