# Apipost 字典模块实测（2026-11-03）

在本机 Apipost 单机版的临时项目“Kindra UI 对照 20261102”实际点击；未发送网络请求。以下为观察事实，不代表 Kindra 已实现一致。

## 导航和列表

左侧“字典”包含数据字典、数据库管理、数据模型；数据字典分自定义和系统内置两个标签。自定义表列依次为选择、参数名称、备注名、字段类型、默认值、示例值、Mock规则、参数描述、状态、操作；表格横向滚动，操作列固定右侧。工具栏有按参数名或描述搜索、保存临时数据、导入、新建；默认每页 10 条。永久行有编辑、删除；临时行还多单条保存图标。点击删除出现“确定删除该条描述吗？”及取消、确定，已取消，未确认删除。

系统内置表为参数名称（名称下显示类型）和参数描述两列，顶部有搜索及“开启系统内置描述”开关，初始开启。共 19 条，默认每页 10 条；点击下一页显示剩余 9 条。搜索“电话”即时返回 telephone 和 tel 共两条。

## 新建与编辑

新建/编辑均为弹窗。字段为参数名称、备注名、类型（默认 string）、是否为空、枚举、常量、Mock、示例值、默认值、Format、最小长度、最大长度、Pattern、字段描述。三个开关默认关闭，最小/最大长度显示 0。空提交在参数名下显示“请输入参数名”。填写名称、备注和描述后确定，行立即出现且状态为永久；编辑图标打开同款弹窗并回填内容。同名再次新建也成功，未出现重复校验。参见[编辑弹窗](screenshots/webp/apipost-dictionary-edit-20261103.webp)。类型选项及字段输入见后续实测；原型编辑提交仍未核查。

## 导入

导入弹窗包含 Key-Value 格式、Raw-Json 格式、从数据库导入、已有 API 获取四页。Key-Value 提示 `参数名：参数说明`；Raw-Json 初始 `{}`，可格式化，提示 `{"参数名":"参数说明"}`；均提供命名方式（默认保持原样）与预览。输入 `kindra_import_20261103:界面对照` 后出现新增字段 1/1、重复字段 0/0 和默认选中的预览行。点导入后弹窗关闭、提示“导入成功”，新行状态为永久。导入后先前五条临时行不再显示，原因尚未确认。

数据库导入支持选择连接及表，或输入建表 SQL（提示暂仅支持 MySQL）；已有 API 获取显示接口树、搜索、一键获取字段和预览。重复字段处理及命名方式见后续实测；其他导入方式的提交行为尚未实测。

## 编辑器类型及规则补充实测

类型下拉包含 string、number、integer、boolean、object、array、null、any、allOf、anyOf、oneOf。string 的枚举启用后显示多标签输入，输入后回车添加；启用常量会关闭枚举并显示单行常量输入。string 示例值也可输入多个标签，实测 alpha、beta 各按回车后同时显示。string Format 实见 date、date-time、time、duration、idn-email、email、hostname、idn-hostname、ipv4、ipv6、uri、uri-reference、iri、iri-reference、uuid、json-pointer、regex、password、binary、byte、char。

切换 number 后常量与默认值显示数字步进器；规则为最小值、最大值、倍数、保留小数位数，显示初始 0。默认值尝试输入 abc 后仍为 0；示例值尝试输入 abc 后没有产生标签，显示暂无数据。number 的 Format 有 float、double、float32、float64。[number 编辑器截图](screenshots/webp/apipost-dictionary-number-20261103.webp)。

boolean 只显示名称、备注、类型、是否为空、默认值、Mock、字段描述；默认值下拉有 true/false。null 只显示名称、备注、类型、是否为空及字段描述，是否为空强制打开且禁用。array 额外显示元素唯一开关和最小/最大元素个数，未见元素类型选择。其他类型的抽查结果见下文。

## 临时条目

在本机专用临时接口的调试 Query 尾行输入参数名 `kindra_temp_20261103` 和描述“临时字典对照”，Tab 失焦后未保存接口，切到数据字典即出现同名 string 条目，状态为临时。点击该行保存图标直接变为永久，保存图标消失，保留编辑/删除。顶部“保存临时数据”悬浮提示为“将所有临时数据保存为永久数据”；多条批量操作见下方实测。

再次导入含已有参数名和新参数名各一条时，预览默认新增 1/1 勾选、重复 0/1 不勾选。切到重复字段手动勾选后导入，原来的同名项保留，另外追加一条具有新描述的永久同名项，同时新增已勾选的新字段；未覆盖原项。

批量保存实测：临时 a/b 两项中只勾选 b，点击顶部“保存临时数据”，两项均直接变永久、单条保存图标消失，无确认；作用范围为全部临时项。勾选表格行后工具栏出现“批量删除”，表头为半选，取消勾选后按钮消失。

Raw-Json 输入对象后点格式化可缩进；`{"fieldName":"说明","count":42,"nested":{"x":"描述"}}` 预览三个顶层 string 字段，嵌套对象显示为 JSON 文本描述，不展开。无效 `{"bad":` 点格式化未见错误提示，预览反而出现 `{` 和 `"bad"` 项。

MySQL DDL 样例 `CREATE TABLE kindra_fixture (user_id BIGINT NOT NULL COMMENT '用户编号', display_name VARCHAR(100) DEFAULT 'guest' COMMENT '显示名称', active TINYINT DEFAULT 1 COMMENT '启用');` 即时预览三条 string，提取注释和 guest 默认值，数字默认值 1 未显示；未连接数据库或提交。已有 API 获取输入“获取用户”按回车筛至一个接口，勾选后点一键获取出现 11 条默认勾选预览，包括 error integer、user object 及其嵌套 id integer、username 等，嵌套字段摊平并保留类型。字段来源的完整范围未确认；命名方式选项与转换见下方实测。

命名方式下拉通过实际点击和键盘展开，选项为保持原样、小驼峰、大驼峰、下划线。`user_name:用户名` 选择小驼峰后右侧预览即时变为 `userName`，左侧源文本保留 `user_name`。批量删除确认文案“是否确定删除？”，取消后数据与选中状态保留。

## 数据库管理初步观察

数据库管理空表列为名称、数据库类型、说明、操作，新建打开数据库连接弹窗。名称和数据库类型必填，默认 MySQL；连接配置按默认配置/默认环境分组，常规页含 IP/Host、端口、用户名、密码和数据库名，底部测试连接、取消、确定。切换 PostgreSQL 后端口由 3306 变 5432。SSH 页的“使用SSH隧道”默认关闭，Host、端口 22、用户名及验证方法禁用。没有连接数据库。

其他类型抽查：integer 有枚举、常量、Mock、示例、数字默认值、Format、最小值、最大值、倍数，无保留小数位数；object 仅名称、备注、类型、是否为空、字段描述；any 同样的字段但是否为空强制开启且禁用。allOf、anyOf、oneOf 逐个选择后也只显示名称、备注、类型、是否为空、字段描述，是否为空均禁用且关闭，未见组合子项编辑。

SSH 开启后 Host、端口 22、用户名、验证方法可编辑，验证方法为密码、公钥、密码与公钥；选公钥后显示“私钥”文件选择器。切换侧栏默认环境时，默认选“使用默认配置”，选“单独配置”后显示独立常规/SSH，SSH 初始关闭；未保存或连接。

## 数据模型初步实点

左侧新建菜单含新建数据模型、模型目录、数据字段和数据库连接。新建模型打开独立标签并显示未保存红点；模型名、描述直接输入，名称同步标签。根节点默认 object，根加号插入空子行，字段名点击进入输入并回车后形成 string 字段。保存右侧下拉是目录选择，本项目显示根目录。工具栏 Raw 编辑呈 JSON Schema（含 properties 和 x-schema-orders），预览弹层显示结构及 Mock 值；智能导入有 JSON、XML、JSON Schema、从数据库导入，JSON 页默认智能合并、命名保持原样。生成代码打开“生成模型代码”弹窗，初始 C (cJSON)，含语言相关配置、预览、取消和复制。模型草稿为临时本地数据，未保存。

## Kindra 隔离窗口鼠标验收

使用独立测试 profile 的“Kindra 字典验收 1103”窗口，实际点击输入：新建、枚举/常量互斥、string 和 integer 类型、各字符串规则、示例、默认值及描述；保存后编辑回填一致。同名创建、导入新增与勾选重复后追加、单条与批量删除确认均通过。临时接口 Query 描述失焦生成临时项，顶部保存后变永久。Key-Value、JSON 格式化及 DDL 预览可用；勾选本地测试接口后一键获取显示新增 Content-Type 和重复 qa_temp。未发送网络请求。[新建弹窗截图](screenshots/webp/kindra-dictionary-create-qa-20261103.webp)。

Kindra 有意保留 MySQL 类型映射，DDL 中 BIGINT 预览为 integer，而原型显示 string；无效 JSON 不照搬原型错误解析。模型 Raw 保存、预览和目录已实现；模型生成代码和智能导入仍为旧占位。数据库目前为 MySQL 直连，SSH 执行和环境覆盖未支持，不能称整个字典模块完全一致。

主 Agent 报告最新 typecheck、build、数据字典 UI 11 组、参数名描述轮询与同名选择、模型 Raw 保存预览目录以及既有 15 组 UI 回归均通过。上述自动测试结果由主 Agent 提供。

## 本轮审查修复与验证

本轮修复了根节点规则往返丢失、仅编辑字典描述时对象或数组默认值及示例丢失、批量格式切换时同名参数规则及启用状态丢失、MCP 删除接口时未提交 URL 草稿丢失，以及数据库表导入测试使用模拟读取的问题。`npm run test:review-regressions` 覆盖前四条数据保留路径，修复前对应测试失败，修复后全部通过。

数据库表读取 mock 已替换为真实隔离 MySQL：`npm run test:dictionary-ui` 默认初始化私有临时实例，验证鉴权拒绝、真实表读取和导入，并在结束后清理。运行环境需在 PATH 提供 `mysqld`，或通过 `KINDRAAPI_TEST_MYSQLD` 指定其路径。也可使用 `KINDRAAPI_SMOKE_MYSQL_HOST`、`KINDRAAPI_SMOKE_MYSQL_PORT`、`KINDRAAPI_SMOKE_MYSQL_USER`、`KINDRAAPI_SMOKE_MYSQL_PASSWORD` 指向显式测试服务；每次创建随机唯一测试库并清理该库。

主 Agent 报告本轮 typecheck、build、`test:review-regressions`、`test:dictionary-ui` 和 `test:documentation` 均通过。这些验证覆盖所列路径，不代表所有 Apipost 行为完全一致。
