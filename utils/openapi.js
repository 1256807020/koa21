'use strict'
// utils/openapi.js
// ============================================================
// OpenAPI 3.1 文档"自动生成"
//
// 教学点：为什么强调"自动生成"？
//   手写 YAML 文档几乎必然会过期（代码改了文档忘了），最后没人信文档。
//   这里的做法是：**请求 schema 只在 utils/schemas.js 定义一份**，
//   路由用它做运行时校验，本文件用 `z.toJSONSchema()` 把它转成 JSON Schema 填进文档。
//   一份定义两处消费 → 校验规则一变，文档立刻跟着变，不会漂移。
//
//   所以本文件里看不到任何字段细节（没有 properties 手抄），
//   只有"路径 → 用哪个 schema / 需要什么权限"的**声明**。
//
// 说明：响应统一为 { code, message, data }（见 utils/response.js），
//       文档里用 components.schemas.ApiResponse 表达这个信封。
// ============================================================
const { z } = require('./validate')
const S = require('./schemas')
const CODE = require('./code')

/** zod schema → JSON Schema（io:'input' 表示"客户端传进来的形状"） */
const toJson = (schema) => z.toJSONSchema(schema, { io: 'input' })

/** 统一响应信封 */
const ApiResponse = {
  type: 'object',
  description: '统一响应体：code=0 表示成功，非 0 见 utils/code.js 错误码表',
  properties: {
    code: { type: 'integer', description: `0 成功；${CODE.PARAM_ERROR} 参数错误；${CODE.UNAUTHENTICATED} 未登录；${CODE.FORBIDDEN} 无权限；${CODE.NOT_FOUND} 不存在；${CODE.CSRF_FAIL} CSRF 失败；${CODE.RATE_LIMIT} 限流`, example: 0 },
    message: { type: 'string', example: 'success' },
    data: { description: '业务数据，结构随接口而定' }
  },
  required: ['code', 'message', 'data']
}

/** 常规 JSON 响应（引用统一信封） */
const jsonResp = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiResponse' } } }
})

// 常见错误响应（复用，避免每个路径重复写）
const errResp = (desc) => jsonResp(desc)
const commonErrors = {
  400: errResp('参数校验失败（code=1001）'),
  401: errResp('未登录或登录态失效（code=1002）'),
  403: errResp('无权限或 CSRF 校验失败（code=1003 / 1007）'),
  429: errResp('请求过于频繁（code=1008）')
}

const jsonBody = (schema) => ({
  required: true,
  content: { 'application/json': { schema: toJson(schema) } }
})

const pageQueryParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 }, description: '页码' },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 }, description: '每页条数' }
]

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: '记录 _id（24 位）' }
// 支持的资源名 = 新增 schema 与编辑 schema 的**并集**：
// setting 是单行表，只有 update schema 没有 add schema，只取 add 会把它漏掉。
const RESOURCE_NAMES = [...new Set([
  ...Object.keys(S.resourceAddSchemas),
  ...Object.keys(S.resourceUpdateSchemas)
])].sort()
const resourceParam = {
  name: 'resource',
  in: 'path',
  required: true,
  schema: { type: 'string', enum: RESOURCE_NAMES },
  description: `资源名（支持 ${RESOURCE_NAMES.join(' / ')}；其中 setting 为单行配置，仅支持 list 与 edit）`
}

function buildSpec () {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Koa CMS API',
      version: '1.0.0',
      description: [
        'Koa 3 + PostgreSQL 18 内容管理系统 API。',
        '',
        '**版本策略**：正式版本统一用 `/api/v1`；`/api` 为兼容旧路径保留（deprecated）。',
        '',
        '**鉴权**：后台接口需登录（会话 Cookie）+ 写请求需 CSRF（双提交 Cookie，值放在 `X-CSRF-Token` 头）。',
        '',
        '**权限**：后台写接口还需要对应权限点（如 `article:delete`），无权限返回 403。',
        '',
        '**响应**：所有 JSON 接口统一返回 `{ code, message, data }`。'
      ].join('\n')
    },
    servers: [{ url: '/', description: '当前服务' }],
    tags: [
      { name: '系统', description: '健康检查' },
      { name: '公开内容', description: '无需登录，供前台/SSG 构建期读取' },
      { name: '鉴权', description: 'CSRF token 签发' },
      { name: '后台内容', description: '资源驱动 CRUD，需登录 + CSRF + 权限点' },
      { name: '权限管理', description: 'RBAC 角色与权限点' },
      { name: '审计日志', description: '写操作留痕查询' },
      { name: '统计报表', description: 'GROUP BY / 窗口函数 / EXPLAIN（SQL 教学）' }
    ],
    components: {
      schemas: {
        ApiResponse,
        PageQuery: toJson(S.pageSchema),
        PublicArticleQuery: toJson(S.publicArticleQuerySchema),
        AuditQuery: toJson(S.auditQuerySchema),
        RolePermission: toJson(S.rolePermissionSchema),
        ResourceAdd: { oneOf: Object.values(S.resourceAddSchemas).map((s) => toJson(s)), description: '新增资源请求体，形状取决于 :resource' },
        ResourceUpdate: { oneOf: Object.values(S.resourceUpdateSchemas).map((s) => toJson(s)), description: '编辑资源请求体（字段可部分提交）' },
        StatsTopQuery: toJson(S.statsTopQuerySchema),
        StatsMonthlyQuery: toJson(S.statsMonthlyQuerySchema),
        StatsExplainQuery: toJson(S.statsExplainQuerySchema)
      },
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'koa:sess',
          description: '登录后由服务端下发的会话 Cookie（POST /backend/login/doLogin）'
        },
        csrfToken: {
          type: 'apiKey',
          in: 'header',
          name: 'X-CSRF-Token',
          description: '写请求必带；值等于可读 Cookie `csrfToken`（先调 GET /api/v1/csrf-token 获取）'
        }
      }
    },
    paths: {
      // ---------------- 系统 ----------------
      '/healthz': {
        get: {
          tags: ['系统'],
          summary: '健康检查',
          description: '探活用，不鉴权、不限流。查 DB 连通性并返回运行时长。',
          responses: {
            200: { description: '服务正常', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' }, env: { type: 'string' }, uptime: { type: 'integer' }, db: { type: 'string', example: 'up' }, latencyMs: { type: 'integer' }, time: { type: 'string' } } } } } },
            503: { description: '数据库不可用（status=degraded）' }
          }
        }
      },

      // ---------------- 公开内容 ----------------
      '/api/v1/public/settings': {
        get: { tags: ['公开内容'], summary: '站点设置', responses: { 200: jsonResp('站点设置（单行）') } }
      },
      '/api/v1/public/nav': {
        get: { tags: ['公开内容'], summary: '导航列表', responses: { 200: jsonResp('仅启用状态，按 sort 升序') } }
      },
      '/api/v1/public/focus': {
        get: { tags: ['公开内容'], summary: '首页轮播图', responses: { 200: jsonResp('轮播图列表') } }
      },
      '/api/v1/public/links': {
        get: { tags: ['公开内容'], summary: '友情链接', responses: { 200: jsonResp('友情链接列表') } }
      },
      '/api/v1/public/categories': {
        get: {
          tags: ['公开内容'],
          summary: '分类树（任意层级）',
          description: 'SQL 用 WITH RECURSIVE 递归 CTE 一次查出整棵树，返回嵌套结构（children 数组）。',
          responses: { 200: jsonResp('嵌套的分类树') }
        }
      },
      '/api/v1/public/articles': {
        get: {
          tags: ['公开内容'],
          summary: '文章列表（分页）',
          description: 'cateId 会**包含其所有子孙分类**的文章（递归 CTE）；列表**不返回 content**（字段白名单，避免响应膨胀）。',
          parameters: [...pageQueryParams,
            { name: 'cateId', in: 'query', schema: { type: 'string' }, description: '分类 id（含子孙分类）' },
            { name: 'keyword', in: 'query', schema: { type: 'string', maxLength: 50 }, description: '标题/描述模糊搜索' }],
          responses: { 200: jsonResp('{ list, total, page, pageSize }') }
        }
      },
      '/api/v1/public/articles/{id}': {
        get: {
          tags: ['公开内容'],
          summary: '文章详情 + 上下篇',
          description: '上下篇用窗口函数 LAG/LEAD 一次算出（同一分类内按 sort/add_time 排序）。',
          parameters: [idParam],
          responses: { 200: jsonResp('{ article, prev, next }'), 404: commonErrors[400] }
        }
      },

      // ---------------- 鉴权 ----------------
      '/api/v1/csrf-token': {
        get: {
          tags: ['鉴权'],
          summary: '签发 CSRF token',
          description: '双提交 Cookie：token 写入**可读** Cookie `csrfToken` 并同时返回，前端把值放进 `X-CSRF-Token` 头即可通过写请求校验。',
          responses: { 200: jsonResp('{ token }') }
        }
      },

      // ---------------- 后台资源 CRUD ----------------
      '/api/v1/admin/{resource}/list': {
        get: {
          tags: ['后台内容'],
          summary: '资源列表',
          description: '需要权限点 `{resource}:list`。',
          security: [{ cookieAuth: [] }],
          parameters: [resourceParam, ...pageQueryParams],
          responses: { 200: jsonResp('{ list, total, page, pageSize }'), ...commonErrors }
        }
      },
      '/api/v1/admin/{resource}/{id}': {
        get: {
          tags: ['后台内容'],
          summary: '资源详情',
          description: '需要权限点 `{resource}:list`。',
          security: [{ cookieAuth: [] }],
          parameters: [resourceParam, idParam],
          responses: { 200: jsonResp('单条记录'), ...commonErrors }
        }
      },
      '/api/v1/admin/{resource}/add': {
        post: {
          tags: ['后台内容'],
          summary: '新增资源',
          description: '需要权限点 `{resource}:create`；写请求需 CSRF。请求体形状见 ResourceAdd。',
          security: [{ cookieAuth: [], csrfToken: [] }],
          parameters: [resourceParam],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ResourceAdd' } } } },
          responses: { 200: jsonResp('新增后的记录'), ...commonErrors }
        }
      },
      '/api/v1/admin/upload': {
        post: {
          tags: ['后台内容'],
          summary: '上传图片',
          description: [
            '需要权限点 `upload:create`；写请求需 CSRF。',
            '**multipart/form-data**，字段名 `file`；同时需带上 `_csrf` 字段（因为 multipart 无法使用自定义请求头）。',
            '仅接受图片（png/jpg/jpeg/gif/bmp/webp），且**扩展名与 MIME 双重校验**；',
            '超限或类型不符返回 400。返回 `url` 可直接存进 img_url / pic / site_logo 等字段。'
          ].join('\n\n'),
          security: [{ cookieAuth: [], csrfToken: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    file: { type: 'string', format: 'binary', description: '图片文件' },
                    _csrf: { type: 'string', description: 'CSRF token（取自可读 Cookie csrfToken）' }
                  },
                  required: ['file', '_csrf']
                }
              }
            }
          },
          responses: { 200: jsonResp('上传结果（含 url）'), ...commonErrors }
        }
      },
      '/api/v1/admin/{resource}/{id}/edit': {
        post: {
          tags: ['后台内容'],
          summary: '编辑资源',
          description: '需要权限点 `{resource}:update`；写请求需 CSRF。字段可部分提交（PATCH 语义）。',
          security: [{ cookieAuth: [], csrfToken: [] }],
          parameters: [resourceParam, idParam],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ResourceUpdate' } } } },
          responses: { 200: jsonResp('更新后的记录'), ...commonErrors }
        }
      },
      '/api/v1/admin/{resource}/{id}/delete': {
        post: {
          tags: ['后台内容'],
          summary: '删除资源',
          description: '需要权限点 `{resource}:delete`；写请求需 CSRF。用 POST 而非 GET，避免被链接/图片跨站触发。',
          security: [{ cookieAuth: [], csrfToken: [] }],
          parameters: [resourceParam, idParam],
          responses: { 200: jsonResp('删除成功'), ...commonErrors }
        }
      },

      // ---------------- RBAC ----------------
      '/api/v1/admin/rbac/me': {
        get: {
          tags: ['权限管理'],
          summary: '当前登录者的角色与权限点',
          description: '前端据此渲染菜单与按钮显隐；**但真正的拦截在服务端**（前端隐藏只是体验优化）。',
          security: [{ cookieAuth: [] }],
          responses: { 200: jsonResp('{ user, roleId, permissions: string[] }'), ...commonErrors }
        }
      },
      '/api/v1/admin/rbac/roles': {
        get: { tags: ['权限管理'], summary: '角色列表', description: '需要权限点 `role:list`。', security: [{ cookieAuth: [] }], responses: { 200: jsonResp('角色列表'), ...commonErrors } }
      },
      '/api/v1/admin/rbac/permissions': {
        get: { tags: ['权限管理'], summary: '权限点列表', description: '需要权限点 `role:list`。', security: [{ cookieAuth: [] }], responses: { 200: jsonResp('全部权限点（含分组 grp）'), ...commonErrors } }
      },
      '/api/v1/admin/rbac/roles/{roleId}/permissions': {
        get: {
          tags: ['权限管理'],
          summary: '某角色的权限点',
          description: '需要权限点 `role:list`。',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'roleId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: jsonResp('权限点 code 数组'), ...commonErrors }
        },
        post: {
          tags: ['权限管理'],
          summary: '覆盖式设置角色权限',
          description: '需要权限点 `role:assign`；写请求需 CSRF。用事务保证"清空 + 写入"原子性。',
          security: [{ cookieAuth: [], csrfToken: [] }],
          parameters: [{ name: 'roleId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: jsonBody(S.rolePermissionSchema),
          responses: { 200: jsonResp('更新后的权限点'), ...commonErrors }
        }
      },

      // ---------------- 统计报表（SQL 教学） ----------------
      '/api/v1/admin/stats/overview': {
        get: {
          tags: ['统计报表'],
          summary: '内容概览与状态分布',
          description: '用 `COUNT(*) FILTER (WHERE ...)` 一条 SQL 同时算出多个维度（只扫一次表）。需要权限点 `stats:view`。',
          security: [{ cookieAuth: [] }],
          responses: { 200: jsonResp('{ article, counts }'), ...commonErrors }
        }
      },
      '/api/v1/admin/stats/categories': {
        get: {
          tags: ['统计报表'],
          summary: '分类统计排行（GROUP BY + 窗口函数）',
          description: [
            '教学点：',
            '- `LEFT JOIN ... ON a.pid = c._id AND a.status = 1`：过滤条件写在 **ON** 里，',
            '  写进 WHERE 会把 LEFT JOIN 退化成 INNER JOIN，0 篇文章的分类会整行消失；',
            '- 同时返回 `ROW_NUMBER` / `RANK` / `DENSE_RANK` 三种排名，可直接对比差异；',
            '- `SUM() OVER ()` 算总占比，`SUM() OVER (ORDER BY ... ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)` 算**累计占比**（帕累托分析）。'
          ].join('\n'),
          security: [{ cookieAuth: [] }],
          responses: { 200: jsonResp('分类排行数组（含 pct / running_pct）'), ...commonErrors }
        }
      },
      '/api/v1/admin/stats/top-articles': {
        get: {
          tags: ['统计报表'],
          summary: '每个分类最新 N 篇（分组 TopN）',
          description: '`PARTITION BY a.pid` 切窗 + `ROW_NUMBER()` 排序取前 N —— 分组 TopN 的标准解法。注意窗口函数不能直接写在 WHERE 里，需套一层子查询。',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 20, default: 2 }, description: '每个分类取几篇' }],
          responses: { 200: jsonResp('文章数组（含 rn_in_cate）'), ...commonErrors }
        }
      },
      '/api/v1/admin/stats/monthly': {
        get: {
          tags: ['统计报表'],
          summary: '按月发文趋势',
          description: '`date_trunc(\'month\', add_time)` + `GROUP BY 1`（按第一个输出列分组）。',
          security: [{ cookieAuth: [] }],
          parameters: [{ name: 'months', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 36, default: 12 } }],
          responses: { 200: jsonResp('{ month, article_count, hot_count } 数组'), ...commonErrors }
        }
      },
      '/api/v1/admin/stats/explain/queries': {
        get: {
          tags: ['统计报表'],
          summary: '可 EXPLAIN 的查询清单（白名单）',
          security: [{ cookieAuth: [] }],
          responses: { 200: jsonResp('[{ key, title, sql }]'), ...commonErrors }
        }
      },
      '/api/v1/admin/stats/explain': {
        get: {
          tags: ['统计报表'],
          summary: '执行计划分析（EXPLAIN ANALYZE）',
          description: [
            '`EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)` —— 看数据库"实际怎么执行"，而不是靠猜。',
            '',
            '⚠️ **安全红线**：`query` 只接受**白名单键**（预置查询的名字），**绝不接受原始 SQL**。',
            '若允许传 SQL 文本，等于把数据库只读权限开放给任何调用方（SQL 注入 by design）。'
          ].join('\n'),
          security: [{ cookieAuth: [] }],
          parameters: [
            { name: 'query', in: 'query', required: true, schema: { type: 'string' }, description: '白名单键，见 /explain/queries' },
            { name: 'analyze', in: 'query', schema: { type: 'string', enum: ['0', '1', 'true', 'false'] }, description: '是否真实执行（默认 true，只读查询无副作用）' }
          ],
          responses: { 200: jsonResp('{ key, sql, planningTimeMs, executionTimeMs, rootNodeType, plan }'), ...commonErrors }
        }
      },

      // ---------------- 审计 ----------------
      '/api/v1/admin/audit/list': {
        get: {
          tags: ['审计日志'],
          summary: '审计日志查询',
          description: '需要权限点 `audit:list`。记录的请求体已脱敏（password/token 等替换为 [REDACTED]）。',
          security: [{ cookieAuth: [] }],
          parameters: [...pageQueryParams,
            { name: 'adminName', in: 'query', schema: { type: 'string' }, description: '操作人（模糊）' },
            { name: 'resource', in: 'query', schema: { type: 'string' }, description: '资源名，如 article' },
            { name: 'action', in: 'query', schema: { type: 'string', enum: ['create', 'update', 'delete', 'other'] } }],
          responses: { 200: jsonResp('{ list, total, page, pageSize }'), ...commonErrors }
        }
      }
    }
  }
}

module.exports = { buildSpec, toJson }
