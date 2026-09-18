# Koa21 CMS

一套基于 Koa2 的内容管理系统（CMS）。前台为服务端渲染的官网，后台为管理界面。
2026-09 完成 **MongoDB → PostgreSQL 18** 数据层迁移与全套依赖升级，包管理由 npm 切换为 pnpm。

---

## 一、项目简介

- 前台官网：首页 / 案例 / 新闻 / 内容详情 / 分类筛选，服务端渲染（SEO 友好、零构建）。
- 后台管理：管理员、内容分类、文章（富文本）、轮播图、友情链接、导航、系统设置。
- 定位：展示型官网 + 轻量内容后台，非高并发业务系统。

## 二、技术栈

| 层 | 技术 |
|---|---|
| Web 框架 | Koa 3.2.x + @koa/router |
| 会话 | koa-session（cookie session，httpOnly + signed） |
| 模板 | koa-art-template + art-template（服务端渲染） |
| 数据库 | PostgreSQL 18（驱动 `pg`） |
| 静态服务 | koa-static |
| 跨域 | @koa/cors（仅对 `/api` 开放） |
| 鉴权/安全 | bcryptjs（密码哈希）、svg-captcha（登录验证码） |
| 上传 | @koa/multer + multer（本地磁盘 `public/upload`） |
| 日志 | log4js |
| 后台 UI | jQuery + Ace Admin 1.x 模板 |
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

## 八、数据库（表）

| 表 | 用途 |
|---|---|
| `admin` | 管理员（username、password[bcrypt]、status、lasttime） |
| `articlecate` | 内容分类（`pid='0'` 为一级） |
| `article` | 文章（`_id`、title、content、pid、img_url、sort、status…） |
| `nav` | 导航 |
| `focus` | 轮播图 |
| `link` | 友情链接 |
| `setting` | 系统设置（单行） |

主键统一为 `_id`（`text`，24 位十六进制，`gen_oid()` 生成），兼容原 Mongo 写法。

## 九、API 概览

**前台公开接口（JSON，`/api/*`，CORS 开放）**

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/catelist` | GET | 分类列表 |
| `/api/newslist` | GET | 新闻列表（支持分页/分类） |
| `/api/addCart` | POST | 示例写接口 |
| `/api/editPeopleInfo` | PUT | 示例写接口 |
| `/api/deleteCart` | DELETE | 示例写接口 |

**后台接口（服务端渲染，非 JSON）**

后台管理目前是**传统服务端渲染**：列表页 `GET /admin/:module`，表单页 `GET /admin/:module/add`、`/edit`，提交 `POST /admin/:module/doAdd`、`/doEdit`，返回页面或重定向。**后台暂未提供 JSON CRUD 接口**（见改造计划 P0）。

## 十、部署建议

- **进程管理**：生产用 `pm2`（cluster 模式）或 `docker`，不要裸 `node`。
- **反向代理**：Nginx 前置，设 `TRUST_PROXY=true`，SSL 终止在 Nginx，Cookie `secure`。
- **静态资源 / 上传**：当前上传存本地 `public/upload`；多实例/对象存储场景应迁移到 OSS/S3。
- **健康检查**：建议补充 `GET /healthz` 探测 DB 连通性。

## 十一、安全现状

**已具备（做得好的部分）**

- SQL 全部参数化（`model/db.js`）+ 表名/字段名白名单（`assertIdent`），**从根上杜绝 SQL 注入**。
- 密码 bcrypt 哈希存储；验证码一次性。
- 全局异常兜底 + 访问日志；生产环境隐藏内部错误。
- session：`httpOnly` + `signed` + `sameSite`。

**仍存在的风险（见改造计划 P0）**

- 后台删除走 `GET /admin/remove?collectionName=表&id=`（CSRF 零成本 + 表名可控）。
- 全站无 CSRF 防护；上传无文件类型白名单；前台富文本 `{{@content}}` 不过滤（存储型 XSS）；登录无限流；验证码明文落日志。

## 十二、改造计划与待办（Roadmap）

> 优先级：P0 = 安全/升级前置，上线前必修；P1 = 质量与权限；P2 = SEO/部署/工程化。

### P0 — 安全（上线前必修）

- [ ] **删除接口重构**：去掉 `collectionName` 表名参数，改为 `POST /api/admin/:resource/:id/delete`，加权限校验 + CSRF token。
- [ ] **全站 CSRF 防护**：引入 `koa-csrf` 或双提交 Cookie 方案，覆盖所有写操作。
- [ ] **上传文件类型白名单**：`tools.multer()` 增加 `fileFilter`，仅允许图片类（png/jpg/gif/webp）。
- [ ] **前台富文本 XSS 净化**：`content.html` 的 `{{@list.content}}` 服务端经 `sanitize-html` / DOMPurify 净化后再输出。
- [ ] **清理验证码明文日志**：删除 `routes/admin/login.js` 中的 `console.log(captcha.text)`；生产 `COOKIE_SECURE=1`。
- [ ] **登录限流与锁定**：引入 `koa-ratelimit` 或失败计数锁定，降低爆破风险。

### P0 — 升级后台框架的前置

- [ ] **后台 CRUD 补 JSON API**：在 `routes/admin/*` 之上新增 `/api/admin/*` 返回 `{ code, message, data }` 统一结构（增删改查 + 分页 + 校验）。这是换 Vue3/React 后台模板的底座。

### P1 — 质量与权限

- [ ] **RBAC**：角色 + 权限点，替换当前"仅登录态"判断（`routes/admin.js` 的 `ctx.session.userinfo`）。
- [ ] **操作审计日志**：记录谁、何时、改了什么。
- [ ] **统一响应体与错误码**：前台/后台统一 `{ code, message, data }` 规范，定义错误码表。
- [ ] **统一输入校验层**：引入 zod/joi，替换散落在各路由的正则校验。
- [ ] **API 版本化**：`/api/v1` 前缀，便于后续不兼容升级。

### P2 — SEO / 部署 / 工程化

- [ ] **SEO 增强**：`sitemap.xml`、`robots.txt`、每页 `meta description` / Open Graph、结构化数据（JSON-LD）。
- [ ] **部署工程化**：`Dockerfile` + `pm2` cluster + CI/CD + Nginx 示例配置。
- [ ] **上传上云**：迁移到 OSS / S3 / 七牛，解耦本地磁盘。
- [ ] **可观测性**：`/healthz` 健康检查 + 全局限流中间件。
- [ ] **API 文档**：Swagger / OpenAPI 自动生成。
- [ ] **测试套件**：vitest 单元 + 接口测试（当前无测试）。
- [ ] **富文本编辑器替换**：ueditor 已停止维护，迁移到 wangEditor / TipTap。

## 十三、已知问题

- 后台部分删除入口为占位（`manage.js` 的 `/delete` 仅返回 '删除用户'），实际删除依赖 `remove` 路由，且为 GET 方式、表名可控（见 P0）。
- 系统设置中"网站地址"为种子数据值，生产请在前台设置页修改。
- 后台管理 UI 为老版 Ace Admin（jQuery 时代），交互与可维护性落后于现代框架，建议按 P0 JSON API 完成后升级。

---

## 许可证

内部项目，未开放授权。
