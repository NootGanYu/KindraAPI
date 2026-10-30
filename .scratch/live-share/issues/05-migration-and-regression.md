# 05: 分享迁移与回归验证

**What to build:** 确保存量分享自动转为实时，并完成端到端回归。

**Blocked by:** 01, 02, 03, 04

**Status:** ready-for-agent

- [ ] 读取旧 `shares.json`（含 snapshot）不报错
- [ ] 旧分享打开后按 scope 实时渲染，无需手动迁移
- [ ] 不删除、不改写既有 snapshot 字段
- [ ] 首页、文件夹页、接口页、下载、密码、过期全链路 smoke
- [ ] 修改接口 → 刷新页面内容更新；文件夹新增接口 → 出现；删除接口 → 404/移除
- [ ] 分享列表 target_count 与页面一致
- [ ] typecheck 与 smoke 全绿
