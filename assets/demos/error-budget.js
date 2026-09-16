/* error-budget —— 错误预算模拟器（卷08 §2.3）
 * 契约：注册到 window.DEMOS['error-budget']，Shadow DOM，样式内联，无外部依赖。
 * 滑块选 SLO 档位（99%/99.9%/99.99%），显示月度错误预算分钟数；
 * 手动注入事故（持续时长 × 影响面）或随机模拟 30 天；预算耗尽提示"冻结变更"；
 * 可切换"无预算约束"对照，比较两种纪律下的发布次数。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['error-budget'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var SLOS = [
    { label: '99%', value: 0.99 },
    { label: '99.9%', value: 0.999 },
    { label: '99.99%', value: 0.9999 }
  ];
  var MONTH_MIN = 30 * 24 * 60; // 43200 分钟
  var WORK_RELEASES = 22;       // 30 天中约 22 个工作日，每天 1 次发布机会

  var state = { incidents: [], manualDay: 0, simmed: false };

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
    'input[type=checkbox]{accent-color:#0f766e;}' +
    '.row{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;align-items:flex-end;}' +
    '.metrics{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;}' +
    '.metric{flex:1;min-width:110px;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;}' +
    '.metric .k{font-size:11px;color:#78716c;}' +
    '.metric .v{font-size:18px;font-weight:600;color:#0f766e;font-variant-numeric:tabular-nums;}' +
    '.metric .v.warn{color:#d97706;}' +
    '.metric .v.bad{color:#dc2626;}' +
    '.bar{height:18px;border:1px solid #e5e1d8;border-radius:9px;overflow:hidden;background:#fafaf9;position:relative;margin:6px 0 4px;}' +
    '.fill{height:100%;background:#0f766e;transition:width .2s;}' +
    '.barlabel{font-size:11px;color:#57534e;display:flex;justify-content:space-between;}' +
    '.timeline{display:grid;grid-template-columns:repeat(15,1fr);gap:3px;margin-top:8px;}' +
    '.day{aspect-ratio:1;border-radius:3px;background:#f5f5f4;border:1px solid #e7e5e4;cursor:default;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button:hover{opacity:.88;}' +
    '.chk{display:flex;align-items:center;gap:6px;font-size:12px;color:#57534e;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.legend{display:flex;gap:14px;font-size:11px;color:#57534e;margin-top:6px;flex-wrap:wrap;}' +
    '.sw{display:inline-block;width:10px;height:10px;vertical-align:-1px;margin-right:4px;border-radius:2px;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 错误预算模拟器（卷08 §2.3：SLO 定承诺，预算管节奏）</div>' +
    '  <h4>① 设定 SLO 档位</h4>' +
    '  <div class="row">' +
    '    <div class="ctl" style="max-width:320px"><label>SLO 档位 <b id="sloLabel">99.9%</b></label>' +
    '      <input id="slo" type="range" min="0" max="2" step="1" value="1"></div>' +
    '  </div>' +
    '  <div class="metrics">' +
    '    <div class="metric"><div class="k">月度错误预算</div><div class="v" id="mBudget">-</div></div>' +
    '    <div class="metric"><div class="k">已消耗</div><div class="v" id="mUsed">-</div></div>' +
    '    <div class="metric"><div class="k">剩余</div><div class="v" id="mLeft">-</div></div>' +
    '    <div class="metric"><div class="k">预算状态</div><div class="v" id="mStatus">-</div></div>' +
    '  </div>' +
    '  <div class="bar"><div class="fill" id="fill" style="width:0%"></div></div>' +
    '  <div class="barlabel"><span>0</span><span id="barMid">预算消耗进度</span><span id="barMax">-</span></div>' +
    '  <h4>② 注入事故（停机分钟数 = 持续时长 × 影响面）</h4>' +
    '  <div class="row">' +
    '    <div class="ctl"><label>持续时长 <b id="durV">30 分钟</b></label>' +
    '      <input id="dur" type="range" min="5" max="300" step="5" value="30"></div>' +
    '    <div class="ctl"><label>影响面 <b id="impV">50%</b></label>' +
    '      <input id="imp" type="range" min="10" max="100" step="5" value="50"></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto"><button id="inject">注入事故</button></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto"><button id="sim" class="ghost">随机模拟 30 天</button></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto"><button id="reset" class="ghost">重置</button></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto;justify-content:flex-end">' +
    '      <span class="chk"><input type="checkbox" id="noBudget"><label for="noBudget">无预算约束（对照）</label></span></div>' +
    '  </div>' +
    '  <h4>③ 30 天时间线（色块 = 当日事故消耗的等效停机分钟数）</h4>' +
    '  <div class="timeline" id="timeline"></div>' +
    '  <div class="legend">' +
    '    <span><span class="sw" style="background:#f5f5f4;border:1px solid #e7e5e4"></span>无事故</span>' +
    '    <span><span class="sw" style="background:#99d5cf"></span>≤ 当日公平份额</span>' +
    '    <span><span class="sw" style="background:#fbbf24"></span>超份额（1–3 倍）</span>' +
    '    <span><span class="sw" style="background:#ef4444"></span>严重超标（&gt;3 倍）</span>' +
    '  </div>' +
    '  <div class="verdict" id="verdict">先设定 SLO，再注入事故或点「随机模拟 30 天」。</div>' +
    '  <div class="note">教学简化：影响面按线性折算等效停机时间（影响 50% 用户 30 分钟 ≈ 全员 15 分钟）；发布策略假设预算余额 &gt;10% 才放行常规发布，≤10% 冻结。公平份额 = 月预算 ÷ 30。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  var timelineEl = $('timeline');
  var dayCells = [];
  for (var i = 0; i < 30; i++) {
    var d = document.createElement('div');
    d.className = 'day';
    timelineEl.appendChild(d);
    dayCells.push(d);
  }

  function budget() {
    var slo = SLOS[parseInt($('slo').value, 10)];
    return { slo: slo, total: MONTH_MIN * (1 - slo.value) };
  }
  function fmtMin(m) {
    if (m >= 120) return (m / 60).toFixed(1) + ' 小时';
    if (m >= 1) return m.toFixed(1) + ' 分钟';
    return (m * 60).toFixed(0) + ' 秒';
  }
  function consumedTotal() {
    var s = 0;
    for (var i = 0; i < state.incidents.length; i++) s += state.incidents[i].cost;
    return s;
  }
  function dayUsage() {
    var days = [];
    for (var i = 0; i < 30; i++) days.push(0);
    state.incidents.forEach(function (inc) { days[inc.day] += inc.cost; });
    return days;
  }

  function render() {
    var b = budget();
    var used = consumedTotal();
    var left = b.total - used;
    var ratio = b.total > 0 ? used / b.total : 0;
    var noBudget = $('noBudget').checked;

    $('sloLabel').textContent = b.slo.label;
    $('mBudget').textContent = fmtMin(b.total);
    $('mUsed').textContent = fmtMin(Math.min(used, b.total * 99));
    $('barMax').textContent = fmtMin(b.total);

    var leftEl = $('mLeft'), statusEl = $('mStatus');
    leftEl.textContent = left > 0 ? fmtMin(left) : '已透支 ' + fmtMin(-left);
    leftEl.className = 'v' + (left <= 0 ? ' bad' : (left < b.total * 0.1 ? ' warn' : ''));

    var status, cls;
    if (ratio >= 1) { status = '耗尽·冻结变更'; cls = ' bad'; }
    else if (ratio >= 0.9) { status = '告急（<10%）'; cls = ' bad'; }
    else if (ratio >= 0.5) { status = '吃紧（黄灯）'; cls = ' warn'; }
    else { status = '充足（绿灯）'; cls = ''; }
    if (noBudget) { status = '无约束模式'; cls = ' warn'; }
    statusEl.textContent = status;
    statusEl.className = 'v' + cls;

    var pct = Math.min(ratio * 100, 100);
    var fill = $('fill');
    fill.style.width = pct + '%';
    fill.style.background = ratio >= 0.9 ? '#dc2626' : (ratio >= 0.5 ? '#d97706' : '#0f766e');
    $('barMid').textContent = '已消耗 ' + Math.round(ratio * 100) + '%';

    // 时间线着色
    var share = b.total / 30;
    var days = dayUsage();
    for (var i = 0; i < 30; i++) {
      var u = days[i], c = dayCells[i];
      c.title = '第 ' + (i + 1) + ' 天：消耗 ' + fmtMin(u);
      if (u <= 0) c.style.background = '#f5f5f4';
      else if (u <= share) c.style.background = '#99d5cf';
      else if (u <= share * 3) c.style.background = '#fbbf24';
      else c.style.background = '#ef4444';
    }

    // 发布次数对比：每天 1 次机会，仅工作日（约 22 天）；预算 >10% 才放行
    var allowed = 0, denied = 0, running = 0;
    if (state.incidents.length > 0) {
      for (var d2 = 0; d2 < 30; d2++) {
        running += days[d2];
        var isWorkday = (d2 % 7) < 5; // 简化：每 7 天 5 个工作日
        if (!isWorkday) continue;
        if (noBudget || running <= b.total * 0.9) allowed++;
        else denied++;
      }
    }
    var v = $('verdict');
    if (state.incidents.length === 0) {
      v.className = 'verdict';
      v.innerHTML = '当前 SLO <b>' + b.slo.label + '</b>，月错误预算 <b>' + fmtMin(b.total) +
        '</b>（30 天 × (1 − SLO)）。注意 99.99% 只剩约 4.3 分钟——几乎不允许人工反应时间，这就是"四个 9 必须架构代际支撑"的含义。';
      return;
    }
    var lines = [];
    lines.push('共 <b>' + state.incidents.length + '</b> 起事故，消耗预算 <b>' +
      Math.round(ratio * 100) + '%</b>（' + fmtMin(used) + ' / ' + fmtMin(b.total) + '）。');
    if (noBudget) {
      v.className = 'verdict bad';
      lines.push('⚠️ <b>无预算约束模式</b>：30 天内发布 <b>' + allowed + '</b> 次（全部放行）——' +
        '事故照发、功能照上，短期看交付更快，但系统在预算透支状态下继续堆变更，下一波事故概率被显著放大。');
      lines.push('切回预算约束模式，对比同一个 30 天里"冻结变更"纪律会减少几次发布、换来什么。');
    } else {
      v.className = ratio >= 0.9 ? 'verdict bad' : 'verdict';
      lines.push('预算纪律下发布 <b>' + allowed + '</b> 次，被冻结 <b>' + denied + '</b> 次' +
        '（无约束对照为 ' + (allowed + denied) + ' 次全部放行）。');
      if (ratio >= 1) {
        lines.push('🛑 <b>错误预算耗尽：冻结变更。</b>只允许修复性发布，团队全部精力转向稳定性改进（修根因、补冗余、写演练），直到预算随滚动窗口恢复——这就是"快与稳的会计制度"。');
      } else if (ratio >= 0.9) {
        lines.push('🔶 预算告急（剩余 <10%）：已进入冻结区间，高风险变更一律评审。');
      } else if (ratio >= 0.5) {
        lines.push('🔶 预算吃紧：发布节奏降档，实验特性暂停，优先把已知的稳定性欠账还掉。');
      } else {
        lines.push('✅ 预算充足：可以放胆发布、上实验特性、做架构重构——没花完的预算是团队的"冒险许可证"。');
      }
    }
    v.innerHTML = lines.join('<br>');
  }

  function injectIncident(day, durMin, impPct) {
    var cost = durMin * impPct / 100;
    if (day >= 30) day = 29;
    state.incidents.push({ day: day, cost: cost });
  }

  $('slo').addEventListener('input', render);
  $('dur').addEventListener('input', function () {
    $('durV').textContent = $('dur').value + ' 分钟';
  });
  $('imp').addEventListener('input', function () {
    $('impV').textContent = $('imp').value + '%';
  });
  $('inject').addEventListener('click', function () {
    injectIncident(state.manualDay, parseInt($('dur').value, 10), parseInt($('imp').value, 10));
    state.manualDay = (state.manualDay + 3) % 30; // 下一次手动注入落在几天后，便于观察分布
    render();
  });
  $('sim').addEventListener('click', function () {
    state.incidents = [];
    state.manualDay = 0;
    for (var d = 0; d < 30; d++) {
      if (Math.random() < 0.28) { // 每天约 28% 概率出事故
        var dur = 10 + Math.random() * 170;    // 10–180 分钟
        var imp = 20 + Math.random() * 80;     // 影响面 20%–100%
        injectIncident(d, dur, imp);
        if (Math.random() < 0.2) {             // 小概率当天梅开二度
          injectIncident(d, 5 + Math.random() * 60, 20 + Math.random() * 60);
        }
      }
    }
    render();
  });
  $('reset').addEventListener('click', function () {
    state.incidents = [];
    state.manualDay = 0;
    render();
  });
  $('noBudget').addEventListener('change', render);

  render();
};
