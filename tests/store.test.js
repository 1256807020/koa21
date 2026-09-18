'use strict'
// tests/store.test.js —— 统一缓存/计数存储（model/store.js 的进程内实现）
// 为什么测这个：限流与权限缓存都建立在它之上，
// 一旦 incr/ttl/delByPrefix 语义错了，限流与鉴权会一起出问题。
const test = require('node:test')
const assert = require('node:assert/strict')

const store = require('../model/store')

// 单测统一用进程内后端（不依赖外部 Redis，保证 CI 可跑）
store._useMemory()

test('set/get：值可读写，未设置的 key 返回 null', async () => {
  await store.set('t:basic', 'hello')
  assert.equal(await store.get('t:basic'), 'hello')
  assert.equal(await store.get('t:not-exist'), null)
})

test('ttl：带过期的 key 到期后取不到（毫秒语义）', async () => {
  await store.set('t:ttl', 'v', 60)
  const remain = await store.ttl('t:ttl')
  assert.ok(remain > 0 && remain <= 60, `ttl 应为剩余毫秒，实际 ${remain}`)

  await new Promise((resolve) => setTimeout(resolve, 90))
  assert.equal(await store.get('t:ttl'), null, '过期后应取不到')
  assert.equal(await store.ttl('t:ttl'), -2, '不存在的 key，ttl 应为 -2')
})

test('incr：自增返回新值；窗口内过期时间不被续期', async () => {
  assert.equal(await store.incr('t:incr', 5000), 1)
  assert.equal(await store.incr('t:incr', 5000), 2)
  assert.equal(await store.incr('t:incr', 5000), 3)

  const remain = await store.ttl('t:incr')
  assert.ok(remain > 0 && remain <= 5000, `窗口不应被续期，实际 ${remain}`)
})

test('incr：未指定 ttl 时永不过期', async () => {
  await store.incr('t:incr-forever')
  assert.equal(await store.ttl('t:incr-forever'), -1, '无过期应返回 -1')
})

test('del / delByPrefix：删除与按前缀批量删除', async () => {
  await store.set('t:del:a', '1')
  await store.set('t:del:b', '2')
  await store.del('t:del:a')
  assert.equal(await store.get('t:del:a'), null)
  assert.equal(await store.get('t:del:b'), '2')

  await store.set('t:del:c', '3')
  await store.delByPrefix('t:del:')
  assert.equal(await store.get('t:del:b'), null)
  assert.equal(await store.get('t:del:c'), null)
})

test('默认后端是进程内实现（未配 Redis 时不报错）', () => {
  assert.equal(store.kind, 'memory')
  assert.equal(store.isRedis(), false)
})
