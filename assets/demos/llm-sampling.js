/* llm-sampling —— 采样机制可视化（篇01 §1.4）
 * 滑块调 Temperature / Top-p，实时重绘 token 概率分布，点"采样一次"观察低温集中、高温发散。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['llm-sampling'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  // 虚拟 token 及其原始 logit（模拟模型对下一个词的"打分"）
  var TOKENS = [
    { t: '增长', logit: 3.2 }, { t: '下降', logit: 2.6 }, { t: '持平', logit: 2.1 },
    { t: '波动', logit: 1.7 }, { t: '下滑', logit: 1.3 }, { t: '回升', logit: 1.0 },
    { t: '暴涨', logit: 0.6 }, { t: '暴跌', logit: 0.3 }, { t: '稳定', logit: 0.0 },
    { t: '萎缩', logit: -0.5 }, { t: '翻倍', logit: -1.0 }, { t: '崩盘', logit: -1.8 }
  ];

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;letter-spacing:.02em;}' +
    '.controls{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:14px;}' +
    '.ctl{display:flex;flex-direction:column;gap:4px;min-width:180px;flex:1;}' +
    '.ctl label{font-size:12px;color:#57534e;display:flex;justify-content:space-between;}' +
    '.ctl label b{color:#0f766e;font-variant-numeric:tabular-nums;}' +
    'input[type=range]{width:100%;accent-color:#0f766e;}' +
    '.chart{display:flex;align-items:flex-end;gap:6px;height:180px;border-bottom:1px solid #e5e1d8;padding-top:8px;}' +
    '.bar-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;position:relative;}' +
    '.bar{width:100%;max-width:46px;background:#99d5cf;border-radius:4px 4px 0 0;transition:height .18s ease,background .15s;position:relative;}' +
    '.bar.filtered{background:#e7e5e4;}' +
    '.bar.hit{background:#0f766e;}' +
    '.count{position:absolute;top:-16px;left:50%;transform:translateX(-50%);font-size:10px;color:#0f766e;font-variant-numeric:tabular-nums;white-space:nowrap;}' +
    '.pct{position:absolute;bottom:-16px;left:50%;transform:translateX(-50%);font-size:10px;color:#78716c;font-variant-numeric:tabular-nums;white-space:nowrap;}' +
    '.tok{margin-top:20px;font-size:11px;color:#57534e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}' +
    '.row{display:flex;gap:16px;margin-top:26px;flex-wrap:wrap;}' +
    '.panel{flex:1;min-width:200px;}' +
    '.panel h4{margin:0 0 6px;font-size:12px;color:#57534e;font-weight:600;}' +
    '.logprobs{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.7;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;min-height:96px;}' +
    '.logprobs .dim{color:#a8a29e;}' +
    'button{background:#0f766e;color:#fff;border:none;border-radius:6px;padding:7px 16px;font-size:13px;cursor:pointer;}' +
    'button:hover{background:#115e59;}' +
    'button.ghost{background:#fff;color:#0f766e;border:1px solid #0f766e;}' +
    '.hist{font-size:12px;color:#57534e;line-height:1.8;word-break:break-all;min-height:40px;}' +
    '.hist .chip{display:inline-block;background:#f0fdfa;border:1px solid #99d5cf;border-radius:4px;padding:0 6px;margin:1px 2px;font-size:11px;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:10px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 采样机制可视化：Temperature 与 Top-p 如何改变下一个 Token 的分布（篇01 §1.4）</div>' +
    '  <div class="controls">' +
    '    <div class="ctl"><label>Temperature <b id="tv">1.00</b></label>' +
    '      <input id="temp" type="range" min="0.1" max="2" step="0.05" value="1"></div>' +
    '    <div class="ctl"><label>Top-p（核采样） <b id="pv">1.00</b></label>' +
    '      <input id="topp" type="range" min="0.1" max="1" step="0.05" value="1"></div>' +
    '    <div class="ctl" style="flex:0 0 auto;justify-content:flex-end;flex-direction:row;gap:8px;align-items:flex-end;">' +
    '      <button id="sample">采样一次</button>' +
    '      <button id="x10" class="ghost">连采 20 次</button>' +
    '      <button id="reset" class="ghost">重置计数</button>' +
    '    </div>' +
    '  </div>' +
    '  <div class="chart" id="chart"></div>' +
    '  <div class="row">' +
    '    <div class="panel"><h4>logprobs 面板（Top 5，经 T / Top-p 调整后）</h4><div class="logprobs" id="lp"></div></div>' +
    '    <div class="panel"><h4>采样历史（条上数字 = 被抽中次数）</h4><div class="hist" id="hist"><span class="dim" style="color:#a8a29e">尚未采样。把 Temperature 拉到 0.2 连采 20 次，再拉到 1.8 对比。</span></div></div>' +
    '  </div>' +
    '  <div class="note">要点：采样参数只改变分布的形状——T→0 收敛到最大概率 token，T 越大越发散；Top-p 直接砍掉长尾。它们不能"变出"模型不会的东西。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };
  var counts = TOKENS.map(function () { return 0; });
  var history = [];
  var current = null; // 当前分布

  function softmax(logits, T) {
    var scaled = logits.map(function (l) { return l / T; });
    var mx = Math.max.apply(null, scaled);
    var exps = scaled.map(function (s) { return Math.exp(s - mx); });
    var sum = exps.reduce(function (a, b) { return a + b; }, 0);
    return exps.map(function (e) { return e / sum; });
  }

  function computeDist() {
    var T = parseFloat($('temp').value);
    var p = parseFloat($('topp').value);
    var probs = softmax(TOKENS.map(function (x) { return x.logit; }), T);
    // Top-p：按概率降序取累计达 p 的最小集合
    var order = probs.map(function (pr, i) { return { i: i, p: pr }; })
      .sort(function (a, b) { return b.p - a.p; });
    var cum = 0, keep = {};
    for (var k = 0; k < order.length; k++) {
      keep[order[k].i] = true;
      cum += order[k].p;
      if (cum >= p) break;
    }
    var keptSum = 0;
    probs.forEach(function (pr, i) { if (keep[i]) keptSum += pr; });
    return probs.map(function (pr, i) {
      return { t: TOKENS[i].t, p: keep[i] ? pr / keptSum : 0, kept: !!keep[i] };
    });
  }

  function render() {
    current = computeDist();
    $('tv').textContent = parseFloat($('temp').value).toFixed(2);
    $('pv').textContent = parseFloat($('topp').value).toFixed(2);
    var maxP = Math.max.apply(null, current.map(function (d) { return d.p; }).concat([0.01]));
    var chart = $('chart');
    chart.innerHTML = '';
    current.forEach(function (d, i) {
      var col = document.createElement('div');
      col.className = 'bar-col';
      var h = Math.round((d.p / maxP) * 148);
      var bar = document.createElement('div');
      bar.className = 'bar' + (d.kept ? '' : ' filtered');
      bar.style.height = Math.max(h, d.kept ? 3 : 2) + 'px';
      bar.dataset.idx = i;
      if (counts[i] > 0) {
        var c = document.createElement('span');
        c.className = 'count';
        c.textContent = '×' + counts[i];
        bar.appendChild(c);
      }
      var pct = document.createElement('span');
      pct.className = 'pct';
      pct.textContent = (d.p * 100).toFixed(1) + '%';
      var tok = document.createElement('div');
      tok.className = 'tok';
      tok.textContent = d.t;
      col.appendChild(bar); col.appendChild(pct); col.appendChild(tok);
      chart.appendChild(col);
    });
    // logprobs 面板
    var top = current.slice().sort(function (a, b) { return b.p - a.p; }).slice(0, 5);
    $('lp').innerHTML = top.map(function (d) {
      var lp = d.p > 0 ? Math.log(d.p).toFixed(3) : '-inf';
      return '<div>' + d.t + '  <span class="dim">p=' + d.p.toFixed(4) + '  logprob=' + lp + '</span></div>';
    }).join('') + '<div class="dim">核内累计概率 ' +
      (current.reduce(function (a, d) { return a + d.p; }, 0) * 100).toFixed(1) +
      '% · 保留 ' + current.filter(function (d) { return d.kept; }).length + '/' + current.length + ' 个 token</div>';
  }

  function sampleOnce() {
    var r = Math.random(), cum = 0, picked = current.length - 1;
    for (var i = 0; i < current.length; i++) {
      cum += current[i].p;
      if (r <= cum) { picked = i; break; }
    }
    counts[picked]++;
    history.push(TOKENS[picked].t);
    render();
    var bar = shadow.querySelector('.bar[data-idx="' + picked + '"]');
    if (bar) { bar.classList.add('hit'); }
    var h = $('hist');
    h.innerHTML = history.slice(-40).map(function (t) {
      return '<span class="chip">' + t + '</span>';
    }).join('');
  }

  $('temp').addEventListener('input', render);
  $('topp').addEventListener('input', render);
  $('sample').addEventListener('click', sampleOnce);
  $('x10').addEventListener('click', function () { for (var i = 0; i < 20; i++) sampleOnce(); });
  $('reset').addEventListener('click', function () {
    counts = TOKENS.map(function () { return 0; });
    history = [];
    render();
    $('hist').innerHTML = '<span style="color:#a8a29e">已重置。</span>';
  });

  render();
};
