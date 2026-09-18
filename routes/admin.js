'use strict'
const Router = require('@koa/router')
const router = new Router()
let ueditor = require('../model/ueditor.js')
let url = require('url')
const config = require('../model/config.js')
const { ensureCsrfToken, csrfGuardPage } = require('../middleware/guard')

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
    prevPage: ctx.request.headers['referer']   /*上一页的地址*/
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
// 引入模块
let index = require('./admin/index.js')
let login = require('./admin/login.js')
let user = require('./admin/user.js')
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
router.use('/user', user)
router.use('/manage', manage)
router.use('/articlecate', articlecate)
router.use('/article', article)
router.use('/focus', focus)
router.use('/link', link)
router.use('/nav', nav)
router.use('/setting', setting)
// 富文本编辑器上传接口（自研实现，见 model/ueditor.js）
// 保存到 public/upload/{yyyy}{mm}{dd}/ 下，返回 URL 给编辑器插入
router.all('/editorUpload', ueditor())
module.exports = router.routes()
