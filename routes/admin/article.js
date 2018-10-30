'use strict'
let router = require('koa-router')()
let DB = require('../../model/db.js')
let tools = require('../../model/tools.js')
router.get('/', async (ctx) => {
  ctx.body = 'article'
  // 一旦打印出promise，肯定是少加了await
  // 先查询数据库
  let page = ctx.query.page || 1;
  let pageSize = 5;
  //查询总数量
  let count = await DB.count('article', {});
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
  // 获取一级分类
  let result = await DB.find('article', { 'pid': '0' })
  // console.log(result)
  await ctx.render('admin/article/add', {
    catelist: result
  })
})

module.exports = router.routes()
