# 唐悠悠的成长记录（静态网页）

## 本地预览

1. 生成内容（会从 `baby/` 扫描素材并生成 `content.json` + `letters/*.html`）：
   - `npm run generate`
2. 启动本地静态服务器：
   - `npm run serve`
3. 打开：
   - `http://localhost:5173`

> 注意：不要用 `file://` 直接打开 `index.html`，浏览器可能会拦截 `fetch` 加载 `content.json`。
>
> 如果你是在 Codex 这类受限环境里运行，可能会遇到端口绑定权限问题；这种情况下请在你自己的系统终端里运行上述命令预览。

## 更新素材

- 按模块把新图片/视频/信件放进 `baby/` 对应文件夹
- 重新运行：`npm run generate`
