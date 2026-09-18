'use strict'
const Router = require('@koa/router')
const router = new Router()
let DB = require('../../model/db.js')
let tools = require('../../model/tools.js')
const { sanitizeArticle } = require('../../utils/sanitize')
// multipart 表单的 CSRF 校验必须放在 multer 之后（multer 解析完 body 才有 _csrf 字段）
const { csrfGuardPage } = require('../../middleware/guard')
const { z, validatePageBody } = require('../../utils/validate')
const { requirePermissionPageByTable } = require('../../middleware/rbac')

// 文章表单 schema（不加 .default()：未提交的字段保持"不修改"语义）
const articleSchema = z.object({
  title: z.string({ error: '标题必填' }).trim().min(1, '标题必填').max(255),
  catename: z.string({ error: '分类名称必填' }).trim().min(1, '分类名称必填').max(100),
  pid: z.string().trim().max(64).optional(),
  author: z.string().trim().max(50).optional(),
  keywords: z.string().max(255).optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  status: z.coerce.number().int().min(0).max(1).optional(),
  is_best: z.coerce.number().int().min(0).max(1).optional(),
  is_hot: z.coerce.number().int().min(0).max(1).optional(),
  is_new: z.coerce.number().int().min(0).max(1).optional()
})

router.get('/', async (ctx) => {
  ctx.body = 'article'
  // 一旦打印出promise，肯定是少加了await
  // 先查询数据库
  // 获取页数，每页几条
  let page = ctx.query.page || 1;
  let pageSize = 3;
  //查询总数量
  let count = await DB.count('article', {});
  // console.log(count)

  let result = await DB.find('article', {}, {}, {
    page: page,
    pageSize: pageSize,
    sortJson: {
      'add_time': -1
    }
  });
  // console.log(result)
  // 要渲染哪个静态页面模版
  if (count <= 0) {
    count = 1
  }
  await ctx.render('admin/article/index', {
    list: result,
    page: page,
    totalPages: Math.ceil(count / pageSize)
  });
})
router.get('/add', async (ctx) => {
  var catelist = await DB.find('articlecate', {})
  // console.log(catelist)
  await ctx.render('admin/article/add', { catelist: tools.cateToList(catelist) });
})
// ueditor demo
// router.get('/ueditor', async (ctx) => {
//   await ctx.render('admin/article/ueditor');
// })
//post接收数据
// 此处upload要与前面var upload = multer({ storage: storage });定义变量名一致；
// pic要与add.html里图片上传部分的name id值一致
// 中间件顺序讲究（详见 docs/dev-notes.md）：
//   ① 权限（只需 session，放最前）→ ② multer 解析（先卡权限可避免"未授权也把文件落盘"）
//   → ③ CSRF（必须等 multer 解析出 body 才能读到 _csrf）→ ④ zod 校验 → ⑤ 业务
router.post('/doAdd', requirePermissionPageByTable('article', 'create'), tools.multer().single('img_url'), csrfGuardPage, validatePageBody(articleSchema, '/admin/article/add'), async (ctx) => {
  // ctx.body = {
  //   filename: ctx.req.file ? ctx.req.file.filename : '',  //返回文件名
  //   body: ctx.req.body
  // }
  let pid = ctx.req.body.pid;
  let catename = ctx.req.body.catename.trim();
  let title = ctx.req.body.title.trim();
  let author = ctx.req.body.author.trim();
  // let pic = ctx.req.body.author.trim();
  let status = ctx.req.body.status;
  let is_best = ctx.req.body.is_best;
  let is_hot = ctx.req.body.is_hot;
  let is_new = ctx.req.body.is_new;
  let keywords = ctx.req.body.keywords;
  let description = ctx.req.body.description || '';
  let content = sanitizeArticle(ctx.req.body.content); // P0 安全：入库前净化，防存储型 XSS
  let img_url = tools.imgUrl(ctx.req.file);

  let add_time = tools.getTime();
  //属性的简写
  let json = {
    pid, catename, title, author, status, is_best, is_hot, is_new, keywords, description, content, img_url, add_time
  }
  // 注意：这里原来漏了 await，会出现"跳转完成但数据还没入库"的偶发问题
  await DB.insert('article', json);
  //跳转
  ctx.redirect(ctx.state.__HOST__ + '/admin/article');
})
// 编辑文章
router.get('/edit', async (ctx) => {
  // 文章id
  var id = ctx.query.id
  // 分类
  var catelist = await DB.find('articlecate', {})
  // console.log(catelist)
  // 当前要编辑的数据
  var articlelist = await DB.find('article', { "_id": DB.getObjectId(id) });
  await ctx.render('admin/article/edit', {
    catelist: tools.cateToList(catelist),
    list: articlelist[0],
    prevPage: ctx.state.G.prevPage   /*保存上一页的值*/
  });
})

router.post('/doEdit', requirePermissionPageByTable('article', 'update'), tools.multer().single('img_url'), csrfGuardPage, validatePageBody(articleSchema, (ctx) => `/admin/article/edit?id=${ctx.request.body.id || ''}`), async (ctx) => {

  let prevPage = ctx.req.body.prevPage || '';  /*上一页的地址*/
  let id = ctx.req.body.id;
  let pid = ctx.req.body.pid;
  let catename = ctx.req.body.catename.trim();
  let title = ctx.req.body.title.trim();
  let author = ctx.req.body.author.trim();
  let pic = ctx.req.body.author;
  let status = ctx.req.body.status;
  let is_best = ctx.req.body.is_best;
  let is_hot = ctx.req.body.is_hot;
  let is_new = ctx.req.body.is_new;
  let keywords = ctx.req.body.keywords;
  let description = ctx.req.body.description || '';
  let content = sanitizeArticle(ctx.req.body.content); // P0 安全：入库前净化，防存储型 XSS
  let img_url = tools.imgUrl(ctx.req.file);
  //属性的简写
  //注意是否修改了图片          var           let块作用域
  let json
  if (img_url) {
    json = {
      pid, catename, title, author, status, is_best, is_hot, is_new, keywords, description, content, img_url
    }
  } else {
    json = {
      pid, catename, title, author, status, is_best, is_hot, is_new, keywords, description, content
    }
  }
  await DB.update('article', { "_id": DB.getObjectId(id) }, json);


  //跳转
  if (prevPage) {
    ctx.redirect(prevPage);

  } else {
    ctx.redirect(ctx.state.__HOST__ + '/admin/article');
  }


})
module.exports = router.routes()
