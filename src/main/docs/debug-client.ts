/**
 * 分享页在线调试脚本（同源静态资源）。
 * 渐进增强：脚本不可用时，表单仍可原生提交到 /execute 并跳转结果页。
 */
export const DEBUG_SCRIPT = String.raw`(function () {
  'use strict'
  var TOKEN = /"(?:\\[\s\S]|[^"\\])*"?|-?\b\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?\b|\b(?:true|false|null)\b/g
  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
  function pretty(text) {
    try { return JSON.stringify(JSON.parse(text), null, 2) } catch (e) { return text }
  }
  function highlight(text) {
    var out = '', cursor = 0, match
    TOKEN.lastIndex = 0
    while ((match = TOKEN.exec(text))) {
      out += escapeHtml(text.slice(cursor, match.index))
      var token = match[0], cls = 'l'
      if (token.charAt(0) === '"') {
        var next = match.index + token.length
        while (next < text.length && /\s/.test(text.charAt(next))) next++
        cls = text.charAt(next) === ':' ? 'k' : 's'
      } else if (/^-?\d/.test(token)) {
        cls = 'n'
      }
      out += '<span class="json-' + cls + '">' + escapeHtml(token) + '</span>'
      cursor = match.index + token.length
    }
    out += escapeHtml(text.slice(cursor))
    return out
  }
  function renderResponse(el, data) {
    el.hidden = false
    var status = data.status
    var html = '<div class="try-response-head">'
    if (data.ok && status) {
      html += '<span class="try-code ' + (status.code < 400 ? 'ok' : 'error') + '">' +
        status.code + ' ' + escapeHtml(status.text || '') + '</span>'
      html += '<span class="try-meta">' + status.time + ' ms · ' +
        escapeHtml(status.mime || '') + ' · ' + status.size + ' B</span>'
    } else {
      html += '<span class="try-code error">请求失败</span><span class="try-meta">' +
        escapeHtml(data.error || '') + '</span>'
    }
    html += '</div>'
    var headers = data.headers || {}
    var keys = Object.keys(headers)
    if (keys.length) {
      html += '<details class="try-headers"><summary>响应头</summary><table>'
      keys.forEach(function (key) {
        html += '<tr><td>' + escapeHtml(key) + '</td><td>' + escapeHtml(String(headers[key])) + '</td></tr>'
      })
      html += '</table></details>'
    }
    var body = data.body || ''
    var isJson = false
    try { JSON.parse(body); isJson = true } catch (e) {}
    html += '<pre class="try-body">' + (isJson ? highlight(pretty(body)) : escapeHtml(body || '（空响应体）')) + '</pre>'
    el.innerHTML = html
  }
  function initCard(form) {
    var card = form.closest('.api-card')
    if (!card) return
    var toggle = card.querySelector('[data-debug-toggle]')
    var response = card.querySelector('.try-response')
    if (toggle) {
      toggle.addEventListener('click', function () {
        var editing = card.classList.toggle('editing')
        toggle.textContent = editing ? '退出调试' : '调试'
        toggle.classList.toggle('on', editing)
        if (!editing && response) response.hidden = true
      })
    }
    form.addEventListener('submit', function (event) {
      event.preventDefault()
      var button = form.querySelector('.try-send')
      if (button) { button.disabled = true; button.textContent = '发送中…' }
      var body = new URLSearchParams()
      new FormData(form).forEach(function (value, key) { body.append(key, String(value)) })
      fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: body
      })
        .then(function (res) { return res.json() })
        .then(function (data) { if (response) renderResponse(response, data) })
        .catch(function (error) {
          if (response) renderResponse(response, { ok: false, error: error.message })
        })
        .finally(function () {
          if (button) { button.disabled = false; button.textContent = '发送请求' }
        })
    })
  }
  function init() {
    document.querySelectorAll('[data-debug-form]').forEach(initCard)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
})()`
