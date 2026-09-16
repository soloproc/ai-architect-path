/* serial-availability —— 串联可用性计算器（卷08 §2.4）
 * 契约：注册到 window.DEMOS['serial-availability']，Shadow DOM，样式内联，无外部依赖。
 * 以 RetailHub 下单链路为默认拓扑：网关→订单服务→Redis→PostgreSQL→推理服务。
 * 每个环节可调可用性档位（99%~99.99%），可勾选"双活并联"（1-(1-a)^2）；
 * 实时计算链路总可用性（连乘）、等效月停机时间、最薄弱一环；
 * 结论区演示 0.999^n 的衰减规律与"并联冗余如何救回一个 9"。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['serial-availability'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var MONTH_MIN = 30 * 24 * 60; // 43200 分钟
  var PRESET = [
    { name: 'API 网关', a: 0.9995 },
    { name: '订单服务', a: 0.999 },
    { name: 'Redis 缓存', a: 0.999 },
    { name: 'PostgreSQL', a: 0.9995 },
    { name: '推理服务', a: 0.995 }
  ];
  var POOL = ['MQ', '报表服务', '库存服务', 'Embedding 服务', '对象存储'];
  var LEVELS = [0.99, 0.995, 0.999, 0.9995, 0.9999];

  var hops = PRESET.map(function (h) { return { name: h.name, a: h.a, dual: false }; });
  var poolIdx = 0;

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    '.hop{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #e7e5e4;' +
    'border-radius:6px;margin-bottom:6px;background:#fafaf9;flex-wrap:wrap;}' +
    '.hop .nm{width:110px;font-size:13px;font-weight:600;color:#44403c;}' +
    '.hop input[type=range]{flex:1;min-width:120px;accent-color:#0f766e;}' +
    '.hop .av{width:64px;font-size:13px;color:#0f766e;font-weight:600;text-align:right;font-variant-numeric:tabular-nums;}' +
    '.hop .dt{width:86px;font-size:11px;color:#78716c;text-align:right;font-variant-numeric:tabular-nums;}' +
    '.chk{display:flex;align-items:center;gap:4px;font-size:11px;color:#57534e;white-space:nowrap;}' +
    '.chk input{accent-color:#d97706;}' +
    '.btns{display:flex;gap:8px;margin:10px 0;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;' +
    'padding:5px 12px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button:hover{opacity:.88;}' +
    'button:disabled{opacity:.4;cursor:not-allowed;}' +
    '.metrics{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 6px;}' +
    '.metric{flex:1;min-width:120px;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;}' +
    '.metric .k{font-size:11px;color:#78716c;}' +
    '.metric .v{font-size:18px;font-weight:600;color:#0f766e;font-variant-numeric:tabular-nums;}' +
    '.metric .v.warn{color:#d97706;}' +
    '.metric .v.bad{color:#dc2626;}' +
    '.bars{margin:8px 0;}' +
    '.brow{display:flex;align-items:center;gap:8px;margin:3px 0;font-size:11px;color:#57534e;}' +
    '.brow .bl{width:110px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.btrack{flex:1;height:14px;background:#f5f5f4;border:1px solid #e7e5e4;border-radius:3px;position:relative;}' +
    '.bfill{height:100%;border-radius:2px;background:#99d5cf;}' +
    '.bfill.chain{background:#0f766e;}' +
    '.bfill.weak{background:#d97706;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;' +
    'background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 串联可用性计算器（卷08 §2.4：0.999ⁿ 的连锁衰减）</div>' +
    '  <div id="hops"></div>' +
    '  <div class="btns">' +
    '    <button id="add" class="ghost">＋ 增加环节</button>' +
    '    <button id="del" class="ghost">－ 减少环节</button>' +
    '    <button id="reset" class="ghost">重置</button>' +
    '  </div>' +
    '  <div class="metrics">' +
    '    <div class="metric"><div class="k">链路总可用性（连乘）</div><div class="v" id="mChain">-</div></div>' +
    '    <div class="metric"><div class="k">等效月停机时间</div><div class="v" id="mDown">-</div></div>' +
    '    <div class="metric"><div class="k">最薄弱一环</div><div class="v warn" id="mWeak">-</div></div>' +
    '  </div>' +
    '  <div class="bars" id="bars"></div>' +
    '  <div class="verdict" id="verdict"></div>' +
    '  <div class="note">教学简化：假设各环节故障相互独立，串联总可用性 = 各环节连乘；' +
    '勾选「双活并联」后该环节按 1−(1−a)² 计算（两个独立副本同时挂才失效），忽略切换时间。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  function lvlText(a) {
    if (a >= 0.9999) return '99.99%';
    if (a >= 0.9995) return '99.95%';
    if (a >= 0.999) return '99.9%';
    if (a >= 0.995) return '99.5%';
    return '99%';
  }
  function fmtMin(m) {
    if (m >= 120) return (m / 60).toFixed(1) + ' 小时';
    if (m >= 1) return m.toFixed(1) + ' 分钟';
    return (m * 60).toFixed(0) + ' 秒';
  }
  function pctText(a) {
    var p = a * 100;
    return (p >= 99.995 ? p.toFixed(3) : p.toFixed(2)) + '%';
  }
  function hopAvail(h) { return h.dual ? 1 - (1 - h.a) * (1 - h.a) : h.a; }
  function chainAvail() {
    var t = 1;
    hops.forEach(function (h) { t *= hopAvail(h); });
    return t;
  }

  function renderHops() {
    var box = $('hops');
    box.innerHTML = '';
    hops.forEach(function (h, i) {
      var row = document.createElement('div');
      row.className = 'hop';
      var idx = LEVELS.indexOf(h.a);
      if (idx < 0) idx = 2;
      row.innerHTML =
        '<span class="nm">' + h.name + '</span>' +
        '<input type="range" min="0" max="4" step="1" value="' + idx + '">' +
        '<span class="av">' + lvlText(h.a) + '</span>' +
        '<span class="dt"></span>' +
        '<span class="chk"><input type="checkbox"' + (h.dual ? ' checked' : '') + '>双活并联</span>';
      var slider = row.querySelector('input[type=range]');
      var chk = row.querySelector('input[type=checkbox]');
      slider.addEventListener('input', function () {
        h.a = LEVELS[parseInt(slider.value, 10)];
        row.querySelector('.av').textContent = lvlText(h.a);
        render();
      });
      chk.addEventListener('change', function () {
        h.dual = chk.checked;
        render();
      });
      box.appendChild(row);
    });
    $('add').disabled = hops.length >= 8;
    $('del').disabled = hops.length <= 2;
  }

  function render() {
    // 每个环节自身的月停机
    var rows = $('hops').querySelectorAll('.hop');
    hops.forEach(function (h, i) {
      var eff = hopAvail(h);
      rows[i].querySelector('.dt').textContent = fmtMin(MONTH_MIN * (1 - eff)) + '/月';
    });

    var chain = chainAvail();
    var down = MONTH_MIN * (1 - chain);
    $('mChain').textContent = pctText(chain);
    $('mChain').className = 'v' + (chain < 0.995 ? ' bad' : (chain < 0.999 ? ' warn' : ''));
    $('mDown').textContent = fmtMin(down);
    $('mDown').className = 'v' + (down > 216 ? ' bad' : (down > 43.2 ? ' warn' : ''));

    var weakI = 0;
    hops.forEach(function (h, i) { if (hopAvail(h) < hopAvail(hops[weakI])) weakI = i; });
    $('mWeak').textContent = hops[weakI].name;

    // 条形图：每环节的不可用损失（对数感）+ 链路
    var bars = $('bars');
    bars.innerHTML = '';
    function addBar(label, a, cls) {
      var loss = 1 - a;
      var w = Math.max(2, Math.min(100, Math.pow(loss * 100, 0.5) * 31));
      var r = document.createElement('div');
      r.className = 'brow';
      r.innerHTML = '<span class="bl">' + label + '</span>' +
        '<div class="btrack"><div class="bfill ' + cls + '" style="width:' + w + '%"></div></div>' +
        '<span>' + pctText(a) + '</span>';
      bars.appendChild(r);
    }
    hops.forEach(function (h, i) {
      addBar(h.name + (h.dual ? '（并联）' : ''), hopAvail(h), i === weakI ? 'weak' : '');
    });
    addBar('—— 整条链路 ——', chain, 'chain');

    // 教学结论
    var n = hops.length;
    var powLoss = (1 - chain) * 100;
    var lines = [];
    lines.push(n + ' 个环节串联，总可用性 = ' +
      hops.map(function (h) { return pctText(hopAvail(h)); }).join(' × ') +
      ' = <b>' + pctText(chain) + '</b>，相当于每月不可用 <b>' + fmtMin(down) + '</b>（损失 ' +
      powLoss.toFixed(2) + '%）。');
    var worst = hops[weakI];
    if (!worst.dual && worst.a <= 0.995) {
      lines.push('⚠️ 短板决定上限：<b>' + worst.name + '</b>（' + pctText(worst.a) +
        '）一个环节就贡献了大部分停机。试试给它勾选「双活并联」——两个 ' + pctText(worst.a) +
        ' 副本并联后该环节可用性变为 <b>' + pctText(1 - (1 - worst.a) * (1 - worst.a)) +
        '</b>，等于花一份冗余的钱买回接近一个 9。');
    } else {
      lines.push('✅ 当前没有特别拖后腿的环节。注意规律：<b>串联每加一个 99.9% 的环节，' +
        '整条链就再乘一次 0.999</b>——5 个 99.9% 串联只剩 99.5%（月停机 3.6 小时）。' +
        '这就是为什么微服务拆分越细，每个服务的 SLO 必须越高。');
    }
    $('verdict').innerHTML = lines.join('<br>');
  }

  $('add').addEventListener('click', function () {
    if (hops.length >= 8) return;
    hops.push({ name: POOL[poolIdx % POOL.length], a: 0.999, dual: false });
    poolIdx++;
    renderHops(); render();
  });
  $('del').addEventListener('click', function () {
    if (hops.length <= 2) return;
    hops.pop();
    renderHops(); render();
  });
  $('reset').addEventListener('click', function () {
    hops = PRESET.map(function (h) { return { name: h.name, a: h.a, dual: false }; });
    poolIdx = 0;
    renderHops(); render();
  });

  renderHops();
  render();
};
