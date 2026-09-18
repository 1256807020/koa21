'use strict'
const Router = require('@koa/router')
const router = new Router()
let DB = require('../../model/db')
// P0 安全：SSR 的写操作一律 POST + CSRF 校验。
// 原实现是 GET + 直接把 URL 里的 collectionName 当表名，问题有二：
//   1) GET 写可被跨站触发（<img src>、链接、预取）→ 典型 CSRF；
//   2) 表名来自参数且无白名单 → 可传任意表越权读写（最危漏洞）。
// 这里同时修掉这两点：方法改 POST、加 CSRF 守卫、加表名/字段白名单。
const { csrfGuardPage, csrfGuard } = require('../../middleware/guard')
const { requirePermissionPage } = require('../../middleware/rbac')
const rbac = require('../../services/rbacService')

/**
 * SSR 专用：权限点由 body 里的 collectionName（表名）+ 动作拼出来。
 * 这三个接口的表名来自表单字段（不再来自 URL），并且已经过白名单校验，
 * 这里再把表名映射成业务资源名（admin→manage）后交给 requirePermissionPage。
 */
function requireTablePermission (action) {
  return async (ctx, next) => {
    const table = String((ctx.request.body && ctx.request.body.collectionName) || '')
    const resource = rbac.TABLE_RESOURCE[table] || table
    return requirePermissionPage(`${resource}:${action}`)(ctx, next)
  }
}

// 后台 UI 真正会操作的表（白名单）。表名来自前端参数，必须限定范围。
const ALLOWED_TABLES = ['admin', 'article', 'articlecate', 'nav', 'focus', 'link', 'setting']
// changeStatus 只允许切换这几个列，防止任意列被改写（attr 同样来自前端）
const ALLOWED_STATUS_ATTRS = ['status', 'is_best', 'is_hot', 'is_new']

/** 校验表名是否在白名单内，返回合法表名或 '' */
function pickTable (value) {
  const name = String(value || '')
  return ALLOWED_TABLES.includes(name) ? name : ''
}

/** 删除后回跳的地址（referer 优先，兜底后台首页） */
function backTo (ctx) {
  return (ctx.state.G && ctx.state.G.prevPage) || '/admin'
}

router.get('/', async (ctx) => {
  await ctx.render('admin/index')
})

// 切换状态（AJAX）：POST + CSRF；失败返回 JSON（前端判 success）
router.post('/changeStatus', csrfGuard, requireTablePermission('update'), async (ctx) => {
  const table = pickTable(ctx.request.body.collectionName)
  const attr = String(ctx.request.body.attr || '')
  const id = ctx.request.body.id

  if (!table || !ALLOWED_STATUS_ATTRS.includes(attr)) {
    ctx.body = { message: '参数错误（表名或字段不在白名单）', success: false }
    return
  }

  const data = await DB.find(table, { '_id': DB.getObjectId(id) })
  if (data.length > 0) {
    // es6 属性名表达式
    const json = data[0][attr] == 1 ? { [attr]: 0 } : { [attr]: 1 }
    const updateResult = await DB.update(table, { '_id': DB.getObjectId(id) }, json)
    ctx.body = updateResult
      ? { message: '更新成功', success: true }
      : { message: '更新失败', success: false }
  } else {
    ctx.body = { message: '更新失败,参数错误', success: false }
  }
})

// 改变排序（AJAX）：POST + CSRF
router.post('/changeSort', csrfGuard, requireTablePermission('update'), async (ctx) => {
  const table = pickTable(ctx.request.body.collectionName)
  const id = ctx.request.body.id
  const sortValue = ctx.request.body.sortValue

  if (!table) {
    ctx.body = { message: '参数错误（表名不在白名单）', success: false }
    return
  }

  const updateResult = await DB.update(table, { '_id': DB.getObjectId(id) }, { sort: sortValue })
  ctx.body = updateResult
    ? { message: '更新成功', success: true }
    : { message: '更新失败', success: false }
})

// 公共的删除方法：POST + CSRF + 表名白名单
// （原为 GET /admin/remove?collectionName=表 —— 最危漏洞，已重构为 POST）
router.post('/remove', csrfGuardPage, requireTablePermission('delete'), async (ctx) => {
  const table = pickTable(ctx.request.body.collectionName)
  const id = ctx.request.body.id
  if (!table) {
    ctx.status = 400
    await ctx.render('admin/error', {
      message: '参数错误（表名不在白名单）',
      redirect: (ctx.state.__HOST__ || '') + backTo(ctx)
    })
    return
  }
  try {
    await DB.remove(table, { '_id': DB.getObjectId(id) })
  } catch (err) {
    // 删除失败（如 id 非法）也回跳，不把栈暴露给用户
  }
  ctx.redirect(backTo(ctx))
})
module.exports = router.routes()
