'use strict'
const Router = require('@koa/router')
const router = new Router()
let ueditor = require('../model/ueditor.js')
let url = require('url')
const config = require('../model/config.js')
const { ensureCsrfToken, csrfGuardPage } = require('../middleware/guard')
const { auditLog } = require('../middleware/auditLog')
const { safeBackPath } = require('../utils/redirect')

// 路由级守卫采用「默认保护、例外显式列出」：
//   - /admin/editorUpload：富文本编辑器上传走自有协议（不带 _csrf），暂豁免；
//     待 P2 换 wangEditor/TipTap 时在请求头带 token 再撤掉豁免。
//   - /admin/changeStatus、/admin/changeSort、/admin/remove：这三个在各自路由里**自行**声明守卫
//     （AJAX 用 csrfGuard 返回 JSON，删除用 csrfGuardPage 返回错误页），避免这里再拦一次导致返回格式不对。
const CSRF_SELF_HANDLED = [
  '/admin/editorUpload',
  '/admin/changeStatus',
  '/admin/changeSort',
  '/admin/remove'
]

// 配置中间件 获取url地址
router.use(async (ctx, next) => {
  // 模版引擎配置全局的变量
  // 站点地址由 config 推导：上线换 https / 域名只改 .env（原注释里"上线要手改 http"的坑已消除）
  ctx.state.__HOST__ = config.getOrigin(ctx)

  // console.log(ctx.request.url)
  // 原生node对路径进行解析
  let pathname = url.parse(ctx.request.url).pathname.substring(1)
  // console.log(pathname.split('/'))
  let splitUrl = pathname.split('/')
  ctx.state.G = {
    url: splitUrl,
    userinfo: ctx.session.userinfo,
    // ⚠️ Referer 是客户端可控的，统一在这里就用 safeBackPath 收敛成"站内相对路径"：
    // 既让模板里渲染的 prevPage 隐藏域天然安全（预防 #2 那条"表单隐藏域被伪造"的路径），
    // 也让所有下游消费者（backTo/doEdit）默认拿到安全值 —— 防御要做在源头，而不是每个调用点各写一遍。
    prevPage: safeBackPath(ctx.request.headers['referer'], '/admin')   /*上一页的地址*/
  }

  // —— P0 安全①：为所有后台页面准备 CSRF token（种 Cookie + 挂 ctx.state 供模板埋隐藏域）——
  ensureCsrfToken(ctx)

  // —— 登录态校验 ——
  if (!ctx.session.userinfo) {
    // 没有登陆跳转道登陆页面（登录相关页面放行）
    if (pathname === 'admin/login' || pathname === 'admin/login/doLogin' || pathname === 'admin/login/code') {
      // 放行，继续往下走（doLogin 也要过 CSRF，防登录 CSRF）
    } else {
      return ctx.redirect('/admin/login')
    }
  }

  // —— P0 安全②：CSRF 双提交 Cookie 校验（SSR 版）——
  // 默认保护：所有写方法都校验；两类例外：
  //   ① CSRF_SELF_HANDLED 里的路由自行处理（见上）；
  //   ② multipart 表单：此刻 body 尚未解析（要等路由里的 multer），读不到 _csrf，
  //      因此这里跳过，由各 multipart 路由在 multer 之后调用 csrfGuardPage（见 article/focus/link/setting）。
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.method)
  const isMultipart = isWrite && !!ctx.is('multipart')
  if (isWrite && !isMultipart && !CSRF_SELF_HANDLED.includes(ctx.path)) {
    return csrfGuardPage(ctx, next)
  }
  await next()
})
// —— 审计埋点：包住**全部**后台路由（SSR 表单 + AJAX 批量端点）——
// 放在这一层而不是各 handler 里，是为了"默认全记"，避免以后新增接口忘了埋点。
// 注意它必须在上面那个 router.use 之后：未登录请求会在上一层就被重定向，不会走到这里。
router.use(auditLog)

// 引入模块
let index = require('./admin/index.js')
let login = require('./admin/login.js')
let manage = require('./admin/manage.js')
let articlecate = require('./admin/articlecate.js')
let article = require('./admin/article.js')
let focus = require('./admin/focus.js')
let link = require('./admin/link.js')
let nav = require('./admin/nav.js')
let setting = require('./admin/setting.js')
// 匹配了上面的路由，就加载模块
router.use(index)
router.use('/login', login)
// 说明：原 `router.use('/user', ...)` 已删除 —— /admin/user 是教学遗留的空壳模块
//（edit/delete 只返回占位文本，list/add 渲染无数据源的静态样板，全站无任何链接引用），
// 真正的"用户管理"是 /admin/manage（对应 admin 表）。
router.use('/manage', manage)
router.use('/articlecate', articlecate)
router.use('/article', article)
router.use('/focus', focus)
router.use('/link', link)
router.use('/nav', nav)
router.use('/setting', setting)
// 富文本编辑器上传接口（自研实现，见 model/ueditor.js）
// 保存到 public/upload/{yyyy}{mm}{dd}/ 下，返回 URL 给编辑器插入
// ⚠️ 只开放真正需要的两种方法：GET 拉配置、POST 上传。
//    原来用 router.all() 会连 TRACE / ACL / MKCALENDAR 等 40 多种 HTTP 方法一起注册，
//    既是无谓攻击面，也让接口清单噪音极大（属"顺手清理"）。
router.get('/editorUpload', ueditor())
router.post('/editorUpload', ueditor())
module.exports = router.routes()
