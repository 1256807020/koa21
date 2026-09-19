'use strict'
// routes/api/audit.js
// ============================================================
// 审计日志查询接口：GET /api/v1/admin/audit/list
//   需要权限点 audit:list（默认只有超级管理员有）。
//   支持按操作人（模糊）、资源、动作过滤 + 分页。
// 教学点：审计日志"能查"才有价值。既然记录了谁改了什么，就必须提供一个受权限保护的正规查询入口，
//        而不是让人去连数据库翻表。
// ============================================================
const Router = require('@koa/router')
const router = new Router()

const { ok } = require('../../utils/response')
const { handle } = require('../../utils/handle')
const { parse } = require('../../utils/validate')
const { auditQuerySchema } = require('../../utils/schemas')
const { requireLogin } = require('../../middleware/guard')
const { requirePermission } = require('../../middleware/rbac')
const auditService = require('../../services/auditService')

router.use(requireLogin)

router.get('/list', requirePermission('audit:list'), handle(async (ctx) => {
  const { page, pageSize, adminName, resource, action, keyword } = parse(auditQuerySchema, ctx.query)
  ok(ctx, await auditService.list({ page, pageSize, adminName, resource, action, keyword }))
}))

module.exports = router.routes()
