'use strict'
// services/statsService.js
// ============================================================
// 统计报表服务（SQL 教学：GROUP BY / 窗口函数 / EXPLAIN）
//
// 本文件是整个项目里 SQL 用法最"进阶"的地方，每一段都值得对照学习：
//   1) aggregate：COUNT(*) FILTER (WHERE ...) —— 一条 SQL 同时算多个维度，替代多次查询
//   2) groupRank：LEFT JOIN + GROUP BY + 窗口函数（ROW_NUMBER / RANK / DENSE_RANK /
//      SUM() OVER() / 窗口内累计 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW）
//   3) groupTopN：PARTITION BY + ROW_NUMBER() —— "每个分组取前 N 条"的经典解法
//      （用窗口函数替代 MySQL 时代的分组 TopN 各种写法）
//   4) explain：EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) —— 看执行计划，而不是猜
// ============================================================
const DB = require('../model/db')
const CODE = require('../utils/code')

function badRequest (message) {
  const e = new Error(message)
  e.code = CODE.PARAM_ERROR
  return e
}

/**
 * 概览：内容/分类/管理员/审计的总量与状态分布
 * 教学点：`COUNT(*) FILTER (WHERE 条件)` 是 PostgreSQL 的聚合过滤语法，
 *        一条 SQL 就能同时得到"总数/在线/离线/推荐/热门/最新"，
 *        比写 6 条 SELECT COUNT(*) ... WHERE 快得多（只扫一次表）。
 */
async function overview () {
  const { rows } = await DB.query(`
    SELECT
      COUNT(*)::int                                   AS total,
      COUNT(*) FILTER (WHERE status = 1)::int         AS online,
      COUNT(*) FILTER (WHERE status <> 1)::int        AS offline,
      COUNT(*) FILTER (WHERE is_best = 1)::int        AS best,
      COUNT(*) FILTER (WHERE is_hot = 1)::int         AS hot,
      COUNT(*) FILTER (WHERE is_new = 1)::int         AS new_count,
      MIN(add_time)                                   AS first_add_time,
      MAX(add_time)                                   AS last_add_time
    FROM article
  `)

  // 标量子查询：小表的计数，写起来最直观（每个子查询一次扫描）
  const { rows: counts } = await DB.query(`
    SELECT
      (SELECT COUNT(*)::int FROM articlecate) AS cate_total,
      (SELECT COUNT(*)::int FROM admin)       AS admin_total,
      (SELECT COUNT(*)::int FROM focus)       AS focus_total,
      (SELECT COUNT(*)::int FROM link)        AS link_total,
      (SELECT COUNT(*)::int FROM audit_log)   AS audit_total
  `)

  return { article: rows[0], counts: counts[0] }
}

/**
 * 分类统计排行：GROUP BY + 窗口函数
 *
 * 教学点（这几条是本节的核心）：
 *   - **过滤条件写在 ON 而不是 WHERE**：`LEFT JOIN article a ON ... AND a.status = 1`。
 *     若把 `a.status = 1` 写到 WHERE 里，LEFT JOIN 会退化成 INNER JOIN，
 *     "一篇在架文章都没有的分类"会从结果里整行消失（这类 bug 很隐蔽）。
 *   - ROW_NUMBER() / RANK() / DENSE_RANK() 的区别：
 *       ROW_NUMBER  → 1,2,3,4（永不重复）
 *       RANK        → 1,2,2,4（并列后续跳号）
 *       DENSE_RANK  → 1,2,2,3（并列后续不跳号）
 *   - SUM(cnt) OVER ()：不带 ORDER BY 的窗口聚合 = "整张结果集的总和"，可用来算占比。
 *   - SUM(cnt) OVER (ORDER BY ... ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)：
 *     **累计值**（running total），进而算出累计占比 —— 帕累托/ABC 分析的原理。
 */
async function categoryStats () {
  const { rows } = await DB.query(`
    WITH cate_stat AS (
      SELECT c._id,
             c.title,
             c.pid,
             COUNT(a._id)::int AS article_count
        FROM articlecate c
        LEFT JOIN article a
               ON a.pid = c._id
              AND a.status = 1
       GROUP BY c._id, c.title, c.pid
    ),
    ranked AS (
      SELECT _id,
             title,
             pid,
             article_count,
             ROW_NUMBER() OVER (ORDER BY article_count DESC, title) AS row_no,
             RANK()       OVER (ORDER BY article_count DESC)        AS rank_no,
             DENSE_RANK() OVER (ORDER BY article_count DESC)        AS dense_rank_no,
             SUM(article_count) OVER ()                             AS total_articles,
             ROUND(100.0 * article_count / NULLIF(SUM(article_count) OVER (), 0), 2) AS pct,
             SUM(article_count) OVER (
               ORDER BY article_count DESC, title
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS running_total
        FROM cate_stat
    )
    SELECT _id, title, pid, article_count,
           row_no, rank_no, dense_rank_no,
           total_articles, pct, running_total,
           ROUND(100.0 * running_total / NULLIF(total_articles, 0), 2) AS running_pct
      FROM ranked
     ORDER BY row_no
  `)
  return rows
}

/**
 * 每个分类下最新的 N 篇文章（分组 TopN）
 * 教学点：PARTITION BY 把结果按分类切窗，再在窗内用 ROW_NUMBER 排序取前 N。
 *   老写法（相关子查询 / 变量 / LIMIT+UNION）都很绕；窗口函数一行搞定。
 * ⚠️ 注意不能在同一个 SELECT 的 WHERE 里直接引用窗口函数别名（执行顺序：WHERE 早于窗口函数），
 *    所以要套一层子查询。
 */
async function topArticlesPerCategory (limit = 2) {
  const { rows } = await DB.query(`
    SELECT *
      FROM (
        SELECT a._id,
               a.title,
               a.pid,
               c.title AS cate_name,
               a.add_time,
               a.is_hot,
               ROW_NUMBER() OVER (PARTITION BY a.pid ORDER BY a.add_time DESC) AS rn_in_cate
          FROM article a
          LEFT JOIN articlecate c ON c._id = a.pid
         WHERE a.status = 1
      ) t
     WHERE rn_in_cate <= $1
     ORDER BY pid, rn_in_cate
  `, [limit])
  return rows
}

/**
 * 按月发文趋势（GROUP BY + date_trunc）
 * 教学点：
 *   - `date_trunc('month', add_time)` 把时间戳归一到月初，配合 GROUP BY 就是"按月统计"。
 *   - `GROUP BY 1` 是**按第一个输出列**分组的简写（可读性取舍：短但不够直观，索引列多时慎用）。
 *   - 用「月初 - N 个月」做下界，比 `add_time > now() - interval 'N month'` 更整齐（不会切到月中）。
 */
async function monthlyTrend (months = 12) {
  const { rows } = await DB.query(`
    SELECT to_char(date_trunc('month', add_time), 'YYYY-MM') AS month,
           COUNT(*)::int                                   AS article_count,
           COUNT(*) FILTER (WHERE is_hot = 1)::int         AS hot_count
      FROM article
     WHERE status = 1
       AND add_time >= date_trunc('month', now()) - ($1::int - 1) * interval '1 month'
     GROUP BY 1
     ORDER BY 1 DESC
  `, [months])
  return rows
}

// ============================================================
// EXPLAIN：看清数据库"打算怎么执行"，而不是靠猜
//
// ⚠️ 安全红线：**绝不接受客户端传来的原始 SQL**。
//    "帮我 EXPLAIN 任意 SQL" 等于把数据库读权限开放给任何人（SQL 注入 by design）。
//    所以这里用**白名单**：只允许对预置的几条查询做 EXPLAIN。
// ============================================================
const EXPLAIN_QUERIES = {
  'public-articles': {
    title: '前台文章列表（JOIN 分类 + 排序 + 分页）',
    sql: `SELECT a._id, a.title, a.add_time, c.title AS cate_name
            FROM article a
            LEFT JOIN articlecate c ON c._id = a.pid
           WHERE a.status = 1
           ORDER BY a.sort DESC, a.add_time DESC
           LIMIT $1 OFFSET $2`,
    params: [10, 0]
  },
  'cate-tree': {
    title: '分类树（WITH RECURSIVE 递归 CTE）',
    sql: `WITH RECURSIVE tree AS (
            SELECT _id, title, pid, 1 AS level FROM articlecate WHERE pid = '0'
            UNION ALL
            SELECT c._id, c.title, c.pid, t.level + 1
              FROM articlecate c JOIN tree t ON c.pid = t._id
          )
          SELECT * FROM tree ORDER BY level, title`,
    params: []
  },
  'cate-stat': {
    title: '分类统计排行（GROUP BY + 窗口函数）',
    sql: `SELECT c._id, COUNT(a._id)::int AS cnt
            FROM articlecate c
            LEFT JOIN article a ON a.pid = c._id AND a.status = 1
           GROUP BY c._id
           ORDER BY cnt DESC`,
    params: []
  },
  'article-detail': {
    title: '文章详情 + 分类名（主键查询）',
    sql: `SELECT a._id, a.title, a.content, c.title AS cate_name
            FROM article a
            LEFT JOIN articlecate c ON c._id = a.pid
           WHERE a._id = $1`,
    params: ['5bdaf166e67d082570b10e01']
  },
  'audit-list': {
    title: '审计日志分页（索引扫描）',
    sql: `SELECT _id, admin_name, action, resource, created_at
            FROM audit_log
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2`,
    params: [20, 0]
  },
  'title-search': {
    title: '标题模糊搜索（ILIKE，看是否走索引）',
    sql: `SELECT _id, title FROM article WHERE title ILIKE $1 LIMIT 20`,
    params: ['%PostgreSQL%']
  }
}

/** 列出可 EXPLAIN 的查询（供前端下拉框使用） */
function listExplainQueries () {
  return Object.entries(EXPLAIN_QUERIES).map(([key, q]) => ({ key, title: q.title, sql: q.sql }))
}

/**
 * 执行 EXPLAIN 并返回执行计划
 * @param {string} key 白名单里的键
 * @param {boolean} analyze 是否真实执行（ANALYZE 会真正跑一遍查询并给实际耗时/行数）
 */
async function explain (key, { analyze = true } = {}) {
  const target = EXPLAIN_QUERIES[key]
  if (!target) {
    throw badRequest(`不支持的 EXPLAIN 目标：${key}（仅允许白名单内的查询）`)
  }

  // ANALYZE 会真的执行查询（注意：对写操作有副作用；这里只允许只读查询）
  // BUFFERS 显示缓存命中情况，VERBOSE 显示输出列，FORMAT JSON 便于程序读取
  const options = analyze
    ? 'ANALYZE, BUFFERS, VERBOSE, FORMAT JSON'
    : 'FORMAT JSON'
  const { rows } = await DB.query(`EXPLAIN (${options}) ${target.sql}`, target.params)

  const root = rows[0]['QUERY PLAN'][0]
  return {
    key,
    title: target.title,
    sql: target.sql,
    analyze,
    planningTimeMs: root['Planning Time'],
    executionTimeMs: root['Execution Time'],
    rootNodeType: root.Plan && root.Plan['Node Type'],
    plan: root
  }
}

module.exports = { overview, categoryStats, topArticlesPerCategory, monthlyTrend, explain, listExplainQueries }
