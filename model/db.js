
var MongoDB = require('mongodb');
var MongoClient = MongoDB.MongoClient;
const ObjectID = MongoDB.ObjectID;

var Config = require('./config.js');

class Db {

    static getInstance () {

        if (!Db.instance) {
            Db.instance = new Db();
        }
        return Db.instance;
    }

    constructor() {

        this.dbClient = '';
        this.connect();

    }

    connect () {
        let _that = this;
        return new Promise((resolve, reject) => {
            if (!_that.dbClient) {
                MongoClient.connect(Config.dbUrl, { useNewUrlParser: true }, (err, client) => {

                    if (err) {
                        reject(err)

                    } else {

                        _that.dbClient = client.db(Config.dbName);
                        resolve(_that.dbClient)
                    }
                })

            } else {
                resolve(_that.dbClient);

            }


        })

    }
    /*

     DB.find('user',{})  返回所有数据
     DB.find('user',{},{"title":1})    返回所有数据  只返回一列
     DB.find('user',{},{"title":1},{   返回第二页的数据
        page:2,
        pageSize:20,
        sort:{"add_time":-1}
     })
     js中实参和形参可以不一样      arguments 对象接收实参传过来的数据
    * */
    find (collectionName, json1, json2, json3) {
        if (arguments.length == 2) {
            var attr = {};
            var slipNum = 0;
            var pageSize = 0;

        } else if (arguments.length == 3) {
            var attr = json2;
            var slipNum = 0;
            var pageSize = 0;
        } else if (arguments.length == 4) {
            var attr = json2;
            var page = json3.page || 1;
            var pageSize = json3.pageSize || 20;
            var slipNum = (page - 1) * pageSize;
            if (json3.sortJson) {
                var sortJson = json3.sortJson;
            } else {
                var sortJson = {}
            }
        } else {
            console.log('传入的参数错误')
        }

        return new Promise((resolve, reject) => {

            this.connect().then((db) => {
                //var result=db.collection(collectionName).find(json);
                var result = db.collection(collectionName).find(json1, { fields: attr }).skip(slipNum).limit(pageSize).sort(sortJson)
                result.toArray(function (err, docs) {

                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(docs);
                })

            })
        })
    }
    update (collectionName, json1, json2) {
        return new Promise((resolve, reject) => {


            this.connect().then((db) => {

                //db.user.update({},{$set:{}})
                db.collection(collectionName).updateOne(json1, {
                    $set: json2
                }, (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                })

            })

        })

    }
    insert (collectionName, json) {
        return new Promise((resolve, reject) => {
            this.connect().then((db) => {

                db.collection(collectionName).insertOne(json, function (err, result) {
                    if (err) {
                        reject(err);
                    } else {

                        resolve(result);
                    }
                })


            })
        })
    }

    remove (collectionName, json) {

        return new Promise((resolve, reject) => {
            this.connect().then((db) => {

                db.collection(collectionName).removeOne(json, function (err, result) {
                    if (err) {
                        reject(err);
                    } else {

                        resolve(result);
                    }
                })


            })
        })
    }
    getObjectId (id) {    /*mongodb�����ѯ _id ���ַ���ת���ɶ���*/

        return new ObjectID(id);
    }
    // 获取分页总条数
    count (collectionName, json) {

        return new Promise((resolve, reject) => {
            this.connect().then((db) => {

                var result = db.collection(collectionName).count(json);
                result.then(function (count) {

                    resolve(count);
                }
                )
            })
        })

    }
}


module.exports = Db.getInstance();
