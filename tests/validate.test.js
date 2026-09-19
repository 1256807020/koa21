'use strict'
// tests/validate.test.js —— zod 校验层（utils/validate.js）
// 用 Node 内置测试运行器（node:test + node:assert），零依赖：pnpm test
const test = require('node:test')
const assert = require('node:assert/strict')

const { parse, pageSchema } = require('../utils/validate')
const CODE = require('../utils/code')

test('parse：成功时返回"类型已转换"的数据（字符串 → 数字）', () => {
  const out = parse(pageSchema, { page: '2', pageSize: '20' })
  assert.equal(out.page, 2)
  assert.equal(out.pageSize, 20)
})

test('parse：缺省分页参数时套用 default（page=1, pageSize=10）', () => {
  const out = parse(pageSchema, {})
  assert.equal(out.page, 1)
  assert.equal(out.pageSize, 10)
})

test('parse：pageSize 超上限（100）应校验失败', () => {
  assert.throws(() => parse(pageSchema, { pageSize: 101 }), (err) => {
    // 必须转成带 .code 的"业务错误"，上层 handle 才能映射成 {code:1001} + HTTP 400
    assert.equal(err.code, CODE.PARAM_ERROR)
    assert.ok(err.message.length > 0, 'message 不能为空（会透给前端）')
    return true
  })
})

test('parse：page 小于 1 应校验失败', () => {
  assert.throws(() => parse(pageSchema, { page: 0 }), (err) => {
    assert.equal(err.code, CODE.PARAM_ERROR)
    return true
  })
})
