'use strict'
// tests/rbac.test.js —— RBAC 中间件与资源映射
// 说明：这里只测**不需要连数据库**的分支（fail-closed 行为与映射表），
//       需要真实权限数据的场景由端到端脚本覆盖。
const test = require('node:test')
const assert = require('node:assert/strict')

const rbacService = require('../services/rbacService')
const { requirePermission, requirePermissionByResource, currentPermissions } = require('../middleware/rbac')
const CODE = require('../utils/code')

const ctxWith = (session) => ({ session, status: 200, body: null, params: {} })

test('资源名 ↔ 表名 映射：admin 表对应 manage 资源（不能反）', () => {
  assert.equal(rbacService.RESOURCE_TABLE.manage, 'admin')
  assert.equal(rbacService.TABLE_RESOURCE.admin, 'manage')
  assert.equal(rbacService.TABLE_RESOURCE.article, 'article')
})

test('未登录 → 401（fail-closed，绝不能放行）', async () => {
  const ctx = ctxWith({})
  let reached = false
  await requirePermission('article:list')(ctx, async () => { reached = true })
  assert.equal(reached, false, '未登录不能进入业务')
  assert.equal(ctx.status, 401)
  assert.equal(ctx.body.code, CODE.UNAUTHENTICATED)
})

test('已登录但没有角色 → 403（拿不到权限时必须拒绝，而不是放行）', async () => {
  const ctx = ctxWith({ userinfo: { _id: 'x', username: 'u' } }) // 没有 role_id
  let reached = false
  await requirePermission('article:list')(ctx, async () => { reached = true })
  assert.equal(reached, false)
  assert.equal(ctx.status, 403)
  assert.equal(ctx.body.code, CODE.FORBIDDEN)
})

test('资源驱动：缺少 :resource 参数 → 400', async () => {
  const ctx = ctxWith({ userinfo: { _id: 'x', username: 'u', role_id: 'r' } })
  ctx.params = {}
  let reached = false
  await requirePermissionByResource('list')(ctx, async () => { reached = true })
  assert.equal(reached, false)
  assert.equal(ctx.status, 400)
})

test('currentPermissions：未登录返回空集合', async () => {
  const { userinfo, perms } = await currentPermissions(ctxWith({}))
  assert.equal(userinfo, null)
  assert.equal(perms.size, 0)
})
