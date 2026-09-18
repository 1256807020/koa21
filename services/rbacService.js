'use strict'
// services/rbacService.js
// ============================================================
// RBAC 业务层：角色 / 权限点 / 角色-权限映射 / 权限解析（带缓存）
//
// 权限模型（RBAC 最小闭环）：
//   admin.role_id ──▶ role ──(role_permission)──▶ permission
//   权限点命名统一为 "资源:动作"（article:delete / role:assign ...），
//   中间件只需按字符串拼装并判断集合是否包含，简单且好排查。
//
// 教学点：
//   1) 为什么权限点用"数据"而不是"代码里的 if"？
//      —— 加角色/调配权限不用改代码、不用发版；超级管理员的权限也是数据（显式映射全部权限点），
//         所以"超管全通过"不是代码特例，权限判断路径只有一条，最不容易出漏洞。
//   2) 为什么要缓存？鉴权在每个请求都跑，每次都 JOIN 两张表会给 DB 无谓压力；
//      这里做 30 秒 TTL 的进程内缓存 + 主动失效（改权限时立刻清）。
//      多实例部署时需换 Redis 或在网关统一鉴权（各实例缓存不同步会有最多 30s 偏差）。
//   3) 无物理外键的代价：删角色必须自己先删 role_permission 再删 role，且要在同一事务里，
//      否则中途失败会留下"孤儿关联行"。见 removeRole。
// ============================================================
const DB = require('../model/db')
const CODE = require('../utils/code')
const createLogger = require('../model/logger')

const log = createLogger('rbac')

// —— 业务资源名 ←→ 表名 映射（集中一处维护，避免 API 层与 SSR 层各写一套）——
// API 层用业务名 manage 指代"管理员"（表名是 admin，叫 manage 更贴近后台菜单语义）；
// SSR 层直接拿表名。两边都从这里取，防止写歪。
const RESOURCE_TABLE = {
  manage: 'admin',
  role: 'role',
  audit: 'audit_log',
  article: 'article',
  articlecate: 'articlecate',
  nav: 'nav',
  focus: 'focus',
  link: 'link',
  setting: 'setting'
}
const TABLE_RESOURCE = Object.fromEntries(
  Object.entries(RESOURCE_TABLE).map(([resource, table]) => [table, resource])
)

// —— 字段白名单（不 SELECT *：role 表虽无敏感字段，但统一风格，避免将来加列被顺手带出）——
const ROLE_FIELDS = { _id: 1, code: 1, name: 1, description: 1, status: 1, add_time: 1 }
const PERMISSION_FIELDS = { _id: 1, code: 1, name: 1, grp: 1, sort: 1 }

// —— 权限缓存：roleId -> { codes:Set<string>, expireAt:number } ——
const CACHE_TTL = 30 * 1000
const permCache = new Map()

/** 清缓存：传 roleId 只清该角色；不传清全部（角色/映射变更后调用） */
function clearPermissionCache (roleId) {
  if (roleId === undefined || roleId === null) permCache.clear()
  else permCache.delete(String(roleId))
}

function notFound (message) {
  const e = new Error(message)
  e.code = CODE.NOT_FOUND
  return e
}

function badRequest (message) {
  const e = new Error(message)
  e.code = CODE.PARAM_ERROR
  return e
}

// ---------------- 角色 ----------------

async function listRoles () {
  return DB.find('role', {}, ROLE_FIELDS, { sortJson: { add_time: 1 } })
}

async function getRole (roleId) {
  const rows = await DB.find('role', { _id: DB.getObjectId(roleId) }, ROLE_FIELDS)
  return rows[0] || null
}

async function createRole ({ code, name, description = '', status = 1 }) {
  const exist = await DB.find('role', { code }, { _id: 1 })
  if (exist.length) throw badRequest('角色标识已存在')
  const { rows } = await DB.insert('role', { code, name, description, status })
  return rows[0]
}

async function updateRole (roleId, data) {
  const id = DB.getObjectId(roleId)
  const patch = {}
  if (data.code !== undefined) patch.code = data.code
  if (data.name !== undefined) patch.name = data.name
  if (data.description !== undefined) patch.description = data.description
  if (data.status !== undefined) patch.status = data.status

  const { rowCount, rows } = await DB.update('role', { _id: id }, patch)
  if (!rowCount) throw notFound('角色不存在')
  clearPermissionCache(id) // 角色状态可能变化，权限缓存作废
  return rows[0]
}

/**
 * 删除角色
 * ⚠️ 这里最能体现"无物理外键"的代价：必须先删关联表，且两步要在同一事务里。
 *    如果有外键 + ON DELETE CASCADE，数据库会自动帮你做这件事。
 */
async function removeRole (roleId) {
  const id = DB.getObjectId(roleId)
  const role = await getRole(id)
  if (!role) throw notFound('角色不存在')

  // 还有管理员在用这个角色 → 不允许删，否则那些人会变成"无权限孤儿"
  const used = await DB.count('admin', { role_id: id })
  if (used > 0) throw badRequest(`该角色下还有 ${used} 个管理员，请先调整他们的角色`)

  await DB.transaction(async (client) => {
    await client.query('DELETE FROM role_permission WHERE role_id = $1', [id])
    await client.query('DELETE FROM role WHERE _id = $1', [id])
  })
  clearPermissionCache(id)
  log.info(`删除角色：${role.code}（已同步清理关联权限）`)
  return true
}

// ---------------- 权限点 ----------------

async function listPermissions () {
  return DB.find('permission', {}, PERMISSION_FIELDS, { sortJson: { sort: 1 } })
}

/** 某角色已拥有的权限点 code 列表 */
async function getRolePermissionCodes (roleId) {
  const role = await getRole(roleId)
  if (!role) throw notFound('角色不存在')
  const { rows } = await DB.query(
    `SELECT p.code
       FROM role_permission rp
       JOIN permission p ON p._id = rp.permission_id
      WHERE rp.role_id = $1
      ORDER BY p.sort`,
    [String(roleId)]
  )
  return rows.map((row) => row.code)
}

/**
 * 覆盖式设置角色权限（先清空再插入）
 * 用事务保证"清空 + 写入"要么全成功要么全回滚，不会出现权限被清空却没写回的中间态。
 */
async function setRolePermissions (roleId, codes = []) {
  const id = DB.getObjectId(roleId)
  const role = await getRole(id)
  if (!role) throw notFound('角色不存在')

  const wanted = [...new Set(codes.map((c) => String(c)))]
  // 只接受权限表里真实存在的 code（防止前端塞入伪造权限点）
  const permRows = wanted.length
    ? await DB.find('permission', { code: { $in: wanted } }, PERMISSION_FIELDS)
    : []

  await DB.transaction(async (client) => {
    await client.query('DELETE FROM role_permission WHERE role_id = $1', [id])
    for (const perm of permRows) {
      await client.query(
        'INSERT INTO role_permission (role_id, permission_id) VALUES ($1, $2)',
        [id, perm._id]
      )
    }
  })

  clearPermissionCache(id) // 立即生效，不让调用方等 30s
  log.info(`更新角色权限：${role.code} → ${permRows.length} 个权限点`)
  return permRows.map((row) => row.code)
}

// ---------------- 权限解析（鉴权用） ----------------

/** 解析某角色拥有的权限集合（带缓存） */
async function resolvePermissions (roleId) {
  const key = String(roleId || '')
  if (!key) return new Set()

  const cached = permCache.get(key)
  if (cached && cached.expireAt > Date.now()) return cached.codes

  const { rows } = await DB.query(
    `SELECT p.code
       FROM role_permission rp
       JOIN permission p ON p._id = rp.permission_id
      WHERE rp.role_id = $1`,
    [key]
  )
  const codes = new Set(rows.map((row) => row.code))
  permCache.set(key, { codes, expireAt: Date.now() + CACHE_TTL })
  return codes
}

/** 取某管理员的 role_id */
async function getAdminRoleId (adminId) {
  const rows = await DB.find('admin', { _id: DB.getObjectId(adminId) }, { _id: 1, role_id: 1 })
  return rows[0] ? rows[0].role_id : null
}

/** 取某管理员的权限集合（先查角色，再解析角色权限） */
async function getAdminPermissions (adminId) {
  const roleId = await getAdminRoleId(adminId)
  if (!roleId) return new Set()
  return resolvePermissions(roleId)
}

module.exports = {
  RESOURCE_TABLE,
  TABLE_RESOURCE,
  ROLE_FIELDS,
  PERMISSION_FIELDS,
  clearPermissionCache,
  listRoles,
  getRole,
  createRole,
  updateRole,
  removeRole,
  listPermissions,
  getRolePermissionCodes,
  setRolePermissions,
  resolvePermissions,
  getAdminRoleId,
  getAdminPermissions
}
