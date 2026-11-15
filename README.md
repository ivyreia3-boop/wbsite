# Your Space — GitHub 网页起始框架

一个原生 HTML / CSS / JavaScript 的响应式单页网站模板，无需安装依赖，适合个人主页、项目介绍、团队网站或作品展示。

## 本地打开

直接双击 `index.html`；或在本目录使用：

```bash
python3 -m http.server 8000
```

然后访问 http://localhost:8000。

## 文件说明

- `index.html`：页面内容与结构。修改站点名称、文字、链接、模块。
- `styles.css`：配色、排版、响应式设计。顶部 `:root` 中可修改主题色。
- `script.js`：手机导航、深浅色主题切换与页脚年份。

## 发布到 GitHub Pages

1. 在 GitHub 创建一个仓库（如 `my-website`），上传本目录全部文件到默认分支根目录。
2. 进入仓库 `Settings` → `Pages` → `Build and deployment`。
3. 将 `Source` 设为 **Deploy from a branch**，`Branch` 选 **main** 和 **/(root)**，保存。
4. 稍后在 Pages 设置页查看发布链接，通常是 `https://<用户名>.github.io/<仓库名>/`。

> GitHub Pages 的发布选项可能随账号或仓库设置变化；如果仓库为 Private，先确认你的账号计划支持相应 Pages 设置。

## 邀请协作者编辑

1. 仓库主页 → `Settings` → `Collaborators`（或 `Collaborators and teams`）。
2. 点击 `Add people`，搜索对方的 **GitHub 用户名**，发送邀请。
3. 被邀请人接受后可以协作。注意：该角色通常拥有写入仓库的权限；不要邀请不认识的人。

## 后续可扩展

- 替换占位内容和链接、加入真实照片或 Logo。
- 根据项目需要新建页面、表单或组件。
- 团队使用 GitHub Issues 和 Pull Requests 管理修改。
