/* kv-cache —— KV Cache 显存计算器（卷06 §1.2）
 * 契约：注册到 window.DEMOS['kv-cache']，Shadow DOM，样式内联，无外部依赖。
 * 选模型档位（参数量/层数/hidden）、权重量化精度、上下文长度、并发数、显卡显存；
 * 实时计算：权重显存、单请求 KV Cache、总占用、是否能装下、该卡最多撑几条并发；
 * 结论区给出容量决策建议（量化 / 缩上下文 / 张量并行 / 换卡）。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['kv-cache'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var MODELS = [
    { label: '1.5B', params: 1.5e9, layers: 28, hidden: 1536 },
    { label: '7B（LLaMA-2 系）', params: 7e9, layers: 32, hidden: 4096 },
    { label: '14B', params: 14e9, layers: 40, hidden: 5120 },
    { label: '32B', params: 32e9, layers: 64, hidden: 5120 },
    { label: '70B（LLaMA-2 系）', params: 70e9, layers: 80, hidden: 8192 }
  ];
  var PREC = [
    { label: 'FP16/BF16（2 字节）', bytes: 2 },
    { label: 'INT8（1 字节）', bytes: 1 },
    { label: 'INT4（0.5 字节）', bytes: 0.5 }
  ];
  var GPUS = [
    { label: '消费卡 24 GB（4090 级）', vram: 24 },
    { label: '专业卡 48 GB（A6000 级）', vram: 48 },
    { label: '数据中心 80 GB（A100/H100）', vram: 80 },
    { label: 'H200 141 GB', vram: 141 }
  ];
  var TP = [
    { label: '单卡（×1）', n: 1 },
    { label: '张量并行 ×2', n: 2 },
    { label: '张量并行 ×4', n: 4 }
  ];
  var CTXS = [1024, 2048, 4096, 8192, 16384, 32768];
  var KV_BYTES = 2;   // KV Cache 通常保持 FP16
  var OVERHEAD = 0.9; // vLLM 常用 gpu-memory-utilization≈0.9，其余留给系统/碎片

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;margin-bottom:6px;}' +
    '@media(max-width:560px){.grid{grid-template-columns:1fr;}}' +
    '.f{display:flex;flex-direction:column;gap:2px;}' +
    '.f label{font-size:11px;color:#57534e;font-weight:600;display:flex;justify-content:space-between;}' +
    '.f label b{color:#0f766e;font-variant-numeric:tabular-nums;}' +
    'select{border:1px solid #d6d3d1;border-radius:6px;padding:6px 8px;font-size:12px;' +
    'font-family:inherit;background:#fafaf9;color:#1c1917;}' +
    'input[type=range]{width:100%;accent-color:#0f766e;}' +
    '.metrics{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 4px;}' +
    '.metric{flex:1;min-width:110px;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;}' +
    '.metric .k{font-size:11px;color:#78716c;}' +
    '.metric .v{font-size:17px;font-weight:600;color:#0f766e;font-variant-numeric:tabular-nums;}' +
    '.metric .v.warn{color:#d97706;}' +
    '.metric .v.bad{color:#dc2626;}' +
    '.stack{margin:10px 0 2px;height:22px;border:1px solid #e5e1d8;border-radius:5px;' +
    'overflow:hidden;display:flex;background:#f5f5f4;}' +
    '.seg{height:100%;}' +
    '.seg.w{background:#0f766e;}' +
    '.seg.k{background:#d97706;}' +
    '.seg.x{background:#dc2626;}' +
    '.legend{display:flex;gap:14px;font-size:11px;color:#57534e;margin-top:4px;flex-wrap:wrap;}' +
    '.sw{display:inline-block;width:10px;height:10px;vertical-align:-1px;margin-right:4px;border-radius:2px;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;' +
    'background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · KV Cache 显存计算器（卷06 §1.2：权重与 KV Cache 分开算账）</div>' +
    '  <div class="grid">' +
    '    <div class="f"><label>模型档位</label><select id="model"></select></div>' +
    '    <div class="f"><label>权重量化精度</label><select id="prec"></select></div>' +
    '    <div class="f"><label>显卡</label><select id="gpu"></select></div>' +
    '    <div class="f"><label>部署方式</label><select id="tp"></select></div>' +
    '    <div class="f"><label>上下文长度 <b id="ctxLabel">4096</b></label>' +
    '      <input id="ctx" type="range" min="0" max="5" step="1" value="2"></div>' +
    '    <div class="f"><label>并发请求数 <b id="concLabel">8</b></label>' +
    '      <input id="conc" type="range" min="1" max="256" step="1" value="8"></div>' +
    '  </div>' +
    '  <div class="metrics">' +
    '    <div class="metric"><div class="k">权重显存</div><div class="v" id="mW">-</div></div>' +
    '    <div class="metric"><div class="k">单请求 KV Cache</div><div class="v" id="mK">-</div></div>' +
    '    <div class="metric"><div class="k">总需求 / 可用</div><div class="v" id="mT">-</div></div>' +
    '    <div class="metric"><div class="k">该卡最大并发</div><div class="v" id="mMax">-</div></div>' +
    '  </div>' +
    '  <div class="stack" id="stack"></div>' +
    '  <div class="legend">' +
    '    <span><span class="sw" style="background:#0f766e"></span>权重</span>' +
    '    <span><span class="sw" style="background:#d97706"></span>KV Cache（并发 × 单请求）</span>' +
    '    <span><span class="sw" style="background:#dc2626"></span>超出显存部分</span>' +
    '  </div>' +
    '  <div class="verdict" id="verdict"></div>' +
    '  <div class="note">公式：权重 ≈ 参数量 × 每参数字节数；单请求 KV Cache ≈ 2 × 层数 × hidden × 2 字节 × 上下文长度。' +
    '教学简化：KV Cache 按 FP16 计（生产可再量化），未计激活值与 CUDA 上下文开销，可用显存按 90% 计。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  function fillSel(id, arr) {
    var s = $(id);
    arr.forEach(function (o, i) {
      var opt = document.createElement('option');
      opt.value = i; opt.textContent = o.label;
      s.appendChild(opt);
    });
  }

  function fmtGB(g) {
    return g >= 100 ? g.toFixed(0) + ' GB' : g.toFixed(1) + ' GB';
  }

  function render() {
    var m = MODELS[parseInt($('model').value, 10)];
    var p = PREC[parseInt($('prec').value, 10)];
    var g = GPUS[parseInt($('gpu').value, 10)];
    var tp = TP[parseInt($('tp').value, 10)];
    var ctx = CTXS[parseInt($('ctx').value, 10)];
    var conc = parseInt($('conc').value, 10);
    $('ctxLabel').textContent = ctx;
    $('concLabel').textContent = conc;

    var weights = m.params * p.bytes / 1e9;                          // GB（全模型）
    var kvPer = 2 * m.layers * m.hidden * KV_BYTES * ctx / 1e9;      // GB（单请求，全模型）
    var usable = g.vram * OVERHEAD * tp.n;                           // 张量并行：显存池合并
    var kvTotal = kvPer * conc;
    var total = weights + kvTotal;
    var fits = total <= usable;
    var maxConc = kvPer > 0 ? Math.floor((usable - weights) / kvPer) : 0;
    if (maxConc < 0) maxConc = 0;

    $('mW').textContent = fmtGB(weights);
    $('mK').textContent = kvPer >= 1 ? kvPer.toFixed(2) + ' GB' : (kvPer * 1024).toFixed(0) + ' MB';
    var t = $('mT');
    t.textContent = fmtGB(total) + ' / ' + fmtGB(usable);
    t.className = 'v' + (fits ? '' : ' bad');
    var mx = $('mMax');
    mx.textContent = maxConc > 0 ? maxConc + ' 条' : '装不下';
    mx.className = 'v' + (maxConc === 0 ? ' bad' : (maxConc < conc ? ' warn' : ''));

    // 堆叠条
    var scale = Math.max(usable, total);
    var wPct = weights / scale * 100;
    var kPct = Math.min(kvTotal, Math.max(0, usable - weights)) / scale * 100;
    var xPct = fits ? 0 : (total - usable) / scale * 100;
    $('stack').innerHTML =
      '<div class="seg w" style="width:' + wPct + '%"></div>' +
      '<div class="seg k" style="width:' + kPct + '%"></div>' +
      (xPct > 0 ? '<div class="seg x" style="width:' + xPct + '%"></div>' : '');

    // 教学结论
    var v = $('verdict');
    var lines = [];
    if (weights > usable) {
      v.className = 'verdict bad';
      v.innerHTML = '🛑 <b>权重本身就装不下</b>：' + m.label + ' ' + p.label +
        ' 需要 ' + fmtGB(weights) + '，超过全部可用显存 ' + fmtGB(usable) +
        '——此时谈并发毫无意义。唯一出路是量化、换更大显存的卡，或张量并行拆卡。' +
        '这就是卷06 §1.2 说的"显存容量是硬门槛：装不下 = 直接出局"。';
      $('stack').innerHTML =
        '<div class="seg w" style="width:' + (usable / weights * 100) + '%"></div>' +
        '<div class="seg x" style="width:' + ((weights - usable) / weights * 100) + '%"></div>';
      $('mT').className = 'v bad';
      $('mMax').textContent = '装不下';
      $('mMax').className = 'v bad';
      return;
    }
    if (!fits) {
      v.className = 'verdict bad';
      lines.push('🛑 <b>装不下</b>：' + m.label + ' + ' + conc + ' 条 ' + ctx +
        ' 上下文需要 ' + fmtGB(total) + '，超过可用 ' + fmtGB(usable) + '。四条出路：');
      var q4 = m.params * 0.5 / 1e9;
      lines.push('① <b>量化</b>：INT4 后权重仅 ' + fmtGB(q4) + '（省 ' + fmtGB(weights - q4) +
        '，全变成 KV Cache 空间）；② <b>缩上下文</b>：KV Cache 与上下文长度成正比，' +
        ctx + ' → ' + (ctx / 2) + ' 直接减半；③ <b>张量并行</b>：' +
        (tp.n > 1 ? '已是 ×' + tp.n + '，可再翻' : '把部署方式切成 ×2，权重与 KV 池同时翻倍') +
        '；④ <b>降并发</b>：当前配置最多撑 <b>' + maxConc + '</b> 条。');
    } else {
      v.className = 'verdict';
      var kvShare = kvTotal / total * 100;
      lines.push('✅ 装得下，剩余余量 ' + fmtGB(usable - total) + '。注意结构：权重 ' +
        fmtGB(weights) + ' 是固定成本，KV Cache ' + fmtGB(kvTotal) + '（占已用 ' +
        kvShare.toFixed(0) + '%）随 <b>并发 × 上下文</b> 线性增长——这就是为什么说' +
        '<b>并发能力 = 显存预算</b>，也是 PagedAttention 要拼命压缩显存碎片的原因。');
      if (maxConc > conc * 2) {
        lines.push('提示：该卡还能再塞约 ' + (maxConc - conc) + ' 条并发。试试把上下文拉到 32K，' +
          '观察"最大并发"如何跳水——长上下文业务的贵，贵在 KV Cache。');
      }
    }
    v.innerHTML = lines.join('<br>');
  }

  fillSel('model', MODELS); $('model').value = 1;
  fillSel('prec', PREC);
  fillSel('gpu', GPUS);
  fillSel('tp', TP);
  ['model', 'prec', 'gpu', 'tp', 'ctx', 'conc'].forEach(function (id) {
    $(id).addEventListener('input', render);
  });
  render();
};
