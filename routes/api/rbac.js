'use strict'
// routes/api/rbac.js
// ============================================================
// RBAC 管理接口：/api/v1/admin/rbac/*
//   GET  /rbac/me                          当前登录者的角色与权限点（前端据此渲染菜单/按钮）
//   GET  /rbac/roles                       角色列表
//   GET  /rbac/permissions                 权限点列表（全部）
//   GET  /rbac/roles/:roleId/permissions   某角色已有的权限点
//   POST /rbac/roles/:roleId/permissions   覆盖式设置某角色的权限点
//
// 教学点：/rbac/me 是前后端分离后**必须**的接口——
//   前端要靠它决定"哪些菜单显示、哪些按钮可点"，而不是把权限硬编码在前端。
//   注意：前端隐藏按钮只是体验优化，**真正的拦截永远在服务端**（requirePermission）。
// ============================================================
const Router = require('@koa/router')
const router = new Router()

const { ok } = require('../../utils/response')
const { handle } = require('../../utils/handle')
const { parse } = require('../../utils/validate')
const { rolePermissionSchema } = require('../../utils/schemas')
const { requireLogin } = require('../../middleware/guard')
const { requirePermission } = require('../../middleware/rbac')
const rbac = require('../../services/rbacService')

// 本组接口都要求登录；具体操作的权限点逐个声明在路由上
router.use(requireLogin)

router.get('/me', handle(async (ctx) => {
  const userinfo = ctx.session.userinfo
  const codes = [...(await rbac.resolvePermissions(userinfo.role_id))]
  ok(ctx, {
    user: { _id: userinfo._id, username: userinfo.username },
    roleId: userinfo.role_id || null,
    permissions: codes
  })
}))

router.get('/roles', requirePermission('role:list'), handle(async (ctx) => {
  ok(ctx, await rbac.listRoles())
}))

router.get('/permissions', requirePermission('role:list'), handle(async (ctx) => {
  ok(ctx, await rbac.listPermissions())
}))

router.get('/roles/:roleId/permissions', requirePermission('role:list'), handle(async (ctx) => {
  ok(ctx, await rbac.getRolePermissionCodes(ctx.params.roleId))
}))

router.post('/roles/:roleId/permissions', requirePermission('role:assign'), handle(async (ctx) => {
  const payload = parse(rolePermissionSchema, ctx.request.body)
  const codes = await rbac.setRolePermissions(ctx.params.roleId, payload.codes)
  ok(ctx, { codes }, '权限已更新')
}))

module.exports = router.routes()
