let Koa = require('koa'),
    router = require('koa-router')(),
    path = require('path'),
    render = require('koa-art-template'),
    static = require('koa-static'),
    session = require('koa-session'),
    sd = require('silly-datetime'),
    bodyParser = require('koa-bodyparser'),
    jsonp = require('koa-jsonp')
// 实例化
let app = new Koa()
// 配置jsonp的中间件
app.use(jsonp())
//配置post提交数据的中间件
app.use(bodyParser())
//配置session的中间件

app.keys = ['some secret hurr']
const CONFIG = {
    key: 'koa:sess',
    maxAge: 864000,
    overwrite: true,
    httpOnly: true,
    signed: true,
    rolling: true,   /*每次请求都重新设置session*/
    renew: false,
};
app.use(session(CONFIG, app))

render(app, {
    root: path.join(__dirname, 'views'),
    extname: '.html',
    debug: process.env.NODE_ENV !== 'production',
    dateFormat: dateFormat = function (value) {
        return sd.format(value, 'YYYY-MM-DD HH:mm');
    } /*扩展模板里面的方法*/
})
// 静态资源默认目录
app.use(static(__dirname + '/public'))

let index = require('./routes/index.js')
let api = require('./routes/api.js')
let admin = require('./routes/admin.js')

router.use('/admin', admin)
router.use('/api', api)
router.use(index)

app.use(router.routes())
app.use(router.allowedMethods())
app.listen(3000, () => {
    console.log('app is running')
})