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

### 2.6 验证状态与开发踩坑（务必记下来）
**踩坑 A：nodemon 旧进程不热重载**
现象：改完 `routes/api.js` 后 curl `/api/admin/*` 仍 404。
原因：正在跑的 3000 实例是**旧进程**，nodemon 没触发重启（或根本不是 nodemon 起的）。
解法：`netstat -ano | grep :3000` 找 PID → `taskkill //F //PID <pid>` → `nohup pnpm dev &` 重启。
教训：改了路由/中间件后若现象不对，先怀疑"跑的是不是最新代码"，别急着改逻辑。

**踩坑 B：execute_command 把带 `&` 的后台命令误判成 watch**
现象：一条命令里 `nohup pnpm dev &` 之后跟 `sleep/curl`，输出被截断、只看到 kill 部分。
原因：工具把含后台常驻进程的命令当成 watch 监控，10s 超时截断。
解法：启动服务与"发请求验证"拆成两条独立命令；验证命令纯 curl，不带 `&`。

**当前状态（2026-09-18 实测通过）**：端到端 curl 全绿——
管理列表返回 `{code:0,...}`；文章列表 row 带 `cate_name`（LEFT JOIN 生效）；
zod 失败返回 `{code:1001,message:"用户名至少 2 位；密码至少 6 位"}`（HTTP 400，message 已转中文）；
新增 → 拿到 `_id` → 删除闭环 → 列表不再含该记录。P0 底座打通。

### 2.7 踩坑 C（最致命）：`require('./admin')` 相对路径加载错模块，导致 404 数小时
**现象**：`/api/admin/manage/list` 始终 404，但 `/api/catelist` 正常。无论怎么改前缀、改 `use` 路径都无效。
**原因（真凶）**：`routes/api.js` 里写的是 `require('./admin')`，而 `api.js` 位于 `routes/` 目录，
`./admin` 解析为 **`routes/admin.js`**（旧 SSR 后台路由），并非我新建的 `routes/api/admin.js`（JSON API）！
于是在 404 现象下，实际嵌套进去的是旧 SSR 路由（`/api/admin/manage/add`、`/api/admin/login`…），
`/api/admin/manage/list` 这种新路径压根不存在 → 404。之前所有"前缀剥离"猜想都是被表象带偏的误判。
**定位方法（关键经验）**：在 `api.js` 末尾加一行调试打印 `router.stack.map(l => l.path)`，
发现 stack 有 54 层且全是旧 SSR 路由名，才真相大白。*:route 注册表是排查 404 的终极武器*。
**解法**：`require('./admin')` → `require('./api/admin')`（指向 `routes/api/admin.js`）。
**教训**：
1. 同目录有多个同名/近名模块时（如 `routes/admin.js` 与 `routes/api/admin.js`），`require` 的相对路径
   是相对"当前文件所在目录"，不是"直觉上的兄弟文件"。写完后用调试打印 stack 验证注册了哪些路由。
2. 404 排查顺序：先看路由 stack 里到底有没有这条路由（模块加载对了没）→ 再看前缀/剥离 → 最后看中间件顺序。
3. 不要被"前缀剥离叠加"这类看似合理的理论带偏，用最小复现 + 打印 stack 拿证据。

### 2.8 踩坑 D：nodemon 抢端口 + 多进程堆积，导致"跑的不是最新代码"
**现象**：改完代码 curl 仍 404，日志却显示已重启。
**原因**：多次 `nohup pnpm dev &` 累积了十几个 nodemon 监视器；每次 nodemon 自动重启时旧 node 子进程
还没释放 3000 端口，新实例 `EADDRINUSE` 崩溃退出，于是**一直由某个旧进程在服务**，改的代码永远不生效。
**解法**：调试阶段改用单进程 `node app.js`（不用 nodemon），改文件后 `taskkill //F //IM node.exe` 干净重启再测，
彻底排除"热重载到底有没有生效"的干扰。生产/日常开发仍用 `pnpm dev`。
**教训**：排障第一步先 `netstat -ano | grep :3000` 确认"现在服务的是哪个 PID、是不是最新代码"，
别在旧进程上反复改逻辑。

### 下一步（阶段三：P0 安全其余 5 项 + P1 起点）
- CSRF 防护（koa-csrf 或双提交 Cookie），套在 handle 外层
- 上传文件类型白名单（tools.multer fileFilter，仅图片）
- 前台富文本 XSS 净化（content.html `{{@content}}` → sanitize-html）
- 删 `login.js` 验证码明文 `console.log` + 生产 `COOKIE_SECURE=1`
- 登录失败限流/锁定（koa-ratelimit）
- P1：RBAC / 审计 / 版本化 / 统一校验固化

---

## 阶段三：P0 安全（登录守卫 + CSRF 已落地）

### 3.1 两道安全闸门 `middleware/guard.js`
P0 底座的 `/api/admin/*` 一开始**完全没有登录校验**——任何人都能增删管理员，是比 CSRF 更大的洞。
先补登录态守卫，再补 CSRF。两道都放在 `routes/api/admin.js` 的 `router.use(...)` 里（子路由级，只罩 /api/admin/*）：

```js
router.use(requireLogin)   // 未登录 → fail 401（{code:1002}）
router.use(csrfGuard)      // 写请求缺/错 token → fail 403（{code:1007}）
```

**关键踩坑（守卫里必须 fail 而非 throw）**：koa 里 `router.use` 中间件 throw 会冒泡到
`app.js` 全局错误处理中间件，而它给 /api 返回的是旧风格 `{success:false}`，与我们的 `{code}` 不一致。
所以守卫里**直接 `return fail(ctx, code, msg, null, status)`，不调 next、也不 throw**——既拦截又统一出参。
（路由 handler 才用 `handle` 包装 try/catch；`use` 中间件用 fail+return。两者分工要记清。）

### 3.2 CSRF 选「双提交 Cookie」而非 koa-csrf 的 session-secret 模式
**决策**：用双提交 Cookie（见 `issueCsrfToken` + `csrfGuard`）。
- `GET /api/csrf-token`：服务端 `crypto.randomBytes` 生成 token，种进**可读** Cookie（`httpOnly:false`）+ 返回给前端。
- 写请求：前端读 Cookie 回传 `X-CSRF-Token` 头；`csrfGuard` 比 `Cookie === Header`，不等 → 403。
**为什么不用 koa-csrf**：双提交 Cookie 不依赖服务端存 secret，天然适配前后端分离 / SPA（fetch 读 cookie 回传 header），
是 OWASP 推荐的 SPA 方案；教学里还顺带讲清"同源 + sameSite 如何防跨站携带"。代价是不能绑到具体 session（仅同源保护），本项目够用。
**验证**（curl 端到端全绿）：未登录写→401；登录后带 token 写→200；登录后缺 token 写→403（`{code:1007}`）。
**待办**：SSR 老后台表单（doAdd/doEdit）的 CSRF 还没套，列在 README P0 待办，后续补。

### 3.3 删除验证码明文日志 + 生产 COOKIE_SECURE（已完成）
**现象/风险**：`routes/admin/login.js` 的 `/code` 里 `console.log(captcha.text)` 把一次性验证码**明文**打进日志，
攻击者只要能读到日志就能绕过人机校验，限流形同虚设。
**解法**：删掉该行；生产 `.env.production` 设 `COOKIE_SECURE=true`（由 `config.session.secure` 驱动，
会话 Cookie 与 CSRF Cookie 会同时带上 `Secure`，仅 https 传输）。
**验证**：触发 `/admin/login/code` 后日志中不再出现 4 位明文验证码。
**教训**：任何"凭据 / 一次性令牌"（密码、验证码、token）都禁止进日志，哪怕是 debug。

### 3.4 上传白名单：扩展名 + MIME 双校验，并把 SVG 踢出（已完成）
**原状态**：只在 `storage.filename` 回调里校验扩展名（可改后缀绕过），且白名单里含 `.svg`。
**三层风险**：
1. 只查扩展名 → 把 `shell.html` 改名 `shell.png` 即可上传；
2. `.svg` 是 XML、可内嵌 `<script>`，直接就是存储型 XSS 载体；
3. 静态目录依赖浏览器 MIME 嗅探，可能把上传的 HTML 当脚本执行。
**解法**：
1. multer `fileFilter` 同时校验「扩展名 ∈ 白名单」**且**「MIME === 该扩展名的期望值」（`ALLOWED_MIME` 映射）；
2. 白名单移除 `.svg`；
3. `app.js` 的 `koa-static` 加 `setHeaders` → 所有静态文件带 `X-Content-Type-Options: nosniff`（禁 MIME 嗅探）。
**工程经验**：`fileFilter` 抽成模块级 `uploadFileFilter` 并导出，与 multer 实例解耦、可单测；
multer 在**接收流之前**调用它，尽量早拒绝、少落盘。
**验证（单测 5 例全绿）**：`.txt` 拒绝、合法 `png`/`jpg` 接受、`png` 后缀但 `mime=text/plain` 拒绝、`svg` 拒绝。
**踩坑**：本想通过 SSR `/admin/article/doAdd` 做上传的**集成测**，结果整个 `/admin/*` 被登录守卫**重定向到 `/admin/login`（302）**，
未登录根本走不到 multer ——误把 302 当成"上传成功"。教训：集成测前先确认路由的鉴权/重定向行为；
本次改用"抽函数 + 单测"的确定性验证（顺带确认了 SSR 后台已被守卫保护）。

### 3.5 前台富文本 XSS 净化（已完成 · 输入净化而非输出转义）
**现象**：`views/default/content.html` 用 `{{@list.content}}`（art-template 的**不转义**输出）渲染富文本正文，
只要正文里存了 `<script>` / `onerror=`，任何访客打开即执行 → 存储型 XSS。
**决策**：富文本**必须原样渲染**才有意义，若在输出侧转义，正文就成了一堆纯文本标签。
因此安全靠**入库前白名单净化**，输出侧保持 `{{@content}}` ——这是"输入净化 vs 输出转义"的经典取舍。
**落点（两条入库路径都要盖）**：
1. SSR `routes/admin/article.js` 的 `doAdd`/`doEdit`（直接 `DB.insert`，**不走 service**）；
2. JSON API `services/articleService.js` 的 `create`/`update`。
两者共用 `utils/sanitize.js` 的 `sanitizeArticle`（基于 `sanitize-html`）。
**白名单要点**：`allowedTags` 只放行常见安全标签；`allowedAttributes` 仅 `a`/`img`/`*`(class,id)；
`allowedSchemes` 禁 `javascript:`/`vbscript:`；外链强制 `rel=noopener noreferrer` + `target=_blank`（防 tabnabbing）。
**验证**：`<script>` 被剥离、`onerror` 被剥离、`a[href="javascript:..."]` 的 href 被删、`<b>ok</b>` 保留、外链自动补 `rel`。
**踩坑**：起初 `allowedTags` 只写了 `strong` 没写 `b`，导致正文里的 `<b>` 被整段丢弃（`disallowedTagsMode:'discard'`）。
教训：白名单要覆盖富文本编辑器**实际产出**的标签（含 `b`/`i` 这类老写法），否则会"净化过度"破坏内容。

### 3.6 登录失败限流 / 账户锁定（已完成）
**风险**：后台登录只有「账号 + 密码 + 验证码」；验证码一旦被绕过或日志泄露，就能无限爆破 + 枚举账号。
**解法**：`middleware/loginRateLimit.js` 内存 Map 滑动窗口——同一用户名 15 分钟内连续失败 **5** 次 → 锁定 **15 分钟**；
成功登录即清零；锁定期**直接拒绝**（连验证码都不校验，省资源也堵爆破）。
**教学点**：生产多实例/集群**不能**用内存 Map（各实例计数不共享）→ 必须换 Redis（`INCR`/`EXPIRE` 或 `rate-limiter-flexible`）；
代码已把存储抽象成 `store`，将来替换实现即可，业务逻辑不动。
**落点**：`routes/admin/login.js` 的 `doLogin` 开头 `checkLock`；密码错 / 账号不存在 / 验证码错三个失败分支都 `onFailure`；
成功分支 `onSuccess`。
**验证（单测）**：连续 5 次失败后 `checkLock().locked === true`（`retryAfter=900s`）；`onSuccess` 后解锁。

### 3.7 SSR 后台表单 CSRF（已完成 · 顺带干掉旧危险 GET 写端点）
**背景**：JSON API（`/api/admin/*`）此前已有 CSRF 守卫，但 **SSR 老后台的表单/链接完全没有**。

**一、SSR 表单怎么传 token？**
原生 HTML 表单**设不了自定义请求头**，不能像 fetch 那样用 `X-CSRF-Token`。解法：
把 token 埋成隐藏域 `<input type="hidden" name="_csrf" value="{{csrfToken}}">`，
服务端 `csrfGuardPage` 仍按「双提交 Cookie」比对（`Cookie.csrfToken === body._csrf`）。
`ensureCsrfToken(ctx)` 负责「没有 Cookie 就签发 + 把 token 挂到 `ctx.state.csrfToken` 供模板渲染」。

**二、致命顺序坑：multipart 表单的 body 在 multer 之前是空的**
对 `enctype="multipart/form-data"` 的表单，`koa-bodyparser` **不解析** multipart，
body 要等路由里的 `tools.multer().single(...)` 才解析。若 CSRF 守卫放在路由链前面，
此刻 `ctx.request.body._csrf` 是 undefined → **所有带附件的表单都会被误判 CSRF 失败**。
解法（两条同时用）：
- 路由级守卫对 `ctx.is('multipart')` 的请求**跳过**；
- 各 multipart 路由在 multer **之后**再挂 `csrfGuardPage`：
  `router.post('/doAdd', tools.multer().single('img_url'), csrfGuardPage, handler)`；
- 普通表单（x-www-form-urlencoded）由 app 层 bodyparser 先解析，路由级守卫即可覆盖。
**教训**：中间件顺序不是"越靠前越安全"，要看**数据什么时候才可用**。

**三、默认保护 + 例外显式**：`routes/admin.js` 里
`if (isWrite && !isMultipart && !CSRF_SELF_HANDLED.includes(ctx.path)) return csrfGuardPage(ctx, next)`。
`CSRF_SELF_HANDLED` 列出自行动处理的路径：`/admin/editorUpload`（编辑器自有协议，暂豁免，P2 换 wangEditor 再接）、
`/admin/changeStatus`、`/admin/changeSort`（AJAX，须返回 JSON 而非 HTML 错误页）、`/admin/remove`（表单，返回 HTML 错误页）。

**四、顺带挖出并修掉的「最危漏洞」——旧 GET 写端点其实一直活着**
排查中发现 `routes/admin/index.js` 的三个端点**从未被删**（此前只新增了 JSON API，忘了删旧的）：
```
GET /admin/remove?collectionName=<任意表>&id=...                      → DB.remove(任意表)
GET /admin/changeStatus?collectionName=<任意表>&attr=<任意列>&id=...   → DB.update(任意表, 任意列)
GET /admin/changeSort?collectionName=<任意表>&id=...&sortValue=...     → DB.update(任意表)
```
两个致命点：
1. **GET 写**：`<img src=".../admin/remove?...">` 就能让已登录管理员无感知地删数据（典型 CSRF）；
2. **表名/列名来自 URL 且无白名单**：`model/mongo-sql.js` 只校验标识符**格式**（`/^[A-Za-z_]\w*$/`），
   不校验是否合法表 → 可传任意表越权读写。
解法：
- 三个端点全部改 **POST** + CSRF 守卫（AJAX 用 `csrfGuard` 返 JSON，删除用 `csrfGuardPage` 返错误页）；
- 加**表名白名单** `ALLOWED_TABLES`（admin/article/articlecate/nav/focus/link/setting）与**字段白名单** `ALLOWED_STATUS_ATTRS`；
- 列表页删除是 `<a href>`（只能发 GET）。为不改 6 个模板，在 `public/admin/basic.js` 拦截 `.delete` 点击，
  从 href 解析参数，组装成带 `_csrf` 的 **POST 表单**提交；AJAX 的 `$.get` 全改 `$.post` 并带 `_csrf`；
- token 前端怎么拿？**双提交 Cookie 的 token 本就在可读 Cookie 里**，JS 直接读 `document.cookie` 即可，无需改模板。

**验证（临时脚本 18 项断言全绿，已删）**：登录页埋 token；`doLogin` 缺 token→403；带 token+验证码→302 登录成功；
三个旧 GET 端点→405/404（已下线）；urlencoded 表单缺/带 token→403/302；multipart 表单缺/带 token→403/302；
`/admin/remove` 非白名单表→400、白名单+CSRF→302、缺 token→403。

**⚠️ 附带的安全提醒**：验证时"取验证码"的方式是**直接解码会话 Cookie**——因为 cookie-session 的会话是
base64(JSON) **未加密**的。这说明：**不要把敏感信息放进 session**。本项目 `ctx.session.userinfo = result[0]`
把整行 admin（含 password 哈希）都塞进了会话，P1 应改为只存 `{ _id, username }`。

**踩坑（教训）**：清理测试数据时用 `ls -t | head -1` 找"最新上传文件"并删除，结果**误删了项目原有演示图**
（那次上传其实被重定向到登录页、根本没落盘）。→ 清理前先用 `git status` 确认文件来源，或按精确文件名删；
已用 `git checkout --` 还原。**别用"最新文件"这种模糊条件删东西。**

### 3.8 接口字段泄露：`SELECT *` 把 password 哈希返回给了调用方（已完成）
**发现方式**：写前端架构演进方案时，逐个接口盘字段发现的——不是"出事了才发现"，而是**主动盘点接口返回体**。
**问题**：`services/adminService.js` 的 `list()` 调用 `DB.find(TABLE, where, null, ...)`，
第三个参数 `fields` 传 `null` 就等于 `SELECT *`，于是 `admin.password`（bcrypt 哈希）随列表/详情返回；
`create()` / `update()` 用的是 `RETURNING *`，同样把哈希回了出去。
**为什么现在必须修**：后台还是 SSR 时调用方只有自己人，风险可控；
但**一旦前后端分离、接口对外暴露面变大，返回体里的哈希就是可直接离线爆破的资产**。
**修法**：
```js
const SAFE_FIELDS = { _id: 1, username: 1, status: 1, lasttime: 1 }   // 投影白名单
function safe (row) { const c = { ...row }; delete c.password; return c }  // 兜住 RETURNING *
```
`list/getById` 传 `SAFE_FIELDS`；`create/update` 用 `safe(rows[0])`。
**验证**：`list` 返回字段恰为 `_id,username,status,lasttime`，`getById/create` 均无 `password`。
**教训**：`find`/`query` 的 `fields=null`（=`SELECT *`）是隐蔽的泄露源。**接口返回体要有字段白名单**，
尤其是含凭据的表；盘接口时"这个接口到底返回了哪些字段"要当成一道必答题。

## 阶段四：P1/P2 后端批次（接口规范 + 可观测性）

### 4.1 API 版本化 `/api/v1`（P1）
**做法**：`routes/api.js` **去掉内部 prefix**，前缀完全交给外层挂载决定；然后同一套路由挂两次：
```js
router.use('/api/v1', api) // 正式版本（新代码统一用这个）
router.use('/api', api)    // 兼容旧路径（deprecated）
```
**为什么必须去掉内部 prefix**：若在 api.js 里写死 `prefix:'/api'`，就没法再挂到 `/api/v1` 下
（会变成 `/api/v1/api/...`）。前缀只在一个地方管，最不容易乱。
**顺序坑（重要）**：`/api` 的**前缀匹配**也会命中 `/api/v1/xxx`，所以**必须把更具体的 `/api/v1` 写在前面**，
否则所有 v1 请求都会被旧路径那层先接管。
**验证**：`/api/catelist` 与 `/api/v1/catelist` 均 200；`/api/v1/admin/manage/list` 未登录返回 401（版本化后守卫依然生效）。

### 4.2 统一响应体固化（修掉"第二套响应格式"）
**问题**：业务接口返回 `{ code, message, data }`，但**全局错误处理**对 `/api` 返回的却是旧风格
`{ success:false, message }`；更糟的是 API 的 404 会返回一段 **HTML**（`<h3>404 Not Found</h3>`），
前端拿到后 `JSON.parse` 直接抛错。
**修法**：`app.js` 的全局 handler 里，API 一律走 `fail()`；404 也按前缀分流（`/api` → JSON，其他 → HTML）。
**教学点**：**兜底出口必须和业务出口用同一套响应体**。否则前端要写两套解析分支，
而且这条路径平时不触发、上线才炸，属于最难查的一类不一致。

### 4.3 全局限流 + `/healthz`（P2 可观测性）
- `middleware/rateLimit.js`：按 **IP** 的固定窗口计数。
  与 `loginRateLimit.js`（按**账号**统计"登录失败次数"）**维度不同、互补**：
  一个是防爆破+锁定账号，一个是防接口被刷、保护服务端。
- **只罩 `/api` 与 `/admin`**：静态资源（图片/CSS/JS）不限流，否则用户正常刷页面就会被误伤；
  `/healthz` 不在这两个前缀内，**自动豁免**（探活绝不能被测限流）。
- 响应头 `X-RateLimit-Limit` / `X-RateLimit-Remaining`；超限返回 `Retry-After` + HTTP 429 + `{ code:1008 }`。
- **细节坑**：清理过期 key 的 `setInterval(...).unref()` —— **`unref()` 很关键**，
  否则这个定时器会一直持有事件循环，导致进程无法退出、测试跑完挂住不返回。
- `/healthz`：只查 DB（`SELECT 1`），返回 `status/env/uptime/db/latencyMs`。
  **探活要"轻"**：别把业务校验塞进去，否则探活本身会拖垮服务。
- ⚠️ 内存 Map 仅适合单实例；多实例必须换 Redis，否则 N 个实例 = 限额被放大 N 倍。

### 4.4 session 瘦身（P1 安全）
原来 `ctx.session.userinfo = result[0]` 把**整行 admin（含 password 哈希）**塞进了会话；
而 cookie-session 的会话是 base64(JSON) **未加密**的 —— **会话里放什么，客户端就能读到什么**。
现改为只存最小字段：
```js
ctx.session.userinfo = { _id, username, status }
```
**验证**：登录成功后解码 `koa:sess` cookie，`userinfo` 只剩 `_id/username/status`，`password` 字段已消失。

### 4.5 测试套件（用 `node:test`，不是 vitest）
- **偏差说明（要如实记录）**：README 原计划 vitest，但当前环境把 `pnpm add` 当 watch 进程、10 秒后终止，
  依赖装不上。改用 **Node 内置测试运行器**：`node --test` + `node:test` + `node:assert`，
  **零依赖**，对本项目完全够用。脚本：`pnpm test`。
- **参数坑**：`node --test tests/`（传目录）会被当成**模块入口**去 require → `MODULE_NOT_FOUND`。
  正确写法是传 **glob 并加引号**，让 node 自己展开（跨平台安全）：
  `node --test "tests/**/*.test.js"`。
- 覆盖范围（**26 项全绿**）：统一响应体与错误码表、zod 校验层、XSS 净化、上传白名单、两个限流器。
- **价值定位**：这批用例本质是**安全回归测试**（净化白名单、上传白名单、限流阈值）。
  以后动这些地方，先跑 `pnpm test`，能立刻知道有没有把安全口子改开。

## 阶段五：权限与内容（RBAC / 审计 / 公开 API / SSR 校验 / OpenAPI）

### 5.1 RBAC 模型：为什么"超管"也是数据，而不是代码里的 if
链路：`admin.role_id → role →(role_permission)→ permission`，权限点命名统一为 **`资源:动作`**（`article:delete`）。

**关键设计取舍**：
1. **超级管理员的权限也是数据**（显式把所有权限点映射给它），不在代码里写 `if (username === 'admin') return next()`。
   好处：鉴权只有**一条**判断路径（`perms.has(code)`），不存在"特例分支"——而安全漏洞最爱藏在特例分支里。
2. 权限点用字符串拼装，路由上声明式挂载，读代码即知权限要求：
   ```js
   router.post('/:resource/:id/delete', requirePermissionByResource('delete'), handle(...))  // → article:delete
   router.post('/doAdd', requirePermissionPageByTable('article', 'create'), ...)             // SSR 版
   ```
3. **fail-closed**：拿不到权限集合（未登录 / 没分配角色 / 查不到角色）一律**拒绝**。
   安全设计必须"默认关门"，绝不能因为"查不到"就放行。

### 5.2 权限缓存：为什么必须有，以及它的边界
鉴权在**每个请求**上都跑，每次都 JOIN `role_permission + permission` 两张表是无谓的 DB 压力。
这里用 `Map<roleId, {codes:Set, expireAt}>`，**TTL 30 秒 + 主动失效**（改权限时立刻清）。
⚠️ **多实例部署时各进程缓存不同步**，会有最多 30 秒权限偏差；正确做法是换 Redis 或在网关统一鉴权。

### 5.3 无物理外键的代价（本项目最值得讲的一处）
`role_permission` **刻意不加外键**（与项目其他表一致，Mongo 迁移遗留的"逻辑关联"风格）。
代价立刻显现：**删角色时数据库不会帮你清理关联行**，必须自己写：
```js
await DB.transaction(async (client) => {
  await client.query('DELETE FROM role_permission WHERE role_id = $1', [id])
  await client.query('DELETE FROM role WHERE _id = $1', [id])
})
```
而且**两步必须在同一事务里**，否则中途失败就留下"孤儿关联行"。
> 对比：如果建表时写 `REFERENCES role(_id) ON DELETE CASCADE`，数据库会自动完成这件事。
> 这就是"有外键 vs 无外键"最直观的差别——不是"外键会不会拖慢性能"，而是**一致性由谁负责**。

### 5.4 审计日志：三个容易做错的点
1. **埋点位置**：写在中间件里（`router.use(auditLog)`）而不是每个 handler —— 审计的价值在于**完整**，
   手写容易"新增接口忘了埋"。中间件 = 默认全记。
2. **不能影响业务**：`record()` 内部自己 try/catch 吞掉异常。业务已经成功了，
   日志写失败只能记 error，**绝不能把请求变成 500**。
3. **必须脱敏**：`password / rpassword / token / csrf / captcha` 一律 `[REDACTED]`，超长正文截断。
   "记录谁改了什么"**不等于**"把凭据留痕"——审计表被人拿到不该等于凭据泄露。

### 5.5 公开内容 API：两个 SQL 进阶用法的真实落点
- **`WITH RECURSIVE` 递归 CTE**（`contentService.getCategoryTree`）：分类是任意层级的树（pid 指向父级），
  一次 SQL 查出全部层级，再在应用层用 Map **O(n)** 组装成嵌套结构。
  还用在 `listArticles({ cateId })`：求"该分类及其所有子孙"，实现"含子分类"的文章筛选。
- **窗口函数 `LAG/LEAD`**（`contentService.getArticle`）：取同分类下的上一篇/下一篇，**一次查询**搞定，
  替代老写法"为 prev、next 各查一次（都带 ORDER BY + LIMIT 1）"。
- 字段白名单：列表**刻意不返回 `content`** —— 正文可能几十 KB，列表带上会让响应体膨胀几十倍。
- `Cache-Control: public, max-age=60, stale-while-revalidate=300`：内容"读多写少"，让 CDN/浏览器缓存；
  将来接 ISR/SSG 时这套缓存头是天然配合。

### 5.6 SSR 表单上 zod：用"中间件"实现，handler 一行不改
后台老表单的 handler 里到处是 `ctx.req.body.title`。要改成 `const { title } = parse(...)`
得动 13 个 handler 的正文，改动面大、极易引入回归。
**换个思路**：做成中间件 `validatePageBody(schema, backPath)` ——
- 校验通过 → 把**转换后的值合并回 body**（handler 完全无感，还能顺手把 `status='1'` 转成数字 `1`）；
- 校验失败 → 渲染错误页并中断（不会继续写库）。

### 5.7 OpenAPI"自动生成"：靠的是单一来源，不是代码生成器
手写 YAML 文档**必然**过期（代码改了文档忘了），最后没人信。
做法：请求 schema 只在 **`utils/schemas.js` 定义一份**——
- 路由用它做运行时校验；
- `utils/openapi.js` 用 **`z.toJSONSchema()`** 把它转成 JSON Schema 填进 OpenAPI 3.1 文档。

于是 `openapi.js` 里**看不到任何字段细节**（没有手抄的 properties），只有"路径 → 用哪个 schema / 需要什么权限"的声明。
校验规则一改，文档立刻跟着变。访问 `GET /api/v1/openapi.json` 与 `GET /api/v1/docs`（Swagger UI）。

### 5.8 本阶段踩的 5 个坑（都很典型）
**坑 A：在 `next()` 之前读 `ctx.params`，拿到的是空值**
审计中间件挂在路由链靠前位置，那时 URL 还没被具体路由匹配，`ctx.params` 是 `{}`。
我提前取了 `ctx.params.resource`，结果审计里 `resource` **全是空字符串**（查日志时完全看不出改的是哪张表）。
→ 必须在 `await next()` **之后**再读 `ctx.params`（此时业务路由已匹配完毕）。这坑很隐蔽，因为不报错、只是数据没价值。

**坑 B：种子规则用字符串后缀匹配，导致只读角色越权读审计**
最初给"只读运营"角色的规则是"所有以 `:list` 结尾的权限"——听起来合理，但 `audit:list` / `role:list` / `manage:list`
**也以 `:list` 结尾**，于是只读账号竟然能查审计日志（越权读！）。
→ 权限规则**别只靠字符串后缀匹配**，要显式限定范围（改成 `p.grp <> 'sys'` 排除系统管理组）。
教训：写权限规则时要反问"这个匹配条件还会命中什么我没想要的？"

**坑 C：zod 的"字段缺失"是类型错误，中文提示要用 `{ error }`**
`z.string().min(1, '标题必填')` —— 当字段**根本不存在**时，zod 抛的是"类型错误"
（`Invalid input: expected string, received undefined`），我写的中文提示只在"值存在但非法"时生效，
结果用户看到英文报错。正确写法（zod 4）：`z.string({ error: '标题必填' })`。
> 注：zod 3 的 `required_error` 在 zod 4 里**无效**（实测仍是英文），必须用 `error`。

**坑 D：SSR schema 不能随便加 `.default()`，否则编辑时会重置未提交的字段**
原表单语义是"没提交的字段 = 不修改"（`_prepareData` 会跳过 undefined）。
若 schema 给 `sort`/`status`/`keywords` 加了 `.default(0)`，编辑时这些字段就会被**强制写成默认值**，
把用户原有数据悄悄改掉。→ SSR 表单的 schema **只做类型校验，不给默认值**。

**坑 E：zod 的 `.parse()` 会剥离未知字段，中间件合并时顺序不能反**
`ctx.request.body` 里有 `id`、`prevPage` 等 schema 里没定义的字段。合并时必须
`{ ...原body, ...parsed }`（原 body 在前），写成 `{ ...parsed, ...原body }` 就会把校验转换后的值又覆盖回字符串。

### 5.9 SSR 写路由的中间件顺序（顺序错了就是漏洞）
```js
router.post('/doAdd',
  requirePermissionPageByTable('article', 'create'), // ① 权限：只需 session，放最前
  tools.multer().single('img_url'),                 // ② 解析 multipart
  csrfGuardPage,                                    // ③ CSRF：必须等 body 解析出 _csrf
  validatePageBody(articleSchema, '/admin/article/add'), // ④ zod 校验
  handler)
```
**① 必须在 ② 之前**：multer 会把文件**落盘**，若权限检查放在后面，
未授权用户也能成功上传文件（浪费磁盘、可能留下恶意文件）。这是"顺序即安全"的典型例子。

### 相关文档
- 前端框架选型与替换范围：**`docs/frontend-architecture.md`**
  （结论：Koa 收敛为纯 API + 前端独立 Next/Nuxt；`views`/`public` 按「前台层 / 后台层 / 用户数据」三层分别处理，
  `public/upload` 永不可直接删）

### 下一步（后端剩余待办）
- **统计报表 SQL**：`GROUP BY` + 窗口函数 `ROW_NUMBER()` 做内容/访问排名（目前只用了 `LAG/LEAD` 取上下篇）
- **`EXPLAIN` 执行计划**实战样例（配合 `docs/database-sql.md`）
- **上传上云**（OSS/S3）与 **部署工程化**（Dockerfile + pm2 + Nginx + CI）——用户已明确"暂不做，准备部署时再做"
- **替换 ueditor**（前端相关，待前端方案确定）
- **前端分离**：按 `docs/frontend-architecture.md` 的 Phase 1 新建 Next/Nuxt/Astro 前台，消费 `/api/v1/public/*`
