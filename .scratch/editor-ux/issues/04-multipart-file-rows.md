# 04: multipart 文件行与 binary 选择器

**What to build:** formdata 的 text/file 类型、文件选择、多选多行、拖拽、清除；binary 复用选择器。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] formdata 模式下 ParamTable 增加类型列 text/file
- [ ] file 行显示文件名 + 大小，提供选择/清除
- [ ] 选择多个文件时按当前 key 追加多行
- [ ] 拖拽文件到行：填入或追加
- [ ] `field_type='file'`，值存绝对路径；executor 行为不变
- [ ] binary body 使用同一选择器写 `file_path`/`file_name`
- [ ] 仅 formdata 显示类型列
- [ ] 分享页只显示文件名
- [ ] typecheck 通过；ui-smoke 覆盖选择、多选、拖拽、清除与发送
