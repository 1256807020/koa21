'use strict'
let router = require('koa-router')()
let DB = require('../../model/db.js')
let tools = require('../../model/tools.js')
// 图片上传模块
let multer = require('koa-multer');
var storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/upload');   /*配置图片上传的目录  public目录下必须存在upload文件夹   注意：图片上传的目录必须存在*/
  },
  filename: function (req, file, cb) {   /*图片上传完成重命名*/
    var fileFormat = (file.originalname).split(".");   /*获取后缀名  分割数组*/
    cb(null, Date.now() + "." + fileFormat[fileFormat.length - 1]);
  }
})
var upload = multer({ storage: storage });
router.get('/', async (ctx) => {
  ctx.body = 'article'
  // 一旦打印出promise，肯定是少加了await
  // 先查询数据库
  // 获取页数，每页几条
  let page = ctx.query.page || 1;
  let pageSize = 1;
  //查询总数量
  let count = await DB.count('article', {});
  // console.log(count)
  let result = await DB.find('article', {}, {}, {
    page: page,
    pageSize: pageSize
  });
  // console.log(result)
  // 要渲染哪个静态页面模版
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
router.get('/ueditor', async (ctx) => {
  await ctx.render('admin/article/ueditor');
})
//post接收数据
// 此处upload要与前面var upload = multer({ storage: storage });定义变量名一致；
// pic要与add.html里图片上传部分的name id值一致
router.post('/doAdd', upload.single('pic'), async (ctx) => {
  ctx.body = {
    filename: ctx.req.file ? ctx.req.file.filename : '',  //返回文件名
    body: ctx.req.body
  }
})

module.exports = router.routes()
