// services/adminService.js
// ============================================================
// 管理员（后台用户）业务逻辑层
// 教学点：
//   1) 路由只调这里，所有 SQL 都集中在 service，方便复用与测试。
//   2) 所有 DB 调用都走 sql-builder 参数化（底层 pg 占位符），从根上杜绝 SQL 注入。
//   3) service 抛出的错误都带 .code（见 utils/code.js），由路由层统一转成 fail()。
// ============================================================
const DB = require('../model/db')
const tools = require('../model/tools')
const code = require('../utils/code')
const config = require('../model/config')
const store = require('../model/store')
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

// —— 会话状态缓存 ——
// 为什么需要：会话本身是客户端 Cookie，账号被删除/禁用/改角色后它不会自动失效。
// 若每次请求都查库确认，会给 DB 增加无谓压力；这里用短 TTL 折中（默认 10 秒）。
// 存储走 model/store.js：配 Redis 则多实例共享（改账号后全局即时失效），否则各进程各存一份。
const SESSION_TTL = config.redis.sessionTtlMs
const SESSION_CACHE_PREFIX = 'session:admin:'
const sessionKey = (adminId) => `${SESSION_CACHE_PREFIX}${adminId}`

async function clearSessionCache (adminId) {
  if (adminId === undefined || adminId === null) await store.delByPrefix(SESSION_CACHE_PREFIX)
  else await store.del(sessionKey(adminId))
}

/**
 * 查询"这个管理员现在还有效吗"（供 requireLogin 每次请求复核）
 * @returns {Promise<null|{_id:string, username:string, status:number, role_id:string|null}>}
 */
async function getSessionState (adminId) {
  const key = String(adminId || '')
  if (!key) return null

  const cached = await store.get(sessionKey(key))
  if (cached !== null && cached !== undefined) {
    // 注意：这里把"账号不存在"也缓存成字符串 'null'，
    // 否则一个已被删除的账号会每次请求都去查库（等于给了攻击者一个免费的打库入口）。
    return cached === 'null' ? null : JSON.parse(cached)
  }

  const rows = await DB.find(TABLE, { _id: key }, SAFE_FIELDS)
  const row = rows[0]
  const state = row
    ? { _id: row._id, username: row.username, status: row.status, role_id: row.role_id || null }
    : null
  await store.set(sessionKey(key), state ? JSON.stringify(state) : 'null', SESSION_TTL)
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
async function list ({ page = 1, pageSize = 10, username = '', keyword = '' } = {}) {
  // keyword 是新后台（/console）与其它通用资源统一的搜索参数名；username 是老接口沿用的参数名，二者等价。
  const kw = keyword || username
  const where = {}
  // $ilike 由 sql-builder 翻译成 ILIKE 参数化条件，大小写不敏感
  if (kw) where.username = { $ilike: `%${kw}%` }

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
  await clearSessionCache(id)
  await rbacService.clearPermissionCache(data.role_id)
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
  await clearSessionCache(id)
  return true
}

module.exports = { list, getById, create, update, remove, getSessionState, clearSessionCache }
