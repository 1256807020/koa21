# Koa21 CMS

一套基于 **Koa 3** 的内容管理系统（CMS）。前台为服务端渲染的官网，后台为管理界面。

2026-09 完成 **MongoDB → PostgreSQL 18** 数据层迁移与全套依赖升级，包管理由 npm 切换为 pnpm。

> **为什么不再是"Koa2"**：Koa 3.0 于 **2025-04 正式发布**（距 Koa 2 已有 8 年；Koa 2.16 长期停在维护模式），
> 本项目已跑在 **Koa 3.2.1** 上——这是当前 Koa 的**最新主线版本**，目前也没有 Koa 4 的计划。
> Koa 3 的主要变化：Node ≥ 18、原生 async/await、`koa-session` 改为具名导出 `createSession()`，
> 且 3.1+ **原生集成 `AsyncLocalStorage`**（无需第三方库即可在任意位置取到当前请求上下文）。
> 若还在别处看到 "基于 Koa2" 的描述，那都是历史遗留文案——本仓库文案已统一为 Koa 3。

---

## 一、项目简介

- 前台官网：首页 / 案例 / 新闻 / 内容详情 / 分类筛选，服务端渲染（SEO 友好、零构建）。
- 后台管理：管理员、内容分类、文章（富文本）、轮播图、友情链接、导航、系统设置。
- 定位：展示型官网 + 轻量内容后台，非高并发业务系统。

## 二、技术栈

| 层 | 技术 |
|---|---|
| Web 框架 | **Koa 3.2.1**（当前最新主线）+ @koa/router |
| 会话 | koa-session（cookie session，httpOnly + signed） |
| 模板 | koa-art-template + art-template（服务端渲染） |
| 数据库 | PostgreSQL 18（驱动 `pg`） |
| 缓存 / 限流存储 | Redis（驱动 `redis`，可选；未配置则自动降级为进程内存储） |
| 静态服务 | koa-static |
| 跨域 | @koa/cors（仅对 `/api` 开放） |
| 鉴权/安全 | bcryptjs（密码哈希）、svg-captcha（登录验证码）、sanitize-html（富文本 XSS 净化） |
| 上传 | @koa/multer + multer（本地磁盘 `public/upload`） |
| 日志 | log4js |
| 后台 UI | jQuery + Ace Admin 1.x 模板 |
| 模块规范 | **CommonJS（`require`）** —— 历史项目演进所致；为何暂不迁 ESM、何时适合迁，见 [`docs/dev-notes.md`](docs/dev-notes.md) 阶段八 8.5 |
| 前台交互 | jQuery + Swiper |
| 包管理 | pnpm（依赖锁定精确版本，见 `.npmrc` 的 `save-exact=true`） |

## 三、功能模块

- **内容**：分类（`articlecate`，支持层级 `pid`）、文章（`article`，富文本）、轮播图（`focus`）、友情链接（`link`）、导航（`nav`）。
- **管理员**：账号、状态（启用/禁用），密码 bcrypt 存储。
- **系统设置**：站点名称、Logo、地址等。
- **前台**：首页、案例、新闻列表与详情、分类筛选。

## 四、目录结构

```
koa21/
├── app.js                 # 应用入口：中间件、session、CORS、模板、路由、启动
├── model/
│   ├── config.js          # 统一配置中心（按 NODE_ENV 加载 .env）
│   ├── db.js              # PostgreSQL 数据访问层（单例 Pool，参数化查询）
│   ├── mongo-sql.js       # Mongo 风格查询 → SQL 翻译器（白名单防注入）
│   ├── tools.js           # 密码哈希、文件上传中间件、日期格式化
│   ├── ueditor.js         # 富文本编辑器上传接口（自研）
│   └── logger.js          # log4js 封装
├── routes/
│   ├── index.js           # 前台页面路由
│   ├── api.js             # 前台公开 JSON 接口（/api/*）
│   └── admin/             # 后台管理路由（渲染 + 表单提交）
├── views/                 # art-template 模板（admin/ 后台，default/ 前台）
├── public/                # 静态资源（含 admin/js 的 Ace 库、前台 js/css）
├── db/                    # SQL 建表脚本 + 种子数据
├── logs/                  # 运行日志（git 忽略）
└── .env.*                 # 环境配置（.env.development/test/production，含密码，已 git 忽略）
```

## 五、环境要求

- Node.js 18+
- PostgreSQL 18
- pnpm 9+

> 本机开发 PostgreSQL 安装在 `D:\Program Files\PostgreSQL\18`，端口 **5433**，库名 `koa_cms`，账号 `postgres`/`postgres`。

## 六、快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量（复制并修改）
cp .env.development .env.development   # 已存在则直接编辑
# 关键变量：PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE、SESSION_KEY、COOKIE_SECURE

# 3. 初始化数据库（建库建表 + 灌种子，幂等）
pnpm db:init

# 4. 启动开发服务
pnpm dev          # 默认 http://localhost:3000

# 5. 访问后台
#    前台首页：http://localhost:3000/
#    后台登录：http://localhost:3000/admin/login
#    默认账号：admin / 123456   （生产环境请尽快改密）
```

可用脚本（`package.json`）：

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 开发模式（端口 3000） |
| `pnpm start:test` | 测试模式（端口 3001） |
| `pnpm start` | 生产模式（端口由 env 决定） |
| `pnpm db:init` | 建库建表灌种子（幂等） |
| `pnpm db:reset` | 删库重建 |
| `pnpm lint` | ESLint 检查 |
| `pnpm test` | 单元测试（`node:test`，零依赖） |
| `pnpm audit:archive` | 审计日志归档：过期行搬进 `audit_log_archive`（默认保留 90 天，`--days=`/`--dry-run`/`--prune-days=` 可选） |

## 七、配置说明（.env）

按 `NODE_ENV` 加载 `.env.<NODE_ENV>`（`.env` 兜底）。常见变量：

| 变量 | 说明 |
|---|---|
| `PORT` / `HOST` | 监听端口 / 地址 |
| `PG_HOST` `PG_PORT` `PG_USER` `PG_PASSWORD` `PG_DATABASE` | PostgreSQL 连接 |
| `PG_POOL_MAX` `PG_SSL` | 连接池上限 / SSL |
| `SESSION_KEY` | session 签名密钥（**生产必须改**） |
| `SESSION_MAX_AGE` `SESSION_ROLLING` | 会话时长 / 滑动续期 |
| `COOKIE_SECURE` `COOKIE_SAME_SITE` | Cookie 安全属性（生产 `COOKIE_SECURE=1`） |
| `SITE_PROTOCOL` `SITE_HOST` | 站点地址（留空则按请求头自动推导 `__HOST__`） |
| `UPLOAD_DIR` `UPLOAD_MAX_SIZE` | 上传目录 / 大小上限 |
| `TRUST_PROXY` | 是否位于 Nginx 等反代之后（生产 `true`） |
| `REDIS_URL` | Redis 连接串（如 `redis://127.0.0.1:6379`）。**留空 = 不启用**，自动降级为进程内存储；多实例部署必须配置 |
| `REDIS_KEY_PREFIX` | Redis 键前缀（便于多环境共用一个实例，如 `koa21:dev:`） |
| `PERMISSION_CACHE_TTL` `SESSION_CACHE_TTL` | 权限缓存（默认 30s）/ 会话复核缓存（默认 10s）的 TTL，单位毫秒 |
| `RATE_LIMIT_WINDOW_MS` `RATE_LIMIT_MAX` | 全局限流窗口与上限（只罩 `/api` 与 `/admin`） |
| `FRONTEND_PAGE_SIZE` `ADMIN_PAGE_SIZE` | 前台 / 后台列表每页条数 |
| `FRONTEND_CATE_*` | 前台三个一级分类 ID（须与 `db/seed.sql` 一致，一般不用改） |

> Redis 未配置或连接失败时，服务**照常启动**，只是把"限流计数/权限缓存/会话复核缓存"放在各进程内存里。
> `/healthz` 会返回 `cache` 字段（`redis` / `memory`），可直接看出当前走的是哪种。

## 八、数据库（表）

| 表 | 用途 |
|---|---|
| `admin` | 管理员（username、password[bcrypt]、status、lasttime、**role_id**） |
| `articlecate` | 内容分类（`pid='0'` 为一级） |
| `article` | 文章（`_id`、title、content、pid、img_url、sort、status…） |
| `nav` | 导航 |
| `focus` | 轮播图 |
| `link` | 友情链接 |
| `setting` | 系统设置（单行） |
| `role` | **RBAC 角色**（code/name/description/status） |
| `permission` | **RBAC 权限点**（`code` 形如 `article:delete`，`grp` 分组） |
| `role_permission` | **角色-权限映射**（多对多，故意不加物理外键） |
| `audit_log` | **操作审计**（admin_id/action/resource/detail(已脱敏)/ip/created_at） |

主键统一为 `_id`（`text`，24 位十六进制，`gen_oid()` 生成），兼容原 Mongo 写法。
内置角色：`super_admin`（全部 33 个权限点）/ `editor`（内容管理 22 个）/ `viewer`（只读 6 个）。

## 九、API 概览

> 正式版本统一用 **`/api/v1`**；`/api` 为兼容旧路径保留（deprecated）。
> **交互式文档：`GET /api/v1/docs`（Swagger UI）；规范 JSON：`GET /api/v1/openapi.json`（从 zod schema 自动生成）。**

**公开内容接口（无需登录，供前台 / SSG 构建期读取）**

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/v1/public/settings` | GET | 站点设置 |
| `/api/v1/public/nav` | GET | 导航 |
| `/api/v1/public/focus` | GET | 首页轮播 |
| `/api/v1/public/links` | GET | 友情链接 |
| `/api/v1/public/categories` | GET | 分类树（**递归 CTE**，任意层级嵌套） |
| `/api/v1/public/articles` | GET | 文章列表（分页 / `cateId` 含子孙分类 / `keyword`；**不含 content**） |
| `/api/v1/public/articles/:id` | GET | 文章详情 + 上下篇（**窗口函数 LAG/LEAD**） |
| `/api/v1/catelist`、`/api/v1/newslist` | GET | **旧公开接口（deprecated，仅兼容保留）**：已统一响应信封、只返回 `status=1`、字段白名单、分页可传 `pageSize`；新代码请用 `/api/v1/public/*` |

**后台接口（需登录 + CSRF；写操作还需权限点）**

| 接口 | 方法 | 权限点 |
|---|---|---|
| `/api/v1/admin/:resource/list`、`/:id` | GET | `{resource}:list` |
| `/api/v1/admin/:resource/add` | POST | `{resource}:create` |
| `/api/v1/admin/:resource/:id/edit` | POST | `{resource}:update` |
| `/api/v1/admin/:resource/:id/delete` | POST | `{resource}:delete` |
| `/api/v1/admin/rbac/me` | GET | 登录即可（返回自己的权限点，供前端渲染菜单） |
| `/api/v1/admin/rbac/roles`、`/permissions` | GET | `role:list` |
| `/api/v1/admin/rbac/roles/:roleId/permissions` | GET / POST | `role:list` / `role:assign` |
| `/api/v1/admin/audit/list` | GET | `audit:list` |
| `/api/v1/csrf-token` | GET | 签发 CSRF token（双提交 Cookie） |

**统计报表接口（SQL 教学，需 `stats:view`）**

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/v1/admin/stats/overview` | GET | 内容概览与状态分布（`COUNT(*) FILTER`） |
| `/api/v1/admin/stats/categories` | GET | 分类排行（`GROUP BY` + 窗口函数：ROW_NUMBER/RANK/DENSE_RANK + 占比 + **累计占比**） |
| `/api/v1/admin/stats/top-articles?limit=2` | GET | 每个分类最新 N 篇（**分组 TopN**：`PARTITION BY` + `ROW_NUMBER`） |
| `/api/v1/admin/stats/monthly?months=12` | GET | 按月发文趋势（`date_trunc` + `GROUP BY 1`） |
| `/api/v1/admin/stats/explain/queries` | GET | 可 EXPLAIN 的查询清单（白名单） |
| `/api/v1/admin/stats/explain?query=<key>` | GET | 执行计划分析（`EXPLAIN ANALYZE`，**只接受白名单键**） |

`resource` 当前支持 `manage`（=管理员表 `admin`）与 `article`。

**系统**

| 接口 | 方法 | 说明 |
|---|---|---|
| `/healthz` | GET | 健康检查（查 DB，返回 status/env/uptime/latencyMs；不鉴权、不限流） |

**后台页面（传统服务端渲染，保留兼容）**

列表页 `GET /admin/:module`，表单页 `/add`、`/edit`，提交 `POST /admin/:module/doAdd`、`/doEdit`。
这些表单同样受**登录守卫 + CSRF + RBAC 权限点 + zod 校验**保护（见 `routes/admin/*.js`）。

## 十、部署建议

- **进程管理**：生产用 `pm2`（cluster 模式）或 `docker`，不要裸 `node`。
- **反向代理**：Nginx 前置，设 `TRUST_PROXY=true`，SSL 终止在 Nginx，Cookie `secure`。
- **静态资源 / 上传**：当前上传存本地 `public/upload`；多实例/对象存储场景应迁移到 OSS/S3。
- **健康检查**：已提供 `GET /healthz`（探活只查 DB）。
- **限流**：`middleware/rateLimit.js` 按 IP 限流（只罩 `/api` 与 `/admin`）。
- **Redis**：限流计数 / 权限缓存 / 会话复核缓存的共享存储。**多实例部署请配置 `REDIS_URL`**；
  未配置时自动降级为进程内存储（单实例可用），`GET /healthz` 的 `cache` 字段（`redis`/`memory`）可直接确认。

## 十一、安全现状

**已具备（做得好的部分）**

- SQL 全部参数化（`model/db.js`）+ 表名/字段名白名单（`assertIdent`），**从根上杜绝 SQL 注入**。
- 密码 bcrypt 哈希存储；验证码一次性（且 SVG 路径化 + `httpOnly` 会话，前端读不出验证码）。
- RBAC 权限点（`资源:动作`）+ 操作审计日志（**入库前脱敏**）。
- 全局异常兜底 + 访问日志 + `/healthz` + 按 IP 限流；生产环境隐藏内部错误。
- session：`httpOnly` + `signed` + `sameSite`，且**只存最小字段**（不再放 password 哈希）。

**已完成的安全改造（原风险已闭环）**

- ✅ 写操作全部 **POST + CSRF + 表名白名单**（原 `GET /admin/remove?collectionName=表` 已下线，旧 GET 返回 405）
- ✅ 上传类型白名单（扩展名 + MIME 双校验，移除 SVG）+ 静态资源 `X-Content-Type-Options: nosniff`
- ✅ 富文本**入库前** XSS 净化（白名单），覆盖 SSR 与 JSON API 两条路径
- ✅ 登录失败限流/锁定（同账号 5 次锁 15 分钟）；验证码明文日志已删；生产 `COOKIE_SECURE=true`
- ✅ **会话复核**：账号被删除/禁用后旧会话立即失效；改角色无需重新登录
- ✅ **开放重定向防护**（`utils/redirect.js` 的 `safeBackPath`，只允许站内相对路径）
- ✅ 参数非法返回 **400**（原来是 500）；未知资源 404 而非 403

**仍需注意**

- 限流计数、权限缓存、会话复核缓存**默认走 Redis**（`REDIS_URL`）；**未配置时会降级为进程内存储**——
  单实例开发没问题，多实例部署务必配置（否则限额各算各的、权限变更最长 30s 才全局一致）。`/healthz` 的 `cache` 字段可确认。
- ✅ 删除记录时会自动清理关联的孤儿图片（`utils/fileCleanup.js`，含路径 containment 防任意文件删除）
- ✅ `audit_log` 有了归档策略（`pnpm audit:archive`，默认保留 90 天，过期搬进 `audit_log_archive`）
- ✅ 所有 `prevPage` 回跳统一走 `safeBackPath`（含 SSR doEdit 隐藏域）
- 生产部署前务必修改默认密码（`admin/123456`）与 `SESSION_KEY`。

## 十二、改造计划与待办（Roadmap）

> 优先级：P0 = 安全/升级前置，上线前必修；P1 = 质量与权限；P2 = SEO/部署/工程化。

### P0 — 安全（上线前必修）

- [x] **删除接口重构**：去掉 `collectionName` 表名参数，改为 `POST /api/admin/:resource/:id/delete`，加权限校验 + CSRF token。
- [x] **全站 CSRF 防护**：引入 `koa-csrf` 或双提交 Cookie 方案，覆盖所有写操作。（JSON API 已覆盖；SSR 表单待补）
- [x] **上传文件类型白名单**：`tools.multer()` 增加 `fileFilter`，仅允许图片类（png/jpg/gif/webp）。
- [x] **前台富文本 XSS 净化**：`content.html` 的 `{{@list.content}}` 服务端经 `sanitize-html` / DOMPurify 净化后再输出。
- [x] **清理验证码明文日志**：删除 `routes/admin/login.js` 中的 `console.log(captcha.text)`；生产 `COOKIE_SECURE=1`。
- [x] **登录限流与锁定**：引入 `koa-ratelimit` 或失败计数锁定，降低爆破风险。

### P0 — 升级后台框架的前置

- [x] **后台 CRUD 补 JSON API**：在 `routes/admin/*` 之上新增 `/api/admin/*` 返回 `{ code, message, data }` 统一结构（增删改查 + 分页 + 校验）。这是换 Vue3/React 后台模板的底座。

### P1 — 质量与权限

- [x] **RBAC**：角色 + 权限点，替换当前"仅登录态"判断（`routes/admin.js` 的 `ctx.session.userinfo`）。
- [x] **操作审计日志**：记录谁、何时、改了什么。
- [x] **统一响应体与错误码**：前台/后台统一 `{ code, message, data }` 规范，定义错误码表。（含修掉全局 500/404 返回旧风格 `{success:false}` 与 HTML 的不一致）
- [x] **统一输入校验层**：引入 zod/joi，替换散落在各路由的正则校验。（JSON API 用 `utils/schemas.js`；SSR 表单用 `validatePageBody` 中间件全覆盖）
- [x] **API 版本化**：`/api/v1` 前缀，便于后续不兼容升级。（同一套路由双挂 `/api/v1` + `/api`）

### P2 — SEO / 部署 / 工程化

- [ ] **SEO 增强**：`sitemap.xml`、`robots.txt`、每页 `meta description` / Open Graph、结构化数据（JSON-LD）。
- [ ] **部署工程化**：`Dockerfile` + `pm2` cluster + CI/CD + Nginx 示例配置。
- [ ] **上传上云**：迁移到 OSS / S3 / 七牛，解耦本地磁盘。
- [x] **可观测性**：`/healthz` 健康检查 + 全局限流中间件。（`middleware/rateLimit.js` 按 IP 限流，只罩 /api 与 /admin；`/healthz` 查 DB 返回 status/uptime/latency）
- [x] **API 文档**：Swagger / OpenAPI 自动生成。（`utils/schemas.js` 单一来源 → `utils/openapi.js` 用 `z.toJSONSchema()` 生成；`GET /api/v1/docs`）
- [x] **测试套件**：单元 + 接口测试。（用 Node 内置 `node:test` 替代 vitest：环境装不上依赖，且零依赖更轻；`pnpm test`，26 项全绿）
- [ ] **富文本编辑器替换**：ueditor 已停止维护，迁移到 wangEditor / TipTap。

## 十三、已知问题

> 原"后台删除为 GET + 表名可控（最危）"问题已修复（见第十一章）；以下为**当前**仍存在、但已知并接受的问题。

- **缓存后端降级**：若未配置 `REDIS_URL`（或 Redis 连不上），限流计数/权限缓存/会话复核会退回**进程内实现** —
  单实例无碍，多实例会出现"限额被放大 N 倍、权限变更最长 30s 才一致"。`/healthz` 的 `cache` 字段可确认当前后端。
- 系统设置中"网站地址"为种子数据值，生产请在后台设置页修改。
- 后台管理 UI 为老版 Ace Admin（jQuery 时代），交互与可维护性落后于现代框架；JSON API（`/api/v1/admin/*`）已就绪，可直接对接现代前端。

---

## 十四、数据库设计与 SQL 实战

> 表关联（无外键的逻辑关联）、关系模型三件套（含多对多中间表）、核心 SQL、
> 本项目常用实战 SQL（分页/模糊搜索/树形 CTE/统计/事务/EXPLAIN），以及
> **"外键 vs 无外键 / ORM vs 手写 SQL"的架构师解惑**，见独立文档
> **[docs/database-sql.md](docs/database-sql.md)**。
> 面向"会用 TypeORM/Prisma 但 SQL 内功弱"的前端转全栈同学，所有示例可在库中直接运行。
>
> 前端**将来用什么框架、怎么迁移、哪些目录可以删**，见独立文档
> **[docs/frontend-architecture.md](docs/frontend-architecture.md)**（Next.js / Nuxt / Astro 选型对比、
> 目标架构、分阶段路线，以及 `views` `public` 逐目录的替换范围界定）。
>
> 另外两份参考：**[docs/koa3-projects-review.md](docs/koa3-projects-review.md)**（2026 年活跃 Koa 项目横向评审 +
> 媒体存储出海选型）、**[docs/database-sql.md](docs/database-sql.md)**（SQL 实战）。
>
> 💡 **想把 `views` / `public` 换成现代 Vue/React？** —— `docs/frontend-architecture.md`
> **§11** 给出了可立刻执行的清理路径（**先后台 SPA 化**：零 SEO 风险、一轮可删 400+ 老旧文件；
> 再前台 SSG+ISR），并澄清了「打包时输出 HTML」与 DedeCMS「发布即生成静态」的关键差异。
>
> 🎨 **前台主题系统（换皮肤 / 模板可开发 / 保 SEO）实施细则**：**[`docs/theme-system.md`](docs/theme-system.md)**
> —— 目录规范、**变量契约**（现状 `list` 装单篇文章、`newslist` 装子分类等命名混乱的整改对照表）、
> `theme.json`、`snippets/` + htmx 局部渲染、主题切换与 `?theme=` 预览、安全约束、开发流程 5 步。

---

## 十五、开发进度追踪（待办 / 已办）

> 状态图例：【未开始】/【进行中】/【已完成】。本表随开发实时更新（规划见第十二章 Roadmap）。
> **目标**：把本项目打磨成**教科书级的 Koa3 全栈框架案例**——安全、规范、SQL 进阶用法全部落到实处，供前端转全栈学习。

### 已办（Done）
- [x] 数据层 MongoDB → PostgreSQL 18 迁移（mongo-sql 翻译层，业务路由零改动）
- [x] 依赖全面升级到最新稳定版，pnpm 精确锁定（`.npmrc` save-exact）
- [x] 密码 md5 → bcrypt（首次登录自动升级，`admin.password` varchar(100)）
- [x] 后台菜单交互修复（`__HOST__` 拼写 + 移除自定义 submenu 脚本，Ace 原生）
- [x] 清理测试临时文件（`.tmp-koa.log`/`.tmp_login.png` git rm + `.gitignore` 忽略）
- [x] 项目 README（技术栈/快速开始/配置/API/部署/安全现状）
- [x] 架构评审：服务端/接口/权限/安全/SEO/部署/规范全维度（见第十二章 Roadmap）
- [x] SQL 实战文档 `docs/database-sql.md`（表关联/多对多/实战 SQL/架构师解惑）
- [x] 前端架构演进方案 `docs/frontend-architecture.md`（Next.js/Nuxt/Astro 选型 + 替换范围逐目录界定 + 分阶段路线 + §9 九条方案清单供比较）
- [x] Koa3 生态横向评审 `docs/koa3-projects-review.md`（koa22/23/24 三项目的优点与坑 + 对照我们不采纳的理由 + **对象存储出海选型**：阿里云 OSS 是否免费 / Cloudflare R2 / Backblaze B2 / Supabase）
- [x] 后端批次（接口规范 + 可观测性）：API 版本化 `/api/v1`、统一响应体固化、session 瘦身、`/healthz`、全局限流、测试套件（`node:test` 26 项）
- [x] 后端批次（权限与内容）：**RBAC**（role/permission/role_permission + 内置三角色 + `requirePermission` 中间件）、**操作审计日志**（audit_log + 埋点 + 脱敏 + 查询接口）、**`/api/v1/public/*` 公开内容 API**、**zod 覆盖 SSR 表单**、**OpenAPI 自动生成**；测试套件扩到 **42 项**
- [x] **Redis 接入**：`model/store.js` 统一缓存/计数存储（Redis 优先，未配置或连不上自动降级进程内）；限流计数、权限缓存、会话复核缓存全部迁移；`/healthz` 暴露 `cache` 字段；测试套件扩到 **54 项**
- [x] **SQL 教学化收尾**：统计报表（`GROUP BY` / 窗口函数 / 分组 TopN / 累计占比）与 `EXPLAIN` 执行计划分析接口 + 文档
- [x] **可运维性三项收尾**：① **审计日志冷热分离** —— 新增 `scripts/audit-archive.js` + `audit_log_archive` 表，事务内「搬运+删除」原子完成，默认保留 90 天（支持 `--days=` / `--dry-run` / `--prune-days=`），建议 cron 每日跑 ② **删除记录时清理孤儿图片** —— 新增 `utils/fileCleanup.js`，按资源字段白名单清理，并做**路径 containment**（`img_url` 被篡改成 `../../` 时拒绝执行，防"任意文件删除"）③ **prevPage 统一走 safeBackPath** —— 补掉 SSR `doEdit` 隐藏域那条漏网的开放重定向，并在源头 `routes/admin.js` 就把 Referer 收敛成站内路径 ④ 端到端实测 6/6 通过（含「upload 目录外文件未被误删」的安全回归）；测试扩到 **77 项**
- [x] **Koa3 生态横向评审**：拆解 2026 年活跃的三 Koa 项目 —— `koa22`（CLI 脚手架，工程习惯最好）/ `koa23`（TS starter，类型功底最好）/ `koa24`（monorepo 全栈，运维形态最完整），逐项比对后确认：它们的**多数优点本项目已具备**（统一响应体、全局错误兜底、requestId、env 强校验、优雅关闭+连接池关闭、`/healthz` 依赖探测、zod+OpenAPI 单一来源），已产出 [`docs/koa3-projects-review.md`](docs/koa3-projects-review.md)，含媒体存储出海选型建议
- [x] **第二轮全量审计与整改**（先程序化枚举出 **150 条路由**再测，脚本 60 项断言 + agent-browser 真实浏览器）：修复 11 个问题 —— **SSR 后台写操作完全不进审计**、**`/admin/editorUpload` 绕过上传白名单（且能传 zip/rar/doc = 任意文件托管）**、`uploadvideo` 逻辑 bug、3 个未鉴权空壳写接口、`newslist` 不过滤 `status` 导致**下架内容外泄**、`catelist` 返回整表原始行、`pageSize` 硬编码、**GET 登出可被跨站触发**、死模块 `/admin/user`、`router.all` 注册 40+ HTTP 方法；测试套件扩到 **68 项**
- [x] **接口全矩阵审计与整改**（脚本 33 项断言 + agent-browser 真实浏览器验证）：修复 9 个真实问题 —— 非法 id 返回 500、未知资源 403、可绑定不存在角色、**账号删除后旧会话仍有效**、**开放重定向**、分页统计用错表、校验结果被无声覆盖、删除产生孤儿数据/可删掉最后一个管理员、硬编码（分类 ID 与 pageSize）；测试套件扩到 **48 项**

### 待办 — P0 安全（上线前必修）
- [x] 删除接口重构：`GET /admin/remove?collectionName=表&id=` → `POST /api/admin/:resource/:id/delete`（已落地：真正调用 `DB.remove`、参数化防注入；CSRF token 已补，权限校验见 P1 RBAC）【已完成 endpoint + CSRF】
- [x] 后台 JSON API 登录态守卫：`middleware/guard.js` 的 `requireLogin` 校验 `session.userinfo`，未登录→401（`{code:1002}`）【已完成】
- [x] 后台 JSON API CSRF 防护（双提交 Cookie）：`middleware/guard.js` 的 `csrfGuard` 覆盖写请求，缺/错 token→403（`{code:1007}`）；`GET /api/csrf-token` 签发 token 并种可读 Cookie【已完成】
- [x] SSR 后台表单 CSRF：`csrfGuardPage` + `ensureCsrfToken`，模板埋隐藏域 `name="_csrf"`；路由级「默认保护 + 例外显式」；multipart 表单在 multer 之后校验（`body` 未解析的坑）【已完成，18 项断言全绿】
- [x] **彻底干掉旧危险 SSR 写端点**：`GET /admin/remove|changeStatus|changeSort`（表名/列名来自 URL、无白名单、GET 可被跨站触发）→ 全部改 `POST` + CSRF + 表名/字段白名单【已完成，旧 GET 已 405】
- [x] 上传文件类型白名单：`tools.uploadFileFilter` 同时校验「扩展名 + MIME」，白名单移除 `.svg`；`app.js` 静态资源加 `X-Content-Type-Options: nosniff`【已完成，单测 5 例全绿】
- [x] 前台富文本 XSS 净化：`utils/sanitize.js`（sanitize-html 白名单），覆盖 SSR `doAdd/doEdit` 与 `articleService.create/update` 两条入库路径【已完成】
- [x] 删 `login.js` 验证码明文 `console.log` + 生产 `COOKIE_SECURE=true`【已完成】
- [x] 登录失败限流/锁定：`middleware/loginRateLimit.js`，同账号 15 分钟内失败 5 次锁定 15 分钟【已完成，单测通过】
- [x] **管理员接口字段泄露**：`adminService` 原用 `SELECT *` 把 `password`（bcrypt 哈希）返回给调用方，已加字段白名单 `_id/username/status/lasttime` + `safe()` 过滤【已完成，验证通过】

### 待办 — P0 升级前置（与框架无关，先建底座）
- [x] 后台 CRUD 补 JSON API（`/api/admin/*` 统一 `{code,message,data}`：utils 响应/错误码/zod 三层 + services 层 + 文章 `LEFT JOIN` 消灭 N+1）【已完成，端到端 curl 全绿】

### 待办 — P1 质量 / 权限
- [x] **RBAC**（角色/权限点，替换纯登录态判断）：新增 `role` / `permission` / `role_permission` 表 + 内置三角色（super_admin 33 / editor 22 / viewer 6 个权限点）；`middleware/rbac.js` 的 `requirePermission` / `requirePermissionByResource` / `requirePermissionPageByTable`；API 与 SSR 写端点全覆盖；`GET /api/v1/admin/rbac/me` 供前端渲染菜单【已完成，端到端 403 拦截已验证】
- [x] session 瘦身：`ctx.session.userinfo` 原存整行 admin（含 password 哈希），改为只存 `{ _id, username, status, role_id }`【已完成，已验证解码会话无 password】
- [x] **操作审计日志**：新增 `audit_log` 表 + `middleware/auditLog.js` 写操作埋点（业务成功后落库）+ `GET /api/v1/admin/audit/list` 查询（需 `audit:list`）；**入库前脱敏**（password/token→`[REDACTED]`）、超长正文截断【已完成，已验证脱敏与记录完整性】
- [x] 统一响应体 + 错误码规范：修掉全局 500/404 对 `/api` 返回旧风格 `{success:false}` 与 HTML 片段的不一致，API 一律走 `fail()`；`handle` 抽到 `utils/handle.js` 共用【已完成】
- [x] **统一输入校验层（zod）**：JSON API 用 `utils/schemas.js`（单一来源）；SSR 表单用 `validatePageBody` 中间件覆盖 `routes/admin/*` 全部 13 个 doAdd/doEdit【已完成】
- [x] API 版本化 `/api/v1`：`routes/api.js` 去掉内部 prefix，同一套路由双挂 `/api/v1` + `/api`【已完成】

### 待办 — 前端分离前置（公开内容 API）
- [x] `/api/v1/public/*` 公开只读内容 API：settings / nav / focus / links / categories（递归 CTE）/ articles（分页+分类含子孙+关键词）/ articles/:id（详情+上下篇窗口函数）；统一 `{code,message,data}` + `Cache-Control` + 字段白名单【已完成】

### 待办 — P2 SEO / 部署 / 工程化
- [ ] SEO 增强（sitemap.xml / robots.txt / meta / OG / JSON-LD）【未开始】待前端方案确定后做
- [ ] Dockerfile + pm2 cluster + CI/CD + nginx 示例【未开始】暂不做，准备部署时再做
- [ ] 上传上对象存储（OSS/S3）【未开始】暂不做，上传走本地
- [x] healthz 健康检查 + 全局限流：`/healthz`（查 DB，返回 status/env/uptime/latency）+ `middleware/rateLimit.js`（按 IP，只罩 /api 与 /admin，静态与 healthz 豁免）【已完成】
- [x] **Swagger / OpenAPI（自动生成）**：请求 schema 只在 `utils/schemas.js` 定义一份，路由用它校验、`utils/openapi.js` 用 `z.toJSONSchema()` 转成 OpenAPI 3.1；`GET /api/v1/openapi.json` + `GET /api/v1/docs`（Swagger UI）【已完成，19 条路径自动生成】
- [x] 测试套件：用 **Node 内置 `node:test`**（零依赖）替代 vitest，`pnpm test` 共 **42 项全绿**（响应体/错误码、zod、XSS 净化、上传白名单、两个限流器、**审计脱敏、handle 映射、RBAC 兜底、OpenAPI 生成**）【已完成】
- [ ] 替换 ueditor → wangEditor / TipTap【未开始】

### 待办 — SQL 教学化（贯穿各批次，把基础/进阶/高级用上）
- [x] 后台列表 JOIN 替代冗余 catename + 消灭 N+1（`services/articleService.list` 用 `LEFT JOIN articlecate` 取 `cate_name`）【已完成】
- [x] 树形分类 `WITH RECURSIVE` 递归 CTE：`contentService.getCategoryTree()` 一次查出整棵树；`listArticles({cateId})` 用递归子树实现"含所有子孙分类"的筛选【已完成】
- [x] 统计报表 `GROUP BY` + 窗口函数：`statsService` 提供 `COUNT(*) FILTER` 多维统计、`GROUP BY` + `date_trunc` 按月趋势、`ROW_NUMBER/RANK/DENSE_RANK` 三种排名 + 占比 + **累计占比**（帕累托）、`PARTITION BY` + `ROW_NUMBER` **分组 TopN**；另有 `LAG/LEAD` 取文章上下篇（`contentService.getArticle`）【已完成】
- [x] 分页 / 模糊搜索 / **事务** 实战样例：【已完成】分页与 `ILIKE` 模糊搜索见 `contentService`、`articleService`；事务见 `rbacService.setRolePermissions`（清空+写入原子化）与 `removeRole`（删关联+删角色原子化）
- [x] 物理外键 + 级联删除（教学对比）：`role_permission` **故意不加外键**，导致删角色必须自己在事务里先删关联行——这正是"有外键 vs 无外键"的活教材（见 `rbacService.removeRole` 注释与 `docs/database-sql.md`）【已完成（教学对比）】
- [x] 多对多中间表：`role_permission`（角色 ↔ 权限点）就是标准多对多中间表实现，含唯一索引防重复授权【已完成】
- [x] `EXPLAIN` 执行计划分析：`GET /api/v1/admin/stats/explain?query=<白名单键>`（`EXPLAIN ANALYZE, BUFFERS, FORMAT JSON`，**只接受白名单键，绝不执行客户端传来的 SQL**）；`docs/database-sql.md` 补了"怎么读 EXPLAIN"对照表【已完成】

---

## 许可证

内部项目，未开放授权。
