# 11: MySQL 表结构导入为模型

**What to build:** 用户选择 MySQL 连接后读取表清单，勾选要导入的表、选择目标模型目录，并按更新/跳过/副本策略把每张表转换为一个可编辑的数据模型；导入保留表注释、列注释、可空性与默认值，并完成 MySQL 类型到 schema 类型的映射。

**Blocked by:** 05, 06, 10

**Status:** ready-for-agent

- [ ] 导入向导可以选择连接并读取表清单
- [ ] 支持勾选表、全选与选择目标模型目录
- [ ] 同名模型支持更新、跳过、副本三种策略，并可应用到全部表
- [ ] 每张表生成一个模型，表名作为模型名，表注释作为模型描述
- [ ] 列注释作为字段描述，`IS_NULLABLE` 决定是否必填，列默认值写入 `default`
- [ ] `tinyint(1)` 映射 boolean；整数映射 integer；decimal/float/double 映射 number；日期/字符串/enum/set 映射 string；json 映射 object；binary/blob 映射 string
- [ ] `bigint` 映射 integer 并给出精度风险提示
- [ ] 导入后的模型可继续用可视化或 Raw 编辑
- [ ] 表清单为空、目录不存在、连接失败等边界返回明确错误
- [ ] smoke 使用本机临时 MySQL 覆盖表读取、类型映射与三种同名策略
- [ ] UI 自动化覆盖导入向导、勾选表与同名策略
- [ ] typecheck 与 build 通过
