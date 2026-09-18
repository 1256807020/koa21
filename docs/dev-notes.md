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

## 阶段六：接口全矩阵审计（先找隐患，再修）

### 6.1 两种手段各司其职
- **接口矩阵用脚本**（可重复、可断言）：边界值、越权、非法输入、错误方法逐条跑，24→33 项断言。
- **真实浏览器用 agent-browser**（curl 看不到的部分）：静态资源是否 404、图片是否真的渲染、验证码图是否加载、CSRF 隐藏域是否存在。
  结果：首页 **19 个资源全 200、0 张破损图**；登录页验证码图 120×34 正常加载、`_csrf` 隐藏域存在（32 位）；`/news` 0 失败。
- **一个正面发现**：验证码**前端读不出来**——svg-captcha 输出的是**路径化 SVG（没有 `<text>` 节点）**，
  且会话 Cookie 是 `httpOnly`（我实测"用 JS 注入会话 Cookie"失败，正是 httpOnly 在起作用）。
  也就是说"读 DOM / 读会话绕过验证码"两条路都走不通。

### 6.2 修复的 9 个问题（每条都有复现断言）
| # | 问题 | 根因 | 修法 |
| --- | --- | --- | --- |
| 1 | **非法 id 返回 500**（公开详情/资源详情/删除/编辑 4 处） | `DB.getObjectId()` 抛的是**无错误码的普通 Error**，被当"未知错误"走 500 | 抛 `code = PARAM_ERROR`；全局错误处理按 `STATUS_BY_CODE` 映射状态 → 现在一律 400 |
| 2 | 未知资源返回 **403**（应为 404） | 权限校验排在资源校验之前，"资源不存在"被错报成"无权限" | 增加 `knownResource` 前置校验 |
| 3 | **可绑定不存在的角色** | `adminService.create/update` 不校验 `role_id` → 造出"无权限孤儿" | `assertRoleExists()` |
| 4 | **账号删除/禁用后旧会话仍有效**（权限撤销不即时） | 会话是客户端 Cookie，不会自己失效 | `requireLogin` 每次回查 DB（10s 缓存）确认账号存在且 `status=1`，并把 `role_id` 刷新进会话（顺带解决"改角色要重登"）；`login.js` 密码正确后也校验 `status` |
| 5 | **开放重定向** | 删除后 `ctx.redirect(Referer)`，实测可 302 到 `https://evil.example.com` | 新增 `utils/redirect.js` 的 `safeBackPath()`，只允许站内相对路径 |
| 6 | **分页总数统计用错表** | `focus.js`/`link.js` 的 `count` 查的是 `article` 表 → 总页数算错 | 改成各自的表 |
| 7 | **校验结果被无声覆盖** | `svc.list({ page, pageSize, ...ctx.query })`：展开在后面，原始字符串覆盖了 zod 转换后的值 | 把 `page/pageSize` 放到展开之后 |
| 8 | **删除会产生孤儿数据** | 删分类不管子分类/文章；删管理员可以删掉自己或最后一个管理员（删光就再也进不去后台） | SSR `/admin/remove` 加业务守卫；并把**静默失败改成错误页**（原来删失败也静默回跳，用户以为删成功了） |
| 9 | **硬编码** | 3 个分类 ID 与 4 处 `pageSize=3` 散落在路由里 | 集中到 `config.frontend` / `config.adminPageSize`，支持 env 覆盖（后台默认 3→10，原值属教程遗留） |

### 6.3 修复中自己引入的回归（同源坑踩了第二次）
修 #2 时我用 `router.use()` 做资源校验，结果**所有请求都变成 `未知资源：undefined`**。
根因与 §5.8 坑 A **完全同源**：`router.use` 的中间件在"**路由尚未匹配**"时执行，那时 `ctx.params` 还是空的。
→ 必须写成**路由级**中间件：`router.get('/:resource/list', knownResource, requirePermission..., handler)`。

**沉淀成规则**：**只要依赖 `ctx.params`，就必须保证读取发生在"路由已匹配"之后**（路由级中间件或 handler 内）。
这个坑我踩了两次（审计 `resource` 全空、资源校验把正常请求全打回 404），已写入 `docs/dev-notes.md` 作为 checklist。

### 6.4 已记录但暂不修（需要时再做）
- **上传文件不随记录删除**：删文章后 `public/upload` 里的图片仍留着 → 需要"删除时清理文件"或对象存储生命周期规则。
- **`audit_log` 无上限增长**：需要归档/清理策略（例如保留 90 天）。
- **SSR `doEdit` 的 `prevPage` 隐藏域**同样可被伪造（同一类开放重定向，风险低于 Referer 场景）→ 后续统一改走 `safeBackPath`。

## 阶段七：Redis 接入 + SQL 教学化收尾

### 7.1 为什么要抽一个 `model/store.js`
限流计数、权限缓存、会话复核缓存，这三样都需要"**带过期时间 + 跨请求共享**"的存储。
单实例时进程内 Map 够用；**多实例时每台机器各存一份** → 限流各算各的（N 个实例 = 限额被放大 N 倍）、
权限/账号变更要等 TTL 到期才在各实例一致。
所以抽一层 `model/store.js`：**业务代码只调 `store.get/set/incr/ttl/del/delByPrefix`，不关心后端是 Redis 还是内存**。

### 7.2 降级（graceful degradation），而不是硬依赖
`store.connect()` 启动时尝试连 Redis：
- 成功 → `kind = 'redis'`，日志明确写出"走 Redis"
- 失败 → 打 warn 退回进程内实现，**不阻断启动**（可用性优先），同时把风险讲清楚

`/healthz` 新增 `cache` 字段（`redis` / `memory`）——**运维一眼就能看出"限流到底有没有走共享存储"**。
这一招很实用：很多人部署完不确定限流是否生效，加个字段就自证了。

### 7.3 键设计（全部是 Redis 友好的原子操作）

| 用途 | 键 | 结构 | 说明 |
| --- | --- | --- | --- |
| 全局限流 | `ratelimit:<ip>:<窗口编号>` | INCR + TTL | 窗口编号拼进 key，天然避免"先 incr 再 expire"的竞态；窗口一换就是全新计数 |
| 登录失败 | `login:fail:<user>` | INCR + TTL(15min) | **原子自增**，多实例并发也不丢计数 |
| 账号锁定 | `login:lock:<user>` | SET + TTL(15min) | 用 TTL 表达锁定期，不需要定时任务清理 |
| 权限缓存 | `rbac:perms:<roleId>` | SET(JSON) + TTL(30s) | 改权限时主动 DEL，让变更立刻生效 |
| 会话复核 | `session:admin:<id>` | SET(JSON/'null') + TTL(10s) | 连"账号不存在"也缓存，避免被删账号持续打库 |

**教学点**：
1. **不要 read-modify-write**：多实例并发下会丢计数（经典竞态），要用 `INCR` 这类原子命令。
2. **`KEYS` 是禁忌**：大库上会阻塞 Redis 单线程。批量删除用**游标 `SCAN`**（`delByPrefix` 就是这么实现的）。
3. **用 TTL 表达时间语义**：窗口、锁定期全交给 Redis 过期，省掉定时清理任务。
4. **序列化要容错**：`Set` 不能直接存 → 转 JSON 数组；读到坏数据要能忽略缓存回源查库，而不是报错。

### 7.4 限流器故障必须 fail-open
`middleware/rateLimit.js` 里 `store.incr` 抛错时 → 记 error 然后**放行**。
理由：限流是"最后一道护栏"，**不是安全边界**（真正的安全在鉴权/CSRF/RBAC）。
让"限流器故障"升级成"全站 5xx"得不偿失。

### 7.5 SQL 教学化收尾（剩余两项）
1. **统计报表**（`services/statsService.js` + `routes/api/stats.js`，权限点 `stats:view`）
   - `COUNT(*) FILTER (WHERE ...)`：一条 SQL 出多个维度（只扫一次表）
   - `GROUP BY` + `date_trunc` 按月趋势；`GROUP BY 1` 位置引用
   - **窗口函数**：`ROW_NUMBER` / `RANK` / `DENSE_RANK` 三种排名 + `SUM() OVER ()` 占比 +
     `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` 累计占比（帕累托分析原理）
   - **分组 TopN**：`PARTITION BY` + `ROW_NUMBER`，并强调"窗口函数不能写进 WHERE，必须套一层子查询"
2. **EXPLAIN**（`GET /api/v1/admin/stats/explain?query=<白名单键>`）
   - `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)` → 返回 planning/execution 耗时 + 根节点类型 + 完整计划
   - **安全红线**：只接受**白名单键**，绝不接受客户端传来的 SQL——
     否则等于把数据库只读权限开放给任何调用方（"设计出来的 SQL 注入"）
   - `docs/database-sql.md` 补了"怎么读 EXPLAIN"对照表（Seq Scan / Index Scan / Nested Loop 爆炸 /
     估算行数与实际行数差百倍 → `ANALYZE` 表；以及 `ILIKE '%x%'` 用不上 B-tree 索引）

### 7.6 本轮踩坑：`LEFT JOIN` 的过滤条件写错位置会静默丢数据
```sql
-- ✅ 正确：过滤写在 ON 里，0 篇文章的分类仍然保留（count = 0）
LEFT JOIN article a ON a.pid = c._id AND a.status = 1

-- ❌ 错误：过滤写进 WHERE，LEFT JOIN 退化成 INNER JOIN，0 篇文章的分类整行消失
LEFT JOIN article a ON a.pid = c._id
WHERE a.status = 1
```
这个 bug **不报错、只是少几行**，非常隐蔽。测试里专门加了断言
「**0 篇文章的分类仍在结果中**」把行为锁住（种子数据里"成功案例"就是这样的分类）。

## 阶段八：第二轮全量审计（60 项断言）+ 关于 CommonJS/ESM

### 8.0 测试怎么做到"全量"
- **先程序化枚举路由**，不从文档抄（文档会过期、会漏）：递归遍历 `router.stack`（`@koa/router` 的
  `routes()` 返回值上挂了 `.router` 引用），共 **150 条** —— 前台 6 / JSON API 66（=33 条 × 2 个版本前缀）/ SSR 后台 78。
- 脚本矩阵 **60 项断言**：响应信封一致性、公开接口字段白名单、**三角色权限矩阵**、安全探测
  （SQLi / 原型污染 / 畸形 JSON / 错误 Content-Type / 超大 body / 存储型 XSS 闭环）、
  SSR 页面可达性、**审计覆盖**、上传与登出行为。
- 真实浏览器（agent-browser）：前台 3 页 **0 失败资源、0 破损图**；`/api/v1/docs` 的 Swagger UI 正常渲染；
  登录页验证码图 120px、`_csrf` 隐藏域存在、**0 个 JS 错误**。

### 8.1 修复清单（11 项，全部有复现断言）

| # | 问题 | 根因 | 修法 |
| --- | --- | --- | --- |
| 1 | **SSR 后台写操作完全不进审计** | `auditLog` 只挂在 `/api/v1/admin/*` | 让 `auditLog` 支持 SSR（路径第二段 / `body.collectionName` 推断资源，并用 `TABLE_RESOURCE` 统一命名），挂到 `routes/admin.js` |
| 2 | **`/admin/editorUpload` 绕过上传白名单** | 它自成一套更弱逻辑，且 `FILE_EXT` 放开 zip/rar/doc/pdf/txt | 按 action 隔离白名单（图片/视频）+ 扩展名与 MIME 双校验 + 涂鸦校验 PNG 魔数 + **取消 uploadfile** |
| 3 | `uploadvideo` **永远拒绝视频** | 用 `IMAGE_EXT` 校验视频（逻辑 bug） | 按 action 取对应白名单 |
| 4 | 3 个空壳写接口（`addCart`/`editPeopleInfo`/`deleteCart`） | 教学残留；未鉴权、无 CSRF、返回旧格式、还 `console.log(body)` | 直接删除 |
| 5 | `/api/v1` 根、`catelist`、`newslist` 返回旧格式 | 历史实现未随统一响应体改造 | 全部收敛为 `{code,message,data}` |
| 6 | **`newslist` 不过滤 `status`** | `DB.find('article', {})` 条件为空 | 加 `status:1`（**已下架文章从公开接口漏出 = 数据泄露**）+ 字段白名单 |
| 7 | `catelist` 返回整表原始行 | 投影传 `null`（= `SELECT *`） | 传字段白名单 |
| 8 | `pageSize` 写死 5 | 硬编码 | 改用 zod `pageSchema`，支持 `pageSize` 参数 |
| 9 | **GET 登出可被跨站触发** | `/admin/login/loginOut` 是 GET，`<img src>` 即可强制下线 | 加 CSRF（token 放 query，双提交 Cookie 下安全），并**彻底销毁会话**（`ctx.session=null`） |
| 10 | `routes/admin/user.js` 死模块 | edit/delete 只返回占位文本、list/add 无数据源、全站无链接引用 | 删除模块 + 2 个静态样板模板 |
| 11 | `router.all('/editorUpload')` 注册 40+ 种 HTTP 方法 | 用了 `router.all`（含 TRACE/ACL/MKCALENDAR…） | 收窄为 `router.get` + `router.post` |

### 8.2 最值得记的两项（为什么它们是真隐患）
**① 审计只覆盖 API、不覆盖 SSR 后台** —— 这个项目的**实际使用入口是 SSR 后台**（运营在页面上点增删改），
而审计只挂了 JSON API。结果是"审计日志看起来有，但主要操作全都没记"，等于审计形同虚设。
教训：做审计/埋点这类"完整性敏感"的功能时，要问一句 **"有几个入口？我全挂上了吗？"**

② **上传是"多条路"的典型**：本项目有两处上传（`tools.multer` 与 `model/ueditor`），
P0 只加固了前者，编辑器那条就成了绕过口子。更糟的是它原 `FILE_EXT` 放开 **zip/rar/doc** ——
这已经不是"XSS 风险"，而是**把自己的域名变成文件托管服务**（钓鱼页、木马分发的绝佳温床）。
教训：安全加固要**按能力（capability）清点**，不能按"我记得改过的那个文件"清点。

### 8.3 验证
- 脚本 **60/60 通过**，其中 4 项是补充回归：登出被拒后登录态仍在（防误杀）、带 token 登出 → 302、
  登出后会话失效 → 401、**下架文章在 `/public/articles` 与旧 `/newslist` 均不可见**。
- 单测 **54 → 68 项**（新增 `tests/ueditor.test.js` 9 例、`tests/auditLog.test.js` 5 例）。
- `npx eslint .` **0 errors**。

### 8.4 一个"查了但不是 bug"的点（记下来以免重复怀疑）
前台首页 `typeof jQuery === 'undefined'` 一度像是"模板用了 `$` 却没加载 jQuery"。
**实测结论：不是问题** —— 首页只用 Swiper（不需要 jQuery）；只有 `/news`、`/case` 用到 jQuery，
且它们用**绝对路径** `/default/js/jquery-1.10.2.min.js` 引入，实测 `typeof jQuery === 'function'`、0 失败资源。
（我最初用 `grep -oE '<script[^>]*src="[^"]*"' | sed 's/.*src="//'` 提取时，`.*` 把开头的 `/` 一起吃掉了，
才误判成相对路径会 404。**教训：文本提取的结论要用浏览器复核，别只信字符串。**）

### 8.5 为什么本项目还在用 `require`（CommonJS）而不是 `import`（ESM）

**先说结论：能不用 ESM 吗？能。现在该迁吗？不该。**

- **现状成因**：这是从 koa2 时代演进来的项目，当时 CJS 是唯一稳妥选择，全部依赖与代码都是 `require`。
  Node 22 对 ESM 支持已经很成熟，Koa 3 本身也不排斥 ESM —— 所以这不是"技术选型落后"，而是**历史成本**问题。
- **迁移的真实成本（远不止把 `require` 换成 `import`）**：
  1. `__dirname` / `__filename` 在 ESM 里不存在 → 要全换成 `import.meta.url` + `fileURLToPath`；
     本项目在 logger、静态目录、模板目录、上传目录等多处用到；
  2. ESM 是静态解析，`require()` 那种"条件加载/循环引用容错"要改成顶层 `await import()`；
  3. **CJS 依赖互操作坑**：老包在 ESM 下往往只有 `default` 可用（`import pkg from 'x'` 而非 `import { f } from 'x'`），
     本项目用了 `@koa/multer`、`koa-art-template`、`svg-captcha`、`koa-session` 等一批 CJS 包，要逐个踩；
  4. 所有 `.js` 与测试文件都要动，`node --test` 的加载方式也要跟着调整；ESLint 配置同步改。
- **收益评估**：ESM 的主要红利（tree-shaking、更现代的加载语义）**在服务端几乎没有收益** ——
  tree-shaking 是前端打包才需要的东西；服务端只关心"能不能跑、好不好维护"。
  而成本是"全项目回归 + 一堆依赖互操作坑"。**投入产出比不划算。**
- **建议（真要迁的时候）**：
  1. **现在不迁**，优先做前端分离（那是更高优先级的架构演进）；
  2. 若将来要迁，**最好等前端分离之后**再动：那时 Koa 只剩 API 层，文件数大幅减少，迁移面最小；
  3. 想小步试水：保持 `package.json` 为 CJS，只让**新建模块**用 `.mjs`，逐步验证依赖互操作。
- **现在就能拿到的"类 ESM 收益"（零风险，值得做）**：
  - 收紧 ESLint（禁隐式全局、强制 `const`、统一 `'use strict'`、规范 require 顺序）；
  - 把"平台能力"从全局挪到显式依赖（本项目已做到：config/logger/store 都是显式 require）。
  → 这些能拿到 ESM 带来的**大部分可维护性收益**，且不会引入回归。

## 阶段九：可运维性收尾 + Koa3 生态横向评审

### 9.1 本轮交付三项（都是"跑久了才会疼"的问题）
| 项 | 交付 | 要点 |
| --- | --- | --- |
| **审计日志归档** | `scripts/audit-archive.js` + `audit_log_archive` 表 + `pnpm audit:archive` | 冷热分离；**搬运与删除必须在同一事务**（否则 insert 成功后 delete 前挂掉，热表会留重复数据）；默认保留 90 天，支持 `--days=` / `--dry-run` / `--prune-days=`；建议 cron 每日跑 |
| **删除时清理孤儿图片** | `utils/fileCleanup.js` | 按资源字段白名单清理；**路径 containment** 是重点（见 9.2） |
| **prevPage 统一走 safeBackPath** | `article.js` / `nav.js` 的 doEdit + `routes/admin.js` 源头 | 原来只有 `/admin/remove` 系列走了 safeBackPath，`doEdit` 的隐藏域那条漏了；并在 `ctx.state.G.prevPage` 源头就把 Referer 收敛成站内路径（防御做在源头，而不是每个调用点各写一遍） |

### 9.2 一个必须记住的安全思维
"**用数据库里的字符串去拼文件路径并删除**" —— 这类功能天生是漏洞放大器。
`img_url` 理论上是自己写的，但一旦它可被篡改（或被历史脏数据污染）成 `upload/../../../app.js`，
"清理垃圾"就秒变**任意文件删除**。
所以必须：① 解析路径后做 `path.relative(UPLOAD_ROOT, abs)`，结果以 `..` 开头或为绝对路径就拒绝；
② 只删普通文件、不删目录；③ 失败只记日志绝不抛（主记录已删，清理是"尽力而为"）。
验证方式也是双保险：单元测试覆盖各种穿越写法 + **端到端造一个 upload 之外的真实文件，删记录后确认它还在**。

### 9.3 Koa3 生态评审（2026 年活跃三项目）

| 项目 | 定位 | 优点 | 坑 |
| --- | --- | --- | --- |
| koa22 | Koa3 **CLI 脚手架** | 洋葱装配顺序、requestId 透传、errorHandler+`app.on('error')` 双通道、校验错误归一化 422、日志分文件、CORS 默认关闭、CLI 净化 package.json 与 lock | 测试几乎为零、无优雅关闭、master 版有个未定义常量的真 bug（CI 从不测 HTTP 所以没发现）、配置 `Object.assign` 浅覆盖陷阱 |
| koa23 | Koa3 + **TypeScript** starter | `declare module 'koa'` 增强 ctx + 原型挂 `ctx.ok/fail`、`AppError` + mapError 用 `unknown` 逐层收窄、zod 校验中间件、env 用 zod 强类型化、vitest+supertest 靠"app 与 server 分离导出" | 无 controller/service 分层、一律 HTTP 200 破坏语义、`validated:unknown` 导致类型链路断裂、`no-explicit-any` 关掉后工具函数成片 `any` |
| koa24 | **monorepo 全栈** + Docker + PM2 | 优雅关闭、Docker 单容器托管前后端、compose healthcheck 带 `start_period`、PM2 cluster 配置、自动路由注册、API/SPA 路径分流 | **号称 Koa3 但实际跑 Koa2**（lock 里 2.16.4）、无全局错误中间件（靠字符串比对 error.message）、`origin:'*'`+`credentials:true` 无效组合、生产 `sync({alter:true})`、密钥进仓库、前后端无共享 schema |

**结论**：这三家的**多数优点我们早就具备**（统一响应体、全局错误兜底、requestId、env 强校验、
优雅关闭 + 关连接池、`/healthz` 依赖探测、zod+OpenAPI 单一来源）。
本轮补的恰恰是它们的**共同短板：可运维性**（审计归档、孤儿文件）。
下一个 P2 建议补 **Dockerfile/compose + PM2 ecosystem** —— 纯配置、零风险、上线收益最大。
详见 **`docs/koa3-projects-review.md`**。

### 9.4 媒体存储选型（出海）
- **阿里云 OSS 不是永久免费**：官方只有"新用户免费试用额度"；国际站 2026 年价格约
  标准存储 **$0.0173/GB/月**（1TB≈$17.7/月），前 5GB 免费，**公网下行流量另计**。
  它的强项在国内 CDN 与备案链路，**出海不占优**。
- **出海首选 Cloudflare R2**：免费 **10GB 存储** + 每月 100 万 A 类 / 1000 万 B 类操作，关键是 **egress 流量费 = 0**
  （内容站"读多写少"，图片外链流量才是大头）；S3 兼容，改造成本低；天然全球边缘。
- 备选 **Backblaze B2**（10GB 免费，加入了 Cloudflare 带宽联盟 → 经 CF 出流量免费）；
  **Supabase Storage** 适合"一个平台搞定 DB + 鉴权 + 存储"（Free 计划 $0/月，含 500MB 库 + 5GB egress）。
- **现在怎么做**：保持本地 `public/upload/` 不动（已过 P0 加固）。
  迁移时唯一的坑是**别把域名写死** —— 图片 URL 应走配置项（如 `MEDIA_BASE_URL`），
  我们当前 `tools.imgUrl` 返回相对路径、模板用 `{{__HOST__}}` 拼，将来换配置项即可，成本低。

### 9.5 验证
- 单测 **77 项**（新增 `tests/fileCleanup.test.js` 9 项，重点是各种路径穿越必须被拒绝）
- 端到端 **6/6**：删除清理孤儿图片 ✔ / upload 目录外文件未被误删 ✔ / prevPage 外站不再被 302 ✔ / 回跳站内 ✔ / 归档脚本可跑 ✔
- 归档实测：热表 44 → 0，冷表 0 → **44**，事务原子
- `npx eslint .` **0 errors**

### 相关文档
- 前端框架选型与替换范围：**`docs/frontend-architecture.md`**
  （结论：Koa 收敛为纯 API + 前端独立 Next/Nuxt；`views`/`public` 按「前台层 / 后台层 / 用户数据」三层分别处理，
  `public/upload` 永不可直接删）

### 下一步（后端剩余待办）
- **审计日志保留策略**（定期归档/清理，避免无上限增长）
- **删除记录时清理上传文件**（或改用对象存储 + 生命周期规则）
- **统一 `prevPage` 回跳走 `safeBackPath`**（SSR doEdit 的隐藏域，同一类开放重定向）
- **上传上云**（OSS/S3）与 **部署工程化**（Dockerfile + pm2 + Nginx + CI）——用户已明确"暂不做，准备部署时再做"
- **替换 ueditor**（前端相关，待前端方案确定）
- **前端分离**：按 `docs/frontend-architecture.md` 的 Phase 1 新建 Next/Nuxt/Astro 前台，消费 `/api/v1/public/*`
- （已完成）SQL 教学化全部收尾：JOIN / 递归 CTE / GROUP BY / 窗口函数 / 分组 TopN / 事务 / EXPLAIN
