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
const { safeBackPath } = require('../../utils/redirect')

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

/**
 * 删除后回跳的地址（referer 优先，兜底后台首页）
 * ⚠️ Referer 是客户端可控的，直接 ctx.redirect(referer) 就是**开放重定向**漏洞
 * （实测可 302 到 https://evil.example.com）。必须用 safeBackPath 限制为站内相对路径。
 */
function backTo (ctx) {
  const referer = ctx.state.G && ctx.state.G.prevPage
  return safeBackPath(referer, '/admin')
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
  const rawId = String(ctx.request.body.id || '')
  const back = backTo(ctx)

  // 统一用错误页反馈（而不是静默回跳）——静默失败会让用户以为"删成功了"
  const deny = async (message, status = 400) => {
    ctx.status = status
    await ctx.render('admin/error', {
      message,
      redirect: (ctx.state.__HOST__ || '') + back
    })
  }

  if (!table) return deny('参数错误（表名不在白名单）')
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(rawId)) return deny('参数错误（id 非法）')

  // —— 业务守卫：避免"删出孤儿数据"与"把系统删到没人能进" ——
  if (table === 'admin') {
    if (rawId === ctx.session.userinfo._id) return deny('不能删除当前登录的账号')
    // 无物理外键 + 单角色模型下，把管理员删光就再也进不去后台了，必须先拦住
    const total = await DB.count('admin', {})
    if (total <= 1) return deny('系统至少需要保留一个管理员账号')
  }
  if (table === 'articlecate') {
    // 分类是树形 + 文章通过 pid 逻辑关联，删父分类会留下"孤儿文章/孤儿子分类"
    const children = await DB.count('articlecate', { pid: rawId })
    if (children > 0) return deny(`该分类下还有 ${children} 个子分类，请先处理子分类`)
    const articles = await DB.count('article', { pid: rawId })
    if (articles > 0) return deny(`该分类下还有 ${articles} 篇文章，请先移走或删除这些文章`)
  }

  try {
    const { rowCount } = await DB.remove(table, { '_id': rawId })
    if (!rowCount) return deny('删除失败：记录不存在', 404)
  } catch (err) {
    return deny(`删除失败：${err.message}`)
  }
  ctx.redirect(back)
})
module.exports = router.routes()
