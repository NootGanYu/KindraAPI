# 交互流：git-dialog-remotes

- 路由：`/git`
- 类型：dialog
- 视口：1180×760
- 说明：—
- 所属页面：[pages/git.md](../pages/git.md)

![git-dialog-remotes](../screenshots/webp/git-dialog-remotes.webp)

## 可见控件

| 区块 | 文案 / aria / icon | 类型 | 状态 | 选择器 |
| --- | --- | --- | --- | --- |
| modal:远程仓库 | Close | `button` | — | `div.ant-modal-root.css-dzyqf7 > div.ant-modal-wrap:nth-of-type(2) > div.ant-modal.css-dzyqf7 > div:nth-of-type(1) > div.ant-modal-content > button.ant-modal-close` |
| modal:远程仓库 | 关闭 | `span` | — | `div.ant-modal-wrap:nth-of-type(2) > div.ant-modal.css-dzyqf7 > div:nth-of-type(1) > div.ant-modal-content > button.ant-modal-close > span.ant-modal-close-x` |
| modal:远程仓库 | 远程仓库 | `div` | — | `div#:ruo:` |
| modal:远程仓库 | 尚未配置远程仓库 支持 HTTPS / SSH 地址。认证由系统 git credential helper 处理，KindraAPI 不保存密码或私钥。 | `div/alert` | — | `div.ant-modal-wrap:nth-of-type(2) > div.ant-modal.css-dzyqf7 > div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.ant-alert.ant-alert-info:nth-of-type(1)` |
| modal:远程仓库 | 名称（如 origin） | `input` | — | `div.ant-modal.css-dzyqf7 > div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.git-remote-add:nth-of-type(4) > input.ant-input.css-dzyqf7:nth-of-type(1)` |
| modal:远程仓库 | 仓库地址 | `input` | — | `div.ant-modal.css-dzyqf7 > div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.git-remote-add:nth-of-type(4) > input.ant-input.css-dzyqf7:nth-of-type(2)` |
| modal:远程仓库 | 添 加 | `button` | — | `div.ant-modal.css-dzyqf7 > div:nth-of-type(1) > div.ant-modal-content > div.ant-modal-body:nth-of-type(2) > div.git-remote-add:nth-of-type(4) > button.ant-btn.css-dzyqf7` |

## 提示文案

**警告**

- 尚未配置远程仓库 支持 HTTPS / SSH 地址。认证由系统 git credential helper 处理，KindraAPI 不保存密码或私钥。

## 相关源码

- `src/renderer/src/pages/GitPage.tsx`：24 条提示
- `src/renderer/src/pages/GitPage.tsx`：6 个菜单项
- `src/renderer/src/pages/GitPage.tsx`：22 个 IPC 调用

> 返回 [交互流索引](README.md)
