'use strict'
// middleware/rbac.js
// ============================================================
// RBAC 鉴权中间件：在"已登录"的基础上，再校验"有没有这个权限点"
//
// 与 guard.js 的分工：
//   requireLogin    → 你是谁？（未登录 401）
//   requirePermission → 你能不能做这件事？（无权限 403）
//
// 教学点：
//   1) 权限点是"资源:动作"字符串（article:delete）。路由上声明式挂载：
//        router.post('/:resource/:id/delete', requirePermissionByResource('delete'), handler)
//      读代码就能看出每个接口需要什么权限，比在 handler 里写 if 清晰得多。
//   2) 与 guard 一样，失败要 **return fail(...)** 而不是 throw：
//      throw 会冒泡到全局中间件变成 500，把"无权限"这种正常业务判断误报成服务端故障。
//   3) 拿不到权限集合时（没分配角色）一律拒绝（fail-closed）——
//      安全设计要"默认关门"，绝不能因为查不到就放行。
// ============================================================
const { fail } = require('../utils/response')
const CODE = require('../utils/code')
const rbac = require('../services/rbacService')

/** 取当前登录者的权限集合（未登录返回空集合） */
async function currentPermissions (ctx) {
  const userinfo = ctx.session && ctx.session.userinfo
  if (!userinfo) return { userinfo: null, perms: new Set() }
  const perms = await rbac.resolvePermissions(userinfo.role_id)
  return { userinfo, perms }
}

/**
 * 校验固定权限点，如 requirePermission('role:assign')
 */
function requirePermission (permission) {
  return async (ctx, next) => {
    const { userinfo, perms } = await currentPermissions(ctx)
    if (!userinfo) {
      return fail(ctx, CODE.UNAUTHENTICATED, '未登录或登录态已失效', null, 401)
    }
    if (!perms.size) {
      return fail(ctx, CODE.FORBIDDEN, '当前账号未分配角色，或角色没有任何权限', null, 403)
    }
    if (!perms.has(permission)) {
      return fail(ctx, CODE.FORBIDDEN, `无权限：${permission}`, null, 403)
    }
    return next()
  }
}

/**
 * 资源驱动路由专用：权限点由 URL 里的 :resource 动态拼装。
 * 例如 requirePermissionByResource('delete') 会把 /admin/article/xxx/delete 变成 article:delete
 */
function requirePermissionByResource (action) {
  return async (ctx, next) => {
    const resource = ctx.params && ctx.params.resource
    if (!resource) {
      return fail(ctx, CODE.PARAM_ERROR, '缺少资源标识', null, 400)
    }
    return requirePermission(`${resource}:${action}`)(ctx, next)
  }
}

/**
 * SSR（服务端渲染表单）版本：失败渲染错误页，而不是返回 JSON。
 * 与 csrfGuardPage 保持同一风格，避免用户看到裸 JSON。
 */
function requirePermissionPage (permission) {
  return async (ctx, next) => {
    const { perms } = await currentPermissions(ctx)
    if (!perms.has(permission)) {
      ctx.status = 403
      await ctx.render('admin/error', {
        message: `无权限执行该操作（需要权限点：${permission}）`,
        redirect: (ctx.state.__HOST__ || '') + '/admin'
      })
      return
    }
    return next()
  }
}

/**
 * SSR 专用：按"数据库表名 + 动作"声明权限。
 * SSR 路由没有 :resource 路径参数，各路由文件自己知道操作的是哪张表，
 * 所以这里提供 requirePermissionPageByTable('nav', 'create') → 校验 nav:create。
 * 表名到资源名的映射集中在 rbacService.TABLE_RESOURCE，避免两边写歪。
 */
function requirePermissionPageByTable (table, action) {
  const resource = rbac.TABLE_RESOURCE[table] || table
  return requirePermissionPage(`${resource}:${action}`)
}

module.exports = {
  requirePermission,
  requirePermissionByResource,
  requirePermissionPage,
  requirePermissionPageByTable,
  currentPermissions
}
