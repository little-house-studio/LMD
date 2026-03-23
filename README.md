# LTHS_MD

Mermaid 空间编辑协作平台前端原型。

## LMD_EDITER VSCode 插件版

当前仓库已经内置一个 VSCode 插件壳 `LMD_EDITER`。

- 面向 `*.lmd` 文件
- 默认用画布视图打开
- 顶部 `源码` 按键会回到 VSCode 自带文本编辑器
- 插件版会裁掉 AI、云端、协作、文件管理、历史和内置源码编辑界面

### 构建插件版

```bash
pnpm install
pnpm run build:vscode
```

构建完成后会得到：

- Webview 资源：[dist](/Users/mac/Documents/vscodeProject/LTHS_MD/dist)
- VSCode 扩展入口：[out/extension.cjs](/Users/mac/Documents/vscodeProject/LTHS_MD/out/extension.cjs)

### 插件调试

推荐在 VSCode 里以“扩展开发宿主”方式启动当前仓库：

- 打开本仓库
- 运行 `pnpm run build:vscode`
- 在 VSCode 中按 `F5`
- 新建或打开 `*.lmd` 文件

### 当前插件版保留的核心能力

- 画布编辑
- 节点 / 连线 / 分组 / 附加信息
- 整理 / 布局 / 标准化
- 图谱树与导航图
- 属性栏编辑
- 导出当前画布图片

## 本地开发

```bash
pnpm install
pnpm dev
```

默认开发地址：

- `http://127.0.0.1:5173/`

## 生产构建

```bash
pnpm build
```

构建产物位于 [dist](/Users/mac/Documents/vscodeProject/LTHS_MD/dist)。

## RK3366 ARM 开发板部署建议

这套前端应按“静态站点 + 轻量文件服务”部署，不要在 RK3366 上跑开发服务器，也不要把 Mermaid 渲染、布局计算、预览生成放到服务端。

推荐原则：

- 在性能更强的机器上执行 `pnpm build`
- 只把 `dist` 上传到 RK3366
- 用 `nginx` 或其他轻量静态服务器直接托管
- RK3366 只负责：
  - 静态文件分发
  - 鉴权反向代理
  - 文件存储与协同接口
- 浏览器端负责：
  - 画布渲染
  - Mermaid 解析与预览
  - 拖拽与缩放
  - 本地缓存与视口状态

不推荐：

- 在 RK3366 上长期运行 `vite dev`
- 在 RK3366 上用 `vite preview` 作为正式服务
- 在 RK3366 上做服务端图片导出或大规模 Mermaid 批量渲染

## nginx 部署示例

构建产物使用相对资源路径，可部署在站点根路径，也可挂在任意子目录。

```nginx
server {
  listen 80;
  server_name _;

  root /srv/www;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~* \.(js|css|svg|png|jpg|jpeg|webp|woff2?)$ {
    expires 7d;
    add_header Cache-Control "public, max-age=604800, immutable";
  }

  gzip on;
  gzip_types text/css application/javascript image/svg+xml application/json;
}
```

建议目录：

- `/srv/www/index.html`
- `/srv/www/assets/...`

## 当前已做的低性能优化

- Mermaid 预览按需动态加载，不阻塞首屏
- 安卓竖屏采用独立移动工作台，减少常驻 UI
- 低性能设备会自动关闭部分阴影、模糊和过渡
- 本地缓存写入已节流，降低弱设备 IO 频率
- 生产构建关闭 sourcemap，减小部署负担
