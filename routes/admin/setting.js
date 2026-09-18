'use strict'
const Router = require('@koa/router')
const router = new Router()
let DB = require('../../model/db.js')
let tools = require('../../model/tools.js')
// multipart 表单的 CSRF 校验必须放在 multer 之后（multer 解析完 body 才有 _csrf 字段）
const { csrfGuardPage } = require('../../middleware/guard')
const { z, validatePageBody } = require('../../utils/validate')
const { requirePermissionPageByTable } = require('../../middleware/rbac')

// 站点设置表单 schema
const settingSchema = z.object({
  site_title: z.string({ error: '站点名称必填' }).trim().min(1, '站点名称必填').max(255),
  site_url: z.string().max(255).optional(),
  site_keywords: z.string().max(255).optional(),
  site_description: z.string().optional(),
  site_icp: z.string().max(100).optional(),
  site_qq: z.string().max(50).optional(),
  site_tel: z.string().max(50).optional(),
  site_address: z.string().max(255).optional(),
  site_status: z.coerce.number().int().min(0).max(1).optional()
})

router.get('/', async (ctx) => {
  // ctx.body = "系统设置"
  let result = await DB.find('setting', {})
  // console.log(result)
  await ctx.render('admin/setting/index', { list: result[0] })
})
// 顺序：权限 → multer → CSRF → zod → 业务
router.post('/doEdit', requirePermissionPageByTable('setting', 'update'), tools.multer().single('site_logo'), csrfGuardPage, validatePageBody(settingSchema, '/admin/setting'), async (ctx) => {
  var site_title = ctx.req.body.site_title;
  var site_url = ctx.req.body.site_url;
  let site_logo = tools.imgUrl(ctx.req.file);
  var site_keywords = ctx.req.body.site_keywords;
  var site_description = ctx.req.body.site_description;
  var site_icp = ctx.req.body.site_icp;
  var site_qq = ctx.req.body.site_qq;
  var site_tel = ctx.req.body.site_tel;
  var site_address = ctx.req.body.site_address;
  var site_status = ctx.req.body.site_status;
  var add_time = tools.getTime();
  // 模块里带了 site_url 输入框，原代码漏存了，这里补上
  var json = {
    site_title, site_url, site_keywords, site_description, site_icp, site_qq, site_tel, site_address, site_status, add_time
  }
  if (site_logo) {
    json.site_logo = site_logo;
  }
  await DB.update('setting', {}, json);
  ctx.redirect(ctx.state.__HOST__ + '/admin/setting');

})
module.exports = router.routes()