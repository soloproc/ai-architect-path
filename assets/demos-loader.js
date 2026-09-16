/* Demo loader: finds .demo-embed blocks, lazy-loads assets/demos/<id>.js,
 * then calls window.DEMOS[id](container). No dependencies. */
(function () {
  window.DEMOS = window.DEMOS || {};
  var loading = {};

  function fail(div, id) {
    div.innerHTML =
      '<div class="demo-error">Demo 加载失败，可查看本地文件 assets/demos/' +
      id + '.js</div>';
  }

  function run(div, id) {
    try {
      if (typeof window.DEMOS[id] === 'function') {
        div.innerHTML = '';
        window.DEMOS[id](div);
      } else {
        fail(div, id);
      }
    } catch (e) {
      fail(div, id);
    }
  }

  function loadDemo(div) {
    var id = div.getAttribute('data-demo');
    if (!id) return;
    if (typeof window.DEMOS[id] === 'function') { run(div, id); return; }
    if (!loading[id]) {
      loading[id] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'assets/demos/' + id + '.js';
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    loading[id].then(
      function () { run(div, id); },
      function () { fail(div, id); }
    );
  }

  function init() {
    var nodes = document.querySelectorAll('.demo-embed');
    for (var i = 0; i < nodes.length; i++) loadDemo(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
