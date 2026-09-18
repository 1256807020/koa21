'use strict'
/**
 * 审计日志归档脚本（P1 可运维性）
 *
 * 为什么需要它：
 *   审计日志是**只增不减**的表（每次写操作一行）。跑一年可能几十上百万行，
 *   热表越大 → 分页查询越慢、备份越重、索引维护越贵。
 *   而实际情况是：90 天前的审计几乎没人查，但**又不能直接删**（合规要留痕）。
 *   所以正解是"冷热分离"：近期留热表，过期搬冷备表/冷存储。
 *
 * 本脚本做的事（在一个**事务**里完成，避免"搬家丢件"）：
 *   1) INSERT INTO audit_log_archive SELECT ... FROM audit_log WHERE created_at < 阈值
 *   2) DELETE FROM audit_log WHERE created_at < 阈值
 *   —— 两步必须在同一事务里：否则 insert 成功后 delete 前进程挂掉，热表会留下重复数据。
 *
 * 用法：
 *   node scripts/audit-archive.js                    # 归档超过 AUDIT_RETENTION_DAYS(默认90) 的行
 *   node scripts/audit-archive.js --days=30          # 临时指定保留期
 *   node scripts/audit-archive.js --dry-run          # 只统计，不动数据（建议先跑）
 *   node scripts/audit-archive.js --prune-days=1095  # 额外清理归档表里超过 1095 天(3年)的行
 *
 * 生产建议：交给 cron / k8s CronJob **每天跑一次**，输出进日志。
 *   0 3 * * * cd /app && node scripts/audit-archive.js >> /var/log/audit-archive.log 2>&1
 */
const fs = require('fs')
require('dotenv').config({ path: `.env.${process.env.NODE_ENV || 'development'}` })
const path = require('path')

const config = require('../model/config')
const createLogger = require('../model/logger')
const DB = require('../model/db')

const log = createLogger('audit-archive')

function argValue (name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (!hit) return fallback
  const num = Number(hit.split('=')[1])
  return Number.isFinite(num) && num >= 0 ? num : fallback
}

function hasFlag (name) {
  return process.argv.some((a) => a === `--${name}`)
}

const RETENTION_DAYS = argValue('days', Number(process.env.AUDIT_RETENTION_DAYS || 90))
const PRUNE_DAYS = argValue('prune-days', Number(process.env.AUDIT_ARCHIVE_RETENTION_DAYS || 0))
const DRY_RUN = hasFlag('dry-run')

async function main () {
  log.info(`开始审计归档：保留 ${RETENTION_DAYS} 天${DRY_RUN ? '（dry-run，不写库）' : ''}`)

  // 归档表可能还没建（老库跑 db:init 之前），这里自动补建，避免脚本成为"只有我记得要先建表"的隐性依赖
  const ddl = fs.readFileSync(path.join(config.root, 'db', 'schema.sql'), 'utf8')
  const start = ddl.indexOf('-- ---------------- 审计归档冷表')
  if (start >= 0) {
    const end = ddl.indexOf('\n\n', start)
    await DB.query(ddl.slice(start, end < 0 ? undefined : end))
  }

  const threshold = `now() - interval '${Math.floor(RETENTION_DAYS)} days'`

  const before = await DB.query(`SELECT count(*)::int AS n FROM audit_log WHERE created_at < ${threshold}`)
  const total = before.rows[0].n
  if (!total) {
    log.info('没有需要归档的记录')
  } else if (DRY_RUN) {
    log.info(`[dry-run] 将归档 ${total} 行（未变更任何数据）`)
  } else {
    // 事务：搬 + 删原子完成（用 model/db 提供的 transaction 封装，走同一个连接池）
    const { moved, deleted } = await DB.transaction(async (client) => {
      const moved = await client.query(
        `INSERT INTO audit_log_archive (admin_id, admin_name, action, resource, resource_id, method, path, status, ip, detail, created_at)
         SELECT admin_id, admin_name, action, resource, resource_id, method, path, status, ip, detail, created_at
           FROM audit_log WHERE created_at < ${threshold}`
      )
      const deleted = await client.query(`DELETE FROM audit_log WHERE created_at < ${threshold}`)
      return { moved, deleted }
    })
    if (moved.rowCount !== deleted.rowCount) {
      log.warn(`搬运(${moved.rowCount})与删除(${deleted.rowCount})行数不一致，请人工核对！`)
    }
    log.info(`已归档 ${deleted.rowCount} 行 → audit_log_archive`)
  }

  if (PRUNE_DAYS > 0) {
    const t2 = `now() - interval '${Math.floor(PRUNE_DAYS)} days'`
    const cnt = await DB.query(`SELECT count(*)::int AS n FROM audit_log_archive WHERE archived_at < ${t2}`)
    log.info(`归档表中超过 ${PRUNE_DAYS} 天的记录：${cnt.rows[0].n} 行`)
    if (cnt.rows[0].n && !DRY_RUN) {
      const r = await DB.query(`DELETE FROM audit_log_archive WHERE archived_at < ${t2}`)
      log.info(`已清理归档表 ${r.rowCount} 行`)
    }
  }

  const remain = await DB.query('SELECT count(*)::int AS n FROM audit_log')
  log.info(`归档后 audit_log 剩余行数：${remain.rows[0].n}`)
}

main()
  .then(async () => { await DB.close(); process.exit(0) })
  .catch(async (err) => { log.error('归档失败：', err.message); try { await DB.close() } catch (e) { /* noop */ } process.exit(1) })
