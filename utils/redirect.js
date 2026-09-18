'use strict'
// utils/redirect.js
// ============================================================
// 安全回跳：防御"开放重定向（Open Redirect）"
//
// 问题背景：后台删除/编辑后会"跳回上一页"，而"上一页"取自
//   - HTTP Referer 头（`ctx.state.G.prevPage`），或
//   - 表单隐藏域 `prevPage`
// 这两者**都是客户端可控的**。攻击者只要构造一个页面，让已登录管理员从该页发起请求
// （或直接伪造请求头），服务端就会 Respond 302 到攻击者指定的站点——
// 典型利用是"跳到高仿登录页"钓鱼：链接域名是可信的，落地页却是假的。
//
// 规则：只允许**站内相对路径**（以单个 `/` 开头，且不是 `//evil.com` 这种协议相对地址）。
// 其余（绝对 URL、协议相对、javascript: 等）一律拒绝，回退到 fallback。
// ============================================================
const SAFE_PATH_RE = /^\/(?!\/)[\w\-./?=&%#@!$'()*+,;:~]*$/

/**
 * 判断是否可安全回跳（站内相对路径）
 * @param {string} value 候选地址（来自 Referer 或表单字段）
 */
function isSafeBackPath (value) {
  if (typeof value !== 'string' || !value) return false
  // 必须单斜杠开头；`//evil.com` 会被浏览器当作协议相对地址，必须排除
  if (!SAFE_PATH_RE.test(value)) return false
  // 额外兜一层：明确含协议或反斜杠的一律拒绝（反斜杠在部分浏览器会被当斜杠）
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false
  if (value.includes('\\')) return false
  return true
}

/**
 * 取安全回跳地址：不安全则用 fallback
 * @param {string} value 候选地址
 * @param {string} [fallback='/admin'] 兜底地址
 */
function safeBackPath (value, fallback = '/admin') {
  return isSafeBackPath(value) ? value : fallback
}

module.exports = { isSafeBackPath, safeBackPath }
