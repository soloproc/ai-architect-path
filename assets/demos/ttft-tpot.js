/* ttft-tpot —— 推理容量曲线交互 + 自建 vs 云 API 成本计算器（卷06 §3.3 / §4）
 * 滑块调并发数，基于简化的 Continuous Batching 排队模型实时绘制 TTFT / TPOT / 吞吐曲线，
 * 标出 SLA 拐点；成本计算器对比两种方案月成本。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['ttft-tpot'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  // ===== 简化容量模型（教学用，参数与卷06 示例同量级）=====
  // 单请求 decode 速率 r0=20 tok/s；聚合吞吐饱和上限 S=1600 tok/s（约 c=80 处出现拐点）
  // 单请求 prefill 1500 tok，prefill 吞吐 P=4000 tok/s → 排队使 TTFT 随并发线性上升
  var R0 = 20, S_MAX = 1600, PREFILL_TOK = 1500, P_RATE = 4000, TPOT_BASE = 50;
  function ttft(c) { return 0.15 + c * PREFILL_TOK / P_RATE / 8; }        // 秒，含排队
  function tpot(c) { return TPOT_BASE * Math.max(1, c * R0 / S_MAX); }     // 毫秒
  function tput(c) { return Math.min(c * R0, S_MAX); }                     // tok/s
  function slaKnee() { // TTFT_P95 突破 2s 的并发
    for (var c = 1; c <= 256; c++) { if (ttft(c) > 2) return c; }
    return 256;
  }

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    'h4{margin:14px 0 8px;font-size:13px;color:#1c1917;font-weight:600;}' +
    '.ctl{display:flex;flex-direction:column;gap:3px;min-width:150px;flex:1;}' +
    '.ctl label{font-size:11px;color:#57534e;display:flex;justify-content:space-between;gap:8px;}' +
    '.ctl label b{color:#0f766e;font-variant-numeric:tabular-nums;}' +
    'input[type=range]{width:100%;accent-color:#0f766e;}' +
    'input[type=number],select{border:1px solid #e5e1d8;border-radius:6px;padding:5px 8px;font-size:12px;width:100%;box-sizing:border-box;font-family:inherit;}' +
    '.row{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;}' +
    'canvas{width:100%;height:260px;display:block;}' +
    '.metrics{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;}' +
    '.metric{flex:1;min-width:120px;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;}' +
    '.metric .k{font-size:11px;color:#78716c;}' +
    '.metric .v{font-size:18px;font-weight:600;color:#0f766e;font-variant-numeric:tabular-nums;}' +
    '.metric .v.warn{color:#dc2626;}' +
    '.legend{display:flex;gap:14px;font-size:11px;color:#57534e;margin-top:6px;flex-wrap:wrap;}' +
    '.sw{display:inline-block;width:14px;height:3px;vertical-align:2px;margin-right:4px;border-radius:2px;}' +
    '.verdict{margin-top:10px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 推理容量曲线与"自建 vs 云 API"成本计算器（卷06 §3.3 / §4.1）</div>' +
    '  <h4>① 并发-容量曲线（简化 Continuous Batching 排队模型）</h4>' +
    '  <div class="row">' +
    '    <div class="ctl"><label>并发数 <b id="cv">8</b></label>' +
    '      <input id="conc" type="range" min="1" max="128" step="1" value="8"></div>' +
    '  </div>' +
    '  <canvas id="chart" width="720" height="260"></canvas>' +
    '  <div class="legend">' +
    '    <span><span class="sw" style="background:#0f766e"></span>TTFT（秒，左轴）</span>' +
    '    <span><span class="sw" style="background:#d97706"></span>TPOT（毫秒，右轴）</span>' +
    '    <span><span class="sw" style="background:#2563eb"></span>聚合吞吐（tok/s，右轴 ×10）</span>' +
    '    <span><span style="color:#dc2626">┆</span>SLA 拐点（TTFT_P95 &gt; 2s）</span>' +
    '  </div>' +
    '  <div class="metrics">' +
    '    <div class="metric"><div class="k">TTFT（当前并发）</div><div class="v" id="mTtft">-</div></div>' +
    '    <div class="metric"><div class="k">TPOT</div><div class="v" id="mTpot">-</div></div>' +
    '    <div class="metric"><div class="k">聚合吞吐</div><div class="v" id="mTput">-</div></div>' +
    '    <div class="metric"><div class="k">SLA 拐点（本模型）</div><div class="v" id="mKnee">-</div></div>' +
    '  </div>' +
    '  <h4>② 自建 vs 云 API 月成本计算器</h4>' +
    '  <div class="row">' +
    '    <div class="ctl"><label>日 Token 量（百万）</label><input id="dailyM" type="number" value="50" min="1" step="1"></div>' +
    '    <div class="ctl"><label>模型档位</label><select id="tier">' +
    '      <option value="7b">7B 量化（轻量任务）</option>' +
    '      <option value="14b" selected>14B（SQL 生成主力）</option>' +
    '      <option value="32b">32B（报告生成）</option>' +
    '    </select></div>' +
    '    <div class="ctl"><label>云 API 单价（元/百万 token，混合价）</label><input id="cloudPrice" type="number" value="8" min="0.1" step="0.5"></div>' +
    '    <div class="ctl"><label>GPU 实例（元/小时）</label><input id="gpuPrice" type="number" value="25" min="1" step="1"></div>' +
    '    <div class="ctl"><label>单实例实测吞吐（tok/s）</label><input id="instTput" type="number" value="2000" min="100" step="100"></div>' +
    '    <div class="ctl"><label>平均利用率</label><select id="util">' +
    '      <option value="0.2">20%（波峰波谷大）</option>' +
    '      <option value="0.4" selected>40%（典型）</option>' +
    '      <option value="0.6">60%（削峰填谷好）</option>' +
    '      <option value="0.8">80%（接近打满）</option>' +
    '    </select></div>' +
    '  </div>' +
    '  <div class="verdict" id="verdict"></div>' +
    '  <div class="note">模型是教学简化：真实拐点必须用 bench_ttft.py 压测实测（容量曲线随模型、量化、max-num-seqs 变化）。成本公式见卷06 §4.1：自建每百万 token 成本 = 实例时价 × 1e6 / (吞吐 × 3600 × 利用率)。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };
  var cv = $('chart');
  var ctx = cv.getContext('2d');

  // 档位影响自建吞吐折算（大模型同卡吞吐更低）
  var TIER_FACTOR = { '7b': 1.4, '14b': 1.0, '32b': 0.45 };

  function draw() {
    var cur = parseInt($('conc').value, 10);
    $('cv').textContent = cur;
    var W = cv.width, H = cv.height;
    var padL = 46, padR = 46, padT = 14, padB = 28;
    var pw = W - padL - padR, ph = H - padT - padB;
    var CMAX = 128;
    var T_MAX = 3, R_MAX = Math.max(200, S_MAX / 100 * 10); // 右轴：TPOT ms 与吞吐/10 共用
    var knee = slaKnee();

    function x(c) { return padL + (c - 1) / (CMAX - 1) * pw; }
    function yL(v) { return padT + ph - Math.min(v / T_MAX, 1) * ph; }
    function yR(v) { return padT + ph - Math.min(v / R_MAX, 1) * ph; }

    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px sans-serif';
    // 网格 + 坐标
    ctx.strokeStyle = '#e5e1d8'; ctx.fillStyle = '#a8a29e';
    for (var g = 0; g <= 3; g++) {
      var yy = padT + ph - g / 3 * ph;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      ctx.fillText((g * T_MAX / 3).toFixed(1) + 's', 6, yy + 3);
      ctx.fillText(Math.round(g * R_MAX / 3) + '', W - padR + 6, yy + 3);
    }
    for (var c = 1; c <= CMAX; c += 16) {
      ctx.fillText(String(c === 1 ? 1 : c), x(c) - 4, H - 10);
    }
    ctx.fillText('并发 →', W / 2 - 16, H - 10);
    // SLA 拐点竖线
    ctx.strokeStyle = '#dc2626'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x(knee), padT); ctx.lineTo(x(knee), padT + ph); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#dc2626';
    ctx.fillText('SLA 拐点 c=' + knee, Math.min(x(knee) + 4, W - 90), padT + 12);
    // 曲线
    function plot(fn, yFn, color) {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      for (var c = 1; c <= CMAX; c++) {
        var px = x(c), py = yFn(fn(c));
        if (c === 1) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke(); ctx.lineWidth = 1;
    }
    plot(ttft, yL, '#0f766e');
    plot(tpot, yR, '#d97706');
    plot(function (c) { return tput(c) / 10; }, yR, '#2563eb');
    // 当前并发竖线
    ctx.strokeStyle = '#1c1917'; ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.moveTo(x(cur), padT); ctx.lineTo(x(cur), padT + ph); ctx.stroke();
    ctx.globalAlpha = 1;

    // 指标卡
    var t = ttft(cur), p = tpot(cur), th = tput(cur);
    $('mTtft').textContent = t.toFixed(2) + ' s';
    $('mTtft').className = 'v' + (t > 2 ? ' warn' : '');
    $('mTpot').textContent = p.toFixed(0) + ' ms';
    $('mTpot').className = 'v' + (p > 100 ? ' warn' : '');
    $('mTput').textContent = th.toFixed(0) + ' tok/s';
    $('mKnee').textContent = 'c = ' + knee;

    calc();
  }

  function calc() {
    var dailyM = parseFloat($('dailyM').value) || 0;
    var tier = $('tier').value;
    var cloudPrice = parseFloat($('cloudPrice').value) || 0;
    var gpuPrice = parseFloat($('gpuPrice').value) || 0;
    var instTput = (parseFloat($('instTput').value) || 1) * TIER_FACTOR[tier];
    var util = parseFloat($('util').value);

    var monthM = dailyM * 30;
    var cloudCost = monthM * cloudPrice;
    // 自建：每百万 token 成本 = 实例时价 × 1e6 / (吞吐 × 3600 × 利用率)
    var selfPerM = gpuPrice * 1e6 / (instTput * 3600 * util);
    var selfCost = monthM * selfPerM;
    // 容量校验：月 token 量需要的实例数
    var needTput = dailyM * 1e6 / 86400 / util;
    var instances = Math.max(1, Math.ceil(needTput / instTput));
    var breakevenM = (gpuPrice * 24 * 30 * instances) / cloudPrice; // 月百万 token 平衡点

    var cheaper = selfCost < cloudCost ? 'self' : 'cloud';
    $('verdict').innerHTML =
      '月 Token 量 <b>' + monthM.toFixed(0) + '</b> 百万 · ' +
      '云 API 月成本 <b>' + cloudCost.toFixed(0) + '</b> 元 · ' +
      '自建月成本 <b>' + selfCost.toFixed(0) + '</b> 元' +
      '（折合 ' + selfPerM.toFixed(2) + ' 元/百万 token，需 ' + instances + ' 个实例）<br>' +
      (cheaper === 'self'
        ? '✅ 当前用量下<b>自建更省</b>，月省约 ' + (cloudCost - selfCost).toFixed(0) + ' 元。'
        : '☁️ 当前用量下<b>云 API 更省</b>，自建单位成本被利用率摊薄不足拖累。') +
      '<br>盈亏平衡点：月用量约 <b>' + breakevenM.toFixed(0) + '</b> 百万 token（日均 ' +
      (breakevenM / 30).toFixed(1) + ' 百万）——低于它按需付费划算，高于它且数据有合规要求时，自建开始占优。';
  }

  ['conc'].forEach(function (id) { $(id).addEventListener('input', draw); });
  ['dailyM', 'tier', 'cloudPrice', 'gpuPrice', 'instTput', 'util'].forEach(function (id) {
    $(id).addEventListener('input', calc);
  });

  // 高 DPI 适配
  function fitCanvas() {
    var ratio = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 720;
    cv.width = w * ratio;
    cv.height = 260 * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // 统一用 CSS 像素坐标
    cv.width = w; cv.height = 260;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    draw();
  }
  fitCanvas();
};
