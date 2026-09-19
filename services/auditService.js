'use strict'
// services/auditService.js
// ============================================================
// 操作审计日志：记录"谁、何时、对什么、做了什么"
//
// 教学点：
//   1) 审计写入**绝不能影响业务**：业务已经成功了，日志写失败只能记 error，不能把请求变成 500。
//      所以 record() 内部自己 try/catch 吞掉异常（fire-and-forget 的安全写法）。
//   2) 入库前必须**脱敏**：password / token / csrf 这类字段一律替换成 [REDACTED]。
//      "记谁改了什么"不等于"把凭据留痕"——审计表被人拿到不该等于凭据泄露。
//   3) 大字段要截断：富文本正文可能几十 KB，直接入库会把审计表撑爆，这里超长截断。
//   4) 查询用字段白名单 + 索引列（created_at DESC / admin_id / resource），见 schema.sql。
// ============================================================
const DB = require('../model/db')
const createLogger = require('../model/logger')

const log = createLogger('audit')

// 敏感字段名特征：命中即脱敏（密码、令牌、验证码等）
const SENSITIVE_KEY_RE = /pass|pwd|token|secret|csrf|captcha|code$/i
// 单个字符串字段的最大入库长度（超出截断，防止审计表被正文撑爆）
const MAX_TEXT = 2000

/** 对请求体做脱敏 + 截断，返回可安全入库的对象（非对象返回 null） */
function sanitize (data) {
  if (!data || typeof data !== 'object') return null
  const out = {}
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = '[REDACTED]'
      continue
    }
    if (typeof value === 'string' && value.length > MAX_TEXT) {
      out[key] = `${value.slice(0, MAX_TEXT)}...[truncated ${value.length - MAX_TEXT} chars]`
      continue
    }
    out[key] = value
  }
  return out
}

/**
 * 写入一条审计日志（失败只记日志，不抛错）
 * @param {object} entry
 * @param {string} [entry.adminId]   操作人 _id
 * @param {string} [entry.adminName] 操作人用户名（冗余存储：即使账号被删也能追溯）
 * @param {string} entry.action      create / update / delete / other
 * @param {string} [entry.resource]  资源名，如 article
 * @param {string} [entry.resourceId]目标记录 _id
 * @param {string} [entry.method]    HTTP 方法
 * @param {string} [entry.path]      请求路径
 * @param {number} [entry.status]    HTTP 状态
 * @param {string} [entry.ip]        客户端 IP
 * @param {object} [entry.detail]    变更内容（会被脱敏）
 */
async function record (entry = {}) {
  try {
    await DB.insert('audit_log', {
      admin_id: entry.adminId || '',
      admin_name: entry.adminName || '',
      action: entry.action || 'other',
      resource: entry.resource || '',
      resource_id: entry.resourceId || '',
      method: entry.method || '',
      path: entry.path || '',
      status: Number.isFinite(entry.status) ? entry.status : 200,
      ip: entry.ip || '',
      detail: sanitize(entry.detail)
    })
  } catch (err) {
    // 审计失败不能影响业务：只记录，不向上抛
    log.error('写入审计日志失败:', err.message)
  }
}

const LIST_FIELDS = {
  _id: 1, admin_id: 1, admin_name: 1, action: 1, resource: 1, resource_id: 1,
  method: 1, path: 1, status: 1, ip: 1, detail: 1, created_at: 1
}

/** 分页查询审计日志（支持按操作人/资源/动作过滤） */
async function list ({ page = 1, pageSize = 20, adminName = '', resource = '', action = '', keyword = '' } = {}) {
  const where = {}
  if (adminName) where.admin_name = { $ilike: `%${adminName}%` }
  if (resource) where.resource = resource
  if (action) where.action = action
  if (keyword) {
    // 新后台（/console/audit）的搜索框语义：一个关键词同时匹配 操作人 / 资源 / 动作。
    // 注意每个字段单独建对象，避免共用同一个条件对象被底层改写。
    where.$or = [
      { admin_name: { $ilike: `%${keyword}%` } },
      { resource: { $ilike: `%${keyword}%` } },
      { action: { $ilike: `%${keyword}%` } }
    ]
  }

  const rows = await DB.find('audit_log', where, LIST_FIELDS, {
    page,
    pageSize,
    sortJson: { created_at: -1 }
  })
  const total = await DB.count('audit_log', where)
  return { list: rows, total, page, pageSize }
}

module.exports = { record, sanitize, list }
