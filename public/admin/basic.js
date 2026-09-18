'use strict'
// ============================================================
// 后台公共交互脚本
// P0 安全改造：原来的 changeStatus / changeSort / remove 都是 **GET** 写操作，
// 可被跨站（<img src>、链接、预取）触发 → CSRF。现全部改为 POST 并携带 _csrf。
//
// 为什么前端能直接拿到 token？
//   本项目用「双提交 Cookie」：csrfToken 存在**可读** Cookie（httpOnly=false）里，
//   前端 JS 读出来、随写请求回传，服务端比对 Cookie 与请求参数是否一致即可。
//   这是双提交 Cookie 方案的核心，SPA / AJAX 场景都不想依赖服务端存 secret。
// ============================================================

/** 从 Cookie 读取 CSRF token（双提交 Cookie 模式） */
function csrfToken () {
  var m = document.cookie.match(/(?:^|;\s*)csrfToken=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

$(function () {
  app.confirmDelete();
})

var app = {
  toggle: function (el, collectionName, attr, id) {
    // 改 POST + _csrf（GET 写操作过不了 CSRF 校验）
    $.post('/admin/changeStatus', {
      collectionName: collectionName, attr: attr, id: id, _csrf: csrfToken()
    }, function (data) {
      if (data.success) {
        if (el.src.indexOf('yes') != -1) {
          el.src = '/admin/images/no.gif';
        } else {
          el.src = '/admin/images/yes.gif';
        }
      }
    })

  },

  /**
   * 删除：列表里的删除仍是 <a class="delete" href=".../admin/remove?collectionName=x&id=y">。
   * 这里拦截点击，把 href 上的参数取出，组装成带 _csrf 的 POST 表单再提交
   * （原生 <a> 只能发 GET，而服务端已改成只接受 POST）。
   * 好处：不用改 6 个列表页模板，删除动作统一走 CSRF 保护。
   */
  confirmDelete () {
    $('.delete').click(function (e) {
      if (!confirm('您确定要删除吗?')) {
        e.preventDefault()
        return false
      }
      e.preventDefault()

      // 解析 href 的查询串（不依赖 URL API，兼容老浏览器）
      var href = $(this).attr('href') || ''
      var q = {}
      var idx = href.indexOf('?')
      if (idx > -1) {
        href.substring(idx + 1).split('&').forEach(function (kv) {
          var p = kv.split('=')
          q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '')
        })
      }

      $('<form>')
        .attr({ method: 'post', action: '/admin/remove' })
        .append($('<input>').attr({ type: 'hidden', name: '_csrf' }).val(csrfToken()))
        .append($('<input>').attr({ type: 'hidden', name: 'collectionName' }).val(q.collectionName || ''))
        .append($('<input>').attr({ type: 'hidden', name: 'id' }).val(q.id || ''))
        .appendTo('body')
        .submit()

      return false
    })
  },

  changeSort (el, collectionName, id) {
    var sortValue = el.value;
    // 改 POST + _csrf
    $.post('/admin/changeSort', {
      collectionName: collectionName, id: id, sortValue: sortValue, _csrf: csrfToken()
    }, function (data) {
      console.log(data)
    })

  }
}
