/* regression-gate —— 回归评测门禁模拟器（篇09 §9.5：Regression Gate 为什么不信平均分）
 * 契约：注册到 window.DEMOS['regression-gate']，Shadow DOM，样式内联，无外部依赖。
 * 用开关/滑块组装一个"候选版本"（Prompt 优化、模型升级、Context 变更、夹带安全回退），
 * 点「跑评测 + 门禁裁决」：系统逐条执行四条门禁规则（硬门槛违规=0 / Regression Set 100% /
 * 维度无显著下降 / 提升须在 Validation Set 达成），任一不满足即 BLOCK 并给出诊断指引。
 * 教学要点：平均分上涨的候选，照样会被门禁拦下；以及"在 Dev Set 上调出来的分数"为什么不作数。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['regression-gate'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var BASE = { quality: 78, cost: 72, latency: 75, safety: 100 }; // Baseline 各维度（百分制）
  var state = { prompt: false, model: 'same', ctx: 'same', regress: 'none', tunedOn: 'dev', ran: false };

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:10px;}' +
    'h4{margin:12px 0 6px;font-size:13px;font-weight:600;}' +
    '.grid{display:flex;gap:14px;flex-wrap:wrap;}' +
    '.ctl{flex:1;min-width:200px;background:#fafaf9;border:1px solid #e7e5e4;border-radius:6px;padding:9px 12px;font-size:12px;}' +
    '.ctl .q{color:#57534e;margin-bottom:6px;font-weight:600;}' +
    'label.opt{display:block;margin:4px 0;color:#44403c;cursor:pointer;}' +
    'input[type=radio],input[type=checkbox]{accent-color:#0f766e;}' +
    '.warn-text{color:#d97706;}.bad-text{color:#dc2626;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button:hover{opacity:.88;}' +
    '.scores{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;}' +
    '.sc{flex:1;min-width:110px;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;}' +
    '.sc .k{font-size:11px;color:#78716c;}' +
    '.sc .v{font-size:18px;font-weight:600;color:#0f766e;font-variant-numeric:tabular-nums;}' +
    '.sc .d{font-size:11px;margin-top:2px;color:#78716c;}' +
    '.sc .d.up{color:#0f766e;}.sc .d.down{color:#dc2626;}' +
    '.gates{display:flex;flex-direction:column;gap:6px;margin:8px 0;}' +
    '.gate{display:flex;gap:10px;align-items:flex-start;border:1px solid #e7e5e4;border-radius:6px;padding:8px 12px;font-size:12px;background:#fafaf9;line-height:1.6;}' +
    '.gate .ic{font-size:15px;line-height:1.4;}' +
    '.gate.pass{border-color:#99d5cf;background:#f0fdfa;}' +
    '.gate.fail{border-color:#fecaca;background:#fef2f2;}' +
    '.gate .why{color:#57534e;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:11px 13px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.75;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.verdict.warn{background:#fffbeb;border-color:#fde68a;color:#92400e;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 回归评测门禁模拟器（篇09 §9.5：四条门禁规则，一条都不讲情面）</div>' +
    '  <h4>① 组装你的候选版本（VersionTuple 变更项）</h4>' +
    '  <div class="grid">' +
    '    <div class="ctl"><div class="q">Prompt 优化（质量 +8，成本 -3）</div>' +
    '      <label class="opt"><input type="checkbox" id="prompt"> 应用新 Prompt 模板 v7</label></div>' +
    '    <div class="ctl"><div class="q">底层模型</div>' +
    '      <label class="opt"><input type="radio" name="model" value="same" checked> 不变</label>' +
    '      <label class="opt"><input type="radio" name="model" value="plus"> 升级到新一代（质量 +10，时延 -8）</label>' +
    '      <label class="opt"><input type="radio" name="model" value="cheap"> 换成便宜小模型（成本 +15，质量 -12）</label></div>' +
    '    <div class="ctl"><div class="q">Context 配置</div>' +
    '      <label class="opt"><input type="radio" name="ctx" value="same" checked> 不变</label>' +
    '      <label class="opt"><input type="radio" name="ctx" value="截断修复"> 修复口径截断 bug（质量 +6）</label>' +
    '      <label class="opt"><input type="radio" name="ctx" value="压缩激进"> 激进压缩省 token（成本 +8，质量 -7）</label></div>' +
    '    <div class="ctl"><div class="q">夹带的隐性变更 <span class="bad-text">（事故高发区）</span></div>' +
    '      <label class="opt"><input type="radio" name="regress" value="none" checked> 无</label>' +
    '      <label class="opt"><input type="radio" name="regress" value="safety"> 工具配置改动引入越权回退 <span class="bad-text">（硬门槛违规）</span></label>' +
    '      <label class="opt"><input type="radio" name="regress" value="regset"> 一个历史事故 Case 复发 <span class="warn-text">（Regression Set 未过）</span></label></div>' +
    '    <div class="ctl"><div class="q">候选版本是在哪个集上调出来的？</div>' +
    '      <label class="opt"><input type="radio" name="tuned" value="dev" checked> Dev Set（边调边测）</label>' +
    '      <label class="opt"><input type="radio" name="tuned" value="val"> Validation Set（未见数据）</label></div>' +
    '  </div>' +
    '  <div style="margin-top:10px"><button id="run">跑评测 + 门禁裁决</button> <button id="reset" class="ghost">重置</button></div>' +
    '  <h4>② 评测结果（Candidate vs Baseline，Validation Set）</h4>' +
    '  <div class="scores" id="scores"><div class="sc"><div class="k">—</div><div class="v">先跑评测</div></div></div>' +
    '  <h4>③ 门禁逐条裁决</h4>' +
    '  <div class="gates" id="gates"><div class="gate"><span class="ic">⏳</span><span>尚未运行。门禁规则：①硬门槛违规数=0 ②Regression Set 通过率=100% ③各维度无显著下降 ④提升须在 Validation Set 达成。</span></div></div>' +
    '  <div class="verdict" id="verdict">教学结论：跑几组组合，特别是「质量大涨 + 夹带安全回退」——看看平均分说了什么，门禁说了什么。</div>' +
    '  <div style="font-size:11px;color:#a8a29e;margin-top:8px;line-height:1.6">教学简化：各维度用百分制打分，"显著下降"阈值固定为 ±5；' +
    'Dev Set 过拟合虚高简化为 +4 分表象分；真实门禁中应使用统计检验（如配对 t 检验 / bootstrap 置信区间）而非固定阈值，' +
    '且每一次评测运行都必须冻结完整的 VersionTuple（代码/模型/Prompt/Context/工具/Memory 六元组）才具备归因能力。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  function readInputs() {
    state.prompt = $('prompt').checked;
    // radio 需用 shadow.querySelector 在 Shadow DOM 内查询
    state.model = shadow.querySelector('input[name=model]:checked').value;
    state.ctx = shadow.querySelector('input[name=ctx]:checked').value;
    state.regress = shadow.querySelector('input[name=regress]:checked').value;
    state.tunedOn = shadow.querySelector('input[name=tuned]:checked').value;
  }

  function candidate() {
    var c = { quality: 78, cost: 72, latency: 75, safety: 100 };
    if (state.prompt) { c.quality += 8; c.cost -= 3; }
    if (state.model === 'plus') { c.quality += 10; c.latency -= 8; }
    if (state.model === 'cheap') { c.cost += 15; c.quality -= 12; }
    if (state.ctx === '截断修复') { c.quality += 6; }
    if (state.ctx === '压缩激进') { c.cost += 8; c.quality -= 7; }
    if (state.tunedOn === 'dev') { c.quality += 4; } // 过拟合虚高：在未见数据上回落前的表象分
    c.safety = state.regress === 'safety' ? 0 : 100;
    Object.keys(c).forEach(function (k) { c[k] = Math.max(0, Math.min(100, c[k])); });
    return c;
  }

  function run() {
    readInputs();
    var c = candidate();
    var avgB = (BASE.quality + BASE.cost + BASE.latency) / 3;
    var avgC = (c.quality + c.cost + c.latency) / 3;

    // 渲染分数卡
    var dims = [['quality', '质量'], ['cost', '成本效率'], ['latency', '时延'], ['safety', '安全（硬门槛）']];
    $('scores').innerHTML = '';
    dims.forEach(function (d) {
      var delta = c[d[0]] - BASE[d[0]];
      var div = document.createElement('div');
      div.className = 'sc';
      div.innerHTML = '<div class="k">' + d[1] + '</div><div class="v">' + c[d[0]] + '</div>' +
        '<div class="d ' + (delta > 0 ? 'up' : (delta < 0 ? 'down' : '')) + '">' +
        (delta > 0 ? '▲ +' + delta : (delta < 0 ? '▼ ' + delta : '— 持平')) + '（Baseline ' + BASE[d[0]] + '）</div>';
      $('scores').appendChild(div);
    });
    var avg = document.createElement('div');
    avg.className = 'sc';
    avg.innerHTML = '<div class="k">软评分平均（不含安全）</div><div class="v">' + avgC.toFixed(1) + '</div>' +
      '<div class="d ' + (avgC >= avgB ? 'up' : 'down') + '">' + (avgC >= avgB ? '▲' : '▼') + ' vs ' + avgB.toFixed(1) + '</div>';
    $('scores').appendChild(avg);

    // 四条门禁规则
    var gates = [];
    gates.push({
      name: '规则一：硬门槛违规数 = 0',
      pass: state.regress !== 'safety',
      why: state.regress === 'safety'
        ? '候选在对抗 Case 上发生跨租户越权（安全维度 0 分）。无论质量涨多少，一票否决。'
        : '无安全不变量违规。'
    });
    gates.push({
      name: '规则二：Regression Set 通过率 = 100%',
      pass: state.regress !== 'regset',
      why: state.regress === 'regset'
        ? '历史事故 Case「memory-cross-tenant-001」复发。Regression Set 只增不改，就是为了让同一类事故永不复发。'
        : '全部历史回归 Case 通过。'
    });
    var dimDrop = (c.quality < BASE.quality - 5) || (c.cost < BASE.cost - 5) || (c.latency < BASE.latency - 5);
    gates.push({
      name: '规则三：各维度无显著下降（统计检验阈值 ±5）',
      pass: !dimDrop,
      why: dimDrop ? '至少一个维度显著劣于 Baseline——总分可能被其他维度的涨幅掩盖，必须逐维度看。' : '各维度波动均在显著性阈值内。'
    });
    gates.push({
      name: '规则四：提升须在 Validation Set 达成',
      pass: state.tunedOn !== 'dev' || avgC <= avgB,
      why: state.tunedOn === 'dev' && avgC > avgB
        ? '候选是在 Dev Set 上边调边测出来的，含约 +4 分过拟合虚高。在 Validation Set 复测前，这个「提升」不被承认。'
        : '提升在未见数据上得到确认（或无提升声明）。'
    });

    $('gates').innerHTML = '';
    var blocked = [];
    gates.forEach(function (g, i) {
      if (!g.pass) blocked.push(i + 1);
      var div = document.createElement('div');
      div.className = 'gate ' + (g.pass ? 'pass' : 'fail');
      div.innerHTML = '<span class="ic">' + (g.pass ? '✅' : '🛑') + '</span>' +
        '<span><b>' + g.name + '</b><br><span class="why">' + g.why + '</span></span>';
      $('gates').appendChild(div);
    });

    // 裁决结论
    var v = $('verdict');
    var avgSay = '软评分平均 ' + avgC.toFixed(1) + '（Baseline ' + avgB.toFixed(1) + '，' + (avgC >= avgB ? '上升' : '下降') + '）';
    if (blocked.length > 0) {
      v.className = 'verdict bad';
      v.innerHTML = '🛑 <b>BLOCK：门禁阻断发布。</b>' + avgSay + '，但触犯了第 ' + blocked.join('、') + ' 条规则。<br>' +
        '下一步不是"再调调分"，而是进入 9.4 节的故障诊断：用 Replay 确认复现 → Fork 定位关键决策点 → Ablation 单变量证实根因 → 修复后把事故沉淀为新的 Regression Case。' +
        (avgC >= avgB ? '<br><b>这就是本 Demo 的核心一课：平均分在涨，门禁在拦——加权平均会掩盖灾难，所以安全与回归永远独立于总分。</b>' : '');
    } else if (avgC <= avgB) {
      v.className = 'verdict warn';
      v.innerHTML = '🟡 <b>门禁通过，但无显著提升。</b>' + avgSay + '。可以进入 Shadow 发布收集线上证据，但没有离线提升支撑的发布，通常不值得消耗一次灰度窗口。';
    } else {
      v.className = 'verdict';
      v.innerHTML = '✅ <b>PASS：四条门禁全部通过。</b>' + avgSay + '，且提升在 Validation Set 达成、无安全违规、无回归复发。<br>' +
        '下一步：冻结完整 VersionTuple → Shadow 发布（只记录不生效）→ Canary 按租户灰度 → 全量。记住：门禁通过只买到一张"灰度入场券"，不等于线上安全。';
    }
  }

  $('run').addEventListener('click', run);
  $('reset').addEventListener('click', function () {
    $('prompt').checked = false;
    shadow.querySelector('input[name=model][value=same]').checked = true;
    shadow.querySelector('input[name=ctx][value=same]').checked = true;
    shadow.querySelector('input[name=regress][value=none]').checked = true;
    shadow.querySelector('input[name=tuned][value=dev]').checked = true;
    $('scores').innerHTML = '<div class="sc"><div class="k">—</div><div class="v">先跑评测</div></div>';
    $('gates').innerHTML = '<div class="gate"><span class="ic">⏳</span><span>尚未运行。门禁规则：①硬门槛违规数=0 ②Regression Set 通过率=100% ③各维度无显著下降 ④提升须在 Validation Set 达成。</span></div>';
    var v = $('verdict');
    v.className = 'verdict';
    v.textContent = '教学结论：跑几组组合，特别是「质量大涨 + 夹带安全回退」——看看平均分说了什么，门禁说了什么。';
  });
};

/* 附：建议搭配篇09 正文 §9.5「CI Regression Gate」四条规则逐条对照体验。 */
