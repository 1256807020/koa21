'use strict'
// tests/db-id.test.js —— id 参数校验必须抛"带错误码的业务错误"
// 回归背景：以前只抛普通 Error，上层认不出是客户端参数问题，
// `GET /api/v1/public/articles/@@@` 会返回 500（把客户端错误报成服务端故障）。
const test = require('node:test')
const assert = require('node:assert/strict')

const DB = require('../model/db')
const CODE = require('../utils/code')

test('合法 id（字母数字下划线中划线，1~64 位）原样返回', () => {
  for (const id of ['abc', '5bdaf166e67d082570b10e01', 'a-b_c', 'A1']) {
    assert.equal(DB.getObjectId(id), id)
  }
})

test('非法 id 抛带 PARAM_ERROR 的错误（而不是无码的普通 Error）', () => {
  for (const bad of ['@@@', 'a b', 'a;b', "a'b", 'x'.repeat(80), '', null, undefined]) {
    assert.throws(() => DB.getObjectId(bad), (err) => {
      assert.equal(err.code, CODE.PARAM_ERROR, `非法 id ${JSON.stringify(bad)} 的错误码不对`)
      assert.ok(err.message.includes('非法的 id'), '提示语应说明是 id 参数问题')
      return true
    }, `应拒绝 ${JSON.stringify(bad)}`)
  }
})
