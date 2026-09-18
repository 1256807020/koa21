'use strict'
// tests/fileCleanup.test.js —— 删除记录时的孤儿图片清理
// 这是**安全敏感**的单元测试：清理功能会用数据库里的字符串去删文件，
// 一旦路径校验写错，它就变成"任意文件删除"漏洞。所以这里重点测**拒绝**的边界。
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs')
const os = require('os')

const { resolveManagedFile, cleanupFiles, RESOURCE_FILE_FIELDS } = require('../utils/fileCleanup')

const UPLOAD_ROOT = path.resolve(path.join(__dirname, '..', 'public', 'upload'))

test('resolveManagedFile：接受 upload/ 下的正常路径', () => {
  const abs = resolveManagedFile('upload/2026/abc.png')
  assert.equal(abs, path.join(UPLOAD_ROOT, '2026', 'abc.png'))
})

test('resolveManagedFile：容忍历史脏数据（带前导斜杠 / public 前缀 / 带域名）', () => {
  const expected = path.join(UPLOAD_ROOT, 'a.png')
  assert.equal(resolveManagedFile('/upload/a.png'), expected)
  assert.equal(resolveManagedFile('public/upload/a.png'), expected)
  assert.equal(resolveManagedFile('https://example.com/upload/a.png'), expected)
})

test('resolveManagedFile：**拒绝**逃出 upload 目录的路径穿越（防任意文件删除）', () => {
  assert.equal(resolveManagedFile('upload/../../app.js'), null)
  assert.equal(resolveManagedFile('upload/../../../etc/passwd'), null)
  assert.equal(resolveManagedFile('/../app.js'), null)
  assert.equal(resolveManagedFile('upload/..'), null)
})

test('resolveManagedFile：拒绝目录本身与非 upload 路径', () => {
  assert.equal(resolveManagedFile('upload'), null)          // upload 目录本身不能删
  assert.equal(resolveManagedFile('upload/'), null)
  assert.equal(resolveManagedFile('/views/index.html'), null)
  assert.equal(resolveManagedFile('app.js'), null)
  assert.equal(resolveManagedFile(''), null)
  assert.equal(resolveManagedFile(null), null)
  assert.equal(resolveManagedFile(undefined), null)
  assert.equal(resolveManagedFile(123), null)
})

test('cleanupFiles：按资源字段白名单清理，真的把文件删掉', () => {
  // 自己造一个真实的临时文件，验证"确实会被删"
  const file = path.join(UPLOAD_ROOT, '__cleanup_probe.png')
  fs.writeFileSync(file, 'x')
  assert.ok(fs.existsSync(file))

  const results = cleanupFiles('article', { img_url: `upload/${path.basename(file)}` })
  assert.equal(results.length, 1)
  assert.equal(results[0].ok, true)
  assert.equal(fs.existsSync(file), false, '文件应已被删除')
})

test('cleanupFiles：字段不在白名单 / 值为空时不动作', () => {
  assert.deepEqual(cleanupFiles('article', {}), [])
  assert.deepEqual(cleanupFiles('article', null), [])
  assert.deepEqual(cleanupFiles('article', { img_url: '' }), [])
  assert.deepEqual(cleanupFiles('foo', { img_url: 'upload/x.png' }), [])
})

test('cleanupFiles：路径被篡改时只返回失败，绝不删除目标文件', () => {
  // 用一个真实存在的文件做"受害者"，确认它不会被删
  const victim = path.join(__dirname, '..', 'package.json')
  assert.ok(fs.existsSync(victim))
  const results = cleanupFiles('article', { img_url: 'upload/../../../package.json' })
  assert.ok(results.every((r) => r.ok === false))
  assert.ok(fs.existsSync(victim), 'package.json 必须还在')
})

test('RESOURCE_FILE_FIELDS：白名单覆盖已知图片字段（防回归）', () => {
  assert.deepEqual(RESOURCE_FILE_FIELDS.article, ['img_url'])
  assert.deepEqual(RESOURCE_FILE_FIELDS.focus, ['pic'])
  assert.deepEqual(RESOURCE_FILE_FIELDS.link, ['pic'])
  assert.deepEqual(RESOURCE_FILE_FIELDS.setting, ['site_logo'])
})

test('清理不存在的文件只返回失败，不抛异常', () => {
  const results = cleanupFiles('focus', { pic: 'upload/__never_exists_123456.png' })
  assert.equal(results.length, 1)
  assert.equal(results[0].ok, false)
})
