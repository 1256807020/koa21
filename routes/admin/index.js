'use strict'
let router = require('koa-router')();
let DB = require('../../model/db')
router.get('/', async (ctx) => {
  await ctx.render('admin/index')
})
router.get('/changeStatus', async (ctx) => {
  // console.log(ctx.query)
  let collectionName = ctx.query.collectionName; /*数据库表*/
  let attr = ctx.query.attr; /*属性*/
  let id = ctx.query.id;   /*更新的 id*/
  let data = await DB.find(collectionName, { "_id": DB.getObjectId(id) });
  // console.log(data)

  if (data.length > 0) {
    if (data[0][attr] == 1) {
      var json = { /*es6 属性名表达式*/
        [attr]: 0
      };
    } else {
      var json = {
        [attr]: 1
      };
    }

    let updateResult = await DB.update(collectionName, { "_id": DB.getObjectId(id) }, json);

    if (updateResult) {
      ctx.body = { "message": '更新成功', "success": true };
    } else {
      ctx.body = { "message": "更新失败", "success": false }
    }

  } else {
    ctx.body = { "message": '更新失败,参数错误', "success": false };
  }
})
// 公共的删除方法
router.get('/remove', async (ctx) => {
  try {
    let collectionName = ctx.query.collectionName; /*数据库表*/
    let id = ctx.query.id;   /*删除的 id*/
    let result = await DB.remove(collectionName, { "_id": DB.getObjectId(id) })
    // 删除之后，返回到哪里
    ctx.redirect(ctx.state.G.prevPage)
  } catch (err) {
    ctx.redirect(ctx.state.G.prevPage)
  }

})
module.exports = router.routes()