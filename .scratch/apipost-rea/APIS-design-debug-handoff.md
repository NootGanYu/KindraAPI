# KindraAPI APIS「设计 / 调试」细粒度对照与交接报告

> 日期：2026-11-02  
> 目标应用：Apipost 单机版 2.0.0（Windows，构建 2025-10-10）  
> 对照对象：KindraAPI `src/renderer/src/pages/ApisPage.tsx` 及 `RequestEditor` / `ResponsePanel` / `DesignEditor` / `JsonFieldTable` / `ParamTable`

## 0. 先看结论

1. **不需要你逐条指出偏差。** 已按 Apipost 真机 UI 拆分到“字段 / 控件 / 交互 / 默认值”级别；报告第 5 节只列出需要你拍板的 8 个歧义点。
2. 已确认 Apipost 的「设计」「调试」两个 Tab 的真实布局（Windows 真机截图，见第 7 节）。
3. 当前最大偏差不是“有没有功能”，而是：
   - 「设计」页缺少 **目录/标签、内联富文本说明、数据结构/示例双视图、Mock 列、智能导入/生成代码**；
   - 「调试」页缺少 **预执行/后执行“添加操作项”模型、参数助手、Raw 子格式、完整鉴权、从设计请求参数生成**；
   - 响应区字段与交互顺序和 Apipost 不完全一致。
4. 本机 Windows 上 REA 的原生 UI 捕获不可用（macOS 专用），已改用窗口截图 + i18n 词表。**切到 Mac 后可以直接用 REA 的 macOS 原生 AX 捕获**，把剩余细节补齐（第 6 节）。

## 1. 分析方法与证据

| 证据 | 说明 |
| --- | --- |
| REA `analyze-javascript-application` | 全量 `work.asar`（344 个 JS）300s 超时；改为分析主入口 `index-0d1d8198fa5a.js`，成功生成 20,000 语义节点 / 14,590 关系的应用图 |
| Apipost i18n 词表 | 从 `work.asar` 提取 18,493 条中文文案；过滤后得到 3,019 个中文键值，用于还原功能名 |
| Windows 真机截图 | 通过窗口坐标点击抓取「设计」「调试」及子 Tab（本目录 `s-*.png`、`v-*.png`） |
| KindraAPI 源码 | 逐文件比对 `ApisPage.tsx`、`RequestEditor.tsx`、`DesignEditor.tsx`、`ResponsePanel.tsx`、`CasesEditor.tsx`、`JsonFieldTable.tsx`、`ParamTable.tsx`、`shared/types.ts` |
| 限制 | Windows REA 原生 UI 捕获返回 `capability_unavailable`；Electron 未向 Windows UIA 暴露完整 AX 树；部分长页面滚动状态未全部截取 |

## 2. Apipost「设计」页真实结构（逐项）

截图：`s-design2.png`（顶部）、`s-design8.png`（布局）、`s-dbg2.png`（数据结构表）

### 2.1 顶部操作区

| 位置 | 控件 | 行为/默认值 |
| --- | --- | --- |
| 第一行 | Method 下拉 | POST / GET / ...；设计态不可发送，只保存 |
| 第一行 | URL 输入 | 示例 `/user/manage/page` |
| 第一行 | 协议下拉 | `http/1.1` |
| 第一行 | `预览` 按钮 | 预览接口文档 |
| 第一行 | `保存` 按钮（深色主按钮） | 保存设计 |
| 第二行 | `目录` 下拉 | 默认 `根目录` |
| 第二行 | `标签` 多选 | placeholder `请输入或选择标签` |
| 状态区 | `● 开发中 ▾` | 接口状态下拉（开发中 / 已完成 / 已废弃 / 自定义） |
| 状态区 | 接口名称 | 可点击编辑 |
| 状态区右侧 | 图标组 | 接口说明（列表图标）、`分享`、`...` 更多 |

### 2.2 详细说明（内联富文本）

截图：`s-design2.png` / `s-dbg2.png`

- 左侧编辑区 + 右侧实时预览，**左右分栏**。
- 工具栏：H、B、I、引用、链接、图片、行内代码、代码块、有序列表、无序列表、任务列表、表格、`+ 插入`。
- 底部：`同步滚动` 勾选、`回到顶部`、`字数：416`、`行数：31`。
- 预览区渲染为富文本（示例包含【调用方式】、URL、Header、Content-Type）。
- **Kindra 当前**：接口说明在 `ApiDescriptionDialog` 弹窗中维护，设计页内没有内联分栏编辑器，也没有字数/行数/同步滚动。

### 2.3 设计请求参数

截图：`s-dbg2.png`

- 标题：`设计请求参数`。
- 子 Tab：`Header (n)`、`Query`、`Path`、`Body (n)`、`认证`。
  - **注意：设计页没有 `Cookie` 子 Tab**；Cookie 只在调试页出现。
- Body 类型：`none`、`form-data`、`urlencoded`、`binary`、`msgpack`、`raw` + Raw 子格式下拉（当前 `JSON`）。
- Body 下方双视图：`数据结构` / `示例`。
- 右上动作：`Raw编辑`、`预览`、`生成代码`、`智能导入`（深色按钮）。
- `数据结构` 表字段（截图 `s-dbg2.png`）：
  - 树形层级（根节点 `object`）
  - 字段名（`endTime` / `keyword` / `limit` ...）
  - 类型选择器（`string` / `integer` / `object`，带彩色类型徽标）
  - 必填开关（星号）
  - 可空开关（N）
  - `Mock` 开关/列
  - `描述` 列（业务说明）
- `示例` 视图：按数据结构生成的示例 JSON / 值。
- **Kindra 当前**：
  - `DesignEditor` 直接复用 `RequestEditor` + `ResponsePanel`，没有 `数据结构 / 示例` 双视图；
  - Body JSON 使用 `JsonFieldTable` 的 `原始 / 字段` 两视图；
  - 字段表没有独立的 `Mock` 开关列，也没有 `智能导入 / 生成代码 / Raw编辑 / 预览` 动作；
  - 设计页仍显示 `Cookie` 子 Tab（与 Apipost 不一致）。

### 2.4 响应契约与错误码（待在 Mac 补全截图）

- REA/i18n 证据：
  - `response_want_code=状态码`、`response_want_type=内容类型`、`response_want_success=成功响应`
  - `new_response=新建期望`、`response_example=响应示例`、`save_response=保存为响应示例`
  - `error_code` 相关：`description_tip=请描述下状态码含义`、`analysis_placeholder`（粘贴错误码文本解析）
- Kindra 已有：响应示例、字段说明、错误码（`DesignEditor` 中的 `错误码` 列表）。
- 待核对：Apipost 响应契约的字段顺序、是否支持多状态码/多内容类型、示例的“默认/校验”标记、错误码批量粘贴解析。

## 3. Apipost「调试」页真实结构（逐项）

截图：`s-dbg4.png`、`v-header.png`、`v-auth`（实际为认证页）、`v-pre.png`、`v-post.png`

### 3.1 顶部操作区

| 位置 | 控件 | 行为/默认值 |
| --- | --- | --- |
| 第一行 | Method 下拉 | POST |
| 第一行 | URL 输入 | `/user/manage/page` |
| 第一行 | 协议下拉 | `http/1.1` |
| 第一行 | `发送` 主按钮 + 下拉 | 发送 / 发送并保存 |
| 第一行 | `保存` + 下拉 | 保存 / 保存并发送 |
| 第二行 | 请求子 Tab | `Header (n)`、`Query`、`Path`、`Body (n)`、`认证`、`Cookie`、`预执行操作`、`后执行操作` |

### 3.2 Header（`v-header.png`）

- 区块标题：`公共参数（Header）`。
- 表头：`参数名` | `参数值` | `描述`。
- 行内元素：启用勾选框、参数名输入、类型徽标（`string`）、必填星号、参数值、描述。
- 示例：`Content-Type` → `application/json`。
- **Kindra**：`ParamTable` 已有 `公共参数（Header）`、参数名/值/描述，结构接近；需核对类型徽标、必填/可空开关、批量生成描述入口。

### 3.3 Query / Path / Cookie

- 与 Header 同一套参数表组件；Query/Path 支持路径变量与查询参数；Cookie 表使用 `Cookie 名` 作为 key placeholder。
- **Kindra**：已实现 `Query`、`Path`、`Cookie` 三个 `ParamTable`，基础结构一致；需核对列与默认值。

### 3.4 Body（`s-dbg4.png`）

- 类型：`none`、`form-data`、`urlencoded`、`binary`、`msgpack`、`raw` + Raw 子格式下拉（`JSON`）。
- `从设计请求参数生成` 按钮（带刷新图标）：用设计页参数生成调试 Body 默认值。
- 编辑器：带行号的代码编辑器；右侧吸附 `参数助手` 竖排标签。
- **Kindra**：
  - 类型相同（msgpack 当前禁用）；
  - 没有 Raw 子格式下拉（JSON/XML/Text/HTML/JavaScript 等）；
  - 没有 `从设计请求参数生成`；
  - 编辑器为普通 `Input.TextArea`，无行号；
  - 没有 `参数助手` 侧栏。

### 3.5 认证（`v-cookie.png` 中实际显示）

- 区块只有一个 `类型` 下拉，当前值 `继承父级`。
- 选择不同类型后展开对应字段（Bearer / Basic / Digest / OAuth1 / OAuth2 / Hawk / AWS / NTLM / JWT / ASAP / EdgeGrid / API Key）。
- **Kindra**：`AuthEditor` 只有 `继承父级 / 无需认证 / Bearer / Basic / API Key` 5 种；执行器 `resolveEffectiveRequest` 也只处理 `bearer / basic / kv` 3 种。
- 证据：i18n `bearer`、`basic`、`digest`、`oauth1_header`、`oauth1_body`、`hawk`、`aws_header`、`aws_url`、`ntlm`、`jwt_header`、`jwt_query`、`auth_key`。

### 3.6 预执行操作 / 后执行操作（`v-pre.png`、`v-post.png`）

- 两者都是 **操作项列表**，默认只有一个虚线按钮：`+ 添加操作项`。
- 不是纯文本脚本输入框。
- REA/i18n 可确认的操作类型：
  - `断言`（可视化断言 / 脚本断言）
  - `提取变量`（JSONPath / 正则 / Header / Cookie → 环境/全局变量）
  - `脚本`（前置/后置 JS，`pm.environment.set`）
  - `数据库操作`
  - `分组`
- **Kindra**：`RequestEditor` 的「预执行操作 / 后执行操作」是两个纯文本 `Input.TextArea`（`pre_script` / `test`），并且执行器目前**没有执行这些脚本**。这是设计/调试链路里最大的结构偏差之一。

### 3.7 响应区（`s-dbg4.png`）

- Tabs：`实时响应`、`响应头`、`Cookie`、`响应示例`、`实际请求`、`控制台`。
- 空状态：`请输入url点击发送按钮获取响应结果`。
- 右上角图标：视图切换（表格/预览等）。
- **Kindra**：`ResponsePanel` Tabs 为 `实时响应 / 响应头 / Cookie / 响应示例 / 字段说明 / 实际请求 / 控制台`。
  - Kindra 多出 `字段说明`；
  - Apipost 调试页没有 `字段说明`（字段说明在「设计」页维护）；
  - 需确认是否保留 Kindra 的 `字段说明` 或移到设计页。

### 3.8 参数助手 / 状态栏

- 调试右侧竖排 `参数助手`：快速查看/插入设计页参数。
- 底部状态栏：`精简模式`、软件序列号、`已绑定·剩余31天`、`设置`。
- Kindra：有 `StatusBar`，但内容不同；无参数助手。

## 4. Kindra 当前实现与偏差清单

### 4.1 设计页偏差

| # | 项目 | Apipost | Kindra 当前 | 偏差级别 |
| --- | --- | --- | --- | --- |
| D1 | 目录字段 | 设计页顶部 `目录` 下拉 | 无（仅左侧树） | 高 |
| D2 | 标签字段 | 顶部 `标签` 多选 | 数据模型有 `tags`，无 UI | 高 |
| D3 | 详细说明 | 内联左右分栏富文本 + 字数/行数/同步滚动 | `ApiDescriptionDialog` 弹窗 | 高 |
| D4 | 顶部预览 | `预览` 按钮 | 无 | 中 |
| D5 | 设计请求参数子 Tab | Header/Query/Path/Body/认证（无 Cookie） | 复用 RequestEditor，含 Cookie | 中 |
| D6 | 数据结构/示例双视图 | 有 | 无（Body 用 原始/字段） | 高 |
| D7 | 数据结构列 | 类型/必填/可空/Mock/描述 | `JsonFieldTable` 字段/类型/说明等，无 Mock 列 | 高 |
| D8 | Body 动作 | Raw编辑 / 预览 / 生成代码 / 智能导入 | 引用模型 / 编辑 / 解除引用 | 高 |
| D9 | 响应契约 | 多状态码/内容类型/示例 | 已有示例/字段/错误码，需细化 | 中 |
| D10 | 错误码批量解析 | 支持粘贴文本解析 | 仅手动逐条添加 | 低 |

### 4.2 调试页偏差

| # | 项目 | Apipost | Kindra 当前 | 偏差级别 |
| --- | --- | --- | --- | --- |
| T1 | 接口状态 | `开发中 ▾` 下拉 | 静态 `开发中` | 高 |
| T2 | 请求子 Tab 顺序 | Header/Query/Path/Body/认证/Cookie/预执行/后执行 | 相同顺序 | 低 |
| T3 | Header 表 | 参数名/值/描述 + 类型徽标 + 必填星号 | ParamTable 接近，需核对 | 中 |
| T4 | Raw 子格式 | JSON/XML/Text/HTML/JavaScript | 无 | 中 |
| T5 | 从设计参数生成 | `从设计请求参数生成` | 无 | 高 |
| T6 | 编辑器 | 行号 + 参数助手 | 普通 TextArea | 中 |
| T7 | 参数助手 | 右侧竖排 | 无 | 中 |
| T8 | 认证类型 | 13 种 | 5 种 UI / 3 种执行 | 高 |
| T9 | 预执行/后执行 | 操作项列表（断言/提取变量/脚本/数据库/分组） | 纯文本脚本，且不执行 | 高 |
| T10 | 断言 | 调试页可加断言 | 仅用例内断言 | 高 |
| T11 | 提取变量 | 支持 JSONPath/正则/Header/Cookie | 无（仅 Flow 内有 setEnv） | 高 |
| T12 | 响应 Tabs | 无 `字段说明` | 有 `字段说明` | 中 |
| T13 | 响应搜索 | `搜索响应区内容` | 无 | 中 |
| T14 | 保存为响应示例 | 有 | 有 | 一致 |
| T15 | 发送历史/对比 | 发送历史 + 历史对比 | HistoryPage 有列表，无对比 | 中 |
| T16 | 请求设置 | 超时/重定向/代理/证书 | 无 | 高 |

## 5. 需要你拍板的 8 个歧义点

> 你不需要逐条列偏差；只需确认下面这些“方向性选择”。未确认的我按 Apipost 行为优先。

1. **详细说明**：改成 Apipost 内联左右分栏（编辑 + 预览 + 字数/行数/同步滚动），还是保留现有弹窗？
2. **设计页 Cookie Tab**：按 Apipost 去掉设计页的 Cookie，只保留调试页 Cookie？
3. **数据结构表**：是否引入 `类型选择器 + 必填/可空双开关 + Mock 列 + 描述`，替换/扩展现有 `JsonFieldTable`？
4. **预执行/后执行**：是否改成 Apipost 的“添加操作项”列表（断言 / 提取变量 / 脚本 / 数据库操作 / 分组）？
5. **参数助手 / 从设计参数生成**：是否首期就做？
6. **Raw 子格式**：首期支持哪些（JSON / XML / Text / HTML / JavaScript）？
7. **认证范围**：13 种全做，还是先做 Digest / OAuth2 / JWT / AWS / API Key？
8. **响应区字段说明**：保留在调试页，还是移到设计页（Apipost 设计页维护字段说明）？

## 6. 切到 Mac 后的继续方案

### 6.1 直接可用的 REA 能力

macOS 上 REA 的 `capture-native-ui-scenario` 可用（Windows 返回 `capability_unavailable`）。建议：

```bash
# 1) 查看 Apipost 主窗口
rea doctor
rea observe_native_ui --pid <PID> --window-id <WID> --screenshot --accessibility --max-nodes 2000

# 2) 逐项点击/等待并截图
rea capture-native-ui-scenario /Applications/Apipost.app \
  --pid <PID> --window-id <WID> --screenshot --accessibility --max-nodes 2000 \
  --steps '[{"kind":"click","path":[0,1,2]},{"kind":"wait","milliseconds":800}]'
```

> `steps` 的 `path` 来自 `observe_native_ui` 返回的 AX 树节点路径；可精确点击，不需要坐标猜测。

### 6.2 建议补采的界面

- 设计页：顶部完整、数据结构/示例、响应契约、错误码、标签下拉、目录下拉、状态下拉、预览。
- 调试页：Header/Query/Path/Body/认证/Cookie/预执行/后执行 全部展开；Raw 子格式菜单；参数助手展开；响应 6 个 Tab；发送后真实响应。
- 左树：筛选菜单、排序菜单、右键菜单、批量操作、回收站。
- 分享/版本/历史：分享弹窗、版本对比、历史对比。

### 6.3 代码侧下一步

1. 先改「设计」页布局（不新增后端能力）：
   - `DesignEditor.tsx` 拆成顶部元信息 + 内联富文本 + 设计请求参数 + 响应契约。
   - 新增 `DesignMetaBar`（目录/标签/状态/预览/保存）。
   - 新增 `RichTextEditor`（复用现有 `ApiDescriptionDialog` 的编辑能力，改为内联 + 预览）。
   - 把 `RequestEditor` 拆出 `DesignRequestTabs`（Header/Query/Path/Body/认证，无 Cookie）。
2. 再改「调试」页：
   - `RequestEditor` 增加 Raw 子格式、从设计参数生成、参数助手、请求设置。
   - 新增 `OperationList`（预执行/后执行操作项），替代纯文本。
   - 扩展 `AuthEditor` 与 `executor.ts` 的鉴权类型。
3. 最后补执行语义：脚本沙箱、断言、变量提取、请求设置。

## 7. 证据文件索引

| 文件 | 内容 |
| --- | --- |
| `APIS-page-gap-analysis.md` | 首轮 APIS 页面全量功能对比（含导入/用例/压测/Mock） |
| `APIS-design-debug-handoff.md` | 本报告 |
| `work-strings.json` | `work.asar` 提取的 18,493 条中文文案（频次 + 来源文件） |
| `i18n-work.json` | `work.asar` 的 3,019 条中文 i18n 键值 |
| `index.json` | REA 对主入口 bundle 的完整应用图（67 MB） |
| `work.json.gz` | REA 全量分析的部分 Evidence（超时截断，22.5 MB；解压：`gunzip -k work.json.gz`） |
| `s-design2.png` / `s-design8.png` | 设计页顶部/布局 |
| `s-dbg2.png` | 设计页数据结构表 |
| `s-dbg4.png` | 调试页 Body |
| `v-header.png` | 调试页 Header 表 |
| `v-cookie.png` | 调试页认证（类型下拉） |
| `v-pre.png` / `v-post.png` | 预执行/后执行“添加操作项” |
| `s-debug.png` / `s-open.png` | 首次窗口与加载态 |
| `uia-tree.txt` | Windows UIA 树（Electron 仅 3 节点，参考价值低） |

> 截图已统一裁掉底部 34px 状态栏，以移除 Apipost 软件序列号/授权信息；不影响设计/调试内容。

---

### 附：本次分析未覆盖/待补

- 设计页响应契约完整截图；
- 调试页 Query/Path/Cookie 表头细节；
- Body 各类型（form-data/urlencoded/binary/msgpack）的真实表头；
- 认证各类型的字段布局；
- 预执行/后执行“添加操作项”展开后的完整菜单；
- 分享、版本对比、历史对比、接口状态管理、标签管理。
