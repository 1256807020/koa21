'use strict'
// middleware/guard.js
// ============================================================
// 后台 JSON API 的两道安全闸门（P0 安全）
//   1) requireLogin：登录态校验（session 里有 userinfo 才放行）
//   2) csrfGuard：CSRF 双提交 Cookie 校验（写请求必须带 X-CSRF-Token 且等于 Cookie 值）
//
// 教学点：
//   - 为什么用 fail() 直接出参而不是 throw？koa 里 throw 会冒泡到全局错误处理中间件，
//     而 app.js 的全局 handler 对 /api 返回的是旧风格 { success:false }，与我们的 { code } 不一致。
//     守卫里直接 fail(ctx, code, msg, null, status) 并 return（不调 next），既拦截又能统一出参。
//   - 为什么“双提交 Cookie”而不是 koa-csrf 的 session secret 模式？
//     双提交 Cookie 不依赖服务端存储 secret，天然适配前后端分离 / SPA（fetch 读 cookie 回传 header），
//     且是 OWASP 推荐的 SPA CSRF 方案；代价是不能绑定到具体 session（仅同源保护），教学足够。
// ============================================================
const crypto = require('crypto')
const { fail } = require('../utils/response')
const code = require('../utils/code')
const config = require('../model/config')
const adminService = require('../services/adminService')

// 1) 登录态守卫：未登录 → 401
//
// ⚠️ 这里不只是"看 Cookie 里有没有 userinfo"，还会**回查数据库确认账号仍然有效**。
// 为什么必须回查（三个真实隐患，实测都能复现）：
//   ① 账号被删除后，旧会话仍然有效 → 权限撤销不即时（"删了人还能用"）；
//   ② 账号被禁用（status=0）后仍能继续访问；
//   ③ 管理员改了角色，但会话里存的还是旧 role_id → 必须重新登录才生效。
// 代价是每请求一次查询，用 adminService 里的 10 秒缓存把开销摊平（多实例需换 Redis）。
async function requireLogin (ctx, next) {
  const userinfo = ctx.session && ctx.session.userinfo
  if (!userinfo || !userinfo._id) {
    return fail(ctx, code.UNAUTHENTICATED, '未登录或登录态已失效', null, 401)
  }

  const state = await adminService.getSessionState(userinfo._id)
  if (!state || Number(state.status) !== 1) {
    ctx.session = null // 会话已无意义，直接销毁（顺带让浏览器清掉 Cookie）
    return fail(ctx, code.UNAUTHENTICATED, '账号不存在或已被禁用，请重新登录', null, 401)
  }

  // 会话内容以数据库为准：用户名/状态/角色都刷新一遍（改角色后无需重新登录）
  ctx.session.userinfo = {
    _id: state._id,
    username: state.username,
    status: state.status,
    role_id: state.role_id || null
  }
  return next()
}

// 签发一个 CSRF token，写入可读 Cookie（双提交模式要求前端能读到它再回传）
function issueCsrfToken (ctx) {
  const token = crypto.randomBytes(16).toString('hex')
  ctx.cookies.set('csrfToken', token, {
    httpOnly: false,        // 必须可被前端 JS 读取后回传（双提交 Cookie 核心）
    sameSite: 'lax',        // 跨站请求不携带，配合同源校验防 CSRF
    secure: config.session.secure, // 生产环境走 https 时置 true
    maxAge: 1000 * 60 * 60 * 2
  })
  return token
}

// 2) CSRF 双提交 Cookie 校验：仅对写方法生效（JSON API 用，失败返回 {code}）
function csrfGuard (ctx, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.method)) return next()
  const cookie = ctx.cookies.get('csrfToken')
  const header = ctx.get('X-CSRF-Token') || (ctx.request.body && ctx.request.body._csrf)
  if (!cookie || !header || cookie !== header) {
    return fail(ctx, code.CSRF_FAIL, 'CSRF token 校验失败', null, 403)
  }
  return next()
}

// ============================================================
// SSR（服务端渲染）表单的 CSRF 支持
// 教学点：JSON API 靠请求头传 token（fetch 可设 header），但**原生 HTML 表单设不了自定义头**，
//   所以 SSR 走「隐藏域 name="_csrf"」提交，服务端仍按双提交 Cookie 比对（cookie === 表单字段）。
// ============================================================

/**
 * 保证当前请求已有 csrfToken Cookie，并把 token 挂到 ctx.state，
 * 模板里用 <input type="hidden" name="_csrf" value="{{csrfToken}}"> 埋进每个表单。
 */
function ensureCsrfToken (ctx) {
  let token = ctx.cookies.get('csrfToken')
  if (!token) token = issueCsrfToken(ctx)
  ctx.state.csrfToken = token
  return token
}

/**
 * SSR 版 CSRF 守卫：失败时渲染错误页（不是 JSON），对表单用户更友好。
 *
 * ⚠️ 重要顺序坑：`multipart/form-data` 的表单在 multer 解析之前，`ctx.request.body` 是**空的**，
 * 此时读不到 `_csrf` 字段 → 会误判失败。所以：
 *   - 普通表单（x-www-form-urlencoded / JSON）：bodyparser 已在 app 层解析，可在路由链靠前处校验；
 *   - multipart 表单：必须在路由里的 `tools.multer().single(...)` **之后**再调用本守卫
 *     （见 routes/admin/article.js、focus.js、link.js、setting.js 的 doAdd/doEdit）。
 */
async function csrfGuardPage (ctx, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.method)) return next()
  const cookie = ctx.cookies.get('csrfToken')
  const field = (ctx.request.body && ctx.request.body._csrf) || ctx.get('X-CSRF-Token')
  if (!cookie || !field || cookie !== field) {
    ctx.status = 403
    await ctx.render('backend/error', {
      message: 'CSRF 校验失败（表单已过期或非本站来源），请返回重新提交',
      redirect: (ctx.state.__HOST__ || '') + '/backend'
    })
    return
  }
  return next()
}

module.exports = { requireLogin, csrfGuard, issueCsrfToken, ensureCsrfToken, csrfGuardPage }
