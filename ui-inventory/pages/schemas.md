# 字典 / 数据模型 / 数据库

- 路由：`/schemas`
- 用途：数据字典、数据模型编辑器、MySQL 连接与表结构导入。
- 采集状态：16 个；DOM/AX 元素合计：744
- 主要源码：`src/renderer/src/pages/SchemasPage.tsx`、`src/renderer/src/components/schemas/DatabasePanel.tsx`、`src/renderer/src/components/schemas/DictionaryPanel.tsx`、`src/renderer/src/components/schemas/DictionarySuggest.tsx`、`src/renderer/src/components/schemas/ModelEditor.tsx`、`src/renderer/src/components/schemas/ModelPickerModal.tsx`、`src/renderer/src/components/schemas/ModelsListPanel.tsx`、`src/renderer/src/components/schemas/SchemaFieldEditor.tsx`、`src/renderer/src/components/schemas/modelDocumentation.ts`

## 状态截图

| 状态 | 类型 | 视口 | 元素数 | 截图 |
| --- | --- | --- | --- | --- |
| `schemas-landing-1180x760` | page | 1180×760 | 19 | [WebP](../screenshots/webp/schemas-landing-1180x760.webp) |
| `schemas-landing-1440x900` | page | 1440×900 | 19 | [WebP](../screenshots/webp/schemas-landing-1440x900.webp) |
| `schemas-dictionary` | page | 1180×760 | 30 | [WebP](../screenshots/webp/schemas-dictionary.webp) |
| `schemas-dictionary-new-field` | dialog | 1180×760 | 30 | [WebP](../screenshots/webp/schemas-dictionary-new-field.webp) |
| `schemas-database-empty` | page | 1180×760 | 30 | [WebP](../screenshots/webp/schemas-database-empty.webp) |
| `schemas-dialog-db-connection` | dialog | 1180×760 | 45 | [WebP](../screenshots/webp/schemas-dialog-db-connection.webp) |
| `schemas-dialog-db-connection-filled` | dialog | 1180×760 | 45 | [WebP](../screenshots/webp/schemas-dialog-db-connection-filled.webp) |
| `schemas-database-list` | page | 1180×760 | 37 | [WebP](../screenshots/webp/schemas-database-list.webp) |
| `schemas-dialog-import-tables` | dialog | 1180×760 | 106 | [WebP](../screenshots/webp/schemas-dialog-import-tables.webp) |
| `schemas-model-editor` | page | 1180×760 | 53 | [WebP](../screenshots/webp/schemas-model-editor.webp) |
| `schemas-model-add-field` | page | 1180×760 | 75 | [WebP](../screenshots/webp/schemas-model-add-field.webp) |
| `schemas-model-visual` | page | 1180×760 | 53 | [WebP](../screenshots/webp/schemas-model-visual.webp) |
| `schemas-model-raw` | page | 1180×760 | 52 | [WebP](../screenshots/webp/schemas-model-raw.webp) |
| `schemas-model-preview` | page | 1180×760 | 50 | [WebP](../screenshots/webp/schemas-model-preview.webp) |
| `schemas-model-codegen` | page | 1180×760 | 50 | [WebP](../screenshots/webp/schemas-model-codegen.webp) |
| `schemas-model-smart-import` | page | 1180×760 | 50 | [WebP](../screenshots/webp/schemas-model-smart-import.webp) |

### schemas-landing-1180x760

![schemas-landing-1180x760](../screenshots/webp/schemas-landing-1180x760.webp)

### schemas-landing-1440x900

![schemas-landing-1440x900](../screenshots/webp/schemas-landing-1440x900.webp)

## 布局区域（1180×760 基准）

| 区域 | x | y | width | height |
| --- | --- | --- | --- | --- |
| `topbar` | 0 | 0 | 1180 | 44 |
| `rail` | 0 | 44 | 50 | 716 |
| `main` | 50 | 44 | 1130 | 716 |

## 控件全量清单

| 区块 | 控件文案 / aria / icon | 类型 | 状态 | 位置 | 来源状态 |
| --- | --- | --- | --- | --- | --- |
| 页面 | 模型名/目录 | `input` | — | 82,56 · 155×19 | `schemas-landing-1180x760` |
| 页面 | anticon-plus<br>`anticon-plus` | `button` | — | 265,54 · 24×24 | `schemas-landing-1180x760` |
| 页面 | anticon-reload<br>`anticon-reload` | `button` | — | 263,156 · 24×24 | `schemas-landing-1180x760` |
| 页面 | 新建<br>`anticon-plus` | `button` | — | 60,720 · 227×30 | `schemas-landing-1180x760` |
| 页面 | 数据字典管理 维护自定义与系统内置字段描述，支持参数联想。<br>`anticon-file-text` | `button` | — | 376,389 · 230×148 | `schemas-landing-1180x760` |
| 页面 | 新建数据模型 用可视化字段树或 Raw JSON Schema 定义数据结构。<br>`anticon-table` | `button` | — | 624,389 · 230×148 | `schemas-landing-1180x760` |
| 页面 | 数据库管理 配置 MySQL 连接，读取表结构并导入为数据模型。<br>`anticon-database` | `button` | — | 872,389 · 230×148 | `schemas-landing-1180x760` |
| 页面 | 数据字典<br>`anticon-file-text` | `div/button` | active | 302,54 · 102×28 | `schemas-dictionary` |
| 页面 | anticon-close<br>`anticon-close` | `span/button` | — | 384,60 · 10×17 | `schemas-dictionary` |
| 页面 | 自定义 | `button` | active | 316,97 · 67×34 | `schemas-dictionary` |
| 页面 | 系统内置 | `button` | — | 383,97 · 80×34 | `schemas-dictionary` |
| 页面 | 搜索参数名称或参数描述 | `input` | — | 503,104 · 245×21 | `schemas-dictionary` |
| 页面 | 新建字段描述<br>`anticon-plus` | `button` | — | 1032,99 · 131×30 | `schemas-dictionary` |
| 页面 | 参数名称 | `th` | — | 315,166 · 260×34 | `schemas-dictionary` |
| 页面 | 参数描述 | `th` | — | 575,166 · 84×34 | `schemas-dictionary` |
| 页面 | 备注 | `th` | — | 659,166 · 180×34 | `schemas-dictionary` |
| 页面 | 默认值 | `th` | — | 839,166 · 140×34 | `schemas-dictionary` |
| 页面 | 操作 | `th` | — | 979,166 · 100×34 | `schemas-dictionary` |
| 页面 | 暂无数据 | `div` | — | 331,284 · 816×21 | `schemas-dictionary` |
| 页面 | 数据库管理<br>`anticon-database` | `div/button` | active | 407,54 · 114×28 | `schemas-database-empty` |
| 页面 | 刷新<br>`anticon-reload` | `button` | — | 995,96 · 79×30 | `schemas-database-empty` |
| 页面 | 名称 | `th` | — | 315,136 · 264×34 | `schemas-database-empty` |
| 页面 | 数据库类型 | `th` | — | 579,136 · 140×34 | `schemas-database-empty` |
| 页面 | 说明 | `th` | — | 719,136 · 264×34 | `schemas-database-empty` |
| 页面 | 暂无数据库连接，点击右上角「新建」开始 | `div` | — | 331,254 · 816×21 | `schemas-database-empty` |
| modal:新建数据库连接 | Close<br>`anticon-close` | `button` | — | 858,112 · 30×30 | `schemas-dialog-db-connection` |
| modal:新建数据库连接 | 关闭<br>`anticon-close` | `span` | — | 858,120 · 30×14 | `schemas-dialog-db-connection` |
| modal:新建数据库连接 | 新建数据库连接 | `div` | — | 304,120 · 572×22 | `schemas-dialog-db-connection` |
| form | 名称 | `div` | — | 304,150 · 92×23 | `schemas-dialog-db-connection` |
| form | 名称 | `label` | — | 346,150 · 50×23 | `schemas-dialog-db-connection` |
| form | 连接名称 | `input` | — | 396,150 · 480×23 | `schemas-dialog-db-connection` |
| form | 说明 | `div` | — | 304,181 · 92×23 | `schemas-dialog-db-connection` |
| form | 说明 | `label` | — | 357,181 · 39×23 | `schemas-dialog-db-connection` |
| form | 可选 | `input` | — | 396,181 · 480×23 | `schemas-dialog-db-connection` |
| form | 数据库类型 | `div` | — | 304,212 · 92×23 | `schemas-dialog-db-connection` |
| form | 数据库类型 | `label` | — | 318,212 · 78×23 | `schemas-dialog-db-connection` |
| form | MySQL<br>`anticon-down` | `div` | — | 396,212 · 480×23 | `schemas-dialog-db-connection` |
| 页面 | MySQL | `span` | — | 404,213 · 464×21 | `schemas-dialog-db-connection` |
| form | 默认配置 | `div` | — | 304,243 · 92×23 | `schemas-dialog-db-connection` |
| form | 默认配置 | `label` | — | 331,243 · 65×23 | `schemas-dialog-db-connection` |
| form | 常规 | `div` | active | 304,273 · 26×37 | `schemas-dialog-db-connection` |
| form | SSH | `div` | — | 362,273 · 25×37 | `schemas-dialog-db-connection` |
| 页面 | 数据库地址 | `div` | — | 304,320 · 92×23 | `schemas-dialog-db-connection` |
| 页面 | 数据库地址 | `label` | — | 307,320 · 89×23 | `schemas-dialog-db-connection` |
| 页面 | 端口 | `div` | — | 304,351 · 92×23 | `schemas-dialog-db-connection` |
| 页面 | 端口 | `label` | — | 357,351 · 39×23 | `schemas-dialog-db-connection` |
| 页面 | anticon-up<br>`anticon-up` | `div` | — | 396,351 · 480×23 | `schemas-dialog-db-connection` |
| 页面 | Increase Value<br>`anticon-up` | `span/button` | — | 875,352 · 1×11 | `schemas-dialog-db-connection` |
| 页面 | Decrease Value<br>`anticon-down` | `span/button` | — | 875,363 · 1×11 | `schemas-dialog-db-connection` |
| 页面 | 3306 | `input/spinbutton` | — | 397,352 · 478×21 | `schemas-dialog-db-connection` |
| 页面 | 用户名 | `div` | — | 304,382 · 92×23 | `schemas-dialog-db-connection` |
| 页面 | 用户名 | `label` | — | 333,382 · 63×23 | `schemas-dialog-db-connection` |
| 页面 | root | `input` | — | 396,382 · 480×23 | `schemas-dialog-db-connection` |
| 页面 | 密码 | `div` | — | 304,413 · 92×23 | `schemas-dialog-db-connection` |
| 页面 | 密码 | `label` | — | 357,413 · 39×23 | `schemas-dialog-db-connection` |
| 页面 | 密码 | `input` | — | 404,414 · 447×21 | `schemas-dialog-db-connection` |
| 页面 | 数据库名 | `div` | — | 304,444 · 92×23 | `schemas-dialog-db-connection` |
| 页面 | 数据库名 | `label` | — | 320,444 · 76×23 | `schemas-dialog-db-connection` |
| 页面 | database | `input` | — | 396,444 · 480×23 | `schemas-dialog-db-connection` |
| modal:新建数据库连接 | 测试连接<br>`anticon-link` | `button` | — | 304,487 · 105×30 | `schemas-dialog-db-connection` |
| modal:新建数据库连接 | 取 消 | `button` | — | 744,487 · 62×30 | `schemas-dialog-db-connection` |
| modal:新建数据库连接 | 确 定 | `button` | — | 814,487 · 62×30 | `schemas-dialog-db-connection` |
| 页面 | 本地 MySQL（只读盘点） | `td` | — | 315,170 · 264×37 | `schemas-database-list` |
| 页面 | anticon-edit<br>`anticon-edit` | `button` | — | 991,176 · 24×24 | `schemas-database-list` |
| 页面 | anticon-cloud-download<br>`anticon-cloud-download` | `button` | — | 1017,176 · 24×24 | `schemas-database-list` |
| 页面 | anticon-delete<br>`anticon-delete` | `button` | — | 1043,176 · 24×24 | `schemas-database-list` |
| modal:导入表结构 · 本地 MySQL（只读盘点） | Close<br>`anticon-close` | `button` | — | 908,112 · 30×30 | `schemas-dialog-import-tables` |
| modal:导入表结构 · 本地 MySQL（只读盘点） | 关闭<br>`anticon-close` | `span` | — | 908,120 · 30×14 | `schemas-dialog-import-tables` |
| modal:导入表结构 · 本地 MySQL（只读盘点） | 导入表结构 · 本地 MySQL（只读盘点） | `div` | — | 254,120 · 672×22 | `schemas-dialog-import-tables` |
| modal:导入表结构 · 本地 MySQL（只读盘点） | 全选 | `label` | — | 254,155 · 57×21 | `schemas-dialog-import-tables` |
| modal:导入表结构 · 本地 MySQL（只读盘点） | 根目录<br>`anticon-down` | `div` | — | 746,150 · 180×30 | `schemas-dialog-import-tables` |
| 页面 | 根目录 | `span` | — | 758,151 · 156×28 | `schemas-dialog-import-tables` |
| modal:导入表结构 · 本地 MySQL（只读盘点） | 更新同名模型 | `label` | — | 254,529 · 108×21 | `schemas-dialog-import-tables` |
| modal:导入表结构 · 本地 MySQL（只读盘点） | 跳过同名模型 | `label` | — | 370,529 · 108×21 | `schemas-dialog-import-tables` |
| modal:导入表结构 · 本地 MySQL（只读盘点） | 创建副本 | `label` | — | 486,529 · 82×21 | `schemas-dialog-import-tables` |
| modal:导入表结构 · 本地 MySQL（只读盘点） | 重新读取表<br>`anticon-reload` | `button` | — | 254,562 · 118×30 | `schemas-dialog-import-tables` |
| modal:导入表结构 · 本地 MySQL（只读盘点） | 关 闭 | `button` | — | 772,562 · 62×30 | `schemas-dialog-import-tables` |
| modal:导入表结构 · 本地 MySQL（只读盘点） | 开始导入 | `button` | — | 842,562 · 84×30 | `schemas-dialog-import-tables` |
| 页面 | 全部模型<br>`anticon-folder-open` | `div/button` | — | 524,54 · 102×28 | `schemas-model-editor` |
| 页面 | 新建数据模型<br>`anticon-table` | `div/button` | active | 629,54 · 126×28 | `schemas-model-editor` |
| 页面 | 输入模型名称，建议使用代码模型名称或其同义词 | `input` | — | 315,94 · 670×42 | `schemas-model-editor` |
| 页面 | 别名（可选） | `input` | — | 315,140 · 200×21 | `schemas-model-editor` |
| 页面 | 模型描述（可选） | `input` | — | 525,140 · 460×21 | `schemas-model-editor` |
| 页面 | 删除<br>`anticon-delete` | `button` | — | 995,94 · 79×30 | `schemas-model-editor` |
| 页面 | 保存<br>`anticon-save` | `button` | — | 1084,94 · 79×30 | `schemas-model-editor` |
| 页面 | 可视化<br>`anticon-table` | `button` | active | 316,179 · 81×28 | `schemas-model-editor` |
| 页面 | Raw 编辑<br>`anticon-code` | `button` | — | 397,179 · 97×28 | `schemas-model-editor` |
| 页面 | 预览<br>`anticon-eye` | `button` | — | 494,179 · 69×28 | `schemas-model-editor` |
| 页面 | 生成代码<br>`anticon-code` | `button` | disabled | 576,179 · 87×28 | `schemas-model-editor` |
| 页面 | 智能导入<br>`anticon-import` | `button` | disabled | 675,179 · 87×28 | `schemas-model-editor` |
| 页面 | 模型根节点描述 | `div` | — | 422,238 · 914×30 | `schemas-model-editor` |
| 页面 | 模型根节点描述 | `input/combobox` | — | 422,238 · 914×23 | `schemas-model-editor` |
| 页面 | 添加字段<br>`anticon-plus` | `button` | — | 1345,241 · 80×24 | `schemas-model-editor` |
| 页面 | 字段名 | `input` | — | 44,327 · 150×23 | `schemas-model-add-field` |
| 页面 | string<br>`anticon-down` | `div` | — | 200,327 · 106×23 | `schemas-model-add-field` |
| 页面 | string | `span` | — | 208,328 · 90×21 | `schemas-model-add-field` |
| 页面 | 未设置 | `input` | — | 438,327 · 114×23 | `schemas-model-add-field` |
| 页面 | 回车添加<br>`anticon-down` | `div` | — | 558,326 · 150×25 | `schemas-model-add-field` |
| 页面 | (未命名单选/控件) | `input/combobox` | — | 564,330 · 4×17 | `schemas-model-add-field` |
| 页面 | 描述 | `div` | — | 714,323 · 160×30 | `schemas-model-add-field` |
| 页面 | 描述 | `input/combobox` | — | 714,323 · 160×23 | `schemas-model-add-field` |
| 页面 | 不引用<br>`anticon-down` | `div` | — | 880,327 · 150×23 | `schemas-model-add-field` |
| 页面 | — | `input` | disabled | 1035,327 · 48×23 | `schemas-model-add-field` |
| 页面 | 上移<br>`anticon-arrow-up` | `button` | disabled | 1089,326 · 23×24 | `schemas-model-add-field` |
| 页面 | 下移<br>`anticon-arrow-down` | `button` | disabled | 1114,326 · 23×24 | `schemas-model-add-field` |
| 页面 | 删除字段<br>`anticon-delete` | `button` | — | 1140,326 · 23×24 | `schemas-model-add-field` |
| 页面 | 重 置 | `button` | — | 1063,229 · 46×23 | `schemas-model-raw` |
| 页面 | 应 用 | `button` | — | 1117,229 · 46×23 | `schemas-model-raw` |
| 页面 | { "type": "object", "properties": {}, "x-schema-orders": [] } | `textarea` | — | 315,259 · 848×387 | `schemas-model-raw` |
| 页面 | 重新生成 | `button` | — | 315,229 · 68×23 | `schemas-model-preview` |

## 提示、空态与错误

**空态**

- 暂无数据
- 暂无数据库连接，点击右上角「新建」开始

**title 属性（悬停提示）**

- 参数描述
- 备注
- 默认值
- 名称
- 说明
- 数据库类型
- MySQL
- 默认配置
- 数据库地址
- 端口
- 用户名
- 密码
- 数据库名
- 本地 MySQL（只读盘点）
- 根目录
- 新建数据模型
- string
- 上移
- 下移
- 删除字段

## 表格

| 状态 | 表头 | 可见行数 |
| --- | --- | --- |
| `schemas-dictionary` | 参数名称 / 参数描述 / 备注 / 默认值 / 操作 / | 0 |
| `schemas-database-empty` | 名称 / 数据库类型 / 说明 / 操作 | 0 |

## 源码静态清单（含 file:line）

### 源码中的按钮

| 组件 | 文案 | 关键属性 | 位置 |
| --- | --- | --- | --- |
| Button | 刷新 |  | `src/renderer/src/components/schemas/DatabasePanel.tsx`:296 |
| Button | 新建 | type=primary | `src/renderer/src/components/schemas/DatabasePanel.tsx`:299 |
| Button | 测试连接 | loading=testing | `src/renderer/src/components/schemas/DatabasePanel.tsx`:328 |
| Button | 取消 |  | `src/renderer/src/components/schemas/DatabasePanel.tsx`:336 |
| Button | 确定 | type=primary | `src/renderer/src/components/schemas/DatabasePanel.tsx`:337 |
| Button | 重新读取表 |  | `src/renderer/src/components/schemas/DatabasePanel.tsx`:523 |
| Button | 关闭 |  | `src/renderer/src/components/schemas/DatabasePanel.tsx`:527 |
| Button | 开始导入 | type=primary loading=importing | `src/renderer/src/components/schemas/DatabasePanel.tsx`:528 |
| Button | 新建字段描述 | type=primary | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:289 |
| Button | 删除 | danger=true | `src/renderer/src/components/schemas/ModelEditor.tsx`:218 |
| Button | 保存 | type=primary loading=saving | `src/renderer/src/components/schemas/ModelEditor.tsx`:221 |
| Button | 删除 | danger=true | `src/renderer/src/components/schemas/ModelEditor.tsx`:268 |
| Button | 保存 | type=primary loading=saving | `src/renderer/src/components/schemas/ModelEditor.tsx`:271 |
| Button | 重置 | size=small | `src/renderer/src/components/schemas/ModelEditor.tsx`:319 |
| Button | 应用 | size=small type=primary | `src/renderer/src/components/schemas/ModelEditor.tsx`:322 |
| Button | 重新生成 | size=small | `src/renderer/src/components/schemas/ModelEditor.tsx`:347 |
| Button | 恢复默认 | size=small type=link | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:196 |
| Button | 关闭标签 |  | `src/renderer/src/pages/SchemasPage.tsx`:727 |

### 源码中的提示 / 通知 / 确认框

| 类型 | 文案 | 位置 |
| --- | --- | --- |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:79 |
| `message.error` | `problem` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:138 |
| `message.error` | `result.error` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:143 |
| `message.success` | `editing ? '已更新连接' : '已新建连接'` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:148 |
| `modal.confirm` | `title=\`删除数据库连接「${connection.name}」？\`; content=已导入的数据模型会保留，此操作不可撤销。; okText=删除; cancelText=取消` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:171 |
| `message.error` | `result.error` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:180 |
| `message.success` | `已删除连接` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:184 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:206 |
| `message.error` | `请至少勾选一张表` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:216 |
| `message.success` | `\`导入完成：新建 ${result.data.created}，更新 ${result.data.updated}，跳过 ${result.data.skipped}，副本 ${result.data.copied}\`` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:229 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:233 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:61 |
| `message.success` | `editing ? '已更新' : '已新建'` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:128 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:131 |
| `modal.confirm` | `title=已存在同名条目; content=\`自定义字典中已有「${duplicate.key}」，仍要保存吗？\`; okText=仍然保存; cancelText=取消` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:149 |
| `modal.confirm` | `title=\`删除自定义描述「${entry.key}」？\`; content=删除后联想与列表会同步更新，此操作不可撤销。; okText=删除; cancelText=取消` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:162 |
| `message.error` | `result.error` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:171 |
| `message.success` | `已删除` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:176 |
| `message.error` | `result.error` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:184 |
| `message.success` | `checked ? '已开启系统内置描述联想' : '已关闭系统内置描述联想'` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:189 |
| `message.error` | `result.error` | `src/renderer/src/components/schemas/ModelEditor.tsx`:78 |
| `message.error` | `请输入模型名称` | `src/renderer/src/components/schemas/ModelEditor.tsx`:113 |
| `message.error` | `problem` | `src/renderer/src/components/schemas/ModelEditor.tsx`:119 |
| `message.warning` | `已存在同名模型，请确认是否符合预期` | `src/renderer/src/components/schemas/ModelEditor.tsx`:129 |
| `message.warning` | `generated.data.warnings[0].message` | `src/renderer/src/components/schemas/ModelEditor.tsx`:132 |
| `message.success` | `已保存` | `src/renderer/src/components/schemas/ModelEditor.tsx`:147 |
| `message.error` | `(error as Error).message` | `src/renderer/src/components/schemas/ModelEditor.tsx`:149 |
| `message.error` | `references.error` | `src/renderer/src/components/schemas/ModelEditor.tsx`:158 |
| `modal.confirm` | `title=\`删除${isFolder ? '目录' : '模型'}「${draft.name}」？\`; content=( <div> {isFolder ? ( <p>目录下的模型会一并删除，且不可撤销。</p> ) : null} {list.length > 0 ? ( <> <p>以下接口仍引用该模型，删除后` | `src/renderer/src/components/schemas/ModelEditor.tsx`:162 |
| `message.error` | `result.error` | `src/renderer/src/components/schemas/ModelEditor.tsx`:196 |
| `message.success` | `已删除` | `src/renderer/src/components/schemas/ModelEditor.tsx`:200 |
| `message.success` | `已应用，可切回可视化` | `src/renderer/src/components/schemas/ModelEditor.tsx`:326 |
| `message.error` | `error.message` | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:39 |
| `message.error` | `(error as Error).message` | `src/renderer/src/pages/SchemasPage.tsx`:105 |
| `modal.confirm` | `title=放弃未保存的修改？; content=\`模型「${tab.name}」还有未保存的修改，关闭后将丢失。\`; okText=放弃并关闭; cancelText=取消` | `src/renderer/src/pages/SchemasPage.tsx`:167 |
| `message.success` | `kind === 'folder' ? '已新建模型目录' : '已新建数据模型'` | `src/renderer/src/pages/SchemasPage.tsx`:200 |
| `message.error` | `(error as Error).message` | `src/renderer/src/pages/SchemasPage.tsx`:202 |
| `message.error` | `(error as Error).message` | `src/renderer/src/pages/SchemasPage.tsx`:248 |
| `message.success` | `已复制` | `src/renderer/src/pages/SchemasPage.tsx`:289 |
| `message.error` | `(error as Error).message` | `src/renderer/src/pages/SchemasPage.tsx`:291 |
| `modal.confirm` | `title=\`删除数据模型「${model.name}」？\`; content=references.length > 0 ? ( <div> <p>以下接口仍引用该模型，删除后引用会保留为失效引用：</p> <ul style={{ paddingLeft: 18, maxHeight: 160, overflow:` | `src/renderer/src/pages/SchemasPage.tsx`:299 |
| `message.success` | `已删除` | `src/renderer/src/pages/SchemasPage.tsx`:327 |
| `modal.confirm` | `title=\`删除模型目录「${model.name}」？\`; content=目录下的模型会一并删除，此操作不可撤销。; okText=删除; cancelText=取消` | `src/renderer/src/pages/SchemasPage.tsx`:332 |
| `message.success` | `已删除` | `src/renderer/src/pages/SchemasPage.tsx`:341 |
| `message.error` | `(error as Error).message` | `src/renderer/src/pages/SchemasPage.tsx`:345 |
| `message.error` | `名称不能为空` | `src/renderer/src/pages/SchemasPage.tsx`:361 |
| `message.success` | `已重命名` | `src/renderer/src/pages/SchemasPage.tsx`:368 |
| `message.error` | `(error as Error).message` | `src/renderer/src/pages/SchemasPage.tsx`:370 |

### 源码中的菜单项

| label | key | disabled | 位置 |
| --- | --- | --- | --- |
| `名称` | `name` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:240 |
| `数据库类型` | `type` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:241 |
| `说明` | `remarks` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:248 |
| `操作` | `actions` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:249 |
| `MySQL` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:367 |
| `常规` | `regular` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:381 |
| `SSH` | `ssh` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:427 |
| `密码` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:478 |
| `私钥` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:479 |
| `密码 + 私钥` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:480 |
| `根目录` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:564 |
| `folder.name` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:565 |
| `更新同名模型` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:603 |
| `跳过同名模型` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:604 |
| `创建副本` | `` | — | `src/renderer/src/components/schemas/DatabasePanel.tsx`:605 |
| `value` | `` | — | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:27 |
| `参数名称` | `key` | — | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:193 |
| `参数描述` | `description` | — | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:209 |
| `备注` | `remarks` | — | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:215 |
| `默认值` | `default_value` | — | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:223 |
| `操作` | `actions` | — | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:233 |
| `( <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}> <` | `` | — | `src/renderer/src/components/schemas/DictionarySuggest.tsx`:74 |
| `名称` | `name` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:20 |
| `别名` | `alias` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:21 |
| `创建人` | `created_by` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:22 |
| `创建时间` | `created_time` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:23 |
| `最后修改人` | `updated_by` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:24 |
| `修改时间` | `updated_time` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:25 |
| `目录` | `folder` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:26 |
| `名称` | `name` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:102 |
| `别名` | `alias` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:110 |
| `创建人` | `created_by` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:116 |
| `创建时间` | `created_time` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:123 |
| `最后修改人` | `updated_by` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:130 |
| `修改时间` | `updated_time` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:137 |
| `目录` | `folder` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:144 |
| `全部目录` | `` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:174 |
| `根目录` | `` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:175 |
| `folder.name` | `` | — | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:176 |
| `string` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:22 |
| `number` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:23 |
| `integer` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:24 |
| `boolean` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:25 |
| `object` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:26 |
| `array` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:27 |
| `引用模型` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:28 |
| `未设置` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:349 |
| `true` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:350 |
| `false` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:351 |
| `model.name` | `` | — | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:431 |
| `新建数据模型` | `model` | — | `src/renderer/src/pages/SchemasPage.tsx`:218 |
| `新建模型目录` | `folder` | — | `src/renderer/src/pages/SchemasPage.tsx`:219 |
| `新建数据字段` | `dictionary` | — | `src/renderer/src/pages/SchemasPage.tsx`:220 |
| `新建数据库连接` | `database` | — | `src/renderer/src/pages/SchemasPage.tsx`:221 |
| `根目录` | `` | — | `src/renderer/src/pages/SchemasPage.tsx`:233 |
| `item.name` | `` | — | `src/renderer/src/pages/SchemasPage.tsx`:236 |
| `打开` | `open` | — | `src/renderer/src/pages/SchemasPage.tsx`:474 |
| `重命名` | `rename` | — | `src/renderer/src/pages/SchemasPage.tsx`:475 |
| `复制到…` | `copy` | — | `src/renderer/src/pages/SchemasPage.tsx`:477 |
| `移动到…` | `move` | — | `src/renderer/src/pages/SchemasPage.tsx`:479 |
| `删除` | `delete` | — | `src/renderer/src/pages/SchemasPage.tsx`:480 |

### 源码中的提示文案

**Tooltip**

| 文案 | 位置 |
| --- | --- |
| `编辑` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:255 |
| `导入表结构` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:260 |
| `删除` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:265 |
| `编辑` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:239 |
| `删除` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:244 |
| `后续支持` | `src/renderer/src/components/schemas/ModelEditor.tsx`:288 |
| `后续支持` | `src/renderer/src/components/schemas/ModelEditor.tsx`:293 |
| `列设置` | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:209 |
| `允许为 null` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:325 |
| `刷新` | `src/renderer/src/pages/SchemasPage.tsx`:593 |

**Placeholder**

| 文案 | 位置 |
| --- | --- |
| `连接名称` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:354 |
| `可选` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:361 |
| `127.0.0.1` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:390 |
| `3306` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:398 |
| `root` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:407 |
| `密码` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:414 |
| `database` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:421 |
| `22` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:456 |
| `-----BEGIN OPENSSH PRIVATE KEY-----` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:489 |
| `搜索参数名称或参数描述` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:270 |
| `例如 user_id` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:333 |
| `例如 用户 ID` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:343 |
| `可选` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:346 |
| `可选` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:349 |
| `placeholder` | `src/renderer/src/components/schemas/DictionarySuggest.tsx`:106 |
| `placeholder` | `src/renderer/src/components/schemas/DictionarySuggest.tsx`:108 |
| `目录名称` | `src/renderer/src/components/schemas/ModelEditor.tsx`:214 |
| `输入模型名称，建议使用代码模型名称或其同义词` | `src/renderer/src/components/schemas/ModelEditor.tsx`:246 |
| `别名（可选）` | `src/renderer/src/components/schemas/ModelEditor.tsx`:255 |
| `模型描述（可选）` | `src/renderer/src/components/schemas/ModelEditor.tsx`:263 |
| `搜索模型名称或别名` | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:65 |
| `搜索模型名称或别名` | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:164 |
| `模型根节点描述` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:77 |
| `字段名` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:295 |
| `—` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:340 |
| `未设置` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:366 |
| `未设置` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:374 |
| `—` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:380 |
| `回车添加` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:389 |
| `每个枚举值的含义，每行一条` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:395 |
| `不引用` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:416 |
| `—` | `src/renderer/src/components/schemas/SchemaFieldEditor.tsx`:440 |
| `模型名/目录` | `src/renderer/src/pages/SchemasPage.tsx`:564 |

**Empty**

| 文案 | 位置 |
| --- | --- |
| `暂无数据库连接，点击右上角「新建」开始` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:313 |
| `暂无表` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:574 |
| `还没有可引用的数据模型` | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:75 |
| `暂无数据，先在左侧新建数据模型` | `src/renderer/src/components/schemas/ModelsListPanel.tsx`:227 |
| `模型已删除或不存在` | `src/renderer/src/pages/SchemasPage.tsx`:722 |

### 快捷键 / 键盘处理

| 表达式 | 位置 |
| --- | --- |
| `event.key === 'Enter'` | `src/renderer/src/pages/SchemasPage.tsx`:639 |

### 行为 / IPC 调用

| 调用 | 参数 | 位置 |
| --- | --- | --- |
| `window.api.db.list` | `projectId` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:75 |
| `window.api.models.list` | `projectId` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:96 |
| `window.api.db.save` | `projectId, draft` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:141 |
| `window.api.db.test` | `draft.config.default, draft.ssh` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:160 |
| `window.api.db.delete` | `projectId, connection.db_id` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:178 |
| `window.api.db.tables` | `connection.config.default, connection.ssh` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:202 |
| `window.api.db.importTables` | `projectId, importConnection.db_id, { tables: selectedTables, target_parent_id: targetFolder, conflic` | `src/renderer/src/components/schemas/DatabasePanel.tsx`:221 |
| `window.api.dictionary.list` | `projectId` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:53 |
| `window.api.dictionary.getSettings` | `projectId` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:54 |
| `window.api.dictionary.save` | `projectId, { ...(editing ?? {}), ...values, id: editing?.id ?? '', project_id: projectId` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:118 |
| `window.api.dictionary.delete` | `projectId, entry.id` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:169 |
| `window.api.dictionary.saveSettings` | `projectId, { builtin_enabled: checked }` | `src/renderer/src/components/schemas/DictionaryPanel.tsx`:182 |
| `window.api.dictionary.suggestions(projectId).then` | `(result) => { if (!result.ok) throw new Error(result.error) const entry = cache.get(projectId) ?? { ` | `src/renderer/src/components/schemas/DictionarySuggest.tsx`:21 |
| `window.api.dictionary.suggestions` | `projectId` | `src/renderer/src/components/schemas/DictionarySuggest.tsx`:21 |
| `window.api.models.generateFromSchema` | `projectId, schema` | `src/renderer/src/components/schemas/ModelEditor.tsx`:76 |
| `window.api.models.generateFromSchema` | `projectId, draft.data.schema` | `src/renderer/src/components/schemas/ModelEditor.tsx`:130 |
| `window.api.models.save` | `projectId, { ...draft, name, updated_by: '本地' }` | `src/renderer/src/components/schemas/ModelEditor.tsx`:137 |
| `window.api.models.references` | `projectId, draft.model_id` | `src/renderer/src/components/schemas/ModelEditor.tsx`:156 |
| `window.api.models.delete` | `projectId, draft.model_id` | `src/renderer/src/components/schemas/ModelEditor.tsx`:194 |
| `window.api.models
      .list(projectId)
      .then((result) => {
        if (!active) return
        if (!result.ok) throw new Error(result.error)
        setModels(result.data)
      })
      .catch((error: Error) => active && message.error(error.message))
      .finally` | `() => active && setLoading(false)` | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:32 |
| `window.api.models
      .list(projectId)
      .then((result) => {
        if (!active) return
        if (!result.ok) throw new Error(result.error)
        setModels(result.data)
      })
      .catch` | `(error: Error) => active && message.error(error.message)` | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:32 |
| `window.api.models
      .list(projectId)
      .then` | `(result) => { if (!active) return if (!result.ok) throw new Error(result.error) setModels(res` | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:32 |
| `window.api.models
      .list` | `projectId` | `src/renderer/src/components/schemas/ModelPickerModal.tsx`:32 |
| `window.api.models.resolveRefs` | `projectId, { $ref: \`kindraapi://model/${modelId}\` }` | `src/renderer/src/components/schemas/modelDocumentation.ts`:5 |
| `window.api.models.generateFromSchema` | `projectId, result.data.schema` | `src/renderer/src/components/schemas/modelDocumentation.ts`:8 |
| `window.api.models.listAll` | `projectId` | `src/renderer/src/pages/SchemasPage.tsx`:98 |
| `window.api.models.create` | `projectId, selectedFolder \|\| '0', kind` | `src/renderer/src/pages/SchemasPage.tsx`:189 |
| `window.api.models.move` | `projectId, modelId, destParentId, orderedIds` | `src/renderer/src/pages/SchemasPage.tsx`:244 |
| `window.api.models.copy` | `projectId, model.model_id, destParentId` | `src/renderer/src/pages/SchemasPage.tsx`:286 |
| `window.api.models.references` | `projectId, model.model_id` | `src/renderer/src/pages/SchemasPage.tsx`:298 |
| `window.api.models.delete` | `projectId, model.model_id` | `src/renderer/src/pages/SchemasPage.tsx`:322 |
| `window.api.models.delete` | `projectId, model.model_id` | `src/renderer/src/pages/SchemasPage.tsx`:339 |
| `window.api.models.save` | `projectId, { ...model, name, updated_by: '本地' }` | `src/renderer/src/pages/SchemasPage.tsx`:365 |

> 返回 [总索引](../README.md)
