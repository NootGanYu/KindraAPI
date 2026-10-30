# 02: 分页分享路由

**What to build:** 分享页从单页锚点导航改为项目首页/文件夹页/接口页三段式服务端路由。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `GET /share/:id` 渲染项目首页：目录树 + 根层级内容
- [ ] `GET /share/:id/f/:folderId` 渲染文件夹页：文件夹说明 + 子项列表
- [ ] `GET /share/:id/a/:apiId` 渲染接口页：请求/响应/脚本/设计/用例分区
- [ ] 旧 `/share/:id` 链接保持可用
- [ ] 导航改为普通链接，展开状态用 `<details>`；当前页高亮
- [ ] 密码 cookie、IP 限流、CSP、安全头对全部新路由生效
- [ ] 非法 id、越权 id（不在解析结果内）返回 404 而非泄漏内容
- [ ] 面包屑：项目 / 分享名 / 文件夹... / 接口
- [ ] typecheck 通过；smoke 覆盖三种页面与 404
