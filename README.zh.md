# dsh-link-actions

[![npm](https://img.shields.io/npm/v/dsh-link-actions.svg)](https://www.npmjs.com/package/dsh-link-actions)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | 中文

给 DSH 聊天里的链接加右键菜单。文件/目录链接多了 **打开、打开方式、在资源管理器中显示、复制路径、另存为**；HTTP(S) 链接多了 **在默认浏览器中打开、复制链接**。

![聊天里的文件链接右键菜单](docs/context-menu-zh.png)

## 为什么是插件

DSH 官方仓库目前[不接受外部 PR](https://github.com/deepseek-ai/deepseek-harness/blob/master/CONTRIBUTING.zh.md)（第 9 行），官方推荐的扩展路径是插件生态。客户端本身也没有「单个链接」级别的 slot：Markdown 链接就是一个 `<a>` 或 `<button>`，所以插件在 document 的捕获阶段监听 `contextmenu`，识别渲染器产出的两种链接形态，自己绘制菜单。

在安装版的 `0.2.1-rc.2` 运行时上验证过。需要能加载客户端插件的 DSH 构建 —— 桌面端与 `dsh web` 都满足。

## 安装

从 npm 安装：

```powershell
dsh plugin --profile desktop add dsh-link-actions
```

也可以直接从本仓库装（`lib/` 已随仓库提交，同样不需要构建）：

```powershell
dsh plugin --profile desktop add github:InnovationLou/dsh-link-actions
```

本地目录安装（改代码时用）：

```powershell
dsh plugin --profile desktop add link:E:\MyProject\dsh-link-actions
```

装完在 `~\.dsh\profiles\desktop\cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: link-actions
      name: dsh-link-actions
```

**重启客户端。** 按 `Ctrl+R` 不够：插件条目在 Host 启动时装配。

想换到别的 profile（比如 `dsh web` 用的那个），把上面两处 `desktop` 换成对应名字。

卸载：

```powershell
dsh plugin --profile desktop remove dsh-link-actions
```

再从 `cordis.patch.yml` 里删掉那三行。

## 菜单

文件、目录 —— 聊天里的文件名按钮和 `fileMention`：

| 菜单项 | 行为 |
| --- | --- |
| 打开 | 交给 Host 桌面用系统默认程序打开；目录则打开文件管理器 |
| 打开方式 › | 列出系统里已注册的关联应用，点其中一项打开 |
| 在资源管理器中显示 | 打开文件管理器并选中该文件 |
| 复制路径 | 复制解析后的绝对路径 |
| 另存为… | 读取文件字节后用「另存为」对话框写到你选的位置 |

HTTP(S) 链接 —— 消息里的普通 `<a>`：

| 菜单项 | 行为 |
| --- | --- |
| 在默认浏览器中打开 | 新窗口打开 |
| 复制链接 | 复制 href |

## 实现要点

- **路径从哪来**：渲染器给文件链接的 `title` 是完整路径（`fileMention` 由 resolver 提供，`MarkdownFileLink` 是作者写下的目标），没有 `title` 时退回按钮文本。
- **相对路径**：用当前会话（`retainedBy.mainView` 命中的那个）的 `cwd` 拼成绝对路径 —— Host 的 `openWorkspacePath` 会按 Host 进程的 cwd 解析相对路径，直接用会错。
- **动作复用既有 Remote**：`session.canOpenWorkspacePath`、`session.workspacePathApplications`、`session.openWorkspacePath`、`workspaceFiles.readBytes`，插件不带自己的传输层。
- **样式复用产品 token**：`--dsw-menu-surface-fill`、`--dsw-elevation-prominent`、`--dsw-alias-*`，跟随明暗主题。
- **零运行时依赖**：客户端半边是一段自包含 ES2022，构建只做 DSH 的 module-loader 握手（`window.__ModuleLoader__.load({ id, factory })`），没有打包器。

## 已验证

对照 npm 上同一份 client bundle，在安装版 `0.2.1-rc.2` 运行时上跑过：

| 场景 | 结果 |
| --- | --- |
| 从 npm 安装 | `dsh plugin add dsh-link-actions`（0.1.0，8 文件 / 71.5 kB），全新 profile 启动客户端后菜单正常弹出 |
| 从 GitHub 安装 | `dsh plugin add github:InnovationLou/dsh-link-actions`，全新 profile 启动客户端后菜单正常弹出 |
| 目录链接右键 | 菜单 5 项：打开 / 打开方式 / 在资源管理器中显示 / 复制路径 / 另存为 |
| 图片「打开方式」 | 列出真实关联：画图、照片、VS Code、Typora、Notepad++ … |
| 「另存为」一个 png | 提示「已保存」，文件落到下载目录，文件名保持不变 |
| HTTP(S) 链接右键 | 菜单 2 项：在默认浏览器中打开 / 复制链接 |
| 相对路径 | `ai-niang-images\fish-01-classic.png` 按会话 cwd 解析成功 |

「打开」/「在资源管理器中显示」走的是同一个 `session.openWorkspacePath` 调用（`reveal` 分支已在代码层核对），但自动化里没有真的弹出窗口。

## 已知限制

- **只作用于会话正文**：`[data-chat-flow]` 之外（侧栏、文档预览）的链接保持原生行为。
- **目录没有「打开方式」**：系统没有目录级关联，子菜单解析为空时该项会自行移除。
- **`[文字](相对路径)` 形式**：按钮里只有作者写的文字，拿不到真实路径时只提供「复制路径」。
- **另存为受 Host 读取上限约束**（`workspaceFiles` 的 `maxFileBytes`），超大文件会被拒绝；目录无法用这条路径保存。
- **应用图标可能不显示**：图标走 Host 的 `open-in-app/icon/<id>` 路由，取不到时连同占位一起移除，标签仍然对齐。
- **依赖内部接口**：`dsh.client` 声明、Remote 名称、`data-chat-flow`、CSS Module 类名中的 `fileMention`/`fileLink` 属于产品内部实现，升级 DSH 后需回归一次。

## 开发

```powershell
node scripts/build.mjs          # src/ -> lib/（client.js 做 loader 握手）
node --check lib/client.js      # 语法自检
```

`tools/` 下是本机验证用的小工具（Node 24 自带 `WebSocket`，直接连 CDP）：`cdp-contextmenu.mjs` 验证链接菜单，`cdp-file-menu.mjs` 验证文件菜单，`cdp-open-with.mjs` 看「打开方式」子菜单，`cdp-save-as.mjs` 端到端跑「另存为」，`cdp-screenshot.mjs` 截图，`asar-head.mjs` 读安装包内的 `app.asar`。

`test/overlay.yml` 是把插件临时挂进某个 CLI profile 的 patch 覆盖层：

```powershell
dsh --profile <name> --patch test/overlay.yml --no-open --port 7401
```

这样验证不会碰日常使用的 profile。

## 发布

发布走 npm 的 **Trusted Publishing**：`release` 流水线向 GitHub 申请 OIDC token，npm 用它换一张短期发布凭据，仓库里不存任何 npm token，也不需要密钥。这正是为了保住你账号上「强制 2FA、禁止 bypass token」的设置 —— 没有 token 可以绕过它。

一次性配置，在 npmjs.com → 该包 → **Settings → Trusted Publisher (GitHub Actions)**：

| 字段 | 值 |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `InnovationLou` |
| Repository | `dsh-link-actions` |
| Workflow filename | `release.yml` |
| Environment | 留空 |

之后每次发版三条命令：

```powershell
npm version patch --no-git-tag-version
git commit -am "release: v0.1.2" && git tag v0.1.2
git push origin main --follow-tags
```

推标签会触发 `release`：重建 `lib/`、与提交内容不一致就失败、然后带 provenance 证明发布。手动跑同一流水线（`workflow_dispatch`）则发布当前提交里的版本号。

`0.1.1` 就是这样发布的第一个版本：npm 为它记录了 SLSA v1 provenance 证明（[attestations](https://registry.npmjs.org/-/npm/v1/attestations/dsh-link-actions@0.1.1)），整条流水线里不存在任何 npm token。

## License

MIT
