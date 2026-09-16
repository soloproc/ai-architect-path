/* mq-peak-shaving —— MQ 削峰填谷模拟器（卷02）
 * 契约：注册到 window.DEMOS['mq-peak-shaving']，Shadow DOM，无外部依赖。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['mq-peak-shaving'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var css = ''
    + ':host{display:block;font-family:inherit;}'
    + '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}'
    + '.cap{font-size:12px;color:#8a8578;margin-bottom:12px;}'
    + '.controls{display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin-bottom:12px;}'
    + '.ctl{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#555;}'
    + '.ctl .val{font-weight:600;color:#0f766e;}'
    + 'input[type=range]{-webkit-appearance:none;appearance:none;width:200px;height:4px;border-radius:2px;background:#e5e1d8;outline:none;cursor:pointer;}'
    + 'input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:15px;height:15px;border-radius:50%;background:#0f766e;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.25);cursor:pointer;}'
    + 'input[type=range]::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:#0f766e;border:2px solid #fff;cursor:pointer;}'
    + 'label.sw{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#333;cursor:pointer;user-select:none;font-weight:600;}'
    + 'input[type=checkbox]{accent-color:#0f766e;width:16px;height:16px;cursor:pointer;}'
    + 'button{padding:7px 14px;border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;font:inherit;font-size:13px;cursor:pointer;transition:background .15s,transform .1s;}'
    + 'button:hover:not(:disabled){background:#0b5c55;}'
    + 'button:active:not(:disabled){transform:scale(.97);}'
    + 'button:disabled{opacity:.45;cursor:not-allowed;}'
    + 'button.ghost{background:#fff;color:#0f766e;}'
    + 'button.ghost:hover:not(:disabled){background:#e6f4f2;}'
    + '.stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;}'
    + '.stat{flex:1;min-width:120px;border:1px solid #e5e1d8;border-radius:8px;padding:8px 10px;background:#faf9f6;}'
    + '.stat .k{font-size:11px;color:#8a8578;}'
    + '.stat .v{font-size:18px;font-weight:700;color:#333;margin-top:2px;}'
    + '.stat .v.warn{color:#dc2626;}'
    + '.stat .v.ok{color:#0f766e;}'
    + 'canvas{display:block;width:100%;height:auto;border:1px solid #eee9dd;border-radius:6px;background:#fff;}'
    + '.legend{font-size:11px;color:#8a8578;margin-top:6px;}'
    + '.legend b.r{color:#dc2626;} .legend b.g{color:#0f766e;} .legend b.o{color:#d97706;}';

  var html = ''
    + '<div class="wrap">'
    + '  <div class="cap">模拟器 · MQ 削峰填谷。拖动滑块制造秒杀流量尖峰，对比「直连 DB」与「MQ 缓冲」两种模式下后端的实际处理压力、排队长度与响应延迟。后端恒定处理能力：800 req/s。</div>'
    + '  <div class="controls">'
    + '    <div class="ctl">瞬时流量（秒杀尖峰）<input type="range" id="rate" min="200" max="5000" step="100" value="3000"/><span class="val" id="rateVal">3000 req/s</span></div>'
    + '    <label class="sw"><input type="checkbox" id="useMq" checked/> 启用 MQ 削峰</label>'
    + '    <button id="burst">⚡ 发起 8 秒秒杀</button>'
    + '    <button id="reset" class="ghost">重置</button>'
    + '  </div>'
    + '  <div class="stats">'
    + '    <div class="stat"><div class="k">后端实际处理</div><div class="v" id="sProc">0 req/s</div></div>'
    + '    <div class="stat"><div class="k">MQ 排队长度</div><div class="v" id="sQueue">0</div></div>'
    + '    <div class="stat"><div class="k">平均响应延迟</div><div class="v" id="sLat">0 ms</div></div>'
    + '    <div class="stat"><div class="k">失败/超时请求</div><div class="v" id="sFail">0</div></div>'
    + '  </div>'
    + '  <canvas id="cv" width="760" height="260"></canvas>'
    + '  <div class="legend">灰线：到达流量；<b class="g">绿线：后端实际处理</b>；<b class="o">橙线：MQ 排队长度（右轴）</b>。关闭 MQ 时超过 800 req/s 的部分直接 <b class="r">失败（红）</b>；开启 MQ 时尖峰被摊平到峰后消费——这就是「削峰填谷」。</div>'
    + '</div>';

  var style = document.createElement('style');
  style.textContent = css;
  var root = document.createElement('div');
  root.innerHTML = html;
  shadow.appendChild(style);
  shadow.appendChild(root);

  var $ = function (s) { return root.querySelector(s); };
  var cv = $('#cv'), ctx = cv.getContext('2d');
  var rateInput = $('#rate'), rateVal = $('#rateVal');
  var useMq = $('#useMq');
  var CAP = 800;              // 后端恒定处理能力 req/s
  var TICK = 100;             // ms per tick
  var TPS = 10;               // ticks per second
  var WINDOW = 40;            // seconds shown
  var N = WINDOW * TPS;       // ticks shown

  rateInput.addEventListener('input', function () { rateVal.textContent = rateInput.value + ' req/s'; });

  var data = []; // {t, arrival, proc, queue, fail}
  var queue = 0, fails = 0, latSum = 0, latCnt = 0;
  var simT = 0, burstUntil = -1, timer = null;

  function reset() {
    data = []; queue = 0; fails = 0; latSum = 0; latCnt = 0; simT = 0; burstUntil = -1;
    draw();
    updateStats(0, 0, 0);
  }

  function tick() {
    var inBurst = simT < burstUntil;
    var arrival = inBurst ? (parseInt(rateInput.value, 10) / TPS) : (80 / TPS); // 平时 80 req/s 背景流量
    var proc, fail = 0, lat;
    if (useMq.checked) {
      queue += arrival;
      proc = Math.min(CAP / TPS, queue);
      queue -= proc;
      // 延迟 ≈ 排队长度 / 消费速率
      lat = Math.round((queue / (CAP / TPS)) * TICK);
      latSum += lat; latCnt++;
    } else {
      proc = Math.min(CAP / TPS, arrival);
      var overflow = arrival - proc;
      if (overflow > 0) { fail = overflow; fails += Math.round(fail); }
      lat = arrival > CAP / TPS ? Math.round(500 + (arrival - CAP / TPS) * 2) : 50;
      latSum += lat; latCnt++;
    }
    data.push({ arrival: arrival, proc: proc, queue: queue, fail: fail });
    if (data.length > N) data.shift();
    simT++;
    draw();
    updateStats(Math.round(proc * TPS), Math.round(queue), Math.round(latSum / Math.max(1, latCnt)));
  }

  function updateStats(procR, q, avgLat) {
    var sProc = $('#sProc'), sQueue = $('#sQueue'), sLat = $('#sLat'), sFail = $('#sFail');
    sProc.textContent = procR + ' req/s';
    sProc.className = 'v ' + (procR >= CAP ? 'warn' : 'ok');
    sQueue.textContent = useMq.checked ? String(q) : '—（无 MQ）';
    sQueue.className = 'v ' + (q > CAP * 3 ? 'warn' : '');
    sLat.textContent = avgLat + ' ms';
    sLat.className = 'v ' + (avgLat > 1000 ? 'warn' : avgLat > 200 ? '' : 'ok');
    sFail.textContent = String(fails);
    sFail.className = 'v ' + (fails > 0 ? 'warn' : 'ok');
  }

  function draw() {
    var W = cv.width, H = cv.height;
    var padL = 46, padR = 46, padT = 14, padB = 26;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    ctx.clearRect(0, 0, W, H);
    var maxRate = Math.max(1200, parseInt(rateInput.value, 10) * 1.1);
    var maxQ = Math.max(CAP * 4, queue * 1.2);
    function x(i) { return padL + plotW * i / (N - 1); }
    function yRate(v) { return padT + plotH * (1 - v * TPS / maxRate); }
    function yQ(v) { return padT + plotH * (1 - v / maxQ); }
    // grid + axes labels
    ctx.strokeStyle = '#f2efe8'; ctx.fillStyle = '#8a8578'; ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    [0, 0.5, 1].forEach(function (f) {
      var yy = padT + plotH * f;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      ctx.fillText(Math.round(maxRate * (1 - f)) + '', padL - 5, yy + 3);
      ctx.textAlign = 'left';
      ctx.fillText(Math.round(maxQ * (1 - f)) + '', W - padR + 5, yy + 3);
      ctx.textAlign = 'right';
    });
    // capacity line
    ctx.strokeStyle = '#dc2626'; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(padL, yRate(CAP)); ctx.lineTo(W - padR, yRate(CAP)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#dc2626'; ctx.textAlign = 'left';
    ctx.fillText('DB 上限 ' + CAP + ' req/s', padL + 6, yRate(CAP) - 5);
    // series
    function series(get, yFn, color, fill) {
      if (data.length < 2) return;
      ctx.beginPath();
      for (var i = 0; i < data.length; i++) {
        var xx = x(N - data.length + i), yy = yFn(get(data[i]));
        if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      if (fill) {
        ctx.save();
        ctx.lineTo(x(N - 1), padT + plotH); ctx.lineTo(x(N - data.length), padT + plotH);
        ctx.closePath();
        ctx.globalAlpha = 0.12; ctx.fillStyle = color; ctx.fill();
        ctx.restore();
        ctx.beginPath();
        for (var j = 0; j < data.length; j++) {
          var x2 = x(N - data.length + j), y2 = yFn(get(data[j]));
          if (j === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2);
        }
      }
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
    }
    series(function (d) { return d.arrival; }, yRate, '#9a958a', false);
    series(function (d) { return d.proc; }, yRate, '#0f766e', true);
    if (useMq.checked) series(function (d) { return d.queue; }, yQ, '#d97706', false);
    // failures as red dots
    ctx.fillStyle = '#dc2626';
    for (var k = 0; k < data.length; k++) {
      if (data[k].fail > 0.5) {
        ctx.beginPath();
        ctx.arc(x(N - data.length + k), yRate(data[k].arrival), 2.4, 0, 6.283);
        ctx.fill();
      }
    }
  }

  $('#burst').addEventListener('click', function () {
    burstUntil = simT + 8 * TPS;
    if (!timer) timer = setInterval(tick, TICK);
  });
  $('#reset').addEventListener('click', function () {
    if (timer) { clearInterval(timer); timer = null; }
    reset();
  });
  useMq.addEventListener('change', function () {
    if (!useMq.checked) queue = 0;
    draw();
  });

  reset();
};
