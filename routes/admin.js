'use strict'
let router = require('koa-router')();

let url = require('url')
// 配置中间件 获取url地址
router.use(async (ctx, next) => {
  // 打印路径，相当于域名
  // console.log(ctx.request.header.host)
  // 模版引擎配置全局的变量
  ctx.state.__HOST__ = 'http://' + ctx.request.header.host

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
// 匹配了上面的路由，就加载模块
router.use(index)
router.use('/login', login)
router.use('/user', user)
router.use('/manage', manage)
router.use('/articlecate', articlecate)
router.use('/article', article)
module.exports = router.routes()
