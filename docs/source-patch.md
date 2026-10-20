# 源码级方案：消息链接的右键菜单（fork 分支）

分支：`feat/chat-link-context-menu`（`E:\MyProject\deepseek-harness`），两个提交：

```
34516e8f feat(ui-chat): open a provider-owned menu on a message link's secondary press
dec9536e feat(ui-primitives): let the Markdown owner replace a link's native context menu
```

## 为什么改渲染器

聊天里的链接只有左键：文件走 `openFile` 进右侧栏预览（目录因此打不开），HTTP(S) 走 `openExternalLink`，右键一律落到浏览器原生菜单，目录连一条通往桌面的路都没有。渲染器不该知道「打开方式」「另存为」这些业务动作，所以先加一条接缝，再把动作放进本来就是它主人的包。

## 设计

1. **`ui-primitives`：接缝**
   `MarkdownDelegate` 增加可选的 `linkMenu(target, gesture)`；`MarkdownAnchor` 与 `MarkdownFileLink` 在 `onContextMenu` 里 `preventDefault` 后交出去，目标分别是 `{kind:'url',href}` 与 `{kind:'file',path,line?}`。没有该回调时保持原生菜单，左键行为完全不变。

2. **`ui-chat`：表面**
   `ChatViewInjected.linkActions` 是数据而不是组件；`ChatView` 在光标处用 `MenuSurface` + `MenuItemButton` 渲染（portal，外部点击 / Escape / 滚动 / 失焦关闭），子菜单支持 `Promise` 行，因为原生应用发现要走一次 Host 往返。文案键 `chat.linkMenu.loading`。

3. **`ui-open-in-app`：动作**
   用与 `ui-deliverables` 提供 `chatFileMentions` 相同的模式 `ctx.provide('chatLinkActions', …)`；`ui-chat` 侧 `ctx.get('chatLinkActions')?.menu(target)`，未装配该插件时服务缺失、链接回退到浏览器菜单。
   行内容：打开 / 打开方式（异步子菜单，来自 `session.workspacePathApplications`）/ 在资源管理器中显示 / 复制路径 / 另存为（`workspaceFiles.readBytes` + File System Access picker，回退 object-URL 下载）；URL 为在默认浏览器中打开 / 复制链接。
   `workspaceFiles` 用可选读取而非 `inject`，缺它的部署只少一行，不会整个插件不激活。

## 改动清单

| 包 | 文件 |
|---|---|
| `client/ui-primitives` | `markdown/MarkdownDelegate.tsx`、`markdown/render.tsx`、`index.ts`、`tests/markdown-file-links.client.spec.tsx` |
| `client/ui-chat` | `contract/slots.ts`、`chat/ChatView.tsx`、`chat/LinkMenu.tsx`、`chat/LinkMenu.module.css`、`apply.ts`、`locale.ts`、`index.ts`、`tests/chat-view.client.spec.tsx` |
| `client/ui-open-in-app` | `link-actions.ts`、`link-save.ts`、`index.ts`、`locales.ts`、`package.json`、`tsconfig.json`、`tests/link-actions.client.spec.tsx` |

## 验证

| 检查 | 结果 |
| --- | --- |
| `tsc -b packages/client/ui-open-in-app`（连带构建 ui-chat 引用） | exit 0 |
| `vitest run packages/client/ui-primitives/tests` | 1369 passed |
| `vitest run packages/client/ui-open-in-app/tests` | 67 passed |
| `vitest run packages/client/ui-chat/tests` | 844 passed |
| oxlint（改动目录 123 文件） | 0 warning / 0 error |
| 仓库 pre-commit 钩子 | lint、whitespace、vendor manifest 全过 |

新增用例覆盖：右键把目标与坐标交给拥有方、无 `linkMenu` 时原生菜单不被吞、文件行词表（打开/打开方式/显示/复制/另存为）、URL 行词表、非 HTTP 目的不出现浏览器行、拒绝与保存失败的上报。

**尚未做**：真实客户端里的运行验证（需要 `pnpm run build:web` 后再起一个来自源码的 profile）。目前是类型 + 单测级证据，行为等价性没有截图。

## 关于 upstream

`CONTRIBUTING.zh.md` 第 9 行说明「目前无法接受外部 PR」，所以这份补丁没有按 PR 提交，它的用途是：

1. 自建客户端时直接可用（`pnpm run build` 后按 `apps/web` 起服务）；
2. 按官方建议发 GitHub Discussion 时作为可复现的实现附件；
3. 若官方后续开放外部 PR，分支已按仓库规范提交并通过本地钩子，可直接开 PR。

## 已知差距

- 失败反馈走 `console.warn`：`chatLinkActions` 是纯服务，没有自己的 React 表面，UI 侧暂无 toast 通道。理想做法是在 `ui-chat` 增加一个轻量通知槽，由菜单行上报。
- 目录仍然没有「打开方式」：系统没有目录级关联，子菜单解析为空时不展开。
- 图标未接：插件版本会请求 `open-in-app/icon/<id>`，这份源码补丁暂时只给纯文本行。
