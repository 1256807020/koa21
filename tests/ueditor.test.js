'use strict'
// tests/ueditor.test.js —— 富文本编辑器上传白名单（model/ueditor.js 的 checkFileType）
// 回归背景：编辑器上传原先自成一套更弱的白名单，绕过了 tools.multer 的图片限制，
//          还能上传 zip/rar/doc/txt（= 把站点变成文件托管），且 uploadvideo 用错白名单导致视频永远传不上。
const test = require('node:test')
const assert = require('node:assert/strict')

const ueditor = require('../model/ueditor')
const { checkFileType } = ueditor

test('uploadimage：合法 PNG（扩展名 + MIME 都对）通过', () => {
  assert.equal(checkFileType('uploadimage', 'a.png', 'image/png').ok, true)
})

test('uploadimage：PNG 后缀但 MIME 是 text/plain → 拒绝（改名绕过）', () => {
  const r = checkFileType('uploadimage', 'a.png', 'text/plain')
  assert.equal(r.ok, false)
  assert.match(r.message, /与内容不符/)
})

test('uploadimage：.txt → 拒绝', () => {
  assert.equal(checkFileType('uploadimage', 'a.txt', 'text/plain').ok, false)
})

test('uploadimage：.svg → 拒绝（XSS 载体）', () => {
  assert.equal(checkFileType('uploadimage', 'a.svg', 'image/svg+xml').ok, false)
})

test('uploadvideo：.mp4 + video/mp4 → 通过（修掉原先"视频永远被拒"的逻辑 bug）', () => {
  assert.equal(checkFileType('uploadvideo', 'v.mp4', 'video/mp4').ok, true)
})

test('uploadvideo：图片后缀 → 拒绝（白名单按 action 隔离）', () => {
  assert.equal(checkFileType('uploadvideo', 'a.png', 'image/png').ok, false)
})

test('uploadfile：已彻底禁用（不再提供任意文件托管）', () => {
  for (const [name, mime] of [['a.zip', 'application/zip'], ['a.pdf', 'application/pdf'], ['a.txt', 'text/plain']]) {
    const r = checkFileType('uploadfile', name, mime)
    assert.equal(r.ok, false, `${name} 不应被接受`)
    assert.match(r.message, /禁用/)
  }
})

test('大小写混写的扩展名按小写处理（.PNG 等价 .png）', () => {
  assert.equal(checkFileType('uploadimage', 'A.PNG', 'image/png').ok, true)
})

test('ACTION_EXT 暴露的白名单里不含 uploadfile（防回归）', () => {
  assert.deepEqual(ueditor.ACTION_EXT.uploadfile, [])
})
