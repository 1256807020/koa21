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
    status: z.coerce.number().int().min(0).max(1).optional()
  })
}

/** 编辑用 schema：把新增 schema 的必填放开（PATCH 语义，部分字段更新） */
const resourceUpdateSchemas = Object.fromEntries(
  Object.entries(resourceAddSchemas).map(([key, schema]) => [key, schema.partial()])
)

// ---------------- RBAC ----------------

/** 覆盖式设置角色权限 */
const rolePermissionSchema = z.object({
  codes: z.array(z.string().max(80)).default([])
})

// ---------------- 审计 ----------------

const auditQuerySchema = pageSchema.extend({
  adminName: z.string().max(50).optional(),
  resource: z.string().max(50).optional(),
  action: z.string().max(20).optional()
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
  resourceParamSchema,
  idParamSchema
}
