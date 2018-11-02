'use strict'
// 配置前台路由
let router = require('koa-router')()
var DB = require('../model/db.js')
var url = require('url')
// 配置中间件，这样nav就可以全局使用了
router.use(async (ctx, next) => {
// 配置中间件 获取url的地址
var pathname = url.parse(ctx.request.url).pathname
    // console.log(pathname)
    var navResult = await DB.find('nav', { $or: [{ 'status': 1 }, { 'status': '1' }] }, {}, {
        sortJson: { "sort": 1 }
    })
    ctx.state.__HOST__ = 'http://' + ctx.request.header.host
    //模板引擎配置全局的变量
    ctx.state.nav = navResult;
    ctx.state.pathname = pathname;
    await next()
})
router.get('/', async (ctx) => {
    console.time('start');
    // 轮播图
    var focusResult = await DB.find('focus', { $or: [{ 'status': 1 }, { 'status': '1' }] }, {}, {
        sortJson: { "sort": 1 }
    })
    console.timeEnd('start');
    // console.log(focusResult)
    ctx.render('default/index', {
        focus: focusResult
    });
})
router.get('/news', async (ctx) => {
    var pid = ctx.query.pid
    var page = ctx.query.page || 1;
    var pageSize = 3;
    // console.log(pid)
    //获取成功案例下面的分类
    var newsResult = await DB.find('articlecate', { 'pid': '5bdaf18de67d082570b10a23' })
    if (pid) {
        /*如果存在*/
        var articleResult = await DB.find('article', { "pid": pid }, {}, {
            page,
            pageSize
        });
        var articleNum = await DB.count('article', { "pid": pid });
    } else {
        //循环子分类获取子分类下面的所有的内容
        var subCateArr = [];
        for (var i = 0; i < newsResult.length; i++) {
            // 强制转换成字符串
            subCateArr.push(newsResult[i]._id.toString());
        }
        var articleResult = await DB.find('article', { "pid": { $in: subCateArr } }, {}, {
            page,
            pageSize
        });
        var articleNum = await DB.count('article', { "pid": { $in: subCateArr } })
    }

    ctx.render('default/news', {
        newslist: newsResult,
        articlelist: articleResult,
        pid: pid,
        page: page,
        totalPages: Math.ceil(articleNum / pageSize) || 0
    });

})

router.get('/service', async (ctx) => {
    //查询
    var serviceList = await DB.find('article', { 'pid': '5bdaf17fe67d082570b10a22' });
    // console.log(serviceList);
    ctx.render('default/service', {
        serviceList: serviceList
    });

})
router.get('/content/:id', async (ctx) => {

    console.log(ctx.params);
    // 获取文章id值
    var id = ctx.params.id;

    var content = await DB.find('article', { '_id': DB.getObjectId(id) });

    console.log(content);

    ctx.render('default/content', {
        list: content[0]

    });
})
// 成功案例
router.get('/case', async (ctx) => {
    var pid = ctx.query.pid
    var page = ctx.query.page || 1;
    var pageSize = 3;
    // console.log(pid)
    //获取成功案例下面的分类
    var cateResult = await DB.find('articlecate', { 'pid': '5bdaf166e67d082570b10a21' })
    if (pid) {
        /*如果存在*/
        var articleResult = await DB.find('article', { "pid": pid }, {}, {
            page,
            pageSize
        });
        var articleNum = await DB.count('article', { "pid": pid });
    } else {
        //循环子分类获取子分类下面的所有的内容
        var subCateArr = [];
        for (var i = 0; i < cateResult.length; i++) {
            // 强制转换成字符串
            subCateArr.push(cateResult[i]._id.toString());
        }
        // db.article.find({"pid":{$in:['5ab32da7b0c895428c85f78d','5afa568d416f21368039b05b']}},{"title":1,'pid':1})
        var articleResult = await DB.find('article', { "pid": { $in: subCateArr } }, {}, {
            page,
            pageSize
        });
        var articleNum = await DB.count('article', { "pid": { $in: subCateArr } })
    }

    ctx.render('default/case', {
        catelist: cateResult,
        articlelist: articleResult,
        pid: pid,
        page: page,
        totalPages: Math.ceil(articleNum / pageSize)
    });
})
router.get('/about', async (ctx) => {

    ctx.render('default/about');

})

router.get('/case', async (ctx) => {

    ctx.render('default/case');

})


module.exports = router.routes()
