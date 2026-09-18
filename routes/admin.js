'use strict'
const Router = require('@koa/router')
const router = new Router()
let ueditor = require('../model/ueditor.js')
let url = require('url')
const config = require('../model/config.js')
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
  // 判断是否登陆
  if (ctx.session.userinfo) {
    await next()
  } else {
    // 没有登陆跳转道登陆页面
    if (pathname === 'admin/login' || pathname === 'admin/login/doLogin' || pathname === 'admin/login/code') {
      await next()

    } else {
      ctx.redirect('/admin/login')
    }
  }

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
