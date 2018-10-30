'use strict'
let router = require('koa-router')()
router.get('/', async (ctx) => {
  ctx.body = 'api接口'
})
module.exports = router.routes()