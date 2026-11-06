/**
 * 分享页单接口复制脚本（同源静态资源）。
 * 复制文本由服务端导出端点生成；局域网 HTTP 属于非安全上下文，
 * navigator.clipboard 不可用时回退到 textarea + execCommand。
 */
export const SHARE_SCRIPT = `(function () {
  'use strict'
  var toast = null
  var toastTimer = 0

  function showToast(text, failed) {
    if (!toast) {
      toast = document.createElement('div')
      toast.className = 'copy-toast'
      toast.setAttribute('role', 'status')
      toast.setAttribute('aria-live', 'polite')
      document.body.appendChild(toast)
    }
    toast.textContent = text
    toast.classList.toggle('error', Boolean(failed))
    toast.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { toast.classList.remove('show') }, 1800)
  }

  function legacyCopy(text) {
    var area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    area.setSelectionRange(0, area.value.length)
    var ok = false
    try { ok = document.execCommand('copy') } catch (error) { ok = false }
    document.body.removeChild(area)
    if (!ok) throw new Error('copy failed')
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () {
        legacyCopy(text)
      })
    }
    try {
      legacyCopy(text)
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(error)
    }
  }

  function handle(button) {
    if (button.dataset.copying === '1') return
    var endpoint = button.dataset.copyEndpoint
    if (!endpoint) return
    button.dataset.copying = '1'
    button.disabled = true
    fetch(endpoint, {
      credentials: 'same-origin',
      headers: { Accept: 'text/plain, application/json' }
    })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.text()
      })
      .then(function (text) {
        return copyText(text)
      })
      .then(function () {
        showToast(button.dataset.copyLabel || '已复制', false)
      })
      .catch(function () {
        showToast('复制失败，请重试', true)
      })
      .then(function () {
        delete button.dataset.copying
        button.disabled = false
      })
  }

  document.addEventListener('click', function (event) {
    var target = event.target
    if (!target || !target.closest) return
    var button = target.closest('[data-copy-endpoint]')
    if (!button) return
    event.preventDefault()
    handle(button)
  })
})()`
