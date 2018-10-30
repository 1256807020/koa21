'use strict'
let router = require('koa-router')()
router.get('/', async (ctx) => {
    ctx.body = '前台首页'
})
module.exports = router.routes()