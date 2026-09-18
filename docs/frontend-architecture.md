# 前端架构演进方案（Next.js / Nuxt 选型 · 替换范围界定）

> 目标：把当前「Koa + art-template 服务端渲染」的 CMS，演进为**可落地的 SEO 方案**，
> 并明确回答三个问题：
> 1. `public` 和 `views` 将来是否可以整目录删除？
> 2. 是否应该「Koa 只做后端服务，前端另接一套」？
> 3. 还是「现有前端不动，优先开发后端」？
>
> 本文只讲**决策与范围**，不含实现代码。事实部分均取自当前仓库（2026-09-18 状态）。

---

## 0. 结论速览（TL;DR）

| 问题 | 结论 |
| --- | --- |
| 技术选型 | **首选 Next.js（App Router）**；若你更熟 Vue 则 **Nuxt 3 完全等价可选**；只想做「前台内容站 + 后台留 Koa」则 **Astro** 是备选 |
| 架构形态 | **Koa 收敛为纯 JSON API 服务（含鉴权/上传），前端独立成一套 Next/Nuxt 工程** |
| 开发顺序 | **先补后端「公开内容 API」，现有前台不动**；再新建 Next 前台；最后迁移后台；收尾才删模板层 |
| 能否删 `views` / `public` | **不能整目录删**。必须分三层：前台层替换后可删、后台层后台迁移后才可删、`public/upload` 是用户数据**永不可直接删** |
| 现在就能删的 | `views/index.html`、`views/default/index.htm`、`public/ajax/*.html`（均已确认无引用）+ 待确认的 `views/admin/article/ueditor.html` |
| **国内 React 框架做 SEO 用哪个？** | **还是 Next.js**（React 生态做 SSR/SSG 的事实标准，国内外都一样）。国产框架的战场是「中后台研发体系」不是内容站；真要国产只有 **Modern.js 3.0** 值得一提。**详见 §10** |
| **当前最划算的 SEO 投入** | 不是换框架，而是补 **`sitemap.xml` + `robots.txt` + OG/JSON-LD**（详见 §10.5）——不依赖任何前端决策，现在就能做 |

---

## 1. 现状盘点（事实，非推测）

### 1.1 技术形态
- Koa 3 + `koa-art-template` 服务端渲染；**没有构建步骤**（`package.json` 无 `build` 脚本），前端是「静态资源 + 模板」。
- 模板过滤器注册在 `app.js` 的 `imports`；模板数据根是 `ctx.state`。
- 无 `sitemap.xml`、无 `robots.txt`、无 OG/JSON-LD（已列入 P2 待办）。

### 1.2 前台（SEO 相关）——6 个页面 + 1 个公共头
路由 `routes/index.js`：

| 路径 | 模板 | 数据来源 |
| --- | --- | --- |
| `/` | `views/default/index.html` | `focus`（轮播）、`link`（友链） |
| `/news` | `views/default/news.html` | `articlecate`（新闻二级分类）+ `article` 分页 |
| `/service` | `views/default/service.html` | `article` where pid=服务分类 |
| `/content/:id` | `views/default/content.html` | `article` 详情 + 分类→导航高亮 |
| `/case` | `views/default/case.html` | `articlecate` + `article` 分页 |
| `/about` | `views/default/about.html` | 静态 |

- 公共头：`views/default/public/header.html`
- 前台静态资源：`public/default/`（74 个文件：css/img/js）
- 富文本正文由 `{{@list.content}}` 原样渲染（**已在 P0 阶段做入库存量净化**，见 `utils/sanitize.js`）

### 1.3 后台（工具型，无 SEO 诉求）
- 路由：`routes/admin/*.js`（11 个文件，`routes/admin.js` 统一挂载 + 登录守卫）
- 模板：`views/admin/`（**31 个 html**，含 `article/ articlecate/ focus/ link/ manage/ nav/ setting/ user/ public/` + `index.html error.html login.html`）
- 静态资源：`public/admin/`（Ace Admin 1.x，103 个文件）
- 富文本编辑器：`public/ueditor/`（270 个文件）

### 1.4 已存在的 API
| 分类 | 端点 | 说明 |
| --- | --- | --- |
| 公开只读 | `/api/catelist`、`/api/newslist` | **字段极少**（newslist 只返回 `_id/title`）、`pageSize` 写死 5，不够前端用 |
| 后台 | `/api/admin/*` | 统一 `{code,message,data}` + 登录守卫 + CSRF 双提交 |
| 教学残留 | `/api/addCart`、`/api/editPeopleInfo`、`/api/deleteCart` | 与业务无关，建议删 |

### 1.5 ⚠️ 分析中发现的安全问题（务必在前后端分离前修掉）
`services/adminService.js` 的 `list()` 用 `DB.find(TABLE, where, null, ...)`——**第三个参数 `fields` 传 `null` 即 `SELECT *`，
会把 `password`（bcrypt 哈希）一起返回给接口调用方**；`getById / create / update` 同样返回含 `password` 的行。
> 现在后台是 SSR、调用方少，风险尚可控；**一旦前台/后台变成独立 SPA，返回体暴露面会显著变大**。
> 修法：给这几个方法加**字段白名单**（`_id/username/status/lasttime`），或统一用一个 `safe(row)` 过滤掉 `password`。

### 1.6 死文件（已确认无任何引用，可直接删）
- `views/index.html`、`views/default/index.htm`：内容都是 `<meta http-equiv="refresh" content="0;url=https://www.qfxlw.net">`，指向外部站点。
- `public/ajax/`（`ajax_get.html`、`ajax_jsonp.html`、`ajax_jsonp_jq.html`）：教程 AJAX/JSONP 示例，无引用。
- `views/admin/article/ueditor.html`：`routes/admin/article.js` 里对应路由**已被注释**，属疑似死文件，确认后删。

---

## 2. 选型对比

| 维度 | Next.js（App Router） | Nuxt 3 | Astro | Remix / React Router 7 | 保持 Koa+art-template |
| --- | --- | --- | --- | --- | --- |
| 渲染能力 | SSG / ISR / SSR / RSC | SSG / ISR / SSR（Nitro） | SSG 为主，可 SSR | SSR 为主 | 仅 SSR |
| CMS 内容站适配 | ★★★★★（ISR + 按需 revalidate） | ★★★★★ | ★★★★★（零 JS、内容集合） | ★★★☆（缓存需自建） | ★★（缓存需自建） |
| SEO 生态 | `metadata` API、`sitemap.ts`、`robots.ts` 官方支持 | `useSeoMeta`、模块生态 | 内建 sitemap/SEO 集成 | 需手写较多 | 全部手写 |
| 后台管理端适配 | ★★★★★（同栈复用） | ★★★★★ | ★☆（不适合交互密集后台） | ★★★★ | ★★★ |
| 学习曲线 / 生态 | React 生态最大、岗位最多 | Vue 团队上手最快 | 最简单（内容站） | 中等 | 已熟悉 |
| 与本项目契合度 | 高（已有 JSON API 底座） | 高 | 中（后台留 Koa） | 中 | 低（改造收益小） |

### 推荐结论
1. **Next.js（App Router）为首选**。理由：① 本项目是**读多写少的内容站**，`SSG + ISR + 按需 revalidate`
   是 SEO/性能最优解，Next 原生支持最成熟；② 已有 `{code,message,data}` JSON API 底座，解耦成本低；
   ③ 前台/后台同栈，可复用组件与鉴权逻辑；④ React 生态与就业面更大。
2. **Nuxt 3 与 Next 能力对标**：若你个人更熟 Vue，选 Nuxt **没有短板**，不必迁就 React。
   两条路线都满足「可落地 SEO」诉求，差别主要在你的技术舒适区与团队构成。
3. **Astro 作为「前台专用」备选**：如果你决定**后台继续用 Koa SSR、只替前台**，Astro 的
   内容站生产力与默认零 JS 是最优的，甚至比 Next 更契合纯展示型官网。但它不适合做交互密集的后台。
4. **不建议**为了 SEO 而在 Koa 上继续手写 sitemap/OG/图片优化/缓存——投入产出比低，
   且与「教科书级可落地案例」的目标相悖；它只适合当作**过渡期**的权宜之计。

---

## 3. 目标架构

```
┌───────────────────────────────┐        HTTP / JSON        ┌────────────────────────────┐
│  前端应用（Next.js / Nuxt）     │ ───────────────────────▶ │  Koa API 服务               │
│  · 前台：SSG + ISR + RSC       │ ◀─────────────────────── │  · /api/v1/public/*  只读   │
│  · 后台：CSR/SSR 管理界面       │   CORS + Cookie + CSRF   │  · /api/v1/admin/*   鉴权   │
│  · sitemap / robots / OG/JSON-LD│                          │  · 上传 / 迁移脚本 / 定时任务 │
└───────────────────────────────┘                          │  · PostgreSQL 18            │
        │                                                   └────────────────────────────┘
        └── 静态资源 / 图片 ──▶ 对象存储(OSS/S3)/CDN  或  Koa 继续托管 /upload
```

**关键变化**：Koa 从「SSR 应用」降级为「纯 API + 基础设施」；模板引擎、静态模板、编辑器资源最终全部下线。

**仓库形态（两种，按需选）**
- **方案 A（推荐 Phase 1 用）独立仓库**：本仓库继续作为 API 服务，新建一个前端仓库。最小侵入、互不干扰。
- **方案 B（长期更优）pnpm monorepo**：`apps/api`（本仓库迁移）+ `apps/web`，用
  `openapi-typescript` 从 API 契约生成前端类型，端到端类型安全。代价是需要搬迁目录结构。
  > 你已经在用 pnpm，做 workspace 没有额外工具成本，但**建议等 API 契约稳定后再搬**，避免边搬边改。

---

## 4. 替换范围界定（逐目录判定）——回答「public 和 views 能不能删」

**先给结论：`public` 和 `views` 都不是「可以整体删」的目录，必须按「前台层 / 后台层 / 用户数据」三层拆开处理。**

| 目录 | 归属 | 内容 | 处理方式 | 何时可删 | 风险 |
| --- | --- | --- | --- | --- | --- |
| `views/default/` | 前台 | 6 模板 + `public/header.html` | 由 Next/Nuxt 页面替代 | **Phase 3** | 需先完成 URL 与 SEO 迁移 |
| `views/index.html`、`views/default/index.htm` | 死文件 | 外站 meta refresh | **立即删** | 现在 | 无 |
| `views/admin/` | 后台 | 31 模板 | Next admin 替代，或**保留** | **Phase 4**（后台迁移后） | 后台不迁则不能删 |
| `views/`（整体） | — | — | 上述清空后整目录可删 | Phase 4 | — |
| `public/default/` | 前台资源 | 74 文件（css/img/js） | 由前端工程 assets 替代 | **Phase 3** | 需先迁走仍被引用的图 |
| `public/ajax/` | 死文件 | 教学 demo | **立即删** | 现在 | 无 |
| `public/admin/` | 后台资源 | Ace 103 文件 | 后台迁移后删 | **Phase 4** | 后台不迁则不能删 |
| `public/ueditor/` | 后台编辑器 | 270 文件 | 已被 P2 列入「替换 ueditor」 | **Phase 4** | — |
| `public/upload/` | **用户生产数据** | 23 文件，**git 跟踪** | **迁移到对象存储，绝不直接删** | 迁移完成后 | **高：删了站点图片全挂** |
| `public/basic.css`、`public/favicon.ico` | 混合 | 被引用中 | 逐文件确认归属后再定 | — | 低 |

**一句话回答**：「`public` 和 `views` 都能删」只在**前台 + 后台都迁移完**之后成立，
且前提是**先把 `public/upload/` 迁到对象存储或明确由 Koa/Nginx 继续托管（路径不变）**。
现在就整目录删 = 直接把站点删了。

---

## 5. 推荐路线（分阶段 + 验收标准）

### Phase 0 —— 后端优先，现前台完全不动（⭐ 最高优先级）
- 新增 **`/api/v1/public/*` 只读接口**：站点设置、导航、轮播、友链、分类树、文章列表（分页/筛选）、文章详情、上下篇。
  - 统一 `{code,message,data}`；统一分页结构；**字段白名单**（禁止 `SELECT *`，尤其 `admin.password`）；
  - 加缓存头：`ETag` / `Cache-Control`（配合前端 ISR 双保险）；
  - 图片字段返回**可直接消费的 URL**（CDN 前缀由 env 决定）。
- API 版本化：`/api/v1/admin/*`（现有 `/api/admin/*` 保留兼容或 301）。
- CORS 精确化：**不要 `origin:'*'` 与 `credentials` 并存**，按环境白名单。
- OpenAPI/Swagger 契约（从 P2 提前）→ 用 `openapi-typescript` 生成前端类型。
- 顺手修掉 §1.5 的 `password` 泄露；删掉 §1.6 的死文件与 `/api/addCart` 等教学残留。
- **验收**：curl/Postman 全绿；契约可生成类型；`admin` 列表返回体不含 `password`。

### Phase 1 —— 新建 Next/Nuxt 前台（双跑灰度）
- 渲染策略：列表/详情页 **SSG + ISR**（`revalidate` + 发布后 `revalidatePath` 按需刷新）；
  全站静态页 SSG；需要个性化的页面才 SSR。
- SEO 清单（逐项可验收）：
  - `metadata` API：title/description/canonical/OG/Twitter；
  - **JSON-LD**：`Article` + `BreadcrumbList`（详情页）、`Organization`（首页）；
  - `sitemap.ts` / `robots.ts`（分页与分类页一并收录）；
  - 404 与 410（已删内容给 410 更利于移除索引）；图片用 `next/image`（或 Nuxt Image）；
  - Core Web Vitals 达标（LCP/CLS/INP）。
- **URL 兼容策略（SEO 生命线）**：
  - 优先**保持现有路径**：`/`、`/news`、`/service`、`/case`、`/about`；
  - 文章详情 `/content/:id`：若改为语义化 `/news/:slug`，**必须 301 且保留旧路径映射表**；
  - 灰度：Nginx 按路径分流（先切 `/news`），观察 Search Console 收录与排名波动。
- **验收**：新旧页面同 URL 内容一致；sitemap 可提交；Lighthouse SEO ≥ 95；无 4xx/5xx 突增。

### Phase 2 —— 后台迁移（可选，收益最低，建议压到最后）
- 若迁移：Next 调 `/api/v1/admin/*`，需解决**跨域 Cookie**（同父域 `SameSite=Lax`，或跨域 `SameSite=None; Secure`）
  与 **CSRF token 传递**（双提交 Cookie 在独立域名下的配置）。
- 若暂不迁移：`views/admin/` + `public/admin/` + `public/ueditor/` **继续保留**，Koa 同时扮演「API + 后台 SSR」双角色——
  这是**完全可接受**的中间态，不必为了「纯粹」而强行迁后台。
- 后台迁移时**务必一并落地 P1 的 RBAC**（当前只有「登录态」判断，所有管理员权限相同）。

### Phase 3 —— 收尾（前台切换完成后）
- 删 `views/default/`、`public/default/`、`public/ajax/`；删 `routes/index.js` 与前台相关模板配置。
- `public/upload/` 迁移到对象存储（或保持由 Koa/Nginx 托管，**保证 URL 不变**）。
- 从此 Koa 不再渲染前台页面。

### Phase 4 —— 后台也迁完之后
- 删 `views/`（整个）、`public/admin/`、`public/ueditor/`；
- 卸载 `koa-art-template`、`art-template`；Koa 成为**纯 API 服务**。

---

## 6. 直接回答你的三个问题

**Q1：将来要替换的是不是 `public` 和 `views` 目录都可以删除？**
不能整体删，要分三层（详见 §4）：
- **前台层**（`views/default/`、`public/default/`、`public/ajax/`）→ 前台替换后（Phase 3）可删；
- **后台层**（`views/admin/`、`public/admin/`、`public/ueditor/`）→ 后台迁移后（Phase 4）才可删；
- **用户数据**（`public/upload/`）→ **任何时候都不能直接删**，只能迁移；
- 另有 3~4 个**死文件现在就能删**（见 §1.6）。

**Q2：是否只做后端服务，前端另接一套？**
**推荐这个方向。** Koa 保留「API + 鉴权(会话/CSRF/RBAC) + 上传 + 脚本」，前端独立一套 Next/Nuxt。
契约用 OpenAPI 固定下来，前端可生成类型。仓库可先独立（最小侵入），后期再考虑 pnpm monorepo。

**Q3：还是现有前端不动，优先开发后端？**
**是，强烈推荐先这样做。** 三条理由：
1. **依赖顺序**：公开内容 API 是前端开发的硬前置，没有它前端无法开工；
2. **风险最低**：前台替换直接牵动 SEO 流量与 URL 迁移，是全项目**风险最高**的一步，应放在 API 稳定之后；
3. **收益排序**：后台是内网工具，迁移收益最低 → 放最后；后端 API 收益最高且有安全欠账（§1.5）→ 放最前。

---

## 7. 风险与注意事项

| 风险 | 说明 | 对策 |
| --- | --- | --- |
| **SEO 流量损失** | URL 变更 / 渲染方式变化导致收录与排名波动 | 保持原路径优先；必须变更则 301 并维护映射表；灰度分流；监控 Search Console |
| **缓存不更新** | ISR 静态内容在后台发布后不刷新 | **必须做 On-Demand Revalidation**（发布/编辑后调用 `revalidatePath`）；本项目已踩过「Vercel Data Cache 持久化 24h」的坑 |
| **字段越权泄露** | 接口 `SELECT *`（如 `admin.password`） | 全部接口加字段白名单；见 §1.5，需在 Phase 0 修掉 |
| **跨域会话/CSRF** | 前后端不同源时 Cookie 与双提交 Cookie 失效 | 同父域 + `SameSite=Lax`；跨域则 `SameSite=None; Secure` + CORS 白名单，禁止 `origin:'*'` 配 `credentials` |
| **上传迁移** | 本地 `/upload` 与对象存储 URL 不一致导致历史图片挂掉 | 统一 URL 规范 + CDN 前缀；迁移期做兼容回源 |
| **权限缺失** | RBAC 尚未实现，任何管理员即为超级管理员 | 后台迁移时一并落地 P1 RBAC |
| **编辑器依赖** | `public/ueditor/` 与 `model/ueditor.js` 自研上传接口耦合 | P2 换 wangEditor/TipTap，顺带撤掉 `/admin/editorUpload` 的 CSRF 豁免 |

---

## 8. 决策清单（待确认）

请在下面勾选，我据此细化下一阶段的实施计划：

- [ ] **选型**：Next.js（App Router） / Nuxt 3 / Astro（仅前台）
- [ ] **仓库形态**：独立前端仓库（推荐） / pnpm monorepo（`apps/api` + `apps/web`）
- [ ] **后台策略**：Phase 2 一起迁移 / 长期保留 Koa SSR 后台
- [ ] **URL 策略**：保持现有路径（推荐） / 改为语义化 slug（`/news/:slug`，需 301）
- [ ] **图片策略**：继续本地 `/upload` 托管 / 上对象存储 + CDN
- [ ] **是否先执行 Phase 0**（补公开 API + 修 `password` 泄露 + 清理死文件）

---

## 9. 方案清单（9 条，逐条对比 —— 按此比较）

### 9.0 总览

| # | 方案 | 渲染方式 | SEO | 后台 | 迁移成本 | 一句话定位 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 保持现状：Koa + art-template | 服务端渲染 | 中（需自己补 sitemap/OG） | 现有 | 0 | 过渡期用，别久留 |
| 2 | Koa + **换维护中的模板引擎** | 服务端渲染 | 中 | 现有 | 低 | 只换"模板语言"，不解决框架老化 |
| 3 | **自研模板渲染** | 服务端渲染 | 中 | 现有 | 中高 | 纯学习，不建议生产 |
| 4 | **静态化（DedeCMS 式）**：后台点"生成"→ 写 HTML | **预生成静态** | 高 | 现有 | 低中 | 最贴合你的 DedeCMS 经验 |
| 5 | **构建期 SSG**（Astro / Eleventy）读 API 生成静态站 | **预生成静态** | 高 | 保留 Koa | 中 | 现代版"静态化"，前台最优 |
| 6 | **Next.js**（App Router） | 预生成 + 按需再生(ISR) | 高 | 可同栈 | 中高 | 前后台同栈，生态最大 |
| 7 | **Nuxt**（v4） | 同 6 | 高 | 可同栈 | 中高 | Vue 团队等价选择 |
| 8 | **BasicCMS + BasicAdmin**（打包进 public） | **纯客户端渲染** | **低** | 换掉 | 低 | 内部项目够用，**SEO 不行**（你自己已判断正确） |
| 9 | 混合：BasicAdmin(SPA 后台) + 前台 SSG/ISR | 后台 CSR + 前台预生成 | 高 | 换掉 | 中 | 后台先爽、前台保 SEO |

### 9.1 方案 1 —— 保持现状（Koa + art-template）
- **怎么工作**：请求进来 → Koa 查库 → `ctx.render('default/xxx')` → art-template 拼 HTML 返回。
- **SEO 现状**：HTML 本身就是服务端渲染，**收录没问题**；但缺 `sitemap.xml`、`robots.txt`、canonical、OG、JSON-LD、结构化数据。
  这些**都能补**（各加一个路由/模板变量即可），所以"现在的方案 SEO 是及格的，只是没做全"。
- **优点**：零迁移成本；你已经熟。
- **缺点**：模板引擎 `art-template` 更新缓慢；没有组件化/类型检查/构建链；后台 Ace Admin 老了。
- **适合**：作为**过渡期**继续跑，同时做后端 API（也是本项目的当前策略）。

### 9.2 方案 2 —— Koa + 换一个"还在维护"的模板引擎
**你问的"有没有现在还在更新迭代的模板方案"，有，见下表：**

| 引擎 | 语法风格 | 维护状态（2026-09 检索） | 备注 |
| --- | --- | --- | --- |
| **Eta** | EJS 风格但更快、更现代 | **活跃**（持续发版，已迁至 `bgub/eta`） | 首选替代 art-template，语法迁移成本最低 |
| **LiquidJS** | Shopify Liquid | **活跃**（2026-08 仍在发版） | 模板"沙箱"友好，适合将来把模板交给运营改 |
| **EJS** | `<% %>` | 维护中（节奏较慢） | 老牌、生态最大、资料最多 |
| **Pug** | 缩进式 | 维护中 | 简洁，但缩进语法争议大 |
| **Handlebars** | `{{ }}` | 维护中（低频、趋于稳定） | 逻辑弱，适合轻量场景 |
| **Nunjucks** | Jinja2 风格 | **低频维护**（Mozilla） | 功能强，但更新慢 |
| art-template（现状） | `{{ }}` | 国内小众、更新少 | 当前所用 |

> ⚠️ 上表"维护状态"是 2026-09 的检索结果，**选型前请到各仓库 Releases 页确认最近发版时间**，不要只信二手结论。

- **怎么做**：装 Eta/LiquidJS，把 `views/**` 的 `{{ }}` 语法迁过去，`app.js` 换渲染中间件。
- **优点**：改动集中、风险低；引擎生态更健康；能顺手拿到更好的模板继承/局部模板能力。
- **缺点**：**只换了"模板语言"，没解决架构老化**——没有组件化、没有类型、没有构建优化、SSR 的运行时开销还在。
- **适合**：你暂时不想动架构、但想让技术栈"不落后"的折中。

### 9.3 方案 3 —— 自研模板渲染
- **怎么做**：自己写"读模板文件 → 正则/自研 AST 替换占位符 → 输出 HTML"。
- **结论**：**不建议用于生产**。你会重造 Eta/LiquidJS/Astro 已经做过且做对的东西（转义、XSS 边界、局部模板、缓存、SourceMap），
  而且**模板转义一旦写错就是 XSS**（本项目刚在 P0 阶段踩过富文本 XSS）。
- **唯一合理场景**：当作学习项目练手，**但生产环境请用成熟引擎**。

### 9.4 方案 4 —— 静态化（DedeCMS 式，最贴合你的经验）★
这正是你 10 年前 DedeCMS 的做法：**模板编译 + 生成静态 HTML + 动态回落**。在 Node 里完全可以复刻：

- **怎么工作**：
  1. 后台保存/编辑文章 → 触发"静态化服务"：用同一套模板（art-template/Eta/LiquidJS）把
     `/news`、`/content/:id`、`/case`、`/service` 渲染成 HTML 文件，写到 `public/html/` 下（例如 `public/html/news/2026/xx.html`）；
  2. Nginx 优先命中静态文件：`try_files $uri $uri/ @koa;`，未命中才回落到 Koa 动态渲染；
  3. 后台提供"一键生成全站 / 生成当前栏目"入口（就是 DedeCMS 的"生成"菜单）。
- **SEO**：静态 HTML 天然最利于收录（爬虫拿到即完整内容、TTFB 极低、Core Web Vitals 好）。
- **优点**：SEO 好；运行时零渲染成本（抗并发）；**完全可控、易理解**；与你已有经验同构。
- **缺点 / 坑**：
  - **内容更新延迟**：必须"重新生成"，漏生成就显示旧内容（要在保存时自动触发，别只做手动生成）；
  - **分页/分类/上下篇**的静态文件要一起生成，否则链接断裂；
  - 文件数量膨胀（几千篇就是几千个文件），要规划目录与清理策略；
  - 搜索、评论、表单这类动态功能仍需回落动态或走 AJAX。
- **适合**：内容型官网 + 你这种"有静态化直觉"的开发者。**是"Koa 后台 + 静态前台"的最短路径。**

### 9.5 方案 5 —— 构建期 SSG（Astro / Eleventy）：现代版"静态化"★
- **怎么工作**：前端工程在**构建时**去请求 Koa 的公开内容 API（或直连 DB），一次性把整站渲染成静态 HTML。
  也就是把方案 4 的"后台点生成"换成"`npm run build` 生成"，把"手写渲染"换成成熟框架。
- **SEO**：与方案 4 同级（甚至更好：自带图片优化、sitemap 集成）。Astro 默认**零 JS**（对比：SPA 常带几百 KB JS）。
- **优点**：迁移成本比 Next/Nuxt 低（无需建"应用"，就是"生成站点"）；贴近你的静态化心智；
  前台性能与 SEO 天花板最高；后台完全不用动。
- **缺点**：内容更新要"重新构建 + 发布"（可用定时构建或 webhook 触发）；不适合需要登录/实时交互的页面。
- **适合**：**只想把前台做好的 CMS**。个人最推荐给"后台保留 Koa、前台要 SEO"的你。

### 9.6 方案 6 —— Next.js（App Router）
- **怎么工作**：前台用 SSG + **ISR**（`revalidate`），后台发布后调用 **On-Demand Revalidation**（`revalidatePath`）按需刷新单页——
  这样既有静态站的速度，又不用全站重构建。后台也能用同一套 Next 写（同栈复用）。
- **SEO**：官方 `metadata` API、`sitemap.ts` / `robots.ts`、JSON-LD 都好做；生态与资料最多。
- **优点**：前后台同栈；能力最全（静态/增量/动态都覆盖）；岗位与生态最大（2026 年主流版本为 Next.js 16）。
- **缺点**：概念多（RSC/缓存/重新验证），学习曲线陡；需要 Node 常驻运行（不能纯静态托管）。
- **适合**：打算把**前台和后台都统一到一套现代工程**的长期方案。

### 9.7 方案 7 —— Nuxt（v4）
- 能力与方案 6 对标（`useSeoMeta`、Nitro、ISR/按需 revalidate、`@nuxt/image` 等），2026 年主流为 Nuxt 4。
- **选它的唯一标准：你更熟 Vue。** 如果你是 Vue 系出身，选 Nuxt 没有任何短板，不必迁就 React。

### 9.8 方案 8 —— BasicCMS + BasicAdmin（前端打包写入后端 `public`）
- **怎么工作**：`BasicAdmin` 构建产物直接扔进后端 `public/`，浏览器加载后用 JS 渲染 + AJAX 取数据 → **纯 CSR**。
- **SEO**：**天生不行**。爬虫拿到的首屏 HTML 几乎是空壳（或需依赖渲染服务），收录差、LCP 差。**你的判断完全正确**：
  **内部管理系统（不需要被搜索引擎收录）非常合适，对外内容站绝对不要用。**
- **优点**：开发爽、部署简单（一个 `public` 目录搞定）、前后端彻底解耦。
- **缺点**：SEO 差；首屏白屏；需要额外配 history 回退。
- **适合**：**内部后台/中后台系统**，或"不需要 SEO"的项目。
  > 换个说法：把 BasicAdmin 当成"后台"用是**优解**；当成"前台"用是**错解**。

### 9.9 方案 9 —— 混合：BasicAdmin（SPA 后台）+ 前台 SSG/ISR
- **怎么工作**：后台用 BasicAdmin（SPA，不关心 SEO）；前台用方案 4/5/6/7 中任一（要 SEO）；
  两者共用同一套 Koa JSON API（本项目的 `/api/v1/public/*` + `/api/v1/admin/*`）。
- **优点**：后台开发体验立刻现代化（不用再维护 Ace Admin 那 31 个老模板）；前台 SEO 不受影响；职责清晰。
- **缺点**：要维护两个前端产物 + 一套 API 契约。
- **适合**：**最务实的落地组合**。尤其适合"后台先换、前台慢慢来"的节奏。

### 9.10 我的建议（针对你三个具体诉求）

| 你的诉求 | 推荐 |
| --- | --- |
| 要 SEO + 不想大动干戈 | **方案 5（Astro 静态化）** 或 **方案 4（自建静态化）** |
| 想吃下"现代全栈"、前后台统一 | **方案 6（Next.js）**，Vue 系则方案 7 |
| 内部管理项目、不管 SEO | **方案 8（BasicAdmin 打包进 public）** |
| 想复刻 DedeCMS 手感 | **方案 4**——"Koa 后台 + 生成静态前台"就是现代版 DedeCMS |
| 后台先爽、前台保 SEO | **方案 9（BasicAdmin 后台 + Astro/Next 前台）** |

**我个人最推荐的两条路（按迁移成本从低到高）：**
1. **方案 5 + 后台不动**：`Astro` 构建期读 Koa 公开 API 生成静态前台；后台继续用现有 Koa SSR。
   成本最低、SEO 最优、最贴合你的静态化直觉。
2. **方案 9**：后台换 BasicAdmin（立刻现代化），前台用 Astro/Next。
   一次性解决"后台模板难维护"，且前台 SEO 有保障。

**不推荐**：方案 3（自研渲染）、方案 8 用作前台、以及"长期停留在方案 1"。

---

## 10. Q&A：**国内 React 框架做 SEO，用什么？难道还是 Next.js？**

> 补充于 2026-09-19。数据核实：Modern.js 3.0 于 2026-04 发布（全面拥抱 Rspack，仍活跃）；
> Next.js 16 已发布（App Router + React 19.2）。

### 10.1 先给结论：**是，还是 Next.js**

在 **React 生态**里做 SEO（即需要 SSR / SSG / ISR），**Next.js 依然是事实标准——这一点国内外没有差别**。
国内公司做需要 SEO 的 React 站点（商城落地页、内容/资讯站、官网），实际用得最多的同样是 Next.js +
**自己部署**（Docker / PM2 / 自己的 K8s），而不是托管到 Vercel。

这不是"崇洋"，而是由**技术复杂度分布**决定的：

| SSR/SSG 真正难的部分 | 谁在投入 |
| --- | --- |
| React Server Components、流式渲染、Suspense 边界 | Next.js 与 React 团队**深度共建**（Next 部分成员就是 React 团队的） |
| 部分预渲染（PPR）、ISR 与缓存失效语义 | Next.js 定义事实标准，其他框架在跟进 |
| 图片/字体自动优化、metadata/JSON-LD 序列化 | Next.js 内置最完整 |
| 边缘/Node 双运行时、Server Actions | 仍是 Next 的实践最成熟 |

换句话说：**SSR 的难点不在"渲染"（`renderToString` 谁都会），而在"水合、缓存、增量更新"这半边**。
国产框架基本没有在这一侧全面投入，所以拿不出真正对等的东西。

### 10.2 国产「React 框架」的真实定位：不是 Next 的替代品

这点非常关键，很多人会误解——**它们解决的是不同的问题**：

| 框架 | 出身 | 它真正擅长 | 做 SEO 内容站？ |
| --- | --- | --- | --- |
| **Modern.js** | 字节 Web Infra | 一站式 Web 工程体系 + 自研 Rspack 构建；支持 CSR/SSR/SSG/微前端/BFF 一体化 | ⭐ **唯一能认真考虑的一个**（3.0 仍在活跃迭代），但要接受社区与资料量级远小于 Next |
| **ice.js** | 阿里（飞冰） | 阿里内部研发体系沉淀、中后台一体化 | 有 SSR 能力，但生态与投入明显不如从前，做内容站不是它的主场 |
| **Umi / Ant Design Pro** | 蚂蚁 | **中后台王者**（路由/布局/权限/数据流全家桶） | ❌ 不适合 SEO，它本来就不是给内容站用的 |
| **Rspress** | 字节 | 文档/博客站专用 SSG | 只适合文档类，通用 CMS 不合适 |

**一句话**：国产 React 框架的主战场是「**企业内/中台研发体系**」（配置化、微前端、一体化 BFF、内部规范落地），
而不是「面向搜索引擎的内容站」。把它们当 Next 的"国产替代"来选型，会失望。

### 10.3 「用国外的」到底在担心什么？拆开看

| 担心 | 事实 |
| --- | --- |
| 代码主权 / 断供？ | **不成立**。Next.js 是 MIT 协议，代码就在你仓库里，随便改随便 fork。和"用某云厂商闭源服务"完全两回事。 |
| 被 Vercel 锁定？ | **只在特定场景**。Next.js **完全可以自部署**：`next build` → `next start`（或 standalone 产物 + Docker + PM2），不依赖 Vercel。真正有耦合的是「Vercel 边缘运行时、托管的 Image Optimization、Vercel KV」这些**你完全可以不用**。 |
| 换成国产的成本？ | 极低。因为部署形态就是一个 Node 服务 + 反向代理，和你的 Koa 一样。 |
| 真正在可能有风险的层级 | **云服务/API 层**（对象存储、CDN、支付、地图、短信、短信/验证码）——那是商业服务，才有"换不掉"的风险；**框架层几乎没有**。 |

> 判断标准应该是：**能不能自己跑起来、代码在不在自己手里、换掉的成本是多少**。
> Next.js 三条全部满足。

### 10.4 针对咱们这个项目（Koa3 + PG 的 CMS，要 SEO + 可能出海）

| 场景 | 推荐 |
| --- | --- |
| **默认推荐** | **Next.js 16（App Router）+ 自部署**（Docker + PM2，正好是我们下一个 P2）。文案走 `generateMetadata` + JSON-LD，列表/详情走 SSG + ISR，Koa 后台发文章时打 webhook 触发按需 `revalidate`。 |
| **很在意「国产」** | 可以考虑 **Modern.js 3.0**。但要清醒接受三点：① 中文社区小，踩坑答案少；② 招人/交接成本高；③ 遇到问题大概率要自己读源码。**我建议不要因为「国产」这个标签承担这些成本。** |
| **只要 SEO、交互极少**（内容站本质） | **Astro**（见方案 5）仍然是最优解——零 JS 默认、构建期出静态页，SEO 与性能上限最高。同样也是"国外"，但这不影响它的适用性。 |
| 愿意换 Vue 阵营 | **Nuxt**。顺带一提：**国内 SEO 场景里 Nuxt 的落地面其实比 Next 更广**，因为 Vue 在国内普及度高 + 尤雨溪的中文社区号召力。如果"国内生态/好招人"是重要考量，**Nuxt 反而比 Next 更贴合这个诉求**。 |

### 10.5 一个容易被忽略的事实

> **决定 SEO 的不是框架，是「服务端能不能吐出完整 HTML」。**

你现在 Koa + art-template **本身就是 SSR**——单就"能否被抓取"这件事，**现状已经比绝大多数 SPA 强得多**。
所以真正的瓶颈大概率不在"要不要上 React"，而在这些地方（都已列入 P2 待办）：

1. **无 `sitemap.xml` / 无 `robots.txt`** —— 这是当前最确定、投入产出比最高的一项；
2. **无 OG / JSON-LD 结构化数据** —— 影响社交分享卡片与搜索富摘要；
3. URL 语义化（现在是 `/content/:id`，不如 `/news/:slug`）；
4. TTFB 与静态资源缓存策略；
5. 内容更新频率与内链结构。

**换句话说**：换框架能提升的是"开发体验与长期可维护性"，
但**对排名的直接影响，远小于上面这 5 条**。先把 `sitemap.xml` + `robots.txt` + JSON-LD 补上，
是当下最划算的 SEO 投入（而且不依赖任何前端框架决策，现在就能做）。

---

## 11. Q&A：**「Vue2 打包时输出各路由 HTML」＝ DedeCMS 那种吗？**（重要澄清）

> 补充于 2026-09-19，回应"想清理 public/views、后台体验差、想要打包出 HTML 那种方案"。

### 11.1 先确诊：你后台体验差的根因，不是配置问题，是**架构决定的**

SSR + 表单式后台（Ace Admin 是 2013 年的 jQuery 模板）的固有缺陷，列举出来你会发现每一条都对得上：

| 你遇到的现象 | 真正的根因 |
|---|---|
| 每次增删改都**整页刷新**，慢且闪屏 | 表单 POST → 302 → **整页重新渲染** + 重加载整套 Ace Admin 的 CSS/JS |
| 校验失败要**重新填一遍**表单 | 校验在服务端 → 渲染错误页 → 靠浏览器后退找输入（经常已经丢了） |
| 分页 / 搜索 / 排序都要跳整页 | 没有 XHR 局部刷新，一切操作都是"导航" |
| 富文本传图要**弹窗 + iframe** | ueditor 的固有交互（且它早已停止维护） |
| 文件又多又不敢动 | `views/admin/` 31 个模板 + `public/admin/` 103 个文件 + `public/ueditor/` **270 个文件** |

**结论：这些没法通过"改改配置/优化一下"解决。** 唯一解法是**后台换 SPA**。

> 顺带一条好消息：**后台不需要 SEO。** 所以后台可以毫无顾虑地用 SPA——
> 这是我们手上**唯一能立刻动手、零风险、收益最大**的一块。

---

### 11.2 你记忆中的"Vue2 打包输出 HTML"是什么？

这个方案叫**构建期预渲染（prerender / SSG）**。典型实现：

- Nuxt 2 的 `nuxt generate`
- `prerender-spa-plugin`（webpack 时代）
- `vite-plugin-ssr` / `vite-ssg` 的 prerender

它的做法是：**构建时（`npm run build`）把每个路由在 Node 里跑一遍，把渲染出的 HTML 落成静态文件**，
比如 `/news/index.html`、`/content/123/index.html`。浏览器和爬虫直接拿到完整 HTML → **SEO 完美、CDN 可缓存**。

### 11.3 ⚠️ 但它和你经验里的 DedeCMS，**差在一个致命的地方**

这是本篇最需要你记住的一点：

| 维度 | **DedeCMS「生成静态」** | **你说的「打包时输出 HTML」** |
|---|---|---|
| 生成时机 | 后台**点发布/更新**那一刻 | **构建时**（跑 `npm run build`） |
| 粒度 | **增量**：只重新生成受影响的页（这篇文章 + 它的列表页 + 首页） | **全量**：整站重新打包一遍 |
| 改一个错别字 | 后台点一下，秒级，**只动那一页** | 跑完整构建 → 重新上传/CDN 刷新 → **改一个字也要全站重发** |
| 本质 | **按需、增量生成** | **构建期、全量生成** |

> **所以：你要找的其实不是「打包时输出 HTML」，而是「内容更新时自动重新生成那一页」。**
> 这两者在 CMS 场景下天差地别——前者会让你的 CMS **不可维护**（文章天天更新，难道天天在服务器上跑一次构建？）。

### 11.4 DedeCMS 概念 → 现代技术 的对照表（建议收藏）

| 你的 DedeCMS 经验 | 现代等价物 | 说明 |
|---|---|---|
| **生成静态**（发布即出 HTML） | **SSG + 按需 ISR** ⭐ | **这就是你要的答案**。Nuxt 3 的 `routeRules: { '/news/**': { isr: true } }`，Next.js 的 `revalidate` / `revalidatePath` |
| **动态浏览**（不生成，实时查库） | **SSR** | 每次请求实时渲染，SEO 也有，但 TTFB 与服务器压力更大 |
| **伪静态** | **语义化 slug / URL 重写** | `/content/:id` → `/news/:slug` |
| 模板标签 `{dede:field.xxx}` | 组件 + 数据获取层 | 你现在 Koa 的 `/api/v1/public/*` 就是数据层 |
| 定时更新首页 | `swr` / CDN 缓存 TTL | Nuxt `routeRules` 的 `swr: 3600` |

**一句话理解 ISR**：页面默认是静态 HTML（快、可缓存、SEO 好），
但**后台发文章时打一个 webhook**，告诉它"这一页过期了"，下一个访客访问时自动重新生成一次。
——这在体验上，**就是 DedeCMS 点"生成HTML"的自动化版本**。

> 已核实：Nuxt 3 的 `routeRules` 支持 `isr` / `swr`（混合渲染），Next.js 16 的 App Router 同样支持。
> 两者都能做到"改一篇文章只重生成那一页"。

### 11.5 那么 `public` 和 `views` 到底什么时候能删？——给你一条**能立刻开始**的路径

之前我给的答案是"不能整目录删"，那是在**什么都不做**的前提下。你現在明确要替换，路径就变了：

#### 阶段 A：**后台 SPA 化**（立刻能做，零 SEO 风险，先把体验问题治了）

后台不需要 SEO，所以抛弃 SSR 完全没代价。

- **技术**：Vue 3 + Vite + Element Plus（若坚持 Vue 2 也可，但 **Vue 2 已于 2023-12 EOL**，不建议新项目再用）
- **数据**：直接吃现成的 `/api/v1/admin/*`（**RBAC、CSRF、审计、字段脱敏都已经就位**，不用改后端）
- **预计删除量**：
  - `views/admin/`（31 个模板）✅ 全删
  - `public/admin/`（103 个文件，Ace Admin 全家桶）✅ 全删
  - `public/ueditor/`（270 个文件）✅ 换成 wangEditor / TipTap / Quill 后删
  - `routes/admin/` 里除 `login` 外的 doAdd/doEdit/列表渲染路由 ✅ 大幅删减
  - `model/ueditor.js`（自研上传器）✅ 换编辑器后删
- **顺带解决**：你吐槽的所有后台体验问题

#### 阶段 B：**前台 SSG + ISR**（这才是"现代 DedeCMS"）

- **继续 Vue**：**Nuxt 3 + `routeRules` ISR**（与你的 DedeCMS 直觉最接近）
- **换 React**：Next.js 16 App Router + ISR
- **数据**：现成的 `/api/v1/public/*`
- **连贯动作**：Koa 后台发布文章 → 调 Nuxt/Next 的 revalidate webhook → 只重生成那一页
- **预计删除量**：
  - `views/default/` ✅ 全删
  - `public/default/` ✅ 全删
  - `routes/index.js`（前台页面路由）✅ 删
  - `public/ajax/*.html`（教学死文件）✅ 删

#### 永不可删

- **`public/upload/`** —— 这是**用户数据**，不是源码。迁移到对象存储（见 `docs/koa3-projects-review.md` §5）后，
  它是"搬到新家"，不是"删除"。

### 11.6 我的建议：先做阶段 A

三条理由：

1. **痛点就在后台**，而后台替换**零 SEO 风险**（爬虫看不到后台）；
2. **后端已经完全就绪**——`/api/v1/admin/*` 有 RBAC、CSRF、审计、zod 校验、字段脱敏，
   这就是当初"先修水管"的意义，现在直接接杯子就行；
3. 一轮下来能删掉 **400+ 个老旧文件**（含 270 个 ueditor），项目立刻清爽，
   而不会像"同时动前台 + 后台"那样风险叠加。

**阶段 A 做完之后**，你再决定前台是走 Nuxt 3 ISR（贴合 DedeCMS 直觉）、Next.js，还是先补 SEO 三件套——
那时的决策会比现在轻松得多。

---

## 附：一句话记忆点

> **先让后端变成"干净的水龙头"（公开 API + 契约 + 无泄漏），再决定用哪个杯子接水（Next/Nuxt/Astro）。
> 杯子可以换，水管没修好，换哪个杯子都白搭。**
