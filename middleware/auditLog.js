'use strict'
// middleware/auditLog.js
// ============================================================
// 写操作审计埋点中间件（JSON API 与 SSR 后台**共用**）
//
// 实现方式：包住 next()，等业务跑完再决定要不要记。
//   - 只记"写方法"（POST/PUT/PATCH/DELETE）：GET 只读，记下来只会把日志表刷满；
//   - 只在**成功**时记（status < 400）：失败请求记了没意义（原因在应用日志里）；
//   - 动作由路径/方法推断：/add→create、/edit→update、/delete|/remove→delete，其余 other。
//
// 教学点：
//   1) 为什么不写在每个 handler 里？—— 新增接口很容易"忘了埋点"，而审计的价值在于**完整**。
//      放在中间件里等于"默认全记"，漏记概率最低。
//   2) 为什么在 next() 之后记录？—— ① 才能拿到真实 ctx.status；
//      ② multipart 表单的 body 要等 multer 解析，而 multer 在 next() 内部，
//         所以**只有等 next() 返回后**才读得到 body（resourceId/变更内容才不会丢）。
//   3) 审计是"事后追责"，不是"事前拦截"。要拦就用 RBAC（另一个中间件），职责不同。
// ============================================================
const audit = require('../services/auditService')
const rbac = require('../services/rbacService')

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

// 这些路径不记（登录本身有独立的失败计数与锁定；编辑器上传不属于数据变更）
const SKIP_PREFIXES = ['/admin/login']

/** 由路径与方法推断动作类型 */
function resolveAction (ctx) {
  if (ctx.method === 'DELETE') return 'delete'
  const path = ctx.path || ''
  if (path.endsWith('/delete') || path.endsWith('/remove')) return 'delete'
  if (path.endsWith('/add') || path.endsWith('/doAdd')) return 'create'
  if (path.endsWith('/edit') || path.endsWith('/doEdit')) return 'update'
  if (path.endsWith('/changeStatus') || path.endsWith('/changeSort')) return 'update'
  return 'other'
}

/**
 * 推断"操作的是哪个资源"
 *   - JSON API：路径里有 :resource（如 /api/v1/admin/article/...）
 *   - SSR 后台：路径第二段就是模块名（/admin/nav/doAdd → nav）
 *   - 批量端点（/admin/remove、/admin/changeStatus）：资源在 body.collectionName
 * 最后统一用 rbacService.TABLE_RESOURCE 把**表名**映射成**业务资源名**（admin → manage），
 * 保证 API 与 SSR 两个入口记下来的 resource 是同一套命名。
 */
function resolveResource (ctx) {
  const body = (ctx.request && ctx.request.body) || {}

  let raw = (ctx.params && ctx.params.resource) || ''
  if (!raw) {
    const seg = String(ctx.path || '').split('/').filter(Boolean) // ['admin','nav','doAdd']
    if (seg[0] === 'admin' && seg[1] && ['remove', 'changeStatus', 'changeSort'].includes(seg[1])) {
      raw = String(body.collectionName || '')
    } else if (seg[0] === 'admin' && seg[1]) {
      raw = seg[1]
    }
  }
  return rbac.TABLE_RESOURCE[raw] || raw
}

function resolveResourceId (ctx) {
  const body = (ctx.request && ctx.request.body) || {}
  return (ctx.params && (ctx.params.id || ctx.params.roleId)) || body.id || ''
}

function auditLog (ctx, next) {
  if (!WRITE_METHODS.includes(ctx.method)) return next()
  if (SKIP_PREFIXES.some((p) => (ctx.path || '').startsWith(p))) return next()

  return next().then(async () => {
    // 只记成功；失败留给应用日志，避免审计表被失败重试刷满
    if (ctx.status >= 400) return

    const userinfo = ctx.session && ctx.session.userinfo
    await audit.record({
      adminId: userinfo && userinfo._id,
      adminName: userinfo && userinfo.username,
      action: resolveAction(ctx),
      resource: resolveResource(ctx),
      resourceId: resolveResourceId(ctx),
      method: ctx.method,
      path: ctx.path,
      status: ctx.status,
      ip: ctx.ip,
      detail: ctx.request.body // record() 内部会脱敏
    })
  })
}

module.exports = { auditLog, resolveAction, resolveResource, resolveResourceId }
