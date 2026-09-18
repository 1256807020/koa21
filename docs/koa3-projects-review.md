# Koa3 生态项目横向评审 + 媒体存储选型

> 目的：把 2026 年在 GitHub 上仍然活跃的三个 Koa 系项目（`koa22` / `koa23` / `koa24`）
> 拆开看，找出**值得我们项目借鉴的做法**并判断是否已经具备；同时回答
> "阿里云 OSS 免费吗 / 出海用哪个对象存储"这个问题。
>
> 数据核实时间：**2026-09-18**（价格与免费额度会变，请以官方页面为准）。

---

## 一、三个项目速览

| 项目 | 定位 | 技术栈 | 我给的评价 |
|---|---|---|---|
| **koa22** | **生成 Koa3 项目的 CLI 脚手架**（自身即模板源） | koa 3.2.1、@koa/router 15、joi、ejs、dotenv、CJS | 工程化**最成熟**的一个：分层、日志、错误处理、发版流程都成套；但测试几乎为零 |
| **koa23** | Koa3 + TypeScript starter | koa 3.1.1、zod 4、vitest 4、supertest、TS 5.9、ESLint flat config | **TypeScript 实践最值得学**（ctx 类型增强、错误类型、zod 中间件）；但无分层、apollo 式缺 controller/service |
| **koa24** | 前后端 monorepo 全栈模板 | pnpm workspace + Koa + Vue + Docker + PM2 | **部署与运维最完整**（Docker/compose/PM2/优雅关闭/自动路由注册）；但**后端实际跑在 Koa2**（见坑 1） |

---

## 二、做得好的地方（值得抄）

### 2.1 来自 koa22

| 做法 | 位置 | 说明 |
|---|---|---|
| 洋葱模型的装配顺序 | `app/setup.js:71-85` | 访问日志 → 错误处理 → 路由 → 404，**顺序正确**且把"错在哪一层"说清楚了 |
| **请求追踪 `x-request-id`** | `app/middleware/requestLogger.js:6-26` | 请求进来先取/生成 requestId，挂到 `ctx.state` 并回写响应头；`try/finally` 保证异常也记录耗时。排障时能把"这条错误日志对应哪个请求"串起来 |
| `errorHandler` + `app.on('error')` 双通道 | `app/middleware/errorHandler.js:6-27` + `app.js:22-28` | 中间件负责给响应，`app.on('error')` 负责打日志，职责分离 |
| **校验错误归一化** | `app/lib/validator.js:11-44` | 一律 `err.status = 422` + `err.details = [{field,message}]`，由同一个错误处理器消费 |
| 日志按天分文件 + 访问日志 JSON 行 | `app/lib/logger.js:87-116` | 访问日志用 `JSON.stringify` 输出，便于 ELK/Loki 采集 |
| **CORS 默认关闭、显式开启** | `config.default.js:20-25` | `enable: process.env.CORS_ENABLE === 'true'` —— 安全默认值做对了 |
| 登录限流 | `templates/admin/app/middleware/loginRateLimit.js:19-41` | IP + 15 分钟窗口，和我们已有的限流同思路 |
| CLI 生成时净化 package.json / lock 根项 | `bin/cli.js:208-253` | 避免业务项目继承脚手架的发布元数据；连 `npm ci` 的 name mismatch 都处理了 |
| 失败即回滚 | `bin/cli.js:353-356` | 生成出错时 `fs.rmSync` 掉半成品 |

### 2.2 来自 koa23

| 做法 | 位置 | 说明 |
|---|---|---|
| **`ctx.ok/fail/error` 原型挂载 + 类型声明** | `src/types/koa.d.ts:1-16` + `src/app/context.ts:6-17` | 运行时在 `app.context` 上挂**一次**（不每请求赋值），类型侧用 `declare module 'koa'` 补齐。调用点直接 `ctx.ok(data)` |
| **错误类型 + 集中映射** | `src/errors/AppError.ts:2-11` + `src/app/mapError.ts:6-25` | `AppError(code, message, expose)`，mapError 用 `unknown` 收参、逐层 `instanceof`/`in` 收窄：AppError → ZodError → 带 status 的 → 500 |
| **zod 校验中间件** | `src/middlewares/validate.ts:6-24` | ZodError 转成 AppError(400)，约定 schema 外层包 `{body, query, params}` |
| **环境变量强类型化** | `src/config/index.ts:6-28` | 用 zod parse `process.env`，失败就 `console.error` + `process.exit(1)`；全项目只见 `config.port`，不再散落 `process.env` |
| 健康检查端点 | `src/routes/health.ts:6-12` | 返回 `status/env/timestamp` |
| **vitest + supertest 测 Koa app** | `tests/http.test.ts:1-41` | 诀窍是 **app 与 server 分离导出**（`http.createServer(app.callback())` 单独一处），测试只 import `app` 就不会真的 listen |

### 2.3 来自 koa24

| 做法 | 位置 | 说明 |
|---|---|---|
| **优雅关闭** | `backend/src/app.js:84-96` | `process.on('SIGTERM')` → `server.close()` → `await closeDatabase()` → `process.exit(0)` |
| Docker 单容器托管前后端 | `Dockerfile:16-24` | 前端 dist 拷进后端 dist/public，由 koa-static 统一提供；`corepack enable` 免全局装 pnpm |
| compose healthcheck + `start_period` | `docker-compose.yml:12-19` | `start_period: 10s` 给启动留宽限，比常见写法严谨；`restart: unless-stopped` |
| **PM2 cluster 配置** | `ecosystem.config.json:6-18` | `instances:"max"` + `exec_mode:"cluster"` + `max_memory_restart:"1G"` + 日志分文件 |
| 自动路由注册 | `backend/src/router/index.js:8-28` | 扫描目录动态 import，新增模块零改动 |
| API / SPA 路径分流 | `backend/src/app.js:54-68` | 末位中间件判断 `/api` 前缀返回 JSON 404，否则落 index.html |
| 上传硬限制 | `backend/src/router/upload.js:9-19` | `fileSize:5MB` + `fileFilter` 只放行 jpeg/png/gif/webp |

---

## 三、他们踩的坑（我们不要重蹈）

| # | 坑 | 出处 |
|---|---|---|
| 1 | **名不副实**：`backend/package.json` 声明 koa `^2.16.4`，lock 里实际解析 2.16.4 —— 整个项目号称 Koa3 却跑在 Koa2 | koa24 |
| 2 | **没有全局错误中间件**，全靠每个 controller 手写 try/catch + `error.message === '用户名已存在'` 字符串比对映射状态码 | koa24 |
| 3 | **CORS `origin:'*'` 与 `credentials:true` 同时用** —— 浏览器会拒绝，这个组合本身无效 | koa24 |
| 4 | 生产 `sequelize.sync({alter:true})` 自动改表，有丢数据风险 | koa24 |
| 5 | 密钥进仓库（`.env.docker` 明文 JWT_SECRET）；根 package 混装子包依赖导致版本漂移 | koa24 |
| 6 | 前后端**无共享 schema**：前端手写 interface、后端手写校验函数，两套契约各写一遍 | koa24 |
| 7 | **测试几乎为零**：只有测 CLI 文件生成的用例，没有任何路由/中间件单测（尽管 app 已导出） | koa22 |
| 8 | `app/middleware/index.js` 的响应包装有缺陷：任何不含 `success` 字段的对象（含 Buffer/Stream）都被强制包成 `{success:true,data}` | koa22 |
| 9 | **master 版 `setup.js:44` 引用了未定义的常量**会直接抛错，但 CI 从不测 HTTP，所以没被发现 | koa22 |
| 10 | `Object.assign` 浅合并配置，`config.local.js` 只写 `{logger:{level}}` 会整体覆盖掉 dir/enableFile | koa22 |
| 11 | **无优雅关闭**：直接 `app.listen` 不保存句柄，部署时硬杀请求 | koa22 |
| 12 | 一律 HTTP 200 + `body.code`，破坏 REST/缓存语义，测试里出现 `expect(res.status).toBe(200)` 这种反直觉断言 | koa23 |
| 13 | `ctx.state.validated` 声明成 `unknown`，导致调用点只能 `as` 断言，类型链路断裂 | koa23 |
| 14 | ESLint 关掉 `no-explicit-any`，工具函数里立刻出现成片 `any` | koa23 |
| 15 | `.env.example` 里有完全没被消费的死配置项 | koa23 |

---

## 四、对照我们项目：已具备 / 本轮补齐 / 不采纳

| 项 | 我们 | 结论 |
|---|---|---|
| 统一响应体 `{code,message,data}` | `utils/response.js` | ✅ 已有（坑 8 的问题我们没有） |
| 全局错误兜底 + 404 分流 JSON/HTML | `app.js:38-72` | ✅ 已有（坑 2 的问题我们没有） |
| requestId | `utils/response.js` | ✅ 已有 |
| 环境变量 zod 强类型校验 | `middleware/envCheck.js` | ✅ 已有（对应 2.2 的亮点） |
| 优雅关闭 SIGINT/SIGTERM + 关连接池 | `app.js:229-241` | ✅ 已有（koa24 的亮点我们早就有，且多了 5s 兜底） |
| 进程级兜底 unhandledRejection | `app.js:243` | ✅ 已有 |
| `/healthz` 依赖探测（DB + 缓存后端） | `app.js:167-189` | ✅ 已有 |
| zod 校验 + OpenAPI 单一来源 | `utils/schemas.js` + `utils/openapi.js` | ✅ 已有，且比 koa23 更进一步（一份 schema 两处消费，避免契约漂移） |
| 分层 router→service | `services/` | ✅ 已有（koa23 缺这块） |
| **审计日志归档（冷热分离）** | **`scripts/audit-archive.js` + `audit_log_archive` 表** | 🆕 **本轮从 koa22 的"日志会无限增长"缺陷反推，补齐** |
| **删除记录时清理孤儿图片** | **`utils/fileCleanup.js`** | 🆕 **本轮新增**（带 path containment，防任意文件删除） |
| **prevPage 开放重定向** | `utils/redirect.js` 兜到所有调用点 | 🆕 **本轮补齐**（原来只有 `/admin/remove` 系列走了 safeBackPath，`article/nav` 的 doEdit 仍在裸跳） |
| Docker / docker-compose | 无 | ⏳ **待做**（见下） |
| PM2 ecosystem | 无 | ⏳ 待做（单实例部署前可先跳过） |
| 迁移 TypeScript | CJS + JS | ❌ **不采纳**：收益主要在大型团队/多人协作；单人演进项目先做前端分离更有价值（同理 ESM 也不迁，见 dev-notes 8.5） |
| 代码混淆 | 无 | ❌ **不采纳**：koa24 自己也只开了字符串数组、关掉了控制流扁平化，服务端 Node 代码混淆防不住逆向，反而损伤堆栈可读性 |

**最值得我再补的两项（下一个 P2）**：`Dockerfile` + `docker-compose.yml`（含 healthcheck 与 `depends_on` 依赖等待）、`ecosystem.config.json`（PM2 部署）；
这两项都是"配置型收益"，几乎零代码风险，但对上线帮助最大。

---

## 五、媒体上传：阿里云 OSS 免费吗？出海用什么？

### 5.1 先回答：阿里云 OSS 免费吗

**不是永久免费。** 阿里云官方给的是**新用户免费试用额度**（完成实名认证且未开通 OSS 的前提下有一小段免费试用），
到期后按"存储费 + **公网下行流量费** + 请求费"计费。国际站 2026 年的公开价格大致是：
标准存储 **$0.0173/GB/月**（约 1TB ≈ $17.7/月），**前 5GB 免费**，外网下行单独计费。
> 来源：`help.aliyun.com/zh/oss/free-quota-for-new-users`、`alibabacloud.com/help/zh/oss/free-quota-for-new-users`

**判断**：如果你要**出海**，阿里云 OSS 不是最优解 —— 它的强项在国内 CDN 与备案链路，
出海场景下流量费和区域都不占优势。

### 5.2 出海 / 内容站的更优选择（截至 2026-09）

| 方案 | 免费额度 | 关键优势 | 适合谁 |
|---|---|---|---|
| **Cloudflare R2** | **10 GB 存储** + 100 万次 A 类操作 + 1000 万次 B 类操作/月 | ⭐ **Egress 流量费 = 0**（这是它碾压 S3 的点） | **出海内容站首选**：图片/视频外链流量不心疼 |
| **Backblaze B2** | **10 GB 存储免费** | 加入了 Cloudflare **Bandwidth Alliance** → 经 Cloudflare 出流量**免费**；单价便宜 | R2 之外的备选，做冷备份很划算 |
| **Supabase Storage** | Free 计划 $0/月（含 500MB 数据库、**5 GB egress**） | 和 Postgres / Auth 一体，自带图片变换与 CDN | 想"一个平台搞定 DB + 鉴权 + 存储"时 |
| 阿里云 OSS | 仅新用户试用；国际站前 5GB | 国内访问快、中文文档与备案配套 | **主要用户在国内**时才划算 |

### 5.3 给我们项目的建议

**短期（现在）**：保持本地 `public/upload/` 不动 —— 它已经过了 P0 加固
（`tools.uploadFileFilter` + `model/ueditor.js` 双白名单、`nosniff`、 extension+MIME 双校验）。

**中期（出海上线时）**：迁移到 **Cloudflare R2**，理由三条：
1. **egress 免费** —— 内容站的流量特点就是"读多写少"，图片外链流量才是大头，R2 这一项就能把可变成本降到 0；
2. **S3 兼容 API** —— 现成的 S3 SDK 直接可用，改造成本极低；
3. 天然全球 CDN 边缘，出海建站不用自己搭加速。

**迁移时要做的两件事**（现在就该在心里有数）：
- **不要写死域名**：图片 URL 应该走一个配置项（如 `MEDIA_BASE_URL`），而不是把 `/upload/xxx.png` 硬编码进模板和数据；
  否则迁移 OSS 时要改库。我们目前 `tools.imgUrl` 返回相对路径，template 用 `{{__HOST__}}` 拼——**将来改成配置项即可，成本低**；
- **继续保留上传白名单**：换到对象存储不等于可以放松校验，反而因为资源会被公开 CDN 分发，
  更要把"只能传图片/视频"这条守住（`tools.uploadFileFilter` 与 `model/ueditor.js` 的两套白名单继续生效）。

---

## 六、一句话总结

三个项目里 **koa22 的工程习惯最好、koa23 的 TS 功底最好、koa24 的运维形态最完整**，
但三者各自的坑（版本不符、无全局错误处理、CORS 组合无效、测试为零、配置浅覆盖、无优雅关闭）
恰好都是"看起来能用但生产会疼"的类型。

对照之后：这三家的**多数优点我们项目已经具备**（统一响应体、全局错误兜底、requestId、env 强校验、优雅关闭、依赖探测健康检查、zod+OpenAPI 单一来源）。
本轮补的是它们的**共同短板**：可运维性（审计归档）与数据一致性（孤儿文件清理）。
下一个 P2 建议补 **Docker + PM2** —— 那是纯配置、零风险、但对上线帮助最大的一块。
