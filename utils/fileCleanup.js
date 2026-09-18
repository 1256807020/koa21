'use strict'
// utils/fileCleanup.js
// ============================================================
// 删除记录时顺带清理关联的图片文件
//
// 问题背景：删除文章/焦点图/友链时，数据库行删了，但 public/upload/ 里的图片一直留着，
//   时间久了就是"孤儿文件"：占磁盘、备份越来越大，且旧图仍可被公开 URL 访问。
//
// ⚠️ 最关键的安全点：**必须先校验待删文件确实在 upload 目录内**（containment）。
//   库里的 img_url 理论上可能被篡改成 "../../../etc/passwd" / "upload/../../app.js"，
//   如果不做 containment 就直接拼接路径删除，这个功能会从"清理垃圾"变成**任意文件删除**漏洞。
//
// 教学点：凡是"用数据库里的字符串拼文件系统路径"的场景，都要问一句
//   —— 这字符串如果不是我期望的样子，最坏会发生什么？
// ============================================================
const path = require('path')
const fs = require('fs')
const config = require('../model/config')
const createLogger = require('../model/logger')

const log = createLogger('fileCleanup')

// 资源名 -> 该记录可能存储图片路径的字段。
// 刻意做成"白名单"：只对已知的图片字段动手，避免误删别的非图片内容。
const RESOURCE_FILE_FIELDS = {
  article: ['img_url'],
  focus: ['pic'],
  link: ['pic'],
  setting: ['site_logo']
}

const UPLOAD_ROOT = path.resolve(config.upload.dirAbs)

/**
 * 把库里存的图片路径解析成绝对路径；不在 upload 目录内则返回 null。
 * 库里存的形态一般是 "upload/xxx.png"（tools.imgUrl 的产物），
 * 但历史数据里也可能出现 "/upload/xxx.png"、"public/upload/xxx.png" 甚至带域名的全路径。
 * @param {unknown} value
 * @returns {string|null}
 */
function resolveManagedFile (value) {
  if (typeof value !== 'string') return null
  let raw = value.trim()
  if (!raw) return null

  raw = raw.replace(/^https?:\/\/[^/]+/i, '') // 去掉可能的域名前缀
  raw = raw.replace(/^\/+/, '')               // 去掉开头的斜杠
  if (raw.startsWith('public/')) raw = raw.slice('public/'.length)

  // 必须是 upload 目录下的资源
  if (raw !== 'upload' && !raw.startsWith('upload/') && !raw.startsWith('upload\\')) return null

  const abs = path.resolve(config.root, 'public', raw)
  const rel = path.relative(UPLOAD_ROOT, abs)
  // rel === '' 表示指向的就是 upload 目录本身，不能删（只能删文件）
  // rel 以 '..' 开头或为绝对路径 => 逃出了 upload 目录 => 拒绝
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return abs
}

/**
 * 删除一个受管的图片文件
 * @returns {{ok:boolean, reason?:string, file?:string}}
 */
function deleteManagedFile (value) {
  const abs = resolveManagedFile(value)
  if (!abs) return { ok: false, reason: '不在受管目录内（已拒绝）' }
  try {
    if (!fs.existsSync(abs)) return { ok: false, reason: '文件不存在' }
    const st = fs.statSync(abs)
    if (!st.isFile()) return { ok: false, reason: '不是普通文件' }
    fs.unlinkSync(abs)
    log.info(`已清理孤儿文件：${abs}`)
    return { ok: true, file: abs }
  } catch (err) {
    // 清理失败绝不能影响主流程（记录都删完了，不能因为删图失败报错）
    log.warn(`清理文件失败 ${abs}: ${err.message}`)
    return { ok: false, reason: err.message }
  }
}

/**
 * 删除某条记录关联的所有图片（按资源的字段白名单）
 * 失败一律只记日志，不抛错 —— 主记录已经删掉了，清理属于"尽力而为"。
 * @param {string} resource 资源名（article / focus / link / setting）
 * @param {object|null} row 删除**之前**取到的那一行
 * @returns {Array<{ok:boolean, reason?:string, file?:string}>}
 */
function cleanupFiles (resource, row) {
  if (!row || typeof row !== 'object') return []
  const fields = RESOURCE_FILE_FIELDS[resource] || []
  const results = []
  for (const field of fields) {
    if (row[field]) results.push(deleteManagedFile(row[field]))
  }
  return results
}

module.exports = {
  cleanupFiles,
  deleteManagedFile,
  resolveManagedFile,
  RESOURCE_FILE_FIELDS
}
