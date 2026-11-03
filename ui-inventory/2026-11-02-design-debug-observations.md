# Apipost 设计与调试实测（2026-11-02）

使用 `/Applications/Apipost单机版.app`，创建临时项目「Kindra UI 对照 20261102」，查看项目自动生成的“获取用户信息”示例；未发送请求。截图：[设计页](screenshots/webp/apipost-reference-design-20261102.webp)。

## 设计

顶部依次为模式切换（设计、调试、接口用例、一键压测、Mock）、状态及接口名称；下一行是方法、URL、HTTP 版本、预览和保存。其后目录和标签并排，接详细说明、设计请求参数及设计响应参数。请求参数标签为 Header、Query、Path、Body、认证；Body 支持 none、form-data、urlencoded、binary、msgpack、raw。Header 表有参数名、参数值、描述及类型选择、勾选和公共参数入口。

响应期望顶层有“成功（200）”标签和“新建期望”，内部有 Body、Header、期望设置。Body 有数据结构/示例切换和可拖拽树；期望设置包含必填名称、HTTP 状态码、内容格式和返回延迟（ms）。

## 调试

URL 行包含方法、URL、HTTP 版本、发送和保存，后两者各有下拉。发送下拉为“发送并保存响应”；保存下拉打开目录选择（搜索、根目录、示例接口）。请求区标签为 Header、Query、Path、Body、认证、Cookie、预执行操作、后执行操作。响应区标签为实时响应、响应头、Cookie、响应示例、实际请求、控制台；实时响应提供美化、原生、预览、可视化、格式与编码选择及保存为响应示例。

## 与已有清单的关系

`components/DesignEditor.md` 是源码静态扫描，只记录错误码输入与添加按钮，不能完整代表本次原生应用设计页的 URL 行、请求参数及响应期望交互；本记录补充实测。已有 `screenshots/webp/apis-mode-design.webp` 与调试截图可供视觉对照，不能替代本次菜单点击证据。

补充核对：设计页保存是独立按钮，没有右侧下拉，目录为下方单独字段。调试页保存右侧下拉为目录选择；发送下拉文字确为“发送并保存响应”，截图 [发送菜单](screenshots/webp/apipost-reference-send-menu-20261102.webp)。raw 格式列表为 JSON、XML、JavaScript、Text、HTML，旁有“从设计请求参数生成”和参数助手。响应期望标签右键只显示系统 Select All/Copy，未见设默认或删除菜单。

## 本轮实现

设计页调整了 URL 行和基本信息布局，提供 Header、Query、Path、Body、认证五个请求标签，以及目录和标签字段。响应期望提供 Body、Header 和期望设置。raw 格式提供 JSON、XML、JavaScript、Text、HTML；调试页支持发送并保存响应、保存到目录。窄分屏增加滚动支持。

设计页预览和响应期望返回延迟尚未实现，仍与 Apipost 有差异。期望删除和设默认是 Kindra 补全的行为，不能视为本轮已实测的 Apipost 菜单。

## 验证

`npm run test:ui` 的 15 项 UI 回归全部通过。

`npm run typecheck`、`npm run build` 和 `node scripts/api-editor-smoke.cjs` 均通过。聚焦测试覆盖设计 URL 吸顶及五个请求标签、响应 Header 编辑、拒绝状态码 999、期望新增/设默认/删除、保存到目录、调试页回车发送、发送并保存响应及失败时不保存空示例、raw XML 落盘，以及左右分屏时标签和操作按钮可达。

Kindra 本轮实现截图：[设计页](screenshots/webp/kindra-design-20261102.webp)、[调试分屏](screenshots/webp/kindra-debug-split-20261102.webp)。上文的 Apipost 截图是参考界面。

## 设计请求参数逐项复查

在临时项目的示例草稿中点击检查，未发送请求。[Header 参考](screenshots/webp/apipost-header-detail-20261102.webp)、[Body 参考](screenshots/webp/apipost-body-detail-20261102.webp)。

- Header 公共参数眼睛按钮控制四行显示；Accept、Accept-Encoding、User-Agent、Connection 的名称和值只读，每行有勾选及全局标记。下方独立三列表，空尾行的类型和必需星号在参数名右侧。点击类型可选 string、number、integer、boolean、object、array、null、any、allOf、anyOf。
- Query 无多余分组标题；点击表头等号切换空值时是否添加等号。填写空尾行名称后自动增加下一空行，URL 同步追加查询参数；表头悬浮显示批量补全、更多和智能转换。
- Path 从 URL 的 `{username}` 生成不可编辑名称、可编辑值和描述的一行；删除 URL 变量后该行仍保留，不能假设立即删除。
- Body raw JSON 默认数据结构树，根节点加号新增子级，行有类型、规则、必需、可空、Mock 和描述。规则弹层可编辑约束；示例切换到生成的 JSON 编辑器。根 object 切为 array 时原字段被替换为 items string，再切回 object 原字段未恢复；根必需禁用且开启，可空可切换。根规则可打开。
- 认证采用横向标签及宽控件。已点击私密键值对、Basic、Bearer、JWT、Digest 和 OAuth 1.0：依次显示 Key/Value/添加位置；Username/Password；Token；添加位置/Algorithm/Secret/Base64/Payload；重试选项及 Username/Password（更多含 Realm、Nonce、Algorithm、qop、Nonce Count、Client Nonce、Opaque）；以及签名方法、密钥和 Token（更多含 Callback、Verifier、Timestamp、Nonce、Version、Realm 等）。OAuth 2.0、Hawk 的具体字段本轮未实测。高级认证后端能力不应由界面外观推断为已实现。

## Body 模式和表头操作补充实测

- none 显示“当前请求未包含 Body”；form-data 表头为参数名、参数值、内容类型、描述，空尾行默认 string 和自动 content-type，类型可选 file，选中后参数值变为“请上传文件”按钮。
- urlencoded 是参数名、参数值、描述三列表；binary 提供“上传文件”按钮。msgpack 可选择，展示数据结构/示例及 object 根节点；未发送请求，不能据此断言编码传输功能。
- Query 表头更多菜单“展示列”提供参数类型/必填、参数描述两个开关。批量补全打开“批量编辑”，可在 Key-Value、Raw-Json、带描述间切换，支持命名方式、预览、复制和确定；带描述是 JSON 对象数组，实见字段 description、field_type、is_checked、key、value、not_null、schema.type。
- 智能转换打开“参数转CodeStruct”，可选择语言及命名等配置并预览代码，另有下载和复制；见[参考截图](screenshots/webp/apipost-smart-convert-20261102.webp)。这是独立代码生成能力，与表格展示列和批量编辑不同，不能因按钮存在而声称已实现。

## 第二轮实现对照

Kindra 截图：[Header](screenshots/webp/kindra-request-header-20261102.webp)、[Query](screenshots/webp/kindra-request-query-20261102.webp)、[Path](screenshots/webp/kindra-request-path-20261102.webp)、[Body](screenshots/webp/kindra-request-body-20261102.webp)、[认证](screenshots/webp/kindra-request-auth-20261102.webp)、[form-data](screenshots/webp/kindra-request-formdata-20261102.webp)、[binary](screenshots/webp/kindra-request-binary-20261102.webp)。

| 部分 | Apipost 实测与 Kindra 落实 | 仍缺或有意差异 |
| --- | --- | --- |
| Header | 公共参数独立区、眼睛切换；系统 Header 取消勾选可实际禁用。 | 具体继承来源与边界仍需结合项目配置验证。 |
| 参数表 | 三列、空白尾行、类型和必填、复制删除、展示列开关及 Key-Value/Raw-Json/带描述批量编辑。 | CodeStruct 智能转换尚未实现；类型不支持 allOf/anyOf。 |
| Query | 参数和 URL 同步，空值等号可切换。 | 批量转换的完整原版功能不等同于已实现。 |
| Path | 从 URL 提取变量并保留旧行，符合移除变量后行仍存在的观察。 | 更复杂路径转换行为未穷尽。 |
| Body | 根节点、添加字段、规则、可空、结构/示例切换和模型引用；form-data 支持 MIME 和文件，binary 支持上传及移除。 | 新增字段复用弹窗；根类型切换有确认，原版直接清空。Mock 表达式和高级规则、msgpack 编码尚未实现。 |
| 认证 | 横排支持继承父级、无需认证、私密键值对、Basic 和 Bearer。 | JWT、Digest、OAuth、Hawk 尚未实现。 |

根节点规则弹窗的必填状态固定不可修改，与表格一致。最新 `typecheck`、`build`、`design-request-smoke` 和 `api-editor-smoke` 均通过。专项测试已完整通过：继承 Header 的显示和禁用；Query 尾行、类型、必填、空值等号及 URL 同步；Path 提取；实际请求；认证数据保留；JSON 根节点、字段规则及视图；批量编辑和展示列；multipart MIME/文件及 binary 上传和移除。`typecheck`、`build`、文档 smoke 及 15 阶段完整 UI 回归均通过。以上记录不代表全面 1:1 对齐。
