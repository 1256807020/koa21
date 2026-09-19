'use strict'
// utils/schemas.js
// ============================================================
// API 请求 schema 的**单一来源**（Single Source of Truth）
//
// 教学点：契约与实现漂移是接口项目最常见的技术债——
//   路由里写一套校验、文档里再抄一套，改了一边忘了另一边，文档就变成了假的。
//   这里把请求 schema 集中到本文件，让**两处都从这里取**：
//     1) 业务路由用它做真实校验（runtime）
//     2) utils/openapi.js 用 z.toJSONSchema() 把它转成 OpenAPI 文档（documentation）
//   一份定义，两处消费，天然不会漂移。
// ============================================================
const { z, pageSchema } = require('./validate')

// ---------------- 公开内容 ----------------

/** 公开文章列表查询参数 */
const publicArticleQuerySchema = pageSchema.extend({
  cateId: z.string().max(64).optional(),
  keyword: z.string().max(50).optional()
})

// ---------------- 后台资源 CRUD ----------------
// 注意：这里的 schema 面向 **JSON API**（字段是结构化 JSON）；
// 后台老表单（SSR）的 schema 在各自 routes/admin/*.js 里，因为表单字段集不同（多 rpassword 等）。

/**
 * 后台资源的「新增」schema —— 单一来源：
 *   路由用它做运行时校验，utils/openapi.js 用它生成文档，避免契约与实现漂移。
 *
 * ⚠️ 字段必须与 services 里的 mutableFields 对齐：schema 放行但 service 不接受，字段会被静默丢弃；
 *    schema 不放行而页面需要，则前端根本传不进来。两边一起看才能保证接口"够用"。
 */
const resourceAddSchemas = {
  manage: z.object({
    username: z.string().min(2, '用户名至少 2 位').max(30),
    password: z.string().min(6, '密码至少 6 位').max(30),
    role_id: z.string().max(64).optional(),
    status: z.coerce.number().int().min(0).max(1).optional()
  }),
  article: z.object({
    title: z.string().min(1, '标题必填').max(200),
    author: z.string().max(50).optional(),
    pid: z.string().optional(),
    content: z.string().optional(),
    status: z.coerce.number().int().min(0).max(1).optional(),
    // ↓ 补齐：原先缺这些字段，后台无法设置封面图 / SEO 信息 / 推荐位 / 排序
    img_url: z.string().max(255).optional(),
    keywords: z.string().max(255).optional(),
    description: z.string().max(500).optional(),
    is_best: z.coerce.number().int().min(0).max(1).optional(),
    is_hot: z.coerce.number().int().min(0).max(1).optional(),
    is_new: z.coerce.number().int().min(0).max(1).optional(),
    sort: z.coerce.number().int().min(0).optional()
  }),
  articlecate: z.object({
    title: z.string().min(1, '分类名必填').max(100),
    pid: z.string().optional(),
    keywords: z.string().max(255).optional(),
    description: z.string().max(500).optional(),
    status: z.coerce.number().int().min(0).max(1).optional(),
    sort: z.coerce.number().int().min(0).optional()
  }),
  nav: z.object({
    title: z.string().min(1, '标题必填').max(100),
    url: z.string().min(1, '链接必填').max(255),
    sort: z.coerce.number().int().min(0).optional(),
    status: z.coerce.number().int().min(0).max(1).optional()
  }),
  focus: z.object({
    title: z.string().min(1, '标题必填').max(100),
    pic: z.string().max(255).optional(),
    url: z.string().max(255).optional(),
    sort: z.coerce.number().int().min(0).optional(),
    status: z.coerce.number().int().min(0).max(1).optional()
  }),
  link: z.object({
    title: z.string().min(1, '标题必填').max(100),
    pic: z.string().max(255).optional(),
    url: z.string().max(255).optional(),
    sort: z.coerce.number().int().min(0).optional(),
    status: z.coerce.number().int().min(0).max(1).optional()
  })
  // 注意：setting **故意没有 add schema** —— 单行配置表，不支持新增
}

/** 编辑用 schema：把新增 schema 的必填放开（PATCH 语义，部分字段更新） */
const resourceUpdateSchemas = Object.fromEntries(
  Object.entries(resourceAddSchemas).map(([key, schema]) => [key, schema.partial()])
)

// setting 是单行表：不能新增，但必须能更新 —— 单独声明它的 update schema
resourceUpdateSchemas.setting = z.object({
  site_title: z.string().min(1, '站点名称必填').max(100),
  site_url: z.string().max(255).optional(),
  site_logo: z.string().max(255).optional(),
  site_keywords: z.string().max(255).optional(),
  site_description: z.string().max(500).optional(),
  site_icp: z.string().max(100).optional(),
  site_qq: z.string().max(50).optional(),
  site_tel: z.string().max(50).optional(),
  site_address: z.string().max(255).optional(),
  site_status: z.coerce.number().int().min(0).max(1).optional()
}).partial()

// ---------------- RBAC ----------------

/** 覆盖式设置角色权限 */
const rolePermissionSchema = z.object({
  codes: z.array(z.string().max(80)).default([])
})

// ---------------- 审计 ----------------

const auditQuerySchema = pageSchema.extend({
  adminName: z.string().max(50).optional(),
  resource: z.string().max(50).optional(),
  action: z.string().max(20).optional(),
  // 新后台（/console/audit）统一用 keyword 做模糊搜索（匹配 操作人/资源/动作）
  keyword: z.string().max(50).optional()
})

// ---------------- 统计报表（SQL 教学） ----------------

/** 分组 TopN 的 N */
const statsTopQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(2)
})

/** 按月趋势的月份数 */
const statsMonthlyQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(12)
})

/**
 * EXPLAIN 参数
 * ⚠️ 只接受**白名单键**（`query` 是预置查询的名字，不是 SQL 文本）——
 *    如果允许传原始 SQL，等于把数据库只读权限开放给任何调用方。
 */
const statsExplainQuerySchema = z.object({
  query: z.string({ error: '缺少 query 参数' }).min(1, '缺少 query 参数').max(50),
  // 注意：不能用 z.coerce.boolean() —— Boolean('false') === true，会把"关"解析成"开"
  analyze: z.enum(['0', '1', 'true', 'false']).optional()
})

// ---------------- 通用路径参数 ----------------

const resourceParamSchema = z.object({ resource: z.string().max(50) })
const idParamSchema = z.object({ id: z.string().max(64) })

module.exports = {
  pageSchema,
  publicArticleQuerySchema,
  resourceAddSchemas,
  resourceUpdateSchemas,
  rolePermissionSchema,
  auditQuerySchema,
  statsTopQuerySchema,
  statsMonthlyQuerySchema,
  statsExplainQuerySchema,
  resourceParamSchema,
  idParamSchema
}
