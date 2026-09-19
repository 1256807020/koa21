'use strict'
/**
 * Mongo 风格查询 → PostgreSQL SQL 片段 翻译器
 *
 * 为什么需要它：
 * 原项目（koa2 教程版）所有路由里写的都是 Mongo 查询语法，
 * 例如 DB.find('article', { pid: { $in: ids } }, { _id: 1, title: 1 }, { page, pageSize, sortJson })
 * 迁移到 PostgreSQL 后，用这一层做翻译，路由代码可以一行不改。
 *
 * 支持：
 *   等值            { status: 1 }
 *   数组（视为 in） { pid: ['a', 'b'] }
 *   比较            { sort: { $gt: 0, $lte: 10 } }
 *   集合            { pid: { $in: [...] } } / { $nin: [...] }
 *   模糊            { title: { $like: '%koa%' } } / { $ilike } / { $regex }
 *   空值            { lasttime: null } → IS NULL
 *   逻辑            { $or: [...] } / { $and: [...] } / { $nor: [...] } / { $not: {...} }
 *   投影            { _id: 1, title: 1 }
 *   排序            { sortJson: { add_time: -1 } }
 * 所有值一律走参数化占位符，标识符做白名单校验，从根上杜绝 SQL 注入。
 */

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

function assertIdent (name) {
  if (typeof name !== 'string' || !IDENT_RE.test(name)) {
    throw new Error(`非法的表名/字段名: ${String(name)}`)
  }
  return name
}

function quoteIdent (name) {
  return `"${assertIdent(name)}"`
}

function addParam (params, value) {
  params.push(value)
  return `$${params.length}`
}

function buildIn (col, list, params, negate) {
  const values = list.filter((v) => v !== undefined)
  if (!values.length) return negate ? 'TRUE' : 'FALSE'
  const placeholders = values.map((v) => addParam(params, v)).join(', ')
  return `${col} ${negate ? 'NOT IN' : 'IN'} (${placeholders})`
}

const COMPARE_OPERATORS = {
  $eq: '=',
  $gt: '>',
  $gte: '>=',
  $lt: '<',
  $lte: '<=',
  $like: 'LIKE',
  $ilike: 'ILIKE'
}

function buildFieldCondition (field, value, params) {
  const col = quoteIdent(field)

  if (value === undefined) return ''
  if (value === null) return `${col} IS NULL`

  const isOperatorObject = typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp) &&
    !Buffer.isBuffer(value)

  if (isOperatorObject) {
    const parts = []
    for (const [op, operand] of Object.entries(value)) {
      if (COMPARE_OPERATORS[op]) {
        parts.push(`${col} ${COMPARE_OPERATORS[op]} ${addParam(params, operand)}`)
      } else if (op === '$ne') {
        parts.push(`${col} IS DISTINCT FROM ${addParam(params, operand)}`)
      } else if (op === '$in') {
        parts.push(buildIn(col, Array.isArray(operand) ? operand : [operand], params, false))
      } else if (op === '$nin') {
        parts.push(buildIn(col, Array.isArray(operand) ? operand : [operand], params, true))
      } else if (op === '$regex') {
        const pattern = operand instanceof RegExp ? operand.source : String(operand)
        parts.push(`${col} ~ ${addParam(params, pattern)}`)
      } else if (op === '$exists') {
        parts.push(operand ? `${col} IS NOT NULL` : `${col} IS NULL`)
      } else if (op === '$not') {
        parts.push(`${col} IS DISTINCT FROM ${addParam(params, operand)}`)
      } else {
        throw new Error(`不支持的查询操作符: ${op}`)
      }
    }
    return parts.join(' AND ')
  }

  if (Array.isArray(value)) return buildIn(col, value, params, false)
  return `${col} = ${addParam(params, value)}`
}

function buildWhere (where, params) {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return ''

  const clauses = []
  for (const [key, value] of Object.entries(where)) {
    if (key === '$or' || key === '$and' || key === '$nor') {
      const list = Array.isArray(value) ? value : []
      const parts = list.map((item) => buildWhere(item, params)).filter(Boolean)
      if (!parts.length) continue
      const joined = `(${parts.join(key === '$and' ? ' AND ' : ' OR ')})`
      clauses.push(key === '$nor' ? `NOT ${joined}` : joined)
      continue
    }
    if (key === '$not') {
      const inner = buildWhere(value, params)
      if (inner) clauses.push(`NOT (${inner})`)
      continue
    }
    if (key.startsWith('$')) throw new Error(`不支持的查询操作符: ${key}`)

    const condition = buildFieldCondition(key, value, params)
    if (condition) clauses.push(condition)
  }

  return clauses.join(' AND ')
}

function buildSelect (projection) {
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) return '*'
  const includes = Object.keys(projection)
    .filter((key) => !key.startsWith('$') && Number(projection[key]) === 1)
  if (!includes.length) return '*'
  return includes.map(quoteIdent).join(', ')
}

function buildOrder (sortJson) {
  if (!sortJson || typeof sortJson !== 'object' || Array.isArray(sortJson)) return ''
  const parts = []
  for (const [field, direction] of Object.entries(sortJson)) {
    const dir = (Number(direction) < 0 || String(direction).toLowerCase() === 'desc') ? 'DESC' : 'ASC'
    parts.push(`${quoteIdent(field)} ${dir}`)
  }
  return parts.length ? `ORDER BY ${parts.join(', ')}` : ''
}

module.exports = {
  assertIdent,
  quoteIdent,
  buildIn,
  buildWhere,
  buildSelect,
  buildOrder
}
