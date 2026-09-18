'use strict'
// 配置前台路由
const Router = require('@koa/router')
const router = new Router()
const url = require('url')
const DB = require('../model/db.js')
const config = require('../model/config.js')

// 全局中间件：导航、站点信息、当前路径
router.use(async (ctx, next) => {
  const pathname = url.parse(ctx.request.url).pathname

  const navResult = await DB.find('nav', { $or: [{ status: 1 }, { status: '1' }] }, {}, {
    sortJson: { sort: 1 }
  })
  const setting = await DB.find('setting', {})

  // 站点地址统一由 config 推导：上线换域名/https 只需改 .env，不用改代码
  ctx.state.__HOST__ = config.getOrigin(ctx)
  ctx.state.nav = navResult
  ctx.state.pathname = pathname
  ctx.state.setting = setting[0] || {}
  await next()
})

// 首页
router.get('/', async (ctx) => {
  // 轮播图
  const focusResult = await DB.find('focus', { $or: [{ status: 1 }, { status: '1' }] }, {}, {
    sortJson: { sort: 1 }
  })
  // 友情链接
  const links = await DB.find('link', { $or: [{ status: 1 }, { status: '1' }] }, {}, {
    sortJson: { sort: 1 }
  })

  await ctx.render('default/index', {
    focus: focusResult,
    links: links
  })
})

// 新闻列表
router.get('/news', async (ctx) => {
  const pid = ctx.query.pid
  const page = Number(ctx.query.page) || 1
  const pageSize = 3

  // 新闻下面的二级分类（ID 沿用原教程数据）
  const newsResult = await DB.find('articlecate', { pid: '5bdaf18de67d082570b10a23' })

  let articleResult
  let articleNum

  if (pid) {
    articleResult = await DB.find('article', { pid }, {}, { page, pageSize })
    articleNum = await DB.count('article', { pid })
  } else {
    const subCateArr = newsResult.map((item) => item._id.toString())
    articleResult = await DB.find('article', { pid: { $in: subCateArr } }, {}, { page, pageSize })
    articleNum = await DB.count('article', { pid: { $in: subCateArr } })
  }

  await ctx.render('default/news', {
    newslist: newsResult,
    articlelist: articleResult,
    pid,
    page,
    totalPages: Math.ceil(articleNum / pageSize) || 0
  })
})

// 服务列表
router.get('/service', async (ctx) => {
  const serviceList = await DB.find('article', { pid: '5bdaf17fe67d082570b10a22' })
  await ctx.render('default/service', {
    serviceList: serviceList
  })
})

// 文章详情
router.get('/content/:id', async (ctx) => {
  const id = ctx.params.id
  const content = await DB.find('article', { _id: DB.getObjectId(id) })

  if (!content.length) {
    ctx.status = 404
    ctx.body = '<h3>内容不存在或已删除</h3>'
    return
  }

  /*
    1、根据文章获取文章的分类信息
    2、根据分类信息去导航表查找当前分类对应的 url
    3、把 url 赋值给 pathname（让导航高亮）
  */
  const cateResult = await DB.find('articlecate', { _id: DB.getObjectId(content[0].pid) })
  let navResult = []

  if (cateResult.length) {
    if (String(cateResult[0].pid) !== '0') {
      // 子分类：连父分类一起找
      const parentCateResult = await DB.find('articlecate', { _id: DB.getObjectId(cateResult[0].pid) })
      const titles = [cateResult[0].title, parentCateResult[0] ? parentCateResult[0].title : null].filter(Boolean)
      navResult = await DB.find('nav', { title: { $in: titles } })
    } else {
      navResult = await DB.find('nav', { title: cateResult[0].title })
    }
  }

  ctx.state.pathname = navResult.length ? navResult[0].url : '/'
  await ctx.render('default/content', {
    list: content[0]
  })
})

// 成功案例
router.get('/case', async (ctx) => {
  const pid = ctx.query.pid
  const page = Number(ctx.query.page) || 1
  const pageSize = 3

  // 成功案例下面的二级分类
  const cateResult = await DB.find('articlecate', { pid: '5bdaf166e67d082570b10a21' })

  let articleResult
  let articleNum

  if (pid) {
    articleResult = await DB.find('article', { pid }, {}, { page, pageSize })
    articleNum = await DB.count('article', { pid })
  } else {
    const subCateArr = cateResult.map((item) => item._id.toString())
    articleResult = await DB.find('article', { pid: { $in: subCateArr } }, {}, { page, pageSize })
    articleNum = await DB.count('article', { pid: { $in: subCateArr } })
  }

  await ctx.render('default/case', {
    catelist: cateResult,
    articlelist: articleResult,
    pid,
    page,
    totalPages: Math.ceil(articleNum / pageSize) || 0
  })
})

// 关于我们
router.get('/about', async (ctx) => {
  await ctx.render('default/about')
})

module.exports = router.routes()
