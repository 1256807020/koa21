# 开发笔记（教科书级 Koa3 全栈案例）

> 本文件记录从"能跑的 CMS"演进到"规范全栈框架"过程中的**设计决策、踩坑与处理经验**。
> 目标读者：想搞懂"为什么这么写"的前后端同学。每条都尽量讲清：现象 → 原因 → 解法 → 教训。

---

## 阶段一：搭建分层骨架与统一响应（P0 底座）

### 1.1 为什么要从「路由直接写 SQL」改成分层

**现象**：原代码 `routes/admin/manage.js` 的 `doAdd`/`doEdit` 里直接拼 SQL，再 `ctx.render('admin/error', ...)` 或 `ctx.redirect(...)`。

**问题**：
1. 页面（SSR）和 API 共用同一套逻辑，无法复用——将来换 SPA 后台要重写一遍。
2. 没有统一出参，前端靠"有没有重定向 / 有没有渲染错误页"猜成功与否，极脆弱。
3. 业务规则（密码加密、权限判断）散落各处，难测试、难审计。

**解法**：引入三层
```
routes/api/admin.js  → 只做：收参数、调 service、出 JSON
services/*.js        → 业务逻辑 + SQL 编排（教学核心都在这）
model/mongo-sql.js   → 纯数据访问（已扎实，保留）
```

**踩坑经验**：不要一上来把所有路由都改掉。先新增 `/api/admin/*` 并存，页面路由保持原样，
等新 API 跑稳再逐步让页面也调用 service。这叫"绞杀者模式（Strangler Fig）"，能随时回退。

### 1.2 统一响应：用 `code` 还是 HTTP `status`？

**现象**：讨论"业务错误该怎么返回"。

**决策**：默认业务错误也返回 HTTP 200，`body.code !== 0` 表示失败（见 `utils/response.js`）。
- 优点：前端只需一个 axios 拦截器判 `code`，不用区分"网络失败"和"业务失败"两套逻辑。
- 例外：未登录返回 401、无权限返回 403、参数错误 400、不存在 404（`fail()` 允许覆盖 `status`）。

**踩坑经验**：koa 里 async 路由 `throw` 会一路冒到全局错误处理中间件。
业务错误必须**显式** `return fail(...)`（用 `handle` 包装统一做），不能 `throw`，否则会被当 500、
返回旧风格 `{success:false}`，与我们新的 `{code}` 风格冲突、还会误打错误日志。

### 1.3 错误码表（`utils/code.js`）

**经验**：用具名常量 + 注释，取代 `ctx.body={success:false, msg:'错误'}`。前端可据此精准提示。

### 1.4 输入校验上 zod（`utils/validate.js`）

**经验**：原代码用正则散校验（如 `username.match(/^\w{4,20}/)`），漏一处就多一个脏数据入口。
改用 zod 后，schema 即文档、即校验、即类型转换（`z.coerce.number` 自动把 `"1"` 转 1）。
**坑**：zod 不是 koa 自带，需 `pnpm add zod`；且要在路由层识别 `ZodError` 转 `PARAM_ERROR`（本阶段在 `handle` 里统一兜）。

---

## 阶段二：services 层 + /api/admin JSON API + JOIN（进行中）

### 2.1 services 层落地
把 `routes/admin/manage.js` 里"路由直接写 SQL"抽进 `services/adminService.js` / `services/articleService.js`。
路由只调 service，SQL 全在 service；service 抛带 `.code` 的错误，由路由 `handle` 统一转 `fail()`。

### 2.2 SQL 教学第一例：JOIN 替代 N+1（见 `services/articleService.list`）
**原写法（N+1）**：先查 article 列表，再循环对每条查一次 articlecate 补 catename → O(N) 次查询，慢。
**改法**：一条 SQL `LEFT JOIN articlecate c ON c._id = a.pid`，分类名 `c.title AS cate_name` 随行返回。
**踩坑**：
- JOIN 后分类列要起别名（cate_name），否则与 a.title 混；
- 模糊搜索的 `%` 必须拼在**参数值**里（`'%' + title + '%'`），绝不能拼进 SQL 字符串，否则前功尽弃；
- 分页参数 `LIMIT $n OFFSET $m` 的位置号要在 where 参数之后顺延（本例用 `whereParams.length + 1/2`）。

### 2.3 路由驱动表 vs 每资源一套路由
用 `services = { manage: adminService, article: articleService }` + `:resource` 动态路由，
避免 6 个资源写 6 套重复路由。**新增资源 = 加一个 service 文件 + 在映射表加一行 + 加一个 add schema**。

### 2.4 统一错误处理 `handle(fn)`
抽 `handle` 包装：try/catch service 抛错 → `fail(ctx, e.code)`。系统异常（未捕获）才走全局 500。
**踩坑**：koa 捕获 async 路由 throw 冒泡到全局 error 中间件；业务错误必须显式 fail，否则打 500 日志、
返回 `{success:false}`（与 `{code}` 不一致）。`handle` 里按 code 映射更语义化的 HTTP status（401/403/400/404）。

### 2.5 删除接口重构（搭底座时一并做）
`GET /admin/remove?collectionName=表&id=` → `POST /api/admin/:resource/:id/delete`。
真正调用 `DB.remove`（原占位 `ctx.body='删除用户'` 从未实现）。
**注意**：CSRF / 权限校验将在 P0 安全下一步补，本阶段先把"能删 + 参数化防注入"落地。

### 下一步（阶段三）
- CSRF 防护（koa-csrf）
- 上传白名单 / XSS 净化 / 验证码日志清理 / 登录限流
- P1 RBAC / 审计 / 版本化 / 统一校验固化
