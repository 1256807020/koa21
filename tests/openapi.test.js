'use strict'
// tests/openapi.test.js —— OpenAPI 自动生成（utils/openapi.js）
// 关键点：文档里的 schema 必须真的来自 zod（而不是手抄），所以这里断言"转换结果有结构"。
const test = require('node:test')
const assert = require('node:assert/strict')

const { buildSpec, toJson } = require('../utils/openapi')
const schemas = require('../utils/schemas')

test('toJson：zod → JSON Schema，能带出字段与约束', () => {
  const json = toJson(schemas.publicArticleQuerySchema)
  assert.equal(json.type, 'object')
  assert.ok(json.properties.keyword, '应包含 keyword 字段')
  assert.equal(json.properties.keyword.maxLength, 50, 'max(50) 应转换成 maxLength')
})

test('规范含要求的 OpenAPI 字段与全部模块路径', () => {
  const spec = buildSpec()
  assert.match(spec.openapi, /^3\.1/)
  assert.ok(spec.info.title && spec.info.version)

  const mustHave = [
    '/healthz',
    '/api/v1/public/categories',
    '/api/v1/public/articles/{id}',
    '/api/v1/csrf-token',
    '/api/v1/admin/{resource}/list',
    '/api/v1/admin/{resource}/{id}/delete',
    '/api/v1/admin/rbac/me',
    '/api/v1/admin/audit/list'
  ]
  for (const path of mustHave) {
    assert.ok(spec.paths[path], `缺少路径 ${path}`)
  }
})

test('组件里的 schema 由 zod 转换而来（不是空壳）', () => {
  const spec = buildSpec()
  const c = spec.components.schemas
  assert.ok(c.PublicArticleQuery.properties, 'PublicArticleQuery 应有 properties')
  assert.ok(c.RolePermission.properties.codes, 'RolePermission.codes 应存在')
  assert.ok(c.ResourceAdd.oneOf.length >= 2, 'ResourceAdd 应是多个资源的 oneOf')
})

test('鉴权方案声明了会话 Cookie 与 CSRF 头', () => {
  const spec = buildSpec()
  const schemes = spec.components.securitySchemes
  assert.equal(schemes.cookieAuth.in, 'cookie')
  assert.equal(schemes.csrfToken.name, 'X-CSRF-Token')
})
