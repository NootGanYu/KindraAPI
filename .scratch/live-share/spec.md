# 实时分享与下载 Spec

Status: ready-for-agent
Date: 2026-10-30
Feature: live-share

## Problem Statement

当前 DocShare 在创建时冻结一份 `snapshot`，分享页服务端模板直接渲染该快照。接口保存后分享不会更新，新增接口也不会进入已有分享；用户必须重新编辑分享。分享页是单页锚点导航，只能整份导出 md/html/openapi，无法下载某个文件夹或单个接口；文件夹虽有 `description` 字段，但没有编辑入口，分享页也不展示。

本 spec 把分享改为**服务端实时渲染**，增加分页路由、三按钮下载、文件夹说明与新显示开关，并保持现有密码、有效期、局域网访问模型不变。

## Solution

- 分享页每次请求从本地存储实时解析范围并渲染，`snapshot` 仅保留作兼容/历史导出，不再驱动页面。
- 分享页改为分页：项目首页、文件夹页、接口页。
- 每页顶部并列三个下载按钮：下载全部（ZIP）、下载当前文件夹（ZIP）、下载当前接口（HTML）；按页面置灰。
- 文件夹说明复用接口说明的富文本编辑器，侧边栏右键编辑，分享页导航与文件夹页展示。
- 分享设置新增 `show_design`、`show_cases` 两个开关（默认开启），供后续设计/用例模块使用。
- 自实现最小 ZIP（STORE 不压缩，无新依赖）。

## User Stories

1. 作为用户，我在本地保存接口后，刷新分享链接即可看到最新内容。
2. 作为用户，我给文件夹范围创建的分享，之后在该文件夹新增接口，刷新后自动出现。
3. 作为用户，我移动接口到分享范围内的文件夹后，它自动出现在分享中；移出后自动消失。
4. 作为用户，自定义范围分享固定我勾选的接口，但内容随保存实时更新；被删除的接口自动从页面移除。
5. 作为用户，单接口分享的接口被删除后，打开链接看到明确的 404。
6. 作为用户，我可以直接把链接发到某个接口页，对方打开即定位到该接口。
7. 作为用户，我可以在分享页一键下载整份文档 ZIP、当前文件夹 ZIP、当前接口 HTML。
8. 作为用户，我下载的 ZIP 保留目录层级，并包含每个文件夹的说明页与每个接口页。
9. 作为用户，我下载的单接口 HTML 是离线可读的静态页，不依赖分享服务。
10. 作为用户，我给文件夹写富文本说明，并在分享页导航与文件夹页看到它。
11. 作为用户，我可以在分享设置里独立开关“设计”和“用例”分区。
12. 作为用户，我升级后已有分享自动变成实时内容，不需要重新创建。

## Implementation Decisions

### 范围解析

新增 `resolveShareTargets(projectId, share): ResolvedShare`：

- `project`：项目内全部 target（含文件夹与接口）。
- `folder`：`target_ids[0]` 指向的文件夹及其全部后代；文件夹本身作为根渲染。文件夹被删除时返回 404。
- `api`：`target_ids[0]` 指向的接口；不存在或类型不符返回 404。
- `custom`：固定 `target_ids` 中仍存在的 target；按父子关系重建森林，父不在集合中的挂到根。

`custom` 的成员集合固定，但每个 target 的内容每次请求实时读取。

### 渲染与路由

- `GET /share/:id`：项目首页（nav + 目录树 + 根层级接口摘要）。
- `GET /share/:id/f/:folderId`：文件夹页（文件夹说明 + 子文件夹/接口列表）。
- `GET /share/:id/a/:apiId`：接口页（请求/响应/脚本/设计/用例分区）。
- 旧链接 `/share/:id` 保持可用。
- 密码会话 cookie、IP 限流、CSP 对分页路由同样生效。
- 页面“最后更新”取范围内 target 的最大 `updated_at`，无 target 时回退 `share.updated_at`。
- 分享列表的 `target_count` 与类型标签改为实时计算。

### 字段开关

- 现有 `show_request / show_body / show_response / show_headers / show_scripts` 继续生效。
- 新增 `show_design / show_cases`，默认 `true`；在 `DocSettings`、`DocShareDialog` 中增加勾选项。
- 文件夹说明不受开关控制，始终展示（属于目录信息）。

### 下载

新增路由，保留旧 `/download?format=md|html|openapi` 行为：

- `GET /share/:id/download?scope=all&format=zip`：整份 ZIP。
- `GET /share/:id/f/:folderId/download?format=zip`：当前文件夹 ZIP。
- `GET /share/:id/a/:apiId/download?format=html|md`：单接口。
- 下载内容按请求时实时数据生成，与在线页一致，遵守密码与字段开关；用例只含断言描述，不含 `last_run`。
- ZIP 结构：`<分享名>/index.html`、每个文件夹一个目录含 `index.html`、每个接口一个 `<接口名>.html`。
- 离线产物移除三个下载按钮，替换为生成时间与来源标识。
- 文件名与目录名做安全清洗（非法字符、保留名、重名追加序号）。
- 自实现 `src/main/docs/zip.ts`：本地文件头、中央目录、EOCD，STORE（method 0），UTF-8 flag；CRC32 自行实现或使用 `zlib.crc32`（Node 22 可用）。

### 三按钮启用规则

- 首页：下载全部可用；当前文件夹、当前接口置灰并带 tooltip。
- 文件夹页：全部、当前文件夹可用；当前接口置灰。
- 接口页：三个都可用。

### 文件夹说明

- `TargetSummary` 增加 `description?: string`，供侧边栏与编辑入口使用。
- 侧边栏文件夹右键菜单增加「编辑说明」，复用 `ApiDescriptionDialog` 的富文本编辑与 `sanitizeRichHtml`。
- 分享页导航项下方展示说明摘要；文件夹页正文展示完整富文本。
- 应用内不做悬停预览。

### 存量迁移

- 所有既有分享自动转为实时渲染，无需手动操作。
- `DocShare.snapshot` 类型保留并在创建/更新时继续写入（作为历史备份与旧版兼容），但所有页面与下载不再读取它。
- 旧的 `GET /share/:id/download?format=...` 仍可用，但数据来源改为实时解析。

## Testing Decisions

- 单元：范围解析（project/folder/api/custom、删除 target、父子重建）、ZIP 字节结构（用系统 `unzip -l` 校验）、文件名清洗、页码路由参数校验。
- 集成（smoke）：创建分享 → 修改接口 → 请求页面断言新内容；文件夹新增接口 → 断言出现；删除接口 → 断言 404/移除；下载 ZIP 并校验条目；密码错误拒绝；三个按钮的置灰状态。
- 分享页无前端 JS 的假设保持不变；分页导航为服务端生成的普通链接。

## Out of Scope

- 公网隧道/固定域名。
- 分享页自动刷新或推送（需用户手动刷新浏览器）。
- 分享权限矩阵、访问日志、水印。

## Further Notes

- 渲染在 main 进程内同步完成；每次请求读取 store，注意不要在请求路径缓存。
- 现有 `snapshot` 相关渲染函数（`renderNav`/`renderDocPage`/`renderApi`/`buildMarkdown`/`buildOpenApi`）需改为接收 `ResolvedShare`。
