# LMD

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

- Webview 资源：`dist/`
- VSCode 扩展入口：`out/extension.cjs`

### 插件调试

推荐在 VSCode 里以“扩展开发宿主”方式启动当前仓库：

- 打开本仓库
- 运行 `pnpm run build:vscode`
- 在 VSCode 中按 `F5`
- 新建或打开 `*.lmd` 文件

### 插件热更新开发

如果你想要更接近浏览器的热更新体验，不要先跑 `build:vscode`，而是直接用开发模式：

```bash
pnpm install
pnpm run dev:vscode
```

然后在 VSCode 里直接启动仓库自带的调试配置 `Run LMD_EDITER`。

这套模式下：

- React / CSS / 画布 UI 走 Vite dev server，支持接近浏览器的热更新
- Webview 前端改动基本会即时刷新
- 扩展宿主代码会自动 watch 编译

需要注意：

- Webview UI 可以做到接近浏览器 HMR
- `extension.cts` 这类 VSCode 扩展宿主代码改动后，通常仍需要重新启动扩展宿主，不能像纯浏览器页面那样完全无感热替换

### 当前插件版保留的核心能力

- 画布编辑
- 节点 / 连线 / 分组 / 附加信息
- 整理 / 布局 / 标准化
- 图谱树与导航图
- 属性栏编辑
- 导出当前画布图片

## LMD 格式解释器

协议内核在 **`lmd-kernel/`**（`@lths/lmd`）。编辑器在 **`src/lmd/`**，按 DDD 分层（`domain` / `application` / `infrastructure` / `presentation`）：

- 格式 API：`openLmd` / `printLmd` / `printMermaid`；旧 Markdown+Mermaid 打开即迁移
- 画布：`src/lmd/presentation/canvas/`
- 文档用例：`src/lmd/application/editing/`

入口：`import { ... } from './src/lmd'`（应用内 `from './lmd'`）。说明见 `src/lmd/README.md`、`lmd-kernel/ARCHITECTURE.md` 与 `skills/lmd-protocol/`。

## 本地开发

```bash
pnpm install
pnpm dev
```

默认开发地址：

- `http://127.0.0.1:5280/`

## 生产构建

```bash
pnpm build
```

构建产物位于 `dist/`。

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
