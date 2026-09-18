// services/adminService.js
// ============================================================
// 管理员（后台用户）业务逻辑层
// 教学点：
//   1) 路由只调这里，所有 SQL 都集中在 service，方便复用与测试。
//   2) 所有 DB 调用都走 mongo-sql 参数化（底层 pg 占位符），从根上杜绝 SQL 注入。
//   3) service 抛出的错误都带 .code（见 utils/code.js），由路由层统一转成 fail()。
// ============================================================
const DB = require('../model/db')
const tools = require('../model/tools')
const code = require('../utils/code')
const rbacService = require('./rbacService')

const TABLE = 'admin'

// 对外字段白名单（P0 安全）：
//   admin 表含 password（bcrypt 哈希），若 SELECT * 会把哈希返回给接口调用方。
//   前后端分离后接口暴露面更大，必须显式限定返回字段。
const SAFE_FIELDS = { _id: 1, username: 1, status: 1, lasttime: 1, role_id: 1, add_time: 1 }

/** 去掉不应外泄的字段（INSERT/UPDATE 的 RETURNING * 会带回 password） */
function safe (row) {
  if (!row) return row
  const copy = { ...row }
  delete copy.password
  return copy
}

// —— 会话状态缓存：adminId -> { state, expireAt } ——
// 为什么需要：会话本身是客户端 Cookie，账号被删除/禁用/改角色后它不会自动失效。
// 若每次请求都查库确认，会给 DB 增加无谓压力；这里用 10 秒 TTL 折中。
// ⚠️ 多实例部署时各进程缓存不同步（最多 10 秒偏差），需换 Redis 或在网关统一校验。
const SESSION_TTL = 10 * 1000
const sessionCache = new Map()

function clearSessionCache (adminId) {
  if (adminId === undefined || adminId === null) sessionCache.clear()
  else sessionCache.delete(String(adminId))
}

/**
 * 查询"这个管理员现在还有效吗"（供 requireLogin 每次请求复核）
 * @returns {Promise<null|{_id:string, username:string, status:number, role_id:string|null}>}
 */
async function getSessionState (adminId) {
  const key = String(adminId || '')
  if (!key) return null

  const cached = sessionCache.get(key)
  if (cached && cached.expireAt > Date.now()) return cached.state

  const rows = await DB.find(TABLE, { _id: key }, SAFE_FIELDS)
  const row = rows[0]
  const state = row
    ? { _id: row._id, username: row.username, status: row.status, role_id: row.role_id || null }
    : null
  sessionCache.set(key, { state, expireAt: Date.now() + SESSION_TTL })
  return state
}

/** 校验 role_id 是否指向真实角色（防止绑到不存在的角色变成"无权限孤儿"） */
async function assertRoleExists (roleId) {
  if (roleId === undefined || roleId === null || roleId === '') return
  const rows = await DB.find('role', { _id: String(roleId) }, { _id: 1 })
  if (!rows.length) {
    const e = new Error('指定的角色不存在')
    e.code = code.PARAM_ERROR
    throw e
  }
}

/** 列表（分页 + 按用户名模糊搜索） */
async function list ({ page = 1, pageSize = 10, username = '' } = {}) {
  const where = {}
  // $ilike 由 mongo-sql 翻译成 ILIKE 参数化条件，大小写不敏感
  if (username) where.username = { $ilike: `%${username}%` }

  // 第三个参数用 SAFE_FIELDS 投影，而不是 null(=SELECT *) —— 见上方说明
  const rows = await DB.find(TABLE, where, SAFE_FIELDS, { page, pageSize, sortJson: { add_time: -1 } })
  const total = await DB.count(TABLE, where)
  return { list: rows, total, page, pageSize }
}

/** 按 id 取单条 */
async function getById (id) {
  const rows = await DB.find(TABLE, { _id: DB.getObjectId(id) }, SAFE_FIELDS)
  return rows[0] || null
}

/** 新增（密码用 bcrypt 哈希；用户名查重） */
async function create ({ username, password, status = 1, role_id }) {
  const exist = await DB.find(TABLE, { username })
  if (exist.length) {
    const e = new Error('管理员已存在')
    e.code = code.PARAM_ERROR
    throw e
  }
  await assertRoleExists(role_id) // 绑定的角色必须真实存在
  const { rows } = await DB.insert(TABLE, {
    username,
    password: await tools.hashPassword(password), // 绝不存明文
    status,
    role_id,             // RBAC：绑定的角色（为空表示没有任何权限）
    lasttime: ''
  })
  return safe(rows[0]) // 不把 password 哈希回传给调用方
}

/** 编辑（密码为空则不改；其余字段按需更新） */
async function update (id, { username, password, status, role_id }) {
  const data = {}
  if (username !== undefined) data.username = username
  if (status !== undefined) data.status = status
  if (role_id !== undefined) {
    await assertRoleExists(role_id)
    data.role_id = role_id
  }
  if (password) data.password = await tools.hashPassword(password)

  const { rowCount, rows } = await DB.update(TABLE, { _id: DB.getObjectId(id) }, data)
  if (!rowCount) {
    const e = new Error('管理员不存在')
    e.code = code.NOT_FOUND
    throw e
  }
  // 改动账号后必须让相关缓存失效：会话状态（10s TTL）与角色权限（30s TTL）
  clearSessionCache(id)
  rbacService.clearPermissionCache(data.role_id)
  return safe(rows[0]) // 不把 password 哈希回传给调用方
}

/** 删除（真正落地；原先 /admin/remove 是占位 ctx.body='删除用户'） */
async function remove (id) {
  const { rowCount } = await DB.remove(TABLE, { _id: DB.getObjectId(id) })
  if (!rowCount) {
    const e = new Error('管理员不存在')
    e.code = code.NOT_FOUND
    throw e
  }
  // 账号已删 → 立刻清掉会话状态缓存，让旧会话在下一个请求就被拒绝
  clearSessionCache(id)
  return true
}

module.exports = { list, getById, create, update, remove, getSessionState, clearSessionCache }
