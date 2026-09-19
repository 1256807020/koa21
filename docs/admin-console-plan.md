# 新后台（Console）实施计划

> 目标：**彻底替换 7-8 年前的 Ace Admin 老后台**，用 Skotwind（纯 HTML + Tailwind v4）重做，
> 服务端渲染、无 SPA、前后台同一套模板心智。
>
> 制定：2026-09-19 · 状态：**后端接口已补齐，后台开发未开始**

---

## 0. 技术选型（已拍板）

| 层 | 选型 | 说明 |
|---|---|---|
| 渲染 | **Liquid**（LiquidJS） | 前后台统一；语法与 DedeCMS / WordPress / Shopify 心智接近 |
| 样式 | **Skotwind 的 CSS（Tailwind v4）** | 纯 HTML + Tailwind 的后台 Dashboard 模板 |
| 富文本 | **wangEditor v5**（国产，自带完整中文工具栏） | 替换 ueditor（270 个文件） |
| 交互 | **约 30 行原生 JS**（fetch + 局部替换） | 不引入 htmx / Vue；避免版本风险 |
| 数据 | **`/api/v1/admin/*`** | 已全资源覆盖（见 §1） |
| 上传 | **`POST /api/v1/admin/upload`** | 复用已加固的 `tools.multer` 白名单 |

**不采用**：Vue3（Vu3Admin01）、htmx、SPA 方案。

### 关于 Skotwind

`E:\360Data\skotwind-tailwind-dashboard`（作者 unifato）：
- **纯 HTML + Tailwind v4**，30 个页面 + 9 个 partials
- 用 Handlebars 的 `{{> partial }}` 做**构建期拼装**（不是运行时数据渲染）
- ⚠️ 它是 **Dashboard（后台）**，不是官网模板 —— **不能用于前台**
- 依赖较重（ApexCharts / DataTables / FullCalendar / Quill 1.3.7 / jQuery…），需按需裁剪
- 自带 Quill 1.3.7 太老，**富文本改用 wangEditor v5**（曾试点 TipTap v2，但其为 headless 编辑器、工具栏与样式需自研，观感不佳，已替换）

**真正只需要 9 个文件**：
`partials/{main, head-css, sidenav, topbar, page-title, footer-scripts}.html` +
`index.html` + `tables-basic.html`（列表）+ `forms-layout.html`（表单）。
其余 20+ 个 `ui-*.html` 是组件演示，留作"组件参考库"按需取用。

---

## 1. 后端接口现状：**已全资源覆盖**（2026-09-19 补齐）

### 资源驱动 CRUD（7 个资源全覆盖）

`GET /api/v1/admin/:resource/list` · `:id` 详情 · `add` · `:id/edit` · `:id/delete`

| 资源 | 说明 |
|---|---|
| `manage` | 管理员（含角色分配） |
| `article` | 文章（含封面图 / SEO 字段 / 推荐位 / 排序） |
| `articlecate` | 分类（**删除带孤儿保护**：有子分类或文章时拒绝） |
| `nav` | 导航 |
| `focus` | 轮播 |
| `link` | 友链 |
| `setting` | 站点设置（**单行表**：仅 list / edit，新增删除显式拒绝） |

### 其他已就绪接口

| 接口 | 说明 |
|---|---|
| `POST /api/v1/admin/upload` | 图片上传（multipart，字段 `file` + `_csrf`；仅图片，扩展名+MIME 双校验） |
| `GET /api/v1/admin/rbac/me` | 当前用户 + 权限点 |
| `GET /api/v1/admin/rbac/roles` / `permissions` | 角色与权限点 |
| `POST /api/v1/admin/rbac/roles/:roleId/permissions` | 覆盖式授权 |
| `GET /api/v1/admin/audit/list` | 审计日志 |
| `GET /api/v1/admin/stats/*` | 统计报表 + EXPLAIN |
| `GET /api/v1/csrf-token` | 签发 CSRF token |

### 权限点（34 个，已全部定义）

`manage:*` `article:*` `articlecate:*` `nav:*` `focus:*` `link:*` `setting:list/update`
`upload:create` `role:*` `role:assign` `audit:list` `stats:view`

### 调用约定

- 响应统一 `{ code, message, data }`，`code=0` 为成功
- 写请求必须带 `X-CSRF-Token` 头（值 = 可读 Cookie `csrfToken`）
- 未登录 `401`，无权限 `403`，参数错误 `400`
- 登录：SSR 版 `/admin/login/doLogin`（带验证码）；JSON API 版 `/api/v1/admin/login`

---

## 2. 目录规划（**新旧并存，随时可回退**）

```
views/
├── admin/          ← 老后台（Ace Admin，29 个模板）—— 保留，验证通过后再删
├── console/        ← 【新后台】Skotwind 转 Liquid
│   ├── layout.liquid
│   ├── partials/   ← sidenav / topbar / head-css / page-title / footer-scripts
│   ├── pages/      ← dashboard / article/list / article/form / ...
│   └── snippets/   ← 局部片段（列表行，供 fetch 局部替换）
└── themes/         ← 前台主题（不动）

public/
├── console/        ← 【新后台】CSS / JS（Tailwind v4 构建产物 + app.js）
├── admin/          ← 老后台资源（待删，103 个）
└── upload/         ← 用户上传（**永不删**）
```

**渲染引擎共存**：art-template（老模板 `.html`）与 LiquidJS（新模板 `.liquid`）按扩展名自动选择，
因此新后台可以直接用 Liquid，老后台零改动。

---

## 3. 实施阶段

| 阶段 | 内容 | 产出 |
|---|---|---|
| **0 ✅** | 后端接口补齐（7 资源 + 上传 + schema 补全） | API 全资源覆盖，22/22 验证通过 |
| **1** | 引入 LiquidJS + 双引擎渲染；Tailwind v4 构建流程 | 渲染底座 |
| **2** | Skotwind 9 个文件 → Liquid（布局/侧栏/顶栏） | 后台外壳 |
| **3** | 文章模块（列表 + 表单 + wangEditor + 上传） | **第一个可用模块** |
| **4** | 分类 / 导航 / 轮播 / 友链 / 设置 / 管理员 | 后台完整 |
| **5** | 验证通过 → 删 `views/admin/` + `public/admin/` + `public/ueditor/`（**400+ 文件**） | 彻底甩掉包袱 |

**阶段 3 做完就能用**，后续模块逐个加，随时可停。

---

## 4. 交互实现（约 30 行，不用框架）

```js
// public/console/app.js 核心
async function api (path, opts) {        // 统一 {code,message,data} + CSRF + 401 跳转 + toast
  const res = await fetch(path, { headers: { 'X-CSRF-Token': getCsrf() }, ...opts })
  const json = await res.json()
  if (json.code !== 0) { toast(json.message); throw new Error(json.message) }
  return json.data
}
async function loadList (url) {          // 局部替换：服务端返回 HTML 片段
  const html = await (await fetch(url)).text()
  document.querySelector('#list').innerHTML = html
}
document.addEventListener('click', e => { /* 分页 / 删除确认（事件委托） */ })
```

**要点**：重渲染后用**事件委托**（绑在不会被替换的父元素上），否则事件会丢。

---

## 5. 待确认

| # | 事项 |
|---|---|
| 1 | Tailwind 在 koa21 装（统一构建）还是在 Skotwind 侧构建后拷贝？ |
| 2 | Skotwind 依赖裁剪到什么程度（最小：布局+表格+表单+图标）？ |
| 3 | 后台登录是否保留验证码？ |
| 4 | 前台最终方案（用户自拟，暂不动） |
