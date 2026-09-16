/* cache-aside —— Cache-Aside 模式与缓存雪崩模拟器（卷02）
 * 契约：注册到 window.DEMOS['cache-aside']，Shadow DOM，无外部依赖。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['cache-aside'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var css = ''
    + ':host{display:block;font-family:inherit;}'
    + '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}'
    + '.cap{font-size:12px;color:#8a8578;margin-bottom:12px;}'
    + '.grid{display:flex;gap:16px;flex-wrap:wrap;}'
    + '.col{flex:1;min-width:260px;}'
    + 'button{padding:6px 12px;border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;font:inherit;font-size:12px;cursor:pointer;transition:background .15s,transform .1s;margin:0 6px 6px 0;}'
    + 'button:hover:not(:disabled){background:#0b5c55;}'
    + 'button:active:not(:disabled){transform:scale(.97);}'
    + 'button:disabled{opacity:.45;cursor:not-allowed;}'
    + 'button.ghost{background:#fff;color:#0f766e;}'
    + 'button.ghost:hover:not(:disabled){background:#e6f4f2;}'
    + '.store{border:1px solid #e5e1d8;border-radius:8px;padding:10px;background:#faf9f6;min-height:150px;transition:border-color .3s,box-shadow .3s;}'
    + '.store h4{margin:0 0 8px 0;font-size:13px;color:#555;}'
    + '.store.flash{border-color:#0f766e;box-shadow:0 0 0 2px rgba(15,118,110,.18);}'
    + '.kv{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:#fff;border:1px solid #eee9dd;border-radius:4px;padding:3px 6px;margin:0 4px 4px 0;display:inline-block;transition:opacity .3s;}'
    + '.kv.nullv{color:#b45309;border-color:#e8cf9f;}'
    + '.empty{font-size:11px;color:#b0ab9e;}'
    + '.log{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;border:1px solid #e5e1d8;border-radius:6px;background:#fcfbf9;padding:8px;height:120px;overflow-y:auto;color:#444;}'
    + '.log div{padding:1px 0;}'
    + '.hit{color:#0f766e;} .miss{color:#b45309;} .wr{color:#555;}'
    + 'label.sw{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#555;cursor:pointer;margin:0 12px 8px 0;user-select:none;}'
    + 'input[type=checkbox]{accent-color:#0f766e;width:15px;height:15px;cursor:pointer;}'
    + 'svg{display:block;width:100%;height:auto;border:1px solid #eee9dd;border-radius:6px;background:#fff;}'
    + '.legend{font-size:11px;color:#8a8578;margin-top:4px;}'
    + '.legend b.a{color:#dc2626;} .legend b.b{color:#0f766e;}'
    + '.sec{font-size:12px;font-weight:600;color:#555;margin:14px 0 8px 0;}';

  var html = ''
    + '<div class="wrap">'
    + '  <div class="cap">模拟器 · Cache-Aside（旁路缓存）。点「读请求」观察命中/未命中回填，点「写请求」观察「先写库、再删缓存」；下方开关可复现缓存雪崩，并对比 TTL 加随机抖动后的 DB QPS 曲线。</div>'
    + '  <div class="grid">'
    + '    <div class="col">'
    + '      <div class="sec">① 读写路径演练</div>'
    + '      <button id="read">模拟读请求 order:1</button>'
    + '      <button id="readBad" class="ghost">读不存在的 order:999</button>'
    + '      <button id="write" class="ghost">模拟写请求（改价）</button>'
    + '      <div class="grid" style="margin-top:6px;">'
    + '        <div class="col"><div class="store" id="cacheBox"><h4>Redis 缓存</h4><div id="cacheKeys"></div></div></div>'
    + '        <div class="col"><div class="store" id="dbBox"><h4>MySQL（事实源）</h4><div id="dbRows"></div></div></div>'
    + '      </div>'
    + '      <div class="log" id="log" style="margin-top:8px;"></div>'
    + '    </div>'
    + '    <div class="col">'
    + '      <div class="sec">② 缓存雪崩实验（DB QPS 曲线）</div>'
    + '      <label class="sw"><input type="checkbox" id="jitter"/> TTL 加随机抖动（300±60s）</label>'
    + '      <button id="preheat">批量预热 100 个 key（TTL=300s）</button>'
    + '      <button id="play" class="ghost">▶ 快进 600 秒</button>'
    + '      <div style="margin-top:8px;"><svg id="chart" viewBox="0 0 460 220" preserveAspectRatio="xMidYMid meet"></svg></div>'
    + '      <div class="legend">红线：DB QPS（回源压力）；绿线：缓存命中 QPS。t=300s 处所有 key 同时过期——<b class="a">不加抖动</b>时曲线瞬间飙升即「雪崩」，<b class="b">加抖动</b>后被摊平。</div>'
    + '    </div>'
    + '  </div>'
    + '</div>';

  var style = document.createElement('style');
  style.textContent = css;
  var root = document.createElement('div');
  root.innerHTML = html;
  shadow.appendChild(style);
  shadow.appendChild(root);

  var $ = function (s) { return root.querySelector(s); };

  // ---------- Part 1: read/write path ----------
  var db = { 'order:1': { item: '保温杯', price: 89 } };
  var cache = {}; // key -> {v, ttl, nullv}
  var cacheKeys = $('#cacheKeys'), dbRows = $('#dbRows'), logEl = $('#log');

  function log(msg, cls) {
    var d = document.createElement('div');
    d.className = cls || '';
    d.textContent = msg;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function flash(el) {
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 600);
  }
  function renderStores() {
    cacheKeys.innerHTML = '';
    var ks = Object.keys(cache);
    if (!ks.length) cacheKeys.innerHTML = '<span class="empty">（空）</span>';
    ks.forEach(function (k) {
      var s = document.createElement('span');
      s.className = 'kv' + (cache[k].nullv ? ' nullv' : '');
      s.textContent = cache[k].nullv ? k + ' → NULL(空值)' : k + ' → ' + JSON.stringify(cache[k].v);
      cacheKeys.appendChild(s);
    });
    dbRows.innerHTML = '';
    Object.keys(db).forEach(function (k) {
      var s = document.createElement('span');
      s.className = 'kv';
      s.textContent = k + ' → ' + JSON.stringify(db[k]);
      dbRows.appendChild(s);
    });
  }

  $('#read').addEventListener('click', function () {
    var k = 'order:1';
    if (cache[k] && !cache[k].nullv) {
      flash($('#cacheBox'));
      log('GET ' + k + ' → 缓存命中，直接返回（~1ms，DB 无压力）', 'hit');
    } else {
      flash($('#dbBox'));
      log('GET ' + k + ' → 缓存 miss，查库（~40ms）', 'miss');
      cache[k] = { v: db[k] };
      flash($('#cacheBox'));
      log('    回填缓存 SETEX ' + k + ' 300s', 'hit');
    }
    renderStores();
  });

  $('#readBad').addEventListener('click', function () {
    var k = 'order:999';
    if (cache[k]) {
      flash($('#cacheBox'));
      log('GET ' + k + ' → 命中「空值缓存」，直接 404（防穿透生效）', 'hit');
    } else {
      flash($('#dbBox'));
      log('GET ' + k + ' → miss 且库中不存在，写入空值（TTL 60s）', 'miss');
      cache[k] = { nullv: true };
      log('    否则爬虫遍历不存在的 id 会把 DB 打穿 = 缓存穿透', 'wr');
    }
    renderStores();
  });

  $('#write').addEventListener('click', function () {
    var k = 'order:1';
    db[k] = { item: '保温杯', price: 79 };
    flash($('#dbBox'));
    log('UPDATE 写库成功（price 89 → 79）', 'wr');
    if (cache[k]) {
      delete cache[k];
      flash($('#cacheBox'));
      log('DEL ' + k + ' —— 写后「删」缓存而不是「改」缓存，下次读回填新值', 'miss');
    } else {
      log('缓存中无此 key，无需删除', 'wr');
    }
    renderStores();
  });

  renderStores();
  log('提示：先连点两次「读请求」，第二次会命中缓存。', 'wr');

  // ---------- Part 2: avalanche chart ----------
  var svg = $('#chart');
  var W = 460, H = 220, padL = 38, padB = 26, padT = 12, padR = 8;
  var NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function simulate(jitter) {
    // 600 秒，100 个 key，预热后 t=300 同时过期（或抖动散开）
    // 背景流量：每秒 100 个读请求均匀落在 100 个 key 上
    var dbQps = new Array(600).fill(0), hitQps = new Array(600).fill(0);
    var expireAt = [];
    for (var i = 0; i < 100; i++) {
      var e = 300 + (jitter ? Math.floor(Math.random() * 120) - 60 : 0);
      if (e < 1) e = 1;
      expireAt.push(e);
    }
    // 每秒 100 请求，每个 key 每秒被访问 1 次（简化）
    var alive = new Array(100).fill(true);
    for (var t = 0; t < 600; t++) {
      var miss = 0;
      for (var k2 = 0; k2 < 100; k2++) {
        if (t >= expireAt[k2] && alive[k2]) {
          alive[k2] = false; // 过期
        }
        if (!alive[k2]) {
          miss++;
          // miss 后回填，重新设 TTL（同样带抖动规则）
          alive[k2] = true;
          expireAt[k2] = t + 300 + (jitter ? Math.floor(Math.random() * 120) - 60 : 0);
        }
      }
      dbQps[t] = miss;
      hitQps[t] = 100 - miss;
    }
    return { db: dbQps, hit: hitQps };
  }

  function draw(data, animate) {
    svg.innerHTML = '';
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var maxY = 100;
    function x(t) { return padL + plotW * t / 600; }
    function y(v) { return padT + plotH * (1 - v / maxY); }
    // axes
    svg.appendChild(el('line', { x1: padL, y1: padT, x2: padL, y2: H - padB, stroke: '#e5e1d8' }));
    svg.appendChild(el('line', { x1: padL, y1: H - padB, x2: W - padR, y2: H - padB, stroke: '#e5e1d8' }));
    [0, 50, 100].forEach(function (v) {
      var t = el('text', { x: padL - 6, y: y(v) + 3, 'text-anchor': 'end', 'font-size': 9, fill: '#8a8578' });
      t.textContent = v;
      svg.appendChild(t);
      svg.appendChild(el('line', { x1: padL, y1: y(v), x2: W - padR, y2: y(v), stroke: '#f2efe8' }));
    });
    [0, 300, 600].forEach(function (v) {
      var t = el('text', { x: x(v), y: H - padB + 14, 'text-anchor': 'middle', 'font-size': 9, fill: '#8a8578' });
      t.textContent = 't=' + v + 's';
      svg.appendChild(t);
    });
    // expire marker
    svg.appendChild(el('line', { x1: x(300), y1: padT, x2: x(300), y2: H - padB, stroke: '#dc2626', 'stroke-dasharray': '4 3', opacity: 0.5 }));
    function path(arr, color) {
      var d = '';
      for (var t = 0; t < 600; t += 2) {
        d += (t === 0 ? 'M' : 'L') + x(t).toFixed(1) + ' ' + y(arr[t]).toFixed(1) + ' ';
      }
      var p = el('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 2 });
      if (animate) {
        var len = 1400;
        p.setAttribute('stroke-dasharray', len);
        p.setAttribute('stroke-dashoffset', len);
        p.style.transition = 'stroke-dashoffset 2.5s linear';
        setTimeout(function () { p.style.strokeDashoffset = '0'; }, 30);
      }
      return p;
    }
    svg.appendChild(path(data.hit, '#0f766e'));
    svg.appendChild(path(data.db, '#dc2626'));
  }

  var sim = simulate(false);
  draw(sim, false);
  var warmed = false;
  $('#preheat').addEventListener('click', function () {
    warmed = true;
    sim = simulate($('#jitter').checked);
    draw(sim, false);
  });
  $('#play').addEventListener('click', function () {
    if (!warmed) { warmed = true; }
    sim = simulate($('#jitter').checked);
    draw(sim, true);
  });
  $('#jitter').addEventListener('change', function () {
    sim = simulate($('#jitter').checked);
    draw(sim, false);
  });
};
