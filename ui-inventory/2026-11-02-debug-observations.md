# Apipost 调试页实测

在临时项目“Kindra UI 对照 20261102”中观察；本机专用草稿“本机调试对照64954”请求 `127.0.0.1:64954/delay`，得到 200、8.014s、509B。[初始](screenshots/webp/apipost-debug-start-20261102.webp)、[Query](screenshots/webp/apipost-debug-query-20261102.webp)、[Header](screenshots/webp/apipost-debug-header-20261102.webp)、[左右分屏](screenshots/webp/apipost-debug-response-split-20261102.webp)。

URL 行为方法、URL、HTTP 版本、发送及保存；发送下拉为发送并保存响应，保存下拉选择目录。发送时按钮禁用并有独立“取消发送”；点击取消未成功验证。请求标签 Header、Query、Path、Body、认证、Cookie、预执行操作、后执行操作。Header/Query/Cookie 表有参数名、参数值、描述、勾选、类型、必填及空尾行；Header 有公共参数显示切换，Query 表头有空值等号；空 Path 只有三列表头。认证是横向类型标签及宽选择框。Body 支持 none、form-data、urlencoded、binary、msgpack、raw；raw JSON 有从设计请求参数生成、可视化编辑、字段描述、美化、更多和参数助手。左右窄屏时 Body 类型收为下拉、标签有溢出菜单。

前执行添加项有自定义脚本、数据库、等待；后执行另有断言、提取变量。脚本可启用，常用脚本助手插入如 `apt.environment.set("key", "value");`、`apt.setRequestHeader("key", "value");`、`apt.test("响应码为 200", function () { apt.response.to.have.status(200); });` 和 `apt.response.json()` / `apt.expect(...).to.eql(...)`。数据库、多操作项等是原型能力，不能推断 Kindra 已支持。

响应包含实时响应、响应头、Cookie、响应示例、实际请求、控制台。状态栏显示状态、耗时、大小及下载；下载打开系统保存对话框。实时响应提供美化、原生、预览、可视化，格式 JSON/XML/HTML/Text/Auto，编码下拉、复制、换行展示、保存为响应示例和断言与校验侧栏。响应头两列；Cookie 列为 Name、Value、Domain、Path、Expires、HttpOnly、Secure；实际请求显示 URL 与 Header/Query/Path/Body 子页。控制台空态说明用于脚本输出和错误。右下布局按钮可切换上下/左右分屏。

## 本轮实现与验证对照

| 部分 | 已实现和已验证 | 与原型的差距 |
| --- | --- | --- |
| 请求和脚本 | Header、Path、重复 Query 及未勾选 Query；单个自定义脚本的启停、删除和助手；常用 `apt` 桥接及变量持久化。 | 原型数据库、等待和多个操作项编排尚未支持。 |
| 请求执行 | 脚本、控制台、断言；预执行异常阻止网络；可禁用系统 Content-Type；可取消网络请求和脚本。 | 原型取消按钮虽已观察到，实际取消效果未由本次原型点击确认。 |
| 响应 | 搜索、复制、下载、换行、格式、编码、Cookie 和实际请求；Body 可视化及窄分屏。格式支持 Auto、JSON、XML、HTML、Text；编码支持 UTF-8、GB2312、GBK、GB18030、ISO-8859-1，并保留原始字节。 | 编码选项不是原型完整集合。 |

`npm run test:debug-runtime` 已通过，覆盖脚本、日志和断言、预执行错误、系统 Header、Path/Query、真实取消、脚本桥接、变量持久化、脚本启停及编码/原始字节。`npm run test:debug-ui` 第一版全部通过，覆盖表格、脚本助手、日志断言、响应工具、Cookie/实际请求、取消请求与网络失败状态、Body 可视化和窄分屏；布局调整后的第二、第三遍均已通过。

Apipost MCP 当前只读，写入被服务拒绝；本记录的原型 UI 事实来自实际点击。


最新实现截图：[响应](screenshots/webp/kindra-debug-current-response-20261102.webp)、[左右分屏](screenshots/webp/kindra-debug-current-split-20261102.webp)。左右分屏中 URL 栏横跨两侧，状态进入响应标签栏，断言位于底部。

已通过 typecheck、build、`test:debug-runtime`、`test:debug-ui`、`test:documentation`、`api-editor-smoke`、`design-request-smoke`、`design-response-smoke` 和 `test:ui` 全 15 项。补充的同名未勾选 Query 仅聚焦失焦及编辑 URL 后失焦回归均已通过；最新 typecheck 和 `git diff --check` 也通过。验证使用隔离 profile；原用户窗口保留，未重启。

## Binary、响应头、方法与状态补充

Binary 空态为全宽细边框区域，上传图标和文字居中；选择文件后保留上传区，下方显示回形针、文件名和删除按钮，删除立即移除文件行。[选中文件](screenshots/webp/apipost-binary-selected-20261102.webp)。响应头两列表头浅灰底，名称约 25%、值约 75%，无纵向分隔线。

GET 青绿、POST 黄橙、PUT 蓝、DELETE 红、PATCH 青绿；方法下拉项中性色，URL 行显示完整方法，紧凑标签 DELETE 缩写 DEL、PATCH 缩写 PAT。[PATCH](screenshots/webp/apipost-patch-status-20261102.webp)。

标题前状态菜单依次开发中蓝、已完成绿、需修改黄、已废弃红，底部接口状态管理。管理弹窗可新建名称，非默认行悬浮出现默认操作；说明默认状态用于新接口且不能删除，删除其他状态后使用该状态的接口转为默认状态。双击已有名称只选中文本，点击色点未见变化；未发现已有状态改名/改色入口。选择状态立即更新界面，是否持久化未验证。[状态管理](screenshots/webp/apipost-status-management-20261102.webp)。

## 四项补充实现

Binary 使用 66px 全宽上传区，支持单文件选择和文件行删除。响应头固定 25/75 列宽，表头为参数名/参数值，显示计数并在切换时复位。五种常用方法共用颜色，紧凑位置使用 DEL/PAT。接口状态选择作为草稿随接口保存持久化；管理设置立即保存，支持新建、设置默认、删除迁移，并保留未保存请求字段。

本轮 typecheck、build、design-request、debug-ui 和 design-response 已通过。上述对照不表示与原型完全一致；`npm run test:debug-parity` 全部通过，`git diff --check` 通过；样式断言覆盖普通单选、圆点位置及状态菜单选中色。

最终实现截图：[Binary 与响应头](screenshots/webp/kindra-debug-parity-binary-headers-20261102.webp)、[状态菜单](screenshots/webp/kindra-debug-parity-status-menu-20261102.webp)、[状态管理](screenshots/webp/kindra-debug-parity-status-manager-20261102.webp)。视觉核对显示普通单选圆点居中、状态选中色浅、管理弹窗白底。

## 参数输入和字典鼠标复查

在“本机调试对照64954”未保存草稿中实测，未发送请求。Query 空描述单击只聚焦，输入 `tel` 和“电话”均无自动建议；参数名点击则显示字典建议，输入 `e` 过滤列表，在列表内滚轮可看到不同后续项。[参数名建议](screenshots/webp/apipost-name-suggestions-20261102.webp)。选择 page 会将名称、类型和描述改为 page、number、分页页码说明，并清空已有参数值；选择 email 填 string 和电子邮箱说明。已有描述被字典项覆盖。

参数值是普通输入，右侧图标打开引用变量、Mock 数据、固定值、自定义函数菜单。描述右侧图标打开字典库入口，再展开浮动描述列表，可选择后替换或插入；实测替换只改变描述，保留名称和类型。[描述字典面板](screenshots/webp/apipost-desc-dictionary-20261102.webp)。表头全选点击会同步取消已有行勾选。参数名建议列表白底两列，无内置/自定义标签，底部有字典库入口。其他行按钮尚未在此轮逐项完成，不能据此声称全部一致。

补充实点：描述“左右”将光标移至中间，字典选电话号码后点击插入得到“左右电话号码”，即追加末尾；替换仅改变描述并关闭面板。字典库管理打开同页模态，含自定义/系统内置、搜索、保存临时数据、导入、新建和参数表；本轮产生的临时字典记录未点击保存。类型 number→integer 实时改变行；必填星号可切换。展示列关闭类型/必填或描述分别隐藏对应内容，恢复后显示。其余行按钮本轮尚未全部实点。

Kindra 参数输入专项通过，覆盖设计/调试 Header、Query、表单 Body、调试 Cookie/Path 的逐格输入及类型、必填、规则、复制、删除，字典滚动和元数据选择、描述字典替换/追加/关闭/返回/管理与保存重开；完整 UI 15 阶段、debug-ui、typecheck 和 build 通过。[空描述点击](screenshots/webp/kindra-description-empty-click-20261102.webp)、[字典滚动](screenshots/webp/kindra-description-scrolled-20261102.webp)、[描述字典](screenshots/webp/kindra-description-description-library-20261102.webp)。这些是 Kindra 测试覆盖，不代表所有原型操作已逐项确认一致。

补充验证：`design-request`、`design-response` 和 `debug-parity` 最新回归均通过。
