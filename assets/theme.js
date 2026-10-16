/* theme.js —— 日间 / 夜间 / 护眼 三模式切换
 * 模式存在 <html data-theme="..."> 上，配色由 style.css 的 :root[data-theme=...] 变量组驱动。
 * 选择持久化到 localStorage('aap-theme')，首帧恢复由 <head> 内联脚本完成（避免闪烁）。
 * 桌面端：侧栏底部三键切换；移动端：顶栏单键循环切换。
 */
(function () {
  var KEY = 'aap-theme';
  var MODES = ['day', 'night', 'eye'];
  var LABELS = { day: '☀️ 日间', night: '🌙 夜间', eye: '🍃 护眼' };

  function cur() {
    var t = document.documentElement.dataset.theme;
    return MODES.indexOf(t) >= 0 ? t : 'day';
  }

  function sync() {
    var t = cur();
    document.querySelectorAll('.theme-switch button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.theme === t);
    });
    var c = document.getElementById('theme-cycle');
    if (c) c.textContent = LABELS[t];
  }

  function set(t) {
    if (MODES.indexOf(t) < 0) t = 'day';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(KEY, t); } catch (e) {}
    sync();
  }

  function init() {
    document.querySelectorAll('.theme-switch button').forEach(function (b) {
      b.addEventListener('click', function () { set(b.dataset.theme); });
    });
    var c = document.getElementById('theme-cycle');
    if (c) {
      c.addEventListener('click', function () {
        set(MODES[(MODES.indexOf(cur()) + 1) % MODES.length]);
      });
    }
    sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
