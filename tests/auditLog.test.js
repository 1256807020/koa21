'use strict'
// tests/auditLog.test.js —— 审计埋点的"资源名 / 动作 / 目标 id"推断
// 回归背景：审计原先只挂在 /api/v1/admin/*，SSR 后台的增删改**完全不进审计**（无痕）。
//          现在两个入口共用同一套推断逻辑，这些用例保证两条路径都记对。
const test = require('node:test')
const assert = require('node:assert/strict')

const { resolveAction, resolveResource, resolveResourceId } = require('../middleware/auditLog')

const ctxOf = (path, { method = 'POST', params = {}, body = {} } = {}) => ({
  path,
  method,
  params,
  request: { body }
})

test('resolveAction：SSR 与 API 的路径都能推断出正确动作', () => {
  assert.equal(resolveAction(ctxOf('/admin/nav/doAdd')), 'create')
  assert.equal(resolveAction(ctxOf('/admin/nav/doEdit')), 'update')
  assert.equal(resolveAction(ctxOf('/admin/remove')), 'delete')
  assert.equal(resolveAction(ctxOf('/admin/changeStatus')), 'update')
  assert.equal(resolveAction(ctxOf('/admin/changeSort')), 'update')
  assert.equal(resolveAction(ctxOf('/api/v1/admin/article/abc/add')), 'create')
  assert.equal(resolveAction(ctxOf('/api/v1/admin/article/abc/delete')), 'delete')
  assert.equal(resolveAction(ctxOf('/whatever', { method: 'DELETE' })), 'delete')
  assert.equal(resolveAction(ctxOf('/whatever')), 'other')
})

test('resolveResource：API 走 :resource 参数', () => {
  const ctx = ctxOf('/api/v1/admin/article/list', { params: { resource: 'article' }, method: 'GET' })
  assert.equal(resolveResource(ctx), 'article')
})

test('resolveResource：SSR 走路径第二段（/admin/nav/doAdd → nav）', () => {
  assert.equal(resolveResource(ctxOf('/admin/nav/doAdd')), 'nav')
  assert.equal(resolveResource(ctxOf('/admin/setting/doEdit')), 'setting')
})

test('resolveResource：批量端点走 body.collectionName，并把表名映射成业务资源名', () => {
  // admin 表 → manage 资源（与 JSON API 的命名保持一致，否则审计里会出现两套名字）
  assert.equal(resolveResource(ctxOf('/admin/remove', { body: { collectionName: 'admin' } })), 'manage')
  assert.equal(resolveResource(ctxOf('/admin/changeStatus', { body: { collectionName: 'nav' } })), 'nav')
  // 非白名单/缺省时不应抛错
  assert.equal(resolveResource(ctxOf('/admin/remove', { body: {} })), '')
})

test('resolveResourceId：兼容 params.id / params.roleId / body.id', () => {
  assert.equal(resolveResourceId(ctxOf('/api/v1/admin/article/x/delete', { params: { id: 'x' } })), 'x')
  assert.equal(resolveResourceId(ctxOf('/api/v1/admin/rbac/roles/r1/permissions', { params: { roleId: 'r1' } })), 'r1')
  assert.equal(resolveResourceId(ctxOf('/admin/nav/doEdit', { body: { id: 'n1' } })), 'n1')
  assert.equal(resolveResourceId(ctxOf('/admin/nav/doAdd', { body: {} })), '')
})
