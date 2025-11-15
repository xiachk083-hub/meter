# 计时计费工具

一个基于 Node.js + Express 的计时计费 Web 应用，前端为无打包的 React UMD + Chart.js。支持在 Vercel 部署（Serverless），并提供 PWA 安装与 Android APK 打包方案。

## 目录结构
- 根目录
  - `index.html` 前端入口（同时提供 PWA 注册）
  - `api/index.js` Serverless 函数入口，直接导出 Express `app`
  - `src/app.js` Express 应用（全部路由、静态资源、SPA 回退）
  - `src/server.js` 本地开发监听入口
  - `src/db.js` 数据层（本地文件或 KV）
  - `public/` PWA 资源（`manifest.json`、`sw.js`、占位 `index.html`）
  - `capacitor.config.json` Capacitor 配置（`webDir: public`、`server.url` 指向线上）
  - `.github/workflows/build-apk.yml` GitHub Actions 构建 Android APK

## 快速开始
### 本地运行
1. 安装依赖
   - `npm install`
2. 启动后端
   - `node src/server.js`
3. 打开浏览器
   - `http://localhost:3000/`

### Vercel 部署
- 根 `api/index.js` 作为函数入口，`index.html` 作为静态首页
- 路由重写
  - `/api/*` → 函数 `api/index.js`
  - `/(.*)` → `index.html`
- 环境变量（在项目设置中配置）
  - `APP_SECRET` 或 `SESSION_SECRET` 或 `SECRET`：用于 Cookie 签名；设置固定值可保持登录状态一致
  - `KV_REST_API_URL`、`KV_REST_API_TOKEN`：如启用 Vercel KV，实现云端持久化（不配置则使用临时文件存储）

## 前端功能
- 登录/注册（Cookie）
- 分类与账号管理（创建、选择）
- 计时控制：开始、暂停、继续、结束（结束弹出汇报）
- 统计视图：趋势、分布、占比
- 数据管理：批量修改/删除、导出 CSV/Excel/JSON、导入 JSON
- PWA：可“添加到主屏幕”在手机上作为应用使用

## 后端 API（简要）
- 认证：`POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`
- 分类与账号：`POST /api/categories`、`GET /api/categories`、`POST /api/accounts`、`GET /api/accounts?categoryId=...`
- 会话：`POST /api/sessions/start|pause|resume|stop`、`GET /api/sessions/:id/status`
- 统计：`GET /api/stats/summary|series|distribution|pie`
- 导出/导入：`GET /api/export?format=json|csv|xlsx`、`POST /api/import`
- 批量操作：`POST /api/sessions/batch/update|delete`（兼容 `PATCH/DELETE`）

## 数据存储
- 默认：Serverless 环境使用临时目录 `/tmp/data`
- KV：设置 `KV_REST_API_URL` 与 `KV_REST_API_TOKEN` 后切换到云端持久化
- 密钥读取：优先使用环境变量 `APP_SECRET|SESSION_SECRET|SECRET`，否则本地 `secret.json`

## PWA 安装
- 打开线上地址（如 `https://traemeterxj8o.vercel.app/`）
- 使用浏览器菜单选择“添加到主屏幕”/“安装应用”

## Android APK 打包
### 通过 GitHub Actions（推荐）
- 工作流：`.github/workflows/build-apk.yml`
- 触发：推送到 `main` 或手动触发
- 输出：在运行详情的 Artifacts 下载 `app-debug.apk`
- 要点：
  - 使用 Node 20、Java 21、Gradle 8.11.1
  - 显式安装 `@capacitor/cli` 与 `@capacitor/android`
  - 使用本地 CLI（`node node_modules/@capacitor/cli/bin/capacitor ...`）避免权限问题
  - `capacitor.config.json` 的 `webDir` 配置为 `public`，避免自拷贝错误

### 本地构建（可选）
- 安装环境：Android Studio（含 SDK）、Java 21、Node 20
- 初始化原生工程：
  - `npm install`
  - `npx cap add android`
  - `npx cap sync android`
- 构建：
  - Android Studio → Build APK(s)
  - 或命令行 `cd android && ./gradlew assembleDebug`
- APK 路径：`android/app/build/outputs/apk/debug/app-debug.apk`

## 常见问题排查
- 404/Not Found：检查 Vercel 路由重写是否正确指向函数与首页；等待部署完成后刷新
- 登录状态丢失：在 Vercel 环境变量设置固定密钥 `APP_SECRET`（或 `SESSION_SECRET|SECRET`）
- `invalid source release: 21`：Runner 使用 JDK 17；将 Actions 的 `setup-java` 改为 `java-version: '21'`
- Capacitor `add android` 自拷贝错误：将 `capacitor.config.json` 的 `webDir` 改为 `public`
- 前端 `map is not a function`：接口返回非数组时已做空数组回退；登录后重试分类/账号加载

## 许可
- 仅供个人使用；如需开源协议请在此处补充说明。