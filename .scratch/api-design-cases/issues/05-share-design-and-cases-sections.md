# 05: 分享页设计与用例分区

**What to build:** 接口页展示设计与用例，受 show_design/show_cases 控制。

**Blocked by:** live-share 01, 02, 04；本 feature 01

**Status:** ready-for-agent

- [ ] 接口页增加「设计」分区：说明、请求/响应结构、错误码表
- [ ] 请求/响应分别受 show_request/show_response 控制；错误码表随设计分区
- [ ] 接口页增加「用例」分区：名称、说明、断言描述
- [ ] 不展示用例的请求覆盖敏感值，不展示 `last_run`
- [ ] `show_design/show_cases` 关闭时整段不输出
- [ ] 下载的 HTML/ZIP 与在线页一致
- [ ] typecheck 通过；smoke 覆盖开关与字段内容
