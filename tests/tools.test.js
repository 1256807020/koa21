'use strict'
// tests/tools.test.js —— 上传白名单与路径工具（model/tools.js）
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const tools = require('../model/tools')
const config = require('../model/config')

/** 把 multer 的 (req, file, cb) 回调包装成 Promise，方便断言 */
function runFilter (file) {
  return new Promise((resolve) => {
    tools.uploadFileFilter({}, file, (err, accept) => resolve({ err, accept }))
  })
}

test('合法 PNG（后缀 + MIME 都对）→ 接受', async () => {
  const { accept } = await runFilter({ originalname: 'a.png', mimetype: 'image/png' })
  assert.equal(accept, true)
})

test('.txt → 拒绝（后缀不在白名单）', async () => {
  const { accept } = await runFilter({ originalname: 'shell.txt', mimetype: 'text/plain' })
  assert.equal(accept, false)
})

test('后缀 .png 但 MIME 是 text/plain → 拒绝（防改名绕过）', async () => {
  const { accept } = await runFilter({ originalname: 'shell.png', mimetype: 'text/plain' })
  assert.equal(accept, false)
})

test('.svg → 拒绝（SVG 可内嵌 script，是 XSS 载体）', async () => {
  const { accept } = await runFilter({ originalname: 'x.svg', mimetype: 'image/svg+xml' })
  assert.equal(accept, false)
})

test('imgUrl：返回相对 public 的 posix 路径（Windows 下也不能出现反斜杠）', () => {
  const abs = path.join(config.root, 'public', 'upload', '2026', 'a.png')
  const url = tools.imgUrl({ path: abs })
  assert.equal(url, 'upload/2026/a.png')
  assert.ok(!url.includes('\\'), '不能出现 Windows 反斜杠')
})

test('imgUrl：没有 file 时返回空串', () => {
  assert.equal(tools.imgUrl(null), '')
  assert.equal(tools.imgUrl({}), '')
})
