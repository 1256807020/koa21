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
    //获取系统信息

    var setting = await DB.find('setting', {});
    ctx.state.__HOST__ = 'http://' + ctx.request.header.host
    //模板引擎配置全局的变量
    ctx.state.nav = navResult;
    ctx.state.pathname = pathname;
    ctx.state.setting = setting[0];
    await next()
})
router.get('/', async (ctx) => {
    console.time('start');
    // 轮播图
    var focusResult = await DB.find('focus', { $or: [{ 'status': 1 }, { 'status': '1' }] }, {}, {
        sortJson: { "sort": 1 }
    })
    console.timeEnd('start');
    //轮播图  注意状态数据不一致问题  建议在后台增加数据的时候状态 转化成number类型
    //导航条的数据
    var links = await DB.find('link', { $or: [{ 'status': 1 }, { 'status': '1' }] }, {}, {

        sortJson: { 'sort': 1 }
    })

    // console.log(focusResult)
    ctx.render('default/index', {
        focus: focusResult,
        links: links
    });
})
router.get('/news', async (ctx) => {
    var pid = ctx.query.pid
    var page = ctx.query.page || 1;
    var pageSize = 3;
    ctx.state.setting.site_title = 'xxx新闻页面';
    ctx.state.setting.site_keywords = 'xxx新闻页面';
    ctx.state.setting.site_description = 'xxx新闻页面';
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

    // console.log(ctx.params);
    // 获取文章id值
    var id = ctx.params.id;

    var content = await DB.find('article', { '_id': DB.getObjectId(id) });

    // console.log(content);
    /*
       1.根据文章获取文章的分类信息
   
       2、根据文章的分类信息，去导航表里面查找当前分类信息的url
   
       3、把url赋值给 pathname
       * */
    //获取当前文章的分类信息
    var cateResult = await DB.find('articlecate', { '_id': DB.getObjectId(content[0].pid) });

    //  console.log(cateResult,cateResult[0].pid);
    if (cateResult[0].pid != 0) {  /*子分类*/
        //找到当前分类的父亲分类
        var parentCateResult = await DB.find('articlecate', { '_id': DB.getObjectId(cateResult[0].pid) });

        var navResult = await DB.find('nav', { $or: [{ 'title': cateResult[0].title }, { 'title': parentCateResult[0].title }] });

    } else {  /*父分类*/

        //在导航表查找当前分类对应的url信息
        var navResult = await DB.find('nav', { 'title': cateResult[0].title });

    }

    if (navResult.length > 0) {
        //把url赋值给 pathname
        ctx.state.pathname = navResult[0]['url'];

    } else {
        ctx.state.pathname = '/';
    }
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
