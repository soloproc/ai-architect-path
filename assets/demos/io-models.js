/* io-models —— IO 模型对比模拟器（卷01 §3.3）
 * 契约：注册到 window.DEMOS['io-models']，Shadow DOM，样式内联，无外部依赖。
 * 同一批请求（可调数量、计算耗时、IO 耗时）分别在三种模式下调度：
 * 阻塞单线程（串行）、多线程（4 线程 + 切换开销）、IO 多路复用（单线程事件循环，等待重叠）。
 * 时间轴逐行渲染每个请求的计算/等待/切换段，游标扫过播放；输出总耗时、线程数、切换次数与教学结论。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['io-models'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var THREADS = 4;      // 多线程模式的线程数
  var SWITCH_MS = 4;    // 多线程模式：每次 IO 挂起/唤醒的调度开销（折算）

  var state = { mode: 'epoll', raf: null, result: null, best: {} };

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    '.row{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;align-items:flex-end;}' +
    '.ctl{display:flex;flex-direction:column;gap:3px;min-width:130px;flex:1;}' +
    '.ctl label{font-size:11px;color:#57534e;display:flex;justify-content:space-between;gap:8px;}' +
    '.ctl label b{color:#0f766e;font-variant-numeric:tabular-nums;}' +
    'input[type=range]{width:100%;accent-color:#0f766e;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 12px;' +
    'font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button.on{background:#0f766e;color:#fff;}' +
    'button.mode{background:#fff;color:#0f766e;}' +
    'button.mode.on{background:#0f766e;color:#fff;}' +
    'button:hover{opacity:.88;}' +
    '.metrics{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;}' +
    '.metric{flex:1;min-width:110px;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;}' +
    '.metric .k{font-size:11px;color:#78716c;}' +
    '.metric .v{font-size:18px;font-weight:600;color:#0f766e;font-variant-numeric:tabular-nums;}' +
    '.metric .v.warn{color:#d97706;}' +
    '.chart{position:relative;background:#fafaf9;border:1px solid #e7e5e4;border-radius:6px;padding:10px;}' +
    '.rrow{display:flex;align-items:center;height:20px;margin:2px 0;}' +
    '.rlabel{width:52px;font-size:10px;color:#78716c;flex:none;font-variant-numeric:tabular-nums;}' +
    '.track{position:relative;flex:1;height:14px;background:#f5f5f4;border-radius:3px;}' +
    '.seg{position:absolute;top:0;height:100%;border-radius:2px;}' +
    '.seg.cpu{background:#0f766e;}' +
    '.seg.io{background:#d6d3d1;}' +
    '.seg.ovh{background:#d97706;}' +
    '.cursor{position:absolute;top:0;bottom:0;width:2px;background:#dc2626;display:none;}' +
    '.legend{display:flex;gap:14px;font-size:11px;color:#57534e;margin-top:6px;flex-wrap:wrap;}' +
    '.sw{display:inline-block;width:10px;height:10px;vertical-align:-1px;margin-right:4px;border-radius:2px;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;' +
    'border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · IO 模型对比模拟器（卷01 §3.3：等待的时候 CPU 在干嘛）</div>' +
    '  <div class="row">' +
    '    <div class="ctl"><label>并发请求数 <b id="nV">6</b></label>' +
    '      <input id="n" type="range" min="1" max="12" step="1" value="6"></div>' +
    '    <div class="ctl"><label>单请求 IO 等待 <b id="ioV">60 ms</b></label>' +
    '      <input id="io" type="range" min="10" max="200" step="10" value="60"></div>' +
    '    <div class="ctl"><label>单请求计算耗时 <b id="cpuV">8 ms</b></label>' +
    '      <input id="cpu" type="range" min="2" max="40" step="2" value="8"></div>' +
    '  </div>' +
    '  <div class="row">' +
    '    <button class="mode" data-m="blocking">阻塞单线程</button>' +
    '    <button class="mode" data-m="threads">多线程（4 线程）</button>' +
    '    <button class="mode on" data-m="epoll">IO 多路复用（事件循环）</button>' +
    '    <button id="play" class="ghost">▶ 播放</button>' +
    '  </div>' +
    '  <div class="metrics">' +
    '    <div class="metric"><div class="k">总耗时</div><div class="v" id="mTotal">-</div></div>' +
    '    <div class="metric"><div class="k">线程数</div><div class="v" id="mThreads">-</div></div>' +
    '    <div class="metric"><div class="k">上下文切换/调度代价</div><div class="v" id="mSwitch">-</div></div>' +
    '    <div class="metric"><div class="k">CPU 利用率</div><div class="v" id="mUtil">-</div></div>' +
    '  </div>' +
    '  <div class="chart" id="chart"></div>' +
    '  <div class="legend">' +
    '    <span><span class="sw" style="background:#0f766e"></span>计算（占 CPU）</span>' +
    '    <span><span class="sw" style="background:#d6d3d1"></span>IO 等待（等数据库/网络）</span>' +
    '    <span><span class="sw" style="background:#d97706"></span>线程切换/调度开销</span>' +
    '    <span><span class="sw" style="background:#dc2626"></span>播放游标</span>' +
    '  </div>' +
    '  <div class="verdict" id="verdict">选择一种模式观察时间轴，再切换对比。</div>' +
    '  <div class="note">教学简化：每个请求 = 计算→等 IO→计算；多线程模式固定 4 条线程、每次 IO 挂起与唤醒各计一次调度开销；事件循环为单线程，IO 等待完全重叠。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  function params() {
    return {
      n: parseInt($('n').value, 10),
      io: parseInt($('io').value, 10),
      cpu: parseInt($('cpu').value, 10)
    };
  }

  /* 三种模式的确定性调度，返回 {rows:[[{t0,t1,type}...]...], total, threads, switches, busy} */
  function schedule(mode, n, cpu, io) {
    var rows = [], i;
    if (mode === 'blocking') {
      var t = 0;
      for (i = 0; i < n; i++) {
        rows.push([
          { t0: t, t1: t + cpu, type: 'cpu' },
          { t0: t + cpu, t1: t + cpu + io, type: 'io' },
          { t0: t + cpu + io, t1: t + 2 * cpu + io, type: 'cpu' }
        ]);
        t = t + 2 * cpu + io;
      }
      return { rows: rows, total: t, threads: 1, switches: 0, busy: n * 2 * cpu };
    }
    if (mode === 'threads') {
      var T = Math.min(THREADS, n);
      var avail = [];
      for (i = 0; i < T; i++) avail.push(0);
      for (i = 0; i < n; i++) {
        var tid = 0;
        for (var j = 1; j < T; j++) if (avail[j] < avail[tid]) tid = j;
        var s = avail[tid];
        rows.push([
          { t0: s, t1: s + cpu, type: 'cpu' },
          { t0: s + cpu, t1: s + cpu + SWITCH_MS, type: 'ovh' },          // 挂起让出
          { t0: s + cpu + SWITCH_MS, t1: s + cpu + SWITCH_MS + io, type: 'io' },
          { t0: s + cpu + SWITCH_MS + io, t1: s + cpu + 2 * SWITCH_MS + io, type: 'ovh' }, // 唤醒恢复
          { t0: s + cpu + 2 * SWITCH_MS + io, t1: s + 2 * cpu + 2 * SWITCH_MS + io, type: 'cpu' }
        ]);
        avail[tid] = s + 2 * cpu + 2 * SWITCH_MS + io;
      }
      var total = 0;
      for (i = 0; i < T; i++) total = Math.max(total, avail[i]);
      return { rows: rows, total: total, threads: T, switches: 2 * n, busy: n * 2 * cpu };
    }
    // epoll：单线程事件循环。第一段 CPU 串行；IO 各自并行；第二段 CPU 按就绪顺序串行
    var tfree = 0;
    var pending = [];
    for (i = 0; i < n; i++) {
      var c0 = tfree, c1 = tfree + cpu;
      tfree = c1;
      pending.push({ idx: i, ready: c1 + io, segs: [{ t0: c0, t1: c1, type: 'cpu' }, { t0: c1, t1: c1 + io, type: 'io' }] });
    }
    pending.sort(function (a, b) { return a.ready - b.ready; });
    var rows2 = [];
    for (i = 0; i < n; i++) rows2.push(null);
    for (i = 0; i < pending.length; i++) {
      var p = pending[i];
      var s2 = Math.max(tfree, p.ready);
      p.segs.push({ t0: s2, t1: s2 + cpu, type: 'cpu' });
      tfree = s2 + cpu;
      rows2[p.idx] = p.segs;
    }
    return { rows: rows2, total: tfree, threads: 1, switches: 0, busy: n * 2 * cpu };
  }

  var MODE_TEXT = {
    blocking: { name: '阻塞单线程', tip: '每个请求死等 IO，线程陪着一起睡——请求只能一个接一个。总耗时 = N ×（计算 + IO）。并发数翻倍，总耗时线性翻倍。' },
    threads: { name: '多线程', tip: '4 条线程并行，总耗时约降为 1/4——但注意琥珀色的切换开销：线程数 = 并发能力，1 万并发就是 1 万条线程（C10K 问题），内存与切换先把机器拖垮。' },
    epoll: { name: 'IO 多路复用（事件循环）', tip: '单线程！所有 IO 等待完全重叠，总耗时 ≈ IO 一次 + 全部计算串行。CPU 在别人等待时一直在干活——这就是 asyncio / Nginx / Redis 的地基。' }
  };

  function render() {
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
    var p = params();
    var r = schedule(state.mode, p.n, p.cpu, p.io);
    state.result = r;

    $('nV').textContent = p.n;
    $('ioV').textContent = p.io + ' ms';
    $('cpuV').textContent = p.cpu + ' ms';

    $('mTotal').textContent = r.total + ' ms';
    $('mThreads').textContent = r.threads;
    $('mThreads').className = 'v' + (state.mode === 'threads' ? ' warn' : '');
    $('mSwitch').textContent = r.switches > 0 ? r.switches + ' 次（' + (r.switches * SWITCH_MS) + ' ms）' : '≈ 0';
    $('mSwitch').className = 'v' + (r.switches > 0 ? ' warn' : '');
    var util = r.total > 0 ? Math.round(r.busy * 100 / r.total) : 0;
    $('mUtil').textContent = util + '%';

    var chart = $('chart');
    chart.innerHTML = '';
    for (var i = 0; i < r.rows.length; i++) {
      var row = document.createElement('div');
      row.className = 'rrow';
      var lab = document.createElement('div');
      lab.className = 'rlabel';
      lab.textContent = '请求 ' + (i + 1);
      var track = document.createElement('div');
      track.className = 'track';
      r.rows[i].forEach(function (seg) {
        var d = document.createElement('div');
        d.className = 'seg ' + seg.type;
        d.style.left = (seg.t0 * 100 / r.total) + '%';
        d.style.width = Math.max((seg.t1 - seg.t0) * 100 / r.total, 0.6) + '%';
        track.appendChild(d);
      });
      row.appendChild(lab);
      row.appendChild(track);
      chart.appendChild(row);
    }
    var cursor = document.createElement('div');
    cursor.className = 'cursor';
    cursor.id = 'cursor';
    chart.appendChild(cursor);

    var mt = MODE_TEXT[state.mode];
    var other = state.mode === 'blocking' ? schedule('epoll', p.n, p.cpu, p.io)
              : schedule('blocking', p.n, p.cpu, p.io);
    var v = $('verdict');
    v.innerHTML = '<b>' + mt.name + '</b>：' + mt.tip +
      '<br><br><b>你观察到了什么：</b>同一批 ' + p.n + ' 个请求，本模式总耗时 <b>' + r.total + ' ms</b>，' +
      '而' + (state.mode === 'blocking' ? '事件循环' : '阻塞模式') + '需要 <b>' + other.total + ' ms</b>。' +
      '差距的来源不是"算得更快"，而是<b>等待不再占用执行者</b>。把 IO 等待滑块拉小、计算耗时拉大再对比——' +
      '你会发现 CPU 密集场景下事件循环的优势消失，这就是为什么 Python 里重计算要交给多进程。';
  }

  function play() {
    var r = state.result;
    if (!r) return;
    var cursor = shadow.getElementById('cursor');
    if (!cursor) return;
    if (state.raf) cancelAnimationFrame(state.raf);
    cursor.style.display = 'block';
    var start = null;
    var DURATION = Math.min(Math.max(r.total * 8, 800), 6000); // 播放时长 0.8–6 秒
    function frame(ts) {
      if (start === null) start = ts;
      var k = (ts - start) / DURATION;
      if (k >= 1) { cursor.style.left = 'calc(100% - 2px)'; state.raf = null; return; }
      cursor.style.left = 'calc(' + (k * 100) + '% - 1px)';
      state.raf = requestAnimationFrame(frame);
    }
    state.raf = requestAnimationFrame(frame);
  }

  var modeBtns = shadow.querySelectorAll('button.mode');
  modeBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      modeBtns.forEach(function (x) { x.className = 'mode'; });
      b.className = 'mode on';
      state.mode = b.getAttribute('data-m');
      render();
    });
  });
  ['n', 'io', 'cpu'].forEach(function (id) {
    $(id).addEventListener('input', render);
  });
  $('play').addEventListener('click', play);

  render();
};
