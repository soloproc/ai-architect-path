/* http-lifecycle —— HTTP 请求完整生命周期模拟器（卷01）
 * 契约：注册到 window.DEMOS['http-lifecycle']，Shadow DOM，无外部依赖。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['http-lifecycle'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var css = ''
    + ':host{display:block;font-family:inherit;}'
    + '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}'
    + '.cap{font-size:12px;color:#8a8578;margin-bottom:12px;}'
    + '.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px;}'
    + 'input[type=text]{flex:1;min-width:220px;padding:7px 10px;border:1px solid #e5e1d8;border-radius:6px;font:inherit;font-size:13px;color:#333;outline:none;}'
    + 'input[type=text]:focus{border-color:#0f766e;}'
    + 'button{padding:7px 14px;border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;font:inherit;font-size:13px;cursor:pointer;transition:background .15s,transform .1s;}'
    + 'button:hover:not(:disabled){background:#0b5c55;}'
    + 'button:active:not(:disabled){transform:scale(.97);}'
    + 'button:disabled{opacity:.45;cursor:not-allowed;}'
    + '.toggle{display:flex;gap:0;border:1px solid #e5e1d8;border-radius:6px;overflow:hidden;}'
    + '.toggle button{border:none;border-radius:0;background:#f7f5f0;color:#555;padding:7px 12px;}'
    + '.toggle button.on{background:#0f766e;color:#fff;}'
    + '.toggle button:hover:not(.on){background:#efece4;}'
    + '.lane{display:flex;align-items:stretch;gap:0;margin-bottom:10px;}'
    + '.stage{flex:1;position:relative;border:1px solid #e5e1d8;background:#faf9f6;border-radius:8px;padding:10px 8px;margin-right:6px;text-align:center;transition:background .2s,border-color .2s,box-shadow .2s;min-width:0;}'
    + '.stage:last-child{margin-right:0;}'
    + '.stage .name{font-size:12px;font-weight:600;color:#555;}'
    + '.stage .ms{font-size:11px;color:#8a8578;margin-top:4px;min-height:14px;}'
    + '.stage.active{background:#e6f4f2;border-color:#0f766e;box-shadow:0 0 0 2px rgba(15,118,110,.15);}'
    + '.stage.done{background:#f0faf8;border-color:#0f766e;}'
    + '.stage.done .ms{color:#0f766e;font-weight:600;}'
    + '.stage.cached .ms{color:#b45309;font-weight:600;}'
    + '.pkt{margin-top:10px;border:1px dashed #e5e1d8;border-radius:6px;background:#fcfbf9;padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#444;white-space:pre-wrap;min-height:60px;}'
    + '.total{font-size:13px;color:#333;margin-top:8px;}'
    + '.total b{color:#0f766e;}'
    + '.note{font-size:12px;color:#8a8578;margin-top:6px;}';

  var html = ''
    + '<div class="wrap">'
    + '  <div class="cap">模拟器 · 一次 HTTP 请求的完整生命周期（DNS → TCP → 请求 → 服务端处理 → 响应）。输入 URL 点「发送」，观察各阶段耗时与报文；切换缓存模式对比差异。</div>'
    + '  <div class="bar">'
    + '    <input type="text" id="url" value="http://api.retailhub.local:8000/orders/42" spellcheck="false"/>'
    + '    <button id="send">发送请求</button>'
    + '    <div class="toggle">'
    + '      <button id="cOff" class="on">无缓存（首次）</button>'
    + '      <button id="cOn">有缓存（304 / 命中）</button>'
    + '    </div>'
    + '  </div>'
    + '  <div class="lane" id="lane"></div>'
    + '  <div class="pkt" id="pkt">报文片段将显示在这里……</div>'
    + '  <div class="total" id="total"></div>'
    + '  <div class="note" id="note"></div>'
    + '</div>';

  var style = document.createElement('style');
  style.textContent = css;
  var root = document.createElement('div');
  root.innerHTML = html;
  shadow.appendChild(style);
  shadow.appendChild(root);

  var lane = root.querySelector('#lane');
  var pkt = root.querySelector('#pkt');
  var totalEl = root.querySelector('#total');
  var noteEl = root.querySelector('#note');
  var sendBtn = root.querySelector('#send');
  var urlInput = root.querySelector('#url');
  var cOff = root.querySelector('#cOff');
  var cOn = root.querySelector('#cOn');
  var cached = false;
  var running = false;

  cOff.addEventListener('click', function () { cached = false; cOff.className = 'on'; cOn.className = ''; });
  cOn.addEventListener('click', function () { cached = true; cOn.className = 'on'; cOff.className = ''; });

  function parseUrl(u) {
    var host = 'api.retailhub.local', port = '8000', path = '/orders/42';
    var m = String(u).match(/^https?:\/\/([^\/:]+)(?::(\d+))?(\/[^\s]*)?/i);
    if (m) { host = m[1]; if (m[2]) port = m[2]; if (m[3]) path = m[3]; }
    return { host: host, port: port, path: path };
  }

  function buildStages(u, useCache) {
    var p = parseUrl(u);
    if (useCache) {
      return [
        { name: 'DNS 解析', ms: 1, pkt: '# 浏览器缓存命中\n' + p.host + ' → 93.184.216.34  (本地 hosts / DNS 缓存，~1ms)' },
        { name: 'TCP 连接', ms: 0, cached: true, pkt: '# 连接复用 (Keep-Alive)\n复用已有 TCP 连接，0 次握手' },
        { name: 'HTTP 请求', ms: 8, pkt: 'GET ' + p.path + ' HTTP/1.1\nHost: ' + p.host + ':' + p.port + '\nIf-None-Match: "v123"\nIf-Modified-Since: Wed, 11 Jun 2025 10:00:00 GMT' },
        { name: '服务端处理', ms: 3, pkt: '# FastAPI 处理\n校验 ETag "v123" 未变化\n→ 直接返回 304，不查数据库' },
        { name: '响应返回', ms: 8, pkt: 'HTTP/1.1 304 Not Modified\nETag: "v123"\nCache-Control: max-age=60\n\n(响应体为空，浏览器复用本地缓存)' }
      ];
    }
    return [
      { name: 'DNS 解析', ms: 28, pkt: '# 递归查询\n' + p.host + ' ?\n  → 根NS → .local NS → 权威NS\n' + p.host + ' = 93.184.216.34  (28ms)' },
      { name: 'TCP 连接', ms: 35, pkt: '# 三次握手 (~1 RTT)\nSYN      →\n         ← SYN+ACK\nACK      →\n连接建立  (35ms)' },
      { name: 'HTTP 请求', ms: 12, pkt: 'GET ' + p.path + ' HTTP/1.1\nHost: ' + p.host + ':' + p.port + '\nAccept: application/json\n\n(请求行 + 首部，本质是文本)' },
      { name: '服务端处理', ms: 46, pkt: '# FastAPI: 路由匹配 + Pydantic 校验\n# SQL: SELECT ... WHERE order_id = 42\n# 序列化为 JSON  (46ms)' },
      { name: '响应返回', ms: 15, pkt: 'HTTP/1.1 200 OK\nContent-Type: application/json\nETag: "v123"\n\n{"order_id":42,"status":"paid", ...}' }
    ];
  }

  function render(stages) {
    lane.innerHTML = '';
    stages.forEach(function (s) {
      var d = document.createElement('div');
      d.className = 'stage';
      d.innerHTML = '<div class="name">' + s.name + '</div><div class="ms"></div>';
      lane.appendChild(d);
    });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  sendBtn.addEventListener('click', function () {
    if (running) return;
    running = true;
    sendBtn.disabled = true;
    totalEl.textContent = '';
    noteEl.textContent = '';
    var stages = buildStages(urlInput.value, cached);
    render(stages);
    pkt.textContent = '准备发送……';
    var nodes = lane.children;
    var i = 0;
    var total = 0;

    function step() {
      if (i > 0) {
        var prev = nodes[i - 1];
        prev.classList.remove('active');
        prev.classList.add(stages[i - 1].cached ? 'done' : 'done');
        if (stages[i - 1].cached) prev.classList.add('cached');
        prev.querySelector('.ms').textContent = stages[i - 1].cached ? '复用 · 0ms' : stages[i - 1].ms + ' ms';
      }
      if (i >= stages.length) {
        total = stages.reduce(function (a, s) { return a + s.ms; }, 0);
        totalEl.innerHTML = '总耗时 <b>' + total + ' ms</b>' + (cached ? '（缓存模式：省掉了握手与服务端重计算）' : '（无缓存模式：完整链路）');
        noteEl.textContent = cached
          ? '观察：缓存命中时 DNS/TCP 近乎免费，服务端用 304 省掉响应体——这就是「缓存」在 HTTP 层的形态。'
          : '观察：真实世界里 DNS 与 TCP 握手常常比服务端处理还贵——这正是连接池与 Keep-Alive 存在的理由。';
        running = false;
        sendBtn.disabled = false;
        return;
      }
      nodes[i].classList.add('active');
      pkt.textContent = stages[i].pkt;
      i++;
      setTimeout(step, 900);
    }
    step();
  });

  render(buildStages(urlInput.value, false));
};
