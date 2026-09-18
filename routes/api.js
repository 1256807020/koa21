'use strict'
const Router = require('@koa/router')
// 本文件**不设内部 prefix**，前缀一律由外层 app.js 挂载时给出：
//   app.js: router.use('/api', api)      → /api/...
//   app.js: router.use('/api/v1', api)   → /api/v1/...（同一套路由挂两次 = API 版本化）
// 这样做的原因：若在这里写死 prefix:'/api'，就无法再挂到 /api/v1 下（会变成 /api/v1/api/...）。
// 内部嵌套（adminApi）仍保持相对路径，前缀完全由外层决定。
const router = new Router()
var DB = require('../model/db.js');
const { buildSpec } = require('../utils/openapi')

// API 根：给出一份"我能提供什么"的索引，替代原来的一行文本
router.get('/', async (ctx) => {
  ctx.body = {
    name: 'Koa CMS API',
    version: 'v1',
    docs: '/api/v1/docs',
    openapi: '/api/v1/openapi.json',
    endpoints: {
      public: '/api/v1/public/*',
      admin: '/api/v1/admin/*',
      rbac: '/api/v1/admin/rbac/*',
      audit: '/api/v1/admin/audit/list'
    }
  }
})

// OpenAPI 规范（自动生成：请求 schema 来自 utils/schemas.js，用 z.toJSONSchema 转换）
router.get('/openapi.json', (ctx) => {
  ctx.set('Cache-Control', 'no-cache')
  ctx.body = buildSpec()
})

// Swagger UI 页面（走 CDN，零 npm 依赖；如需离线可把静态文件放进 public/）
// 说明：这里返回的是 HTML，不属于 JSON API，所以直接写 ctx.body 而不是走 ok()
router.get('/docs', (ctx) => {
  ctx.type = 'html'
  ctx.body = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>Koa CMS API 文档</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>body{margin:0}#swagger-ui{max-width:1200px;margin:0 auto}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/v1/openapi.json',
      dom_id: '#swagger-ui',
      docExpansion: 'list',
      defaultModelsExpandDepth: 1
    })
  </script>
</body>
</html>`
})
router.get('/catelist', async (ctx) => {

  var result = await DB.find('articlecate', {})

  //console.log(result);
  ctx.body = {
    result: result
  };
})


router.get('/newslist', async (ctx) => {

  var page = ctx.query.page || 1;

  var pageSize = 5

  var result = await DB.find('article', {}, { '_id': 1, "title": 1 }, {
    page,
    pageSize
  })

  //console.log(result);
  ctx.body = {
    result: result
  };
})
//增加购物车数据
router.post('/addCart',async (ctx)=>{

  //接收客户端提交的数据 、主要做的操作就是增加数据

  console.log(ctx.request.body);



  ctx.body={
      "success":true,
      "message":'增加数据成功'
  };

})

//修改用餐人数的接口
router.put('/editPeopleInfo',async (ctx)=>{

  //接收客户端提交的数据 、主要做的操作就是修改数据
  console.log(ctx.request.body);
  ctx.body={
      "success":true,
      "message":'修改数据成功'
  };
})

//用于删除数据源
router.delete('/deleteCart',async (ctx)=>{

  //接收客户端提交的数据 、主要做的操作就是删除数据的操作
  console.log(ctx.query);

  ctx.body={
      "success":true,
      "message":'删除数据成功'
  };



})
// 后台管理 JSON API（P0 底座）：/api/admin/* 统一返回 { code, message, data }
// 鉴权(登录态 / CSRF / RBAC) 在阶段三补；本阶段先打通"能用 + 参数化防注入 + 统一出参"
// adminApi 相对路由 /:resource/*，叠加上面的 '/admin' 与外层的 '/api' → 最终 /api/admin/:resource/*
// 因为外层挂了两次，它同时也有 /api/v1/admin/:resource/*（版本化，见 app.js）
// 注意路径！本文件在 routes/ 目录，JSON API 子路由在 routes/api/admin.js，
// 所以必须写 require('./api/admin')；若写成 require('./admin') 会误加载 routes/admin.js（SSR 后台路由）！
// 这个路径写错曾导致 404 长达数小时（详见 docs/dev-notes.md 阶段二踩坑 C）。
const publicApi = require('./api/public') // 公开内容 API（无需登录，前端分离后的数据源）
const rbacApi = require('./api/rbac')     // RBAC：角色/权限点/当前登录者权限
const auditApi = require('./api/audit')   // 审计日志查询
const adminApi = require('./api/admin')   // 资源驱动 CRUD

// 签发 CSRF token 的端点：前端登录后调一次，拿到 token 写进 X-CSRF-Token 头再发写请求
// （双提交 Cookie 模式：本接口把 token 同时种进可读 Cookie，前端读 Cookie 回传即可）
const { ok } = require('../utils/response')
const { issueCsrfToken } = require('../middleware/guard')
router.get('/csrf-token', (ctx) => {
  const token = issueCsrfToken(ctx)
  ok(ctx, { token })
})

// —— 挂载顺序很重要：更具体的路径必须写在前面 ——
// 否则 '/admin' 那层的 /:resource/* 会先把 /admin/rbac/... 这类请求吃掉（resource 会被当成 'rbac'）。
// 外层 app.js 挂 '/api' 与 '/api/v1'，这里再挂第二段前缀，最终路径形如：
//   /api/v1/public/articles       公开内容
//   /api/v1/admin/rbac/me         RBAC
//   /api/v1/admin/audit/list      审计
//   /api/v1/admin/article/list    资源驱动 CRUD（adminApi 内部是相对路由 /:resource/*）
router.use('/public', publicApi)
router.use('/admin/rbac', rbacApi)
router.use('/admin/audit', auditApi)
router.use('/admin', adminApi)

module.exports = router.routes()