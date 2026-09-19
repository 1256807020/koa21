'use strict'
// tests/article-fields.test.js —— 守住"schema ↔ service 字段对齐"这条契约
//
// 背景（真实事故）：articleService.create 曾经只接收 title/author/pid/content/status，
// 而 utils/schemas.js 的 article add schema 放行了 description/keywords/img_url/is_best/...
// → 后台填的描述、关键词、封面图、推荐位、排序**全部被静默丢弃**，编辑时自然是空的。
// 这类 bug 不报错、不抛异常，只靠人工点页面才能发现；所以用测试把契约钉死。
const test = require('node:test')
const assert = require('node:assert/strict')

const { resourceAddSchemas } = require('../utils/schemas')
const { MUTABLE_FIELDS } = require('../services/articleService')

test('article：schema 放行的字段必须都被 service 接受（防静默丢弃）', () => {
  const schemaKeys = Object.keys(resourceAddSchemas.article.shape)
  const missing = schemaKeys.filter((k) => !MUTABLE_FIELDS.includes(k))
  assert.deepEqual(
    missing,
    [],
    `以下字段 schema 放行但 service 不收，会被静默丢弃：${missing.join(', ')}`
  )
})

test('article：MUTABLE_FIELDS 不应包含 schema 未声明的字段（防绕过校验写库）', () => {
  const schemaKeys = Object.keys(resourceAddSchemas.article.shape)
  const extra = MUTABLE_FIELDS.filter((k) => !schemaKeys.includes(k))
  assert.deepEqual(
    extra,
    [],
    `以下字段 service 接受但 schema 未声明，前端传不进来（白名单形同虚设）：${extra.join(', ')}`
  )
})
