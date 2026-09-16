/* burn-rate-alert —— 多窗口燃烧率告警模拟器（卷08 §3.3）
 * 契约：注册到 window.DEMOS['burn-rate-alert']，Shadow DOM，样式内联，无外部依赖。
 * 设定 SLO 档位与背景错误率，注入一段"错误脉冲"（峰值错误率 × 持续时长）；
 * 模拟 48 小时逐分钟数据，按 Google SRE 工作簿的四档多窗口规则
 * （燃烧率 14.4/6/3/1，各配长短双窗口）逐档判定是否触发及检出延迟；
 * 结论区解释"为什么单一阈值告警不是漏报就是误报，多窗口多燃烧率才是答案"。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['burn-rate-alert'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var SLOS = [
    { label: '99%', value: 0.99 },
    { label: '99.9%', value: 0.999 },
    { label: '99.99%', value: 0.9999 }
  ];
  // Google SRE Workbook 推荐配置（针对 99.9% SLO，阈值 = 燃烧率 × 允许错误率）
  var TIERS = [
    { name: '快燃 · 立即叫人', burn: 14.4, longMin: 60, shortMin: 5, sev: 'page', color: '#dc2626' },
    { name: '中燃 · 立即叫人', burn: 6, longMin: 360, shortMin: 30, sev: 'page', color: '#d97706' },
    { name: '慢燃 · 工单跟进', burn: 3, longMin: 1440, shortMin: 120, sev: 'ticket', color: '#0f766e' },
    { name: '阴燃 · 每日巡检', burn: 1, longMin: 4320, shortMin: 360, sev: 'ticket', color: '#78716c' }
  ];
  var SIM_MIN = 48 * 60; // 模拟 48 小时

  var state = { series: null, pulseAt: 0 };

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    'h4{margin:14px 0 8px;font-size:13px;color:#1c1917;font-weight:600;}' +
    '.row{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px;align-items:flex-end;}' +
    '.ctl{display:flex;flex-direction:column;gap:3px;min-width:150px;flex:1;}' +
    '.ctl label{font-size:11px;color:#57534e;display:flex;justify-content:space-between;gap:8px;}' +
    '.ctl label b{color:#0f766e;font-variant-numeric:tabular-nums;}' +
    'input[type=range]{width:100%;accent-color:#0f766e;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;' +
    'padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button:hover{opacity:.88;}' +
    'table{border-collapse:collapse;width:100%;font-size:12px;margin-top:6px;}' +
    'th,td{padding:5px 8px;border-bottom:1px solid #e7e5e4;text-align:left;font-variant-numeric:tabular-nums;}' +
    'th{color:#57534e;font-weight:600;background:#fafaf9;}' +
    'tr.fire td{background:#fef2f2;color:#991b1b;font-weight:600;}' +
    'tr.quiet td{color:#78716c;}' +
    'canvas{width:100%;height:120px;display:block;border:1px solid #e7e5e4;border-radius:6px;' +
    'background:#fafaf9;margin-top:6px;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;' +
    'background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '.legend{display:flex;gap:12px;font-size:11px;color:#57534e;margin-top:4px;flex-wrap:wrap;}' +
    '.sw{display:inline-block;width:10px;height:10px;vertical-align:-1px;margin-right:4px;border-radius:2px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 多窗口燃烧率告警模拟器（卷08 §3.3：何时把人叫起来）</div>' +
    '  <h4>① 设定 SLO 与背景错误率</h4>' +
    '  <div class="row">' +
    '    <div class="ctl" style="max-width:220px"><label>SLO 档位 <b id="sloLabel">99.9%</b></label>' +
    '      <input id="slo" type="range" min="0" max="2" step="1" value="1"></div>' +
    '    <div class="ctl" style="max-width:220px"><label>背景错误率 <b id="bgLabel">0.05%</b></label>' +
    '      <input id="bg" type="range" min="0" max="4" step="1" value="0"></div>' +
    '  </div>' +
    '  <h4>② 注入错误脉冲（第 12 小时开始）</h4>' +
    '  <div class="row">' +
    '    <div class="ctl"><label>脉冲峰值错误率 <b id="peakLabel">2%</b></label>' +
    '      <input id="peak" type="range" min="0" max="9" step="1" value="3"></div>' +
    '    <div class="ctl"><label>持续时长 <b id="durLabel">60 分钟</b></label>' +
    '      <input id="dur" type="range" min="5" max="720" step="5" value="60"></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto"><button id="run">注入并模拟</button></div>' +
    '  </div>' +
    '  <canvas id="cv" width="760" height="120"></canvas>' +
    '  <div class="legend">' +
    '    <span><span class="sw" style="background:#0f766e"></span>每分钟错误率</span>' +
    '    <span><span class="sw" style="background:#dc2626"></span>快燃阈值（14.4×）</span>' +
    '    <span><span class="sw" style="background:#d97706"></span>中燃阈值（6×）</span>' +
    '  </div>' +
    '  <h4>③ 四档告警判定结果</h4>' +
    '  <table><thead><tr><th>档位</th><th>燃烧率阈值</th><th>长窗口</th><th>短窗口</th>' +
    '<th>级别</th><th>判定</th><th>检出延迟</th></tr></thead><tbody id="tb"></tbody></table>' +
    '  <div class="verdict" id="verdict">先点「注入并模拟」，观察同一个故障在不同档位下的命运。</div>' +
    '  <div class="note">规则（Google SRE 工作簿）：某档告警触发 = 短窗口错误率 ≥ 阈值 ×(1−SLO) ' +
    '且 长窗口错误率 ≥ 同一阈值。短窗口保证"检出快、复位快"，长窗口保证"不是毛刺"。' +
    '燃烧率 = 实际错误率 ÷ 允许错误率，燃烧率 14.4 意味着 2 天烧完 30 天预算。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };
  var BGS = [0.0005, 0.001, 0.002, 0.005, 0.01];
  var PEAKS = [0.002, 0.005, 0.01, 0.02, 0.05, 0.08, 0.12, 0.2, 0.35, 0.5];

  function slo() { return SLOS[parseInt($('slo').value, 10)]; }
  function bgErr() { return BGS[parseInt($('bg').value, 10)]; }
  function peakErr() { return PEAKS[parseInt($('peak').value, 10)]; }
  function durMin() { return parseInt($('dur').value, 10); }

  function simulate() {
    var start = 12 * 60, d = durMin(), peak = peakErr(), bg = bgErr();
    var s = new Array(SIM_MIN);
    for (var t = 0; t < SIM_MIN; t++) {
      var inPulse = t >= start && t < start + d;
      var base = inPulse ? peak : bg;
      // 加少量抖动，让曲线像真的
      s[t] = base * (0.9 + Math.random() * 0.2);
    }
    state.series = s; state.pulseAt = start;
  }

  function winAvg(s, end, len) {
    if (end < 0) return 0;
    var from = Math.max(0, end - len + 1), sum = 0, n = 0;
    for (var i = from; i <= end; i++) { sum += s[i]; n++; }
    return n ? sum / n : 0;
  }

  function judge() {
    var s = state.series, allowed = 1 - slo().value;
    var out = [];
    TIERS.forEach(function (tier) {
      var thr = tier.burn * allowed;
      var fireAt = -1;
      for (var t = state.pulseAt; t < SIM_MIN; t++) {
        if (winAvg(s, t, tier.shortMin) >= thr && winAvg(s, t, tier.longMin) >= thr) {
          fireAt = t; break;
        }
      }
      out.push({ tier: tier, fire: fireAt >= 0, delay: fireAt >= 0 ? fireAt - state.pulseAt + 1 : -1 });
    });
    return out;
  }

  function fmtDelay(m) {
    if (m >= 120) return (m / 60).toFixed(1) + ' 小时';
    return m + ' 分钟';
  }

  function draw() {
    var cv = $('cv'), ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return; // 极端环境（无 canvas 后端）下跳过绘图，不影响判定与结论
    var W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    if (!state.series) return;
    var s = state.series, allowed = 1 - slo().value;
    var maxV = Math.max(peakErr() * 1.15, 14.4 * allowed * 1.2);
    // 阈值线
    [[14.4, '#dc2626'], [6, '#d97706']].forEach(function (p) {
      var y = H - (p[0] * allowed / maxV) * (H - 14) - 4;
      ctx.strokeStyle = p[1]; ctx.setLineDash([4, 4]); ctx.beginPath();
      ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]);
    });
    // 错误率曲线
    ctx.strokeStyle = '#0f766e'; ctx.lineWidth = 1.4; ctx.beginPath();
    for (var t = 0; t < SIM_MIN; t += 4) {
      var x = (t / SIM_MIN) * W;
      var y = H - (Math.min(s[t], maxV) / maxV) * (H - 14) - 4;
      if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = '#78716c'; ctx.font = '10px sans-serif';
    ctx.fillText('0h', 4, H - 2);
    ctx.fillText('12h（脉冲开始）', (12 * 60 / SIM_MIN) * W, H - 2);
    ctx.fillText('48h', W - 26, H - 2);
  }

  function renderTable(res) {
    var tb = $('tb');
    tb.innerHTML = '';
    res.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.className = r.fire ? 'fire' : 'quiet';
      tr.innerHTML =
        '<td>' + r.tier.name + '</td>' +
        '<td>' + r.tier.burn + '×</td>' +
        '<td>' + (r.tier.longMin >= 1440 ? (r.tier.longMin / 1440) + ' 天' : (r.tier.longMin / 60) + ' 小时') + '</td>' +
        '<td>' + (r.tier.shortMin >= 60 ? (r.tier.shortMin / 60) + ' 小时' : r.tier.shortMin + ' 分钟') + '</td>' +
        '<td>' + (r.tier.sev === 'page' ? '☎ 叫人' : '✉ 工单') + '</td>' +
        '<td>' + (r.fire ? '触发' : '未触发') + '</td>' +
        '<td>' + (r.fire ? fmtDelay(r.delay) : '—') + '</td>';
      tb.appendChild(tr);
    });
  }

  function verdict(res) {
    var v = $('verdict');
    var allowed = (1 - slo().value) * 100;
    var burn = peakErr() / (1 - slo().value);
    var fired = res.filter(function (r) { return r.fire; });
    var lines = [];
    lines.push('允许错误率 = 1 − SLO = <b>' + allowed.toFixed(allowed < 0.1 ? 2 : 1) + '%</b>；' +
      '脉冲峰值 ' + (peakErr() * 100).toFixed(1) + '%，即燃烧率峰值 ≈ <b>' + burn.toFixed(1) + '×</b>，' +
      '持续 ' + durMin() + ' 分钟。');
    if (fired.length === 0) {
      v.className = 'verdict';
      lines.push('四档全部未触发：脉冲太短或太弱，各档的长短窗口都没能同时越线。' +
        '这正是设计意图——<b>无关紧要的毛刺不该把人叫起来</b>。试试拉长持续时长或调高峰值。');
    } else {
      var fast = fired[0];
      v.className = fast.tier.sev === 'page' ? 'verdict bad' : 'verdict';
      lines.push('命中 ' + fired.length + ' 档。最快的是「' + fast.tier.name + '」，' +
        '故障开始 <b>' + fmtDelay(fast.delay) + '</b> 后告警' +
        (fast.tier.sev === 'page' ? '（电话/IM 叫人）' : '（进工单队列，工作时间处理）') + '。');
      var missedSlow = res.filter(function (r) { return !r.fire && r.tier.burn <= 3; });
      if (missedSlow.length > 0) {
        lines.push('注意：' + missedSlow.map(function (r) { return '「' + r.tier.name + '」'; }).join('、') +
          '未触发——脉冲在它的长窗口内被稀释到阈值之下。<b>快档抓突发，慢档抓阴燃</b>，' +
          '缺了任何一档，告警网就有洞：只有快档的系统对"每天慢慢烧 3%"的慢性病毫无知觉。');
      }
    }
    v.innerHTML = lines.join('<br>');
  }

  function refreshLabels() {
    $('sloLabel').textContent = slo().label;
    $('bgLabel').textContent = (bgErr() * 100).toFixed(2) + '%';
    $('peakLabel').textContent = (peakErr() * 100).toFixed(1) + '%';
    $('durLabel').textContent = durMin() + ' 分钟';
  }

  ['slo', 'bg', 'peak', 'dur'].forEach(function (id) {
    $(id).addEventListener('input', refreshLabels);
  });
  $('run').addEventListener('click', function () {
    simulate();
    draw();
    var res = judge();
    renderTable(res);
    verdict(res);
  });

  refreshLabels();
};
