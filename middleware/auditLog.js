'use strict'
// middleware/auditLog.js
// ============================================================
// 写操作审计埋点中间件
//
// 实现方式：包住 next()，等业务跑完再看结果决定要不要记。
//   - 只记"写方法"（POST/PUT/PATCH/DELETE）：GET 是只读，记下来只会把日志表刷满；
//   - 只在**成功**时记（status < 400）：失败请求记了也没意义（失败原因在应用日志里）；
//   - 动作由路径推断：/add→create、/edit→update、/delete→delete，其余 other。
//
// 教学点：
//   1) 为什么不写在每个 handler 里？—— 那样新增接口很容易"忘了埋点"，
//      审计的关键属性是**完整**。放在中间件里等于"默认全记"，漏记的概率最低。
//   2) 为什么放在业务之后记录？—— 这样能拿到真实的 ctx.status；
//      同时"是否成功"决定了要不要留痕（失败重试不会污染审计）。
//   3) 审计是"事后追责"，不是"事前拦截"。要拦就用 RBAC（另一个中间件），两者职责不同。
// ============================================================
const audit = require('../services/auditService')

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

/** 由路径与方法推断动作类型 */
function resolveAction (ctx) {
  if (ctx.method === 'DELETE') return 'delete'
  const path = ctx.path || ''
  if (path.endsWith('/delete')) return 'delete'
  if (path.endsWith('/add')) return 'create'
  if (path.endsWith('/edit')) return 'update'
  return 'other'
}

function auditLog (ctx, next) {
  if (!WRITE_METHODS.includes(ctx.method)) return next()

  return next().then(async () => {
    // 只记成功；失败留给应用日志，避免审计表被失败重试刷满
    if (ctx.status >= 400) return

    // ⚠️ 必须在 next() **之后**才读 ctx.params：
    // 中间件挂在路由链靠前的位置，那时 URL 还没被具体路由匹配，ctx.params 是空的，
    // 提前取会得到空字符串（这个坑实际踩过一次：审计里 resource 全是空）。
    const resource = (ctx.params && ctx.params.resource) || ''
    const resourceId = (ctx.params && (ctx.params.id || ctx.params.roleId)) || ''

    const userinfo = ctx.session && ctx.session.userinfo
    await audit.record({
      adminId: userinfo && userinfo._id,
      adminName: userinfo && userinfo.username,
      action: resolveAction(ctx),
      resource,
      resourceId,
      method: ctx.method,
      path: ctx.path,
      status: ctx.status,
      ip: ctx.ip,
      detail: ctx.request.body // record() 内部会脱敏
    })
  })
}

module.exports = { auditLog, resolveAction }
