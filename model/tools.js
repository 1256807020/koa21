let md5 = require('md5')
let tools = {
  md5 (str) {
    return md5(str)
  },
  cateToList (data) {
    // console.log(data)
    // 1 获取一级分类
    let firstArr = []
    for (let i = 0; i < data.length; i++) {
      if (data[i].pid === '0') {
        firstArr.push(data[i])
      }
    }
    // 2 获取二级分类
    for (var i = 0; i < firstArr.length; i++) {

      firstArr[i].list = [];
      //遍历所有的数据  看那个数据的pid等于当前的数据_id
      for (var j = 0; j < data.length; j++) {
        if (firstArr[i]._id == data[j].pid) {
          firstArr[i].list.push(data[j]);
        }
      }

    }

    // console.log(firstArr)

    return firstArr
  }
}
module.exports = tools
