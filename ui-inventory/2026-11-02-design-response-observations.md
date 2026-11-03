# Apipost 设计响应参数实测

临时项目「Kindra UI 对照 20261102」，示例接口“创建用户”，未发送请求。[新建期望截图](screenshots/webp/apipost-response-new-20261102.webp)。

## 期望和设置

新建期望浮层含必填名称（默认成功）、状态码（200）、内容格式（JSON）和确定；确定即新增并选中，初始 Body 是空 object。标签显示名称和状态码，右侧垃圾桶点击后确认删除；未发现默认或更多菜单。设置区横排名称、HTTP 状态码、内容格式、返回延迟（ms，默认 0）；名称修改立即更新标签并标记草稿未保存。状态码可清空，标签随之去掉括号。格式提供 JSON、XML、HTML、Binary；状态码下拉有常见 2xx–5xx 项且可输入。负数通过辅助功能设置后仍为 0；最大值、空值处理未可靠验证。只有一个期望时标签栏不显示垃圾桶，无法从该界面删除最后一个。

## Body

结构视图有 Raw编辑、预览、生成代码、智能导入；Raw 编辑的是 JSON Schema，空根示例为 `{"type":"object","properties":{}}`。预览显示数据结构的 Mock 值，例如空 object 为 `{}`。智能导入支持 JSON、XML、JSON Schema、从数据库导入，覆盖模式为智能合并或完全覆盖，并有命名风格、预览、确定/取消。根和字段提供加子节点、类型、规则、必需、可空、Mock、描述等控件。

示例视图有字段描述、美化、更多、从设计请求参数生成及参数助手；更多含查找替换、简化。生成按钮提示“根据设计页的请求参数生成默认值”；空结构点击后仍为空，具体生成行为未充分验证。

## Header

参数名、参数值、描述三列，带全选、空尾行、行勾选、类型与必填；悬浮表头显示批量补全和更多。更多为展示列开关：参数类型/必填、参数描述。

## 补充核查与截图

Binary 格式下数据结构按钮禁用，Body 显示示例文本编辑器及字段描述、美化、更多和参数助手。生成代码打开“生成模型代码”弹窗，语言含 TypeScript、TypeScript Effect Schema、TypeScript Zod 等；可设置数据模型名，预览区提供下载和复制，底部有取消/复制。

参考截图：[设置](screenshots/webp/apipost-response-settings-20261102.webp)、[Header](screenshots/webp/apipost-response-header-20261102.webp)、[数据结构](screenshots/webp/apipost-response-structure-20261102.webp)、[Binary 示例](screenshots/webp/apipost-response-example-20261102.webp)、[Raw 编辑](screenshots/webp/apipost-response-raw-20261102.webp)、[智能导入](screenshots/webp/apipost-response-import-20261102.webp)。

## 行操作及示例补充

整数和字符串行绿色加号均在本行后插入相邻节点；点击名称直接进入编辑。悬浮行左侧出现拖拽柄，右侧出现删除，未观察到复制按钮。“字段描述”打开“提取字段描述”弹窗，按扁平路径列出字段、类型、必填、值和描述，可编辑，提供批量补全、展示列、重新提取和关闭。参数助手展开后有字典库、动态值和搜索，外观与请求助手相同；插入行为未逐项验证。

## Kindra 实现与验证

实现截图：[Header](screenshots/webp/kindra-response-header-20261102.webp)、[设置](screenshots/webp/kindra-response-settings-20261102.webp)、[Body](screenshots/webp/kindra-response-body-20261102.webp)、[XML](screenshots/webp/kindra-response-body-xml-20261102.webp)、[预览](screenshots/webp/kindra-response-preview-20261102.webp)、[导入](screenshots/webp/kindra-response-import-20261102.webp)、[代码](screenshots/webp/kindra-response-code-20261102.webp)。

Header 和期望设置专项、Body 工具专项、API 专项、15 项 UI 回归、请求专项、typecheck 和 documentation 均通过。智能导入目前支持 JSON 和 JSON Schema，代码生成支持 TypeScript；Mock 表达式、高级规则、命名风格转换和参数助手等尚未实现。字段描述弹窗中的批量补全和列开关也尚未支持，与 Header 的批量编辑和列设置不同。返回延迟仅保存设计配置，不表示 Mock 运行时已支持。以上实现不代表所有参考应用行为均已验证一致。

最新响应专项完整通过，覆盖根规则、Raw 与嵌套数组、数组对象删字段、预览不修改草稿、导入、TypeScript 生成、重命名、相邻新增、拖拽落盘与导出、直接删除、字段描述重新提取、模型元数据保留及锁定解除、XML、默认期望和末项保护。typecheck、build、documentation、请求专项和 15 项 UI 回归也通过。[字段描述实现截图](screenshots/webp/kindra-response-field-descriptions-20261102.webp)。
