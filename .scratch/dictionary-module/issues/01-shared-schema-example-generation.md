# 01: 统一模型示例生成（预重构）

**What to build:** 把现有 schema → 示例 JSON 的生成逻辑收敛为主进程共享能力，让后续模型预览、API 引用与 MCP 使用同一套取值优先级、深度保护与循环处理；现有 MCP 的既有行为保持不变，并有 smoke 覆盖。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 主进程提供共享的 schema 示例生成能力，MCP 现有 schema 示例行为不回退
- [x] 生成优先级为 `example` → `default` → `enum[0]` → 类型占位
- [x] object 按 `x-schema-orders` 顺序生成，array 生成一个元素
- [x] `$ref` 递归解析，深度上限 8，循环引用返回 warning 而不是抛错
- [x] 失效引用返回 warning，并保留可继续使用的部分结果
- [x] smoke 覆盖优先级、嵌套 object/array、循环引用与失效引用
- [x] typecheck 与 build 通过

## Comments

2026-10-25 · 实现完成

- 共享生成能力落在 `src/main/schema/example.ts`，MCP 的 OpenAPI 示例生成已改为复用。
- 覆盖 example/default/enum/类型占位、x-schema-orders、数组单元素、深度 8、$ref 循环与失效引用 warning。
- smoke 新增优先级、嵌套、循环与失效引用断言。
