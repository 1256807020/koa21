'use strict'
// routes/admin.js
// ============================================================
// /admin 入口：仅承载「登录 / 登出」与「已登录 → /console」的跳转。
// 旧后台（Ace Admin + art-template）整套 SSR 页面路由与 ueditor 已删除，
// 后台功能统一由 /console（Liquid + Tailwind）提供。
// ============================================================
const Router = require('@koa/router')
const router = new Router()
const config = require('../model/config')
const url = require('url')
const { ensureCsrfToken, csrfGuardPage } = require('../middleware/guard')
const { auditLog } = require('../middleware/auditLog')
const { safeBackPath } = require('../utils/redirect')

router.use(async (ctx, next) => {
  // 站点地址（模板用）
  ctx.state.__HOST__ = config.getOrigin(ctx)

  const pathname = url.parse(ctx.request.url).pathname.substring(1)
  ctx.state.G = {
    url: pathname.split('/'),
    userinfo: ctx.session.userinfo,
    // Referer 客户端可控，统一收敛为站内相对路径（防开放重定向）
    prevPage: safeBackPath(ctx.request.headers['referer'], '/admin')
  }

  // 为所有后台页面准备 CSRF token（种 Cookie + 挂 ctx.state 供表单埋隐藏域）
  ensureCsrfToken(ctx)

  // 登录态校验：未登录跳登录页（登录相关路径放行）
  if (!ctx.session.userinfo) {
    if (pathname === 'admin/login' || pathname === 'admin/login/doLogin' || pathname === 'admin/login/code') {
      // 放行
    } else {
      return ctx.redirect('/admin/login')
    }
  }

  // CSRF 双提交 Cookie 校验（写方法）
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.method)
  const isMultipart = isWrite && !!ctx.is('multipart')
  if (isWrite && !isMultipart) {
    return csrfGuardPage(ctx, next)
  }
  await next()
})

// 审计埋点：包住全部 /admin 路由
router.use(auditLog)

// 登录相关（渲染 Liquid 新模板）
const login = require('./admin/login.js')
router.use('/login', login)

// 已登录访问 /admin 直接进新后台；未登录会被上面的中间件拦到 /admin/login
router.get('/', async (ctx) => ctx.redirect((ctx.state.__HOST__ || '') + '/console'))

module.exports = router.routes()
