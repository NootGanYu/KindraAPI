# 03: 三按钮下载与 ZIP

**What to build:** 分享页顶部三个下载按钮（全部 ZIP / 当前文件夹 ZIP / 当前接口 HTML），并自实现无依赖 ZIP。

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] 新增 `src/main/docs/zip.ts`：STORE 压缩、CRC32、UTF-8 文件名 flag、中央目录与 EOCD
- [ ] `GET /share/:id/download?scope=all&format=zip` 返回整份 ZIP
- [ ] `GET /share/:id/f/:folderId/download?format=zip` 返回该文件夹 ZIP
- [ ] `GET /share/:id/a/:apiId/download?format=html|md` 返回单接口文件
- [ ] 保留旧 `/download?format=md|html|openapi`，数据源改为实时解析
- [ ] ZIP 结构：`<分享名>/index.html`、文件夹目录 + `index.html`、接口 `<接口名>.html`
- [ ] 下载内容遵守密码与字段开关；用例不含 `last_run`
- [ ] 离线 HTML 移除三个下载按钮，显示生成时间与来源标识
- [ ] 文件名/目录名清洗：非法字符、保留名、重名追加序号
- [ ] 三按钮按页面置灰（首页只启用“全部”，文件夹页前两个，接口页三个）
- [ ] typecheck 通过；smoke 用 `unzip -l` 校验 ZIP 条目，覆盖密码错误与置灰文案
