/* http-lifecycle —— HTTP 请求完整生命周期模拟器（卷01）
 * 契约：注册到 window.DEMOS['http-lifecycle']，Shadow DOM，无外部依赖。
 * 交互：点「发送请求」自动走一遍五阶段动画；动画中/结束后，
 * 可点击任意阶段卡、或用「◀ 上一阶段 / 下一阶段 ▶」按钮来回切换，
 * 逐个查看该阶段的报文片段与原理讲解。
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
    + '.stage{flex:1;position:relative;border:1px solid #e5e1d8;background:#faf9f6;border-radius:8px;padding:10px 8px;margin-right:6px;text-align:center;transition:background .2s,border-color .2s,box-shadow .2s;min-width:0;cursor:pointer;}'
    + '.stage:last-child{margin-right:0;}'
    + '.stage:hover{border-color:#0f766e;}'
    + '.stage .name{font-size:12px;font-weight:600;color:#555;}'
    + '.stage .ms{font-size:11px;color:#8a8578;margin-top:4px;min-height:14px;}'
    + '.stage .idx{position:absolute;top:4px;left:6px;font-size:10px;color:#b8b2a4;}'
    + '.stage.active{background:#e6f4f2;border-color:#0f766e;box-shadow:0 0 0 2px rgba(15,118,110,.15);}'
    + '.stage.done{background:#f0faf8;border-color:#0f766e;}'
    + '.stage.done .ms{color:#0f766e;font-weight:600;}'
    + '.stage.cached .ms{color:#b45309;font-weight:600;}'
    + '.stage.sel{border-color:#0f766e;box-shadow:0 0 0 2px rgba(15,118,110,.28);}'
    + '.stage.sel .name{color:#0f766e;}'
    + '.nav{display:flex;gap:8px;align-items:center;margin:4px 0 10px;}'
    + '.nav button{padding:5px 12px;font-size:12px;background:#fff;color:#0f766e;}'
    + '.nav button:hover:not(:disabled){background:#f0faf8;}'
    + '.nav .where{font-size:12px;color:#8a8578;margin-left:auto;}'
    + '.pkt{margin-top:4px;border:1px dashed #e5e1d8;border-radius:6px;background:#fcfbf9;padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#444;white-space:pre-wrap;min-height:60px;}'
    + '.desc{margin-top:8px;font-size:12.5px;color:#57534e;line-height:1.7;background:#f7f5f0;border-left:3px solid #0f766e;border-radius:0 6px 6px 0;padding:8px 12px;min-height:22px;}'
    + '.desc b{color:#0f766e;}'
    + '.total{font-size:13px;color:#333;margin-top:8px;}'
    + '.total b{color:#0f766e;}'
    + '.note{font-size:12px;color:#8a8578;margin-top:6px;}';

  var html = ''
    + '<div class="wrap">'
    + '  <div class="cap">模拟器 · 一次 HTTP 请求的完整生命周期（DNS → TCP → 请求 → 服务端处理 → 响应）。点「发送」自动走一遍；<b>点击任意阶段卡，或用 ◀ ▶ 按钮前后切换</b>，逐个查看每个阶段的报文与原理。切换缓存模式可对比差异。</div>'
    + '  <div class="bar">'
    + '    <input type="text" id="url" value="http://api.retailhub.local:8000/orders/42" spellcheck="false"/>'
    + '    <button id="send">发送请求</button>'
    + '    <div class="toggle">'
    + '      <button id="cOff" class="on">无缓存（首次）</button>'
    + '      <button id="cOn">有缓存（304 / 命中）</button>'
    + '    </div>'
    + '  </div>'
    + '  <div class="lane" id="lane"></div>'
    + '  <div class="nav">'
    + '    <button id="prev">◀ 上一阶段</button>'
    + '    <button id="next">下一阶段 ▶</button>'
    + '    <span class="where" id="where"></span>'
    + '  </div>'
    + '  <div class="pkt" id="pkt">报文片段将显示在这里……</div>'
    + '  <div class="desc" id="desc"></div>'
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
  var descEl = root.querySelector('#desc');
  var totalEl = root.querySelector('#total');
  var noteEl = root.querySelector('#note');
  var whereEl = root.querySelector('#where');
  var sendBtn = root.querySelector('#send');
  var prevBtn = root.querySelector('#prev');
  var nextBtn = root.querySelector('#next');
  var urlInput = root.querySelector('#url');
  var cOff = root.querySelector('#cOff');
  var cOn = root.querySelector('#cOn');
  var cached = false;
  var running = false;
  var stages = [];
  var selected = -1;      // 当前正在查看的阶段下标
  var played = false;     // 是否已完整发送过一次（决定是否显示耗时）

  cOff.addEventListener('click', function () {
    cached = false; cOff.className = 'on'; cOn.className = '';
    rebuild();
  });
  cOn.addEventListener('click', function () {
    cached = true; cOn.className = 'on'; cOff.className = '';
    rebuild();
  });

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
        { name: 'DNS 解析', ms: 1,
          pkt: '# 浏览器缓存命中\n' + p.host + ' → 93.184.216.34  (本地 hosts / DNS 缓存，~1ms)',
          desc: '<b>DNS 解析（缓存模式）</b>：浏览器和操作系统各自缓存了域名解析结果，命中时几乎免费。DNS 缓存有 TTL，到期才会重新递归查询。' },
        { name: 'TCP 连接', ms: 0, cached: true,
          pkt: '# 连接复用 (Keep-Alive)\n复用已有 TCP 连接，0 次握手',
          desc: '<b>TCP 连接（缓存模式）</b>：HTTP/1.1 Keep-Alive 让一条 TCP 连接反复服务多次请求，握手只付一次税。连接池大小、空闲超时都是服务端的重要调优参数。' },
        { name: 'HTTP 请求', ms: 8,
          pkt: 'GET ' + p.path + ' HTTP/1.1\nHost: ' + p.host + ':' + p.port + '\nIf-None-Match: "v123"\nIf-Modified-Since: Wed, 11 Jun 2025 10:00:00 GMT',
          desc: '<b>HTTP 请求（缓存模式）</b>：浏览器带上 If-None-Match（ETag）发起「条件请求」——“如果资源没变就告诉我一声，别再把内容发一遍”。' },
        { name: '服务端处理', ms: 3,
          pkt: '# FastAPI 处理\n校验 ETag "v123" 未变化\n→ 直接返回 304，不查数据库',
          desc: '<b>服务端处理（缓存模式）</b>：服务端比对 ETag 发现资源未变，直接回 304，省掉查库、序列化等大部分工作——这就是协商缓存省下的服务端成本。' },
        { name: '响应返回', ms: 8,
          pkt: 'HTTP/1.1 304 Not Modified\nETag: "v123"\nCache-Control: max-age=60\n\n(响应体为空，浏览器复用本地缓存)',
          desc: '<b>响应返回（缓存模式）</b>：304 响应没有响应体，网络传输成本几乎为零；浏览器拿出本地缓存的内容直接使用。对比无缓存模式，省下的主要是「建连 + 服务端重计算 + 响应体传输」三笔钱。' }
      ];
    }
    return [
      { name: 'DNS 解析', ms: 28,
        pkt: '# 递归查询\n' + p.host + ' ?\n  → 根NS → .local NS → 权威NS\n' + p.host + ' = 93.184.216.34  (28ms)',
        desc: '<b>DNS 解析</b>：把域名翻译成 IP。本地没缓存时要走「根 → 顶级域 → 权威」递归链路，跨国解析可能上百毫秒。工程对策：DNS 预解析（dns-prefetch）、长 TTL、HTTPDNS。' },
      { name: 'TCP 连接', ms: 35,
        pkt: '# 三次握手 (~1 RTT)\nSYN      →\n         ← SYN+ACK\nACK      →\n连接建立  (35ms)',
        desc: '<b>TCP 连接</b>：三次握手至少花 1 个 RTT；如果上 HTTPS，TLS 握手还要再加 1~2 个 RTT。跨境场景 RTT 动辄 150ms+，「建连」常常比「处理」还贵——这就是连接池与 Keep-Alive 存在的理由。' },
      { name: 'HTTP 请求', ms: 12,
        pkt: 'GET ' + p.path + ' HTTP/1.1\nHost: ' + p.host + ':' + p.port + '\nAccept: application/json\n\n(请求行 + 首部，本质是文本)',
        desc: '<b>HTTP 请求</b>：HTTP/1.1 报文就是纯文本：请求行（方法 + 路径 + 版本）+ 首部 + 空行 + 可选请求体。这一阶段的耗时主要是上行带宽与 RTT。' },
      { name: '服务端处理', ms: 46,
        pkt: '# FastAPI: 路由匹配 + Pydantic 校验\n# SQL: SELECT ... WHERE order_id = 42\n# 序列化为 JSON  (46ms)',
        desc: '<b>服务端处理</b>：框架路由 → 参数校验 → 业务逻辑 → 查库 → 序列化。后端性能优化（索引、缓存、异步化）主要就发生在这 46ms 里——它是五个阶段中唯一「你写的代码」直接决定快慢的部分。' },
      { name: '响应返回', ms: 15,
        pkt: 'HTTP/1.1 200 OK\nContent-Type: application/json\nETag: "v123"\n\n{"order_id":42,"status":"paid", ...}',
        desc: '<b>响应返回</b>：状态行 + 响应首部 + 响应体。ETag 是这次响应埋下的「伏笔」：下次请求带上它，服务端就有机会回 304——切换到「有缓存」模式再发一次，对比这条链路能省多少。' }
    ];
  }

  function render() {
    lane.innerHTML = '';
    stages.forEach(function (s, i) {
      var d = document.createElement('div');
      d.className = 'stage';
      d.setAttribute('data-i', i);
      d.innerHTML = '<span class="idx">' + (i + 1) + '</span><div class="name">' + s.name + '</div><div class="ms"></div>';
      d.addEventListener('click', function () { select(i); });
      lane.appendChild(d);
    });
  }

  function select(i) {
    if (i < 0 || i >= stages.length) return;
    selected = i;
    var nodes = lane.children;
    for (var k = 0; k < nodes.length; k++) nodes[k].classList.remove('sel');
    nodes[i].classList.add('sel');
    pkt.textContent = stages[i].pkt;
    descEl.innerHTML = stages[i].desc;
    whereEl.textContent = '第 ' + (i + 1) + ' / ' + stages.length + ' 阶段 · ' + stages[i].name;
    prevBtn.disabled = i <= 0;
    nextBtn.disabled = i >= stages.length - 1;
  }

  prevBtn.addEventListener('click', function () { select(selected - 1); });
  nextBtn.addEventListener('click', function () { select(selected + 1); });

  function rebuild() {
    stages = buildStages(urlInput.value, cached);
    played = false;
    totalEl.textContent = '';
    noteEl.textContent = '';
    render();
    select(0);
  }

  sendBtn.addEventListener('click', function () {
    if (running) return;
    running = true;
    sendBtn.disabled = true;
    totalEl.textContent = '';
    noteEl.textContent = '';
    stages = buildStages(urlInput.value, cached);
    render();
    var nodes = lane.children;
    var i = 0;

    function step() {
      if (i > 0) {
        var prev = nodes[i - 1];
        prev.classList.remove('active');
        prev.classList.add('done');
        if (stages[i - 1].cached) prev.classList.add('cached');
        prev.querySelector('.ms').textContent = stages[i - 1].cached ? '复用 · 0ms' : stages[i - 1].ms + ' ms';
      }
      if (i >= stages.length) {
        var total = stages.reduce(function (a, s) { return a + s.ms; }, 0);
        totalEl.innerHTML = '总耗时 <b>' + total + ' ms</b>' + (cached ? '（缓存模式：省掉了握手与服务端重计算）' : '（无缓存模式：完整链路）');
        noteEl.textContent = (cached
          ? '观察：缓存命中时 DNS/TCP 近乎免费，服务端用 304 省掉响应体——这就是「缓存」在 HTTP 层的形态。'
          : '观察：真实世界里 DNS 与 TCP 握手常常比服务端处理还贵——这正是连接池与 Keep-Alive 存在的理由。')
          + '　现在可以点击任意阶段卡，或用 ◀ ▶ 按钮来回复习每个阶段。';
        running = false;
        sendBtn.disabled = false;
        played = true;
        select(stages.length - 1);
        return;
      }
      nodes[i].classList.add('active');
      select(i);
      i++;
      setTimeout(step, 1100);
    }
    step();
  });

  rebuild();
};
