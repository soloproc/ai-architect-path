/* context-window —— 上下文窗口挤压模拟器（篇01 §1.6）
 * 契约：注册到 window.DEMOS['context-window']，Shadow DOM，样式内联，无外部依赖。
 * 模拟 Agent 多轮循环的上下文增长：System/工具定义固定，历史消息逐轮膨胀，
 * 超出窗口时按"从最旧开始裁剪"策略淘汰；可开启"摘要压缩"对照。
 * 历史中段放一条"关键规则"标记，展示其 可见/中段风险/被裁剪 三种命运，
 * 直观呈现 lost in the middle 与"最小充分"原则。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['context-window'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var SYS_TOK = 2000;      // System Prompt
  var TOOL_TOK = 1500;     // 工具定义
  var RAG_TOK = 1200;      // 每轮 RAG 检索资料
  var Q_TOK = 200;         // 当前用户问题
  var RULE_TOK = 600;      // 关键规则（放在历史中段的标记）
  var SUMMARY_RATIO = 0.15;

  var state = { rounds: [], cropped: 0, summary: 0, ruleFate: 'alive', log: [] };
  // rounds: [{u:用户消息tok, t:工具结果tok, rule:true?}]

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    '.row{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;align-items:flex-end;}' +
    '.ctl{display:flex;flex-direction:column;gap:3px;min-width:140px;flex:1;}' +
    '.ctl label{font-size:11px;color:#57534e;display:flex;justify-content:space-between;gap:8px;}' +
    '.ctl label b{color:#0f766e;font-variant-numeric:tabular-nums;}' +
    'input[type=range]{width:100%;accent-color:#0f766e;}' +
    'input[type=checkbox]{accent-color:#0f766e;}' +
    'select{font-family:inherit;font-size:12px;padding:4px 6px;border:1px solid #d6d3d1;border-radius:5px;color:#1c1917;background:#fff;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button:hover{opacity:.88;}' +
    '.chk{display:flex;align-items:center;gap:6px;font-size:12px;color:#57534e;}' +
    '.stack{display:flex;height:34px;border:1px solid #d6d3d1;border-radius:6px;overflow:hidden;margin:8px 0 4px;background:#fafaf9;}' +
    '.seg{height:100%;transition:width .25s;position:relative;min-width:0;}' +
    '.seg span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;white-space:nowrap;overflow:hidden;}' +
    '.metrics{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;}' +
    '.metric{flex:1;min-width:105px;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;}' +
    '.metric .k{font-size:11px;color:#78716c;}' +
    '.metric .v{font-size:17px;font-weight:600;color:#0f766e;font-variant-numeric:tabular-nums;}' +
    '.metric .v.warn{color:#d97706;}' +
    '.metric .v.bad{color:#dc2626;}' +
    '.ruleline{display:flex;align-items:center;gap:8px;font-size:12px;margin:8px 0;padding:8px 10px;border-radius:6px;border:1px solid #e5e1d8;background:#fafaf9;}' +
    '.ruleline .dot{width:10px;height:10px;border-radius:50%;flex:none;background:#0f766e;}' +
    '.ruleline.risk .dot{background:#d97706;}' +
    '.ruleline.dead .dot{background:#dc2626;}' +
    '.ruleline.risk{border-color:#fcd34d;background:#fffbeb;}' +
    '.ruleline.dead{border-color:#fecaca;background:#fef2f2;}' +
    '.log{font-size:11px;color:#57534e;background:#fafaf9;border:1px solid #e7e5e4;border-radius:6px;padding:8px 10px;max-height:110px;overflow-y:auto;line-height:1.8;font-variant-numeric:tabular-nums;}' +
    '.log .crop{color:#d97706;}' +
    '.log .boom{color:#dc2626;}' +
    '.verdict{margin-top:10px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.legend{display:flex;gap:12px;font-size:11px;color:#57534e;margin-top:6px;flex-wrap:wrap;}' +
    '.sw{display:inline-block;width:10px;height:10px;vertical-align:-1px;margin-right:4px;border-radius:2px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 上下文窗口挤压模拟器（篇01 §1.6：窗口长度 ≠ 有效长度）</div>' +
    '  <div class="row">' +
    '    <div class="ctl" style="max-width:170px"><label>窗口大小</label>' +
    '      <select id="win"><option value="8000">8K Token</option>' +
    '      <option value="16000" selected>16K Token</option>' +
    '      <option value="32000">32K Token</option></select></div>' +
    '    <div class="ctl"><label>每轮用户消息 <b id="uV">400</b></label>' +
    '      <input id="uTok" type="range" min="100" max="1500" step="50" value="400"></div>' +
    '    <div class="ctl"><label>每轮工具结果 <b id="tV">1200</b></label>' +
    '      <input id="tTok" type="range" min="200" max="4000" step="100" value="1200"></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto;justify-content:flex-end">' +
    '      <span class="chk"><input type="checkbox" id="sum"><label for="sum">摘要压缩（篇06剧透）</label></span></div>' +
    '  </div>' +
    '  <div class="row">' +
    '    <button id="step">跑 1 轮</button>' +
    '    <button id="run8" class="ghost">连跑 8 轮</button>' +
    '    <button id="reset" class="ghost">重置</button>' +
    '  </div>' +
    '  <div class="stack" id="stack"></div>' +
    '  <div class="legend">' +
    '    <span><span class="sw" style="background:#0f766e"></span>System+工具(固定)</span>' +
    '    <span><span class="sw" style="background:#14b8a6"></span>摘要</span>' +
    '    <span><span class="sw" style="background:#a8a29e"></span>历史消息</span>' +
    '    <span><span class="sw" style="background:#d97706"></span>关键规则</span>' +
    '    <span><span class="sw" style="background:#78716c"></span>RAG+当前问题</span>' +
    '    <span><span class="sw" style="background:#f5f5f4;border:1px solid #e7e5e4"></span>剩余窗口</span>' +
    '  </div>' +
    '  <div class="metrics">' +
    '    <div class="metric"><div class="k">已用 / 窗口</div><div class="v" id="mUsed">-</div></div>' +
    '    <div class="metric"><div class="k">存活轮数</div><div class="v" id="mRounds">-</div></div>' +
    '    <div class="metric"><div class="k">已裁剪轮数</div><div class="v warn" id="mCrop">-</div></div>' +
    '    <div class="metric"><div class="k">单轮边际成本</div><div class="v" id="mCost">-</div></div>' +
    '  </div>' +
    '  <div class="ruleline" id="rule"><span class="dot"></span><span id="ruleText"></span></div>' +
    '  <div class="log" id="log"></div>' +
    '  <div class="verdict" id="verdict">点「跑 1 轮」开始模拟一个 Agent 循环。注意观察：历史越滚越长，第几轮开始触发裁剪？</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  function windowSize() { return parseInt($('win').value, 10); }
  function fixedTok() { return SYS_TOK + TOOL_TOK + RAG_TOK + Q_TOK; }
  function historyTok() {
    var s = 0;
    state.rounds.forEach(function (r) { s += r.u + r.t + (r.rule ? RULE_TOK : 0); });
    return s;
  }
  function totalTok() { return fixedTok() + historyTok() + state.summary; }

  function addLog(msg, cls) {
    state.log.push({ msg: msg, cls: cls || '' });
    if (state.log.length > 40) state.log.shift();
  }

  function enforceBudget() {
    // 从最旧的轮开始裁剪，直到能装进窗口；裁剪的去向取决于摘要开关
    while (state.rounds.length > 0 && totalTok() > windowSize()) {
      var victim = state.rounds[0];
      var vTok = victim.u + victim.t + (victim.rule ? RULE_TOK : 0);
      state.rounds.shift();
      state.cropped++;
      if (victim.rule) state.ruleFate = 'dead';
      if ($('sum').checked) {
        state.summary += Math.round(vTok * SUMMARY_RATIO);
        addLog('裁剪第 ' + state.cropped + ' 轮（' + vTok + ' tok）→ 压缩进摘要（+' +
          Math.round(vTok * SUMMARY_RATIO) + ' tok）', 'crop');
      } else {
        addLog('裁剪第 ' + state.cropped + ' 轮（' + vTok + ' tok）→ 直接丢弃', 'crop');
      }
    }
  }

  function runRound() {
    if (state.rounds.length === 0 && state.cropped === 0 && state.summary === 0) {
      state.log = [];
    }
    var u = parseInt($('uTok').value, 10);
    var t = parseInt($('tTok').value, 10);
    var idx = state.rounds.length + state.cropped + 1;
    var hasRule = (idx === 2); // 关键规则在第 2 轮进入历史（此后越埋越深）
    state.rounds.push({ u: u, t: t, rule: hasRule });
    addLog('第 ' + idx + ' 轮：+用户 ' + u + ' tok，+工具结果 ' + t + ' tok');
    enforceBudget();
    if (totalTok() > windowSize()) {
      addLog('⚠️ 固定开销（System+工具+RAG+问题）已超窗口——请求将直接失败', 'boom');
    }
    render();
  }

  function render() {
    var W = windowSize();
    var used = Math.min(totalTok(), W);
    var pct = function (v) { return Math.max(v / W * 100, 0) + '%'; };
    var ruleAlive = state.ruleFate !== 'dead';
    var histNoRule = historyTok() - (ruleAlive ? RULE_TOK : 0);
    if (histNoRule < 0) histNoRule = 0;

    var stack = $('stack');
    stack.innerHTML =
      '<div class="seg" style="width:' + pct(SYS_TOK + TOOL_TOK) + ';background:#0f766e"><span>System+工具</span></div>' +
      (state.summary > 0 ? '<div class="seg" style="width:' + pct(state.summary) + ';background:#14b8a6"><span>摘要</span></div>' : '') +
      (histNoRule > 0 ? '<div class="seg" style="width:' + pct(histNoRule) + ';background:#a8a29e"><span>历史×' + state.rounds.length + '</span></div>' : '') +
      (ruleAlive && state.cropped + state.rounds.length >= 2 ? '<div class="seg" style="width:' + pct(RULE_TOK) + ';background:#d97706"><span>规则</span></div>' : '') +
      '<div class="seg" style="width:' + pct(RAG_TOK + Q_TOK) + ';background:#78716c"><span>RAG+问题</span></div>' +
      '<div class="seg" style="width:' + Math.max((W - used) / W * 100, 0) + '%;background:#f5f5f4"></div>';

    var ratio = totalTok() / W;
    var usedEl = $('mUsed');
    usedEl.textContent = Math.round(totalTok() / 100) / 10 + 'K / ' + W / 1000 + 'K';
    usedEl.className = 'v' + (ratio >= 1 ? ' bad' : (ratio >= 0.8 ? ' warn' : ''));
    $('mRounds').textContent = state.rounds.length;
    $('mCrop').textContent = state.cropped;
    $('mCost').textContent = '+' + Math.round(totalTok() / 100) / 10 + 'K 输入/轮';

    // 关键规则命运：活着 → 看它埋得多深
    var rl = $('rule');
    if (state.cropped + state.rounds.length < 2) {
      rl.className = 'ruleline';
      $('ruleText').textContent = '📌 关键规则将在第 2 轮进入历史（比如"所有查询必须带 tenant_id"）——之后它会被越埋越深。';
    } else if (state.ruleFate === 'dead') {
      rl.className = 'ruleline dead';
      $('ruleText').textContent = '❌ 关键规则已被裁剪出窗口：模型此刻"忘了"这条约束——被裁剪的上下文就是丢失的状态，除非你有摘要或持久化机制。';
    } else {
      var depthOk = state.rounds.length <= 3;
      rl.className = 'ruleline' + (depthOk ? '' : ' risk');
      $('ruleText').textContent = depthOk
        ? '✅ 关键规则仍在窗口较浅处，模型大概率看得见。'
        : '🔶 关键规则被埋在 ' + state.rounds.length + ' 轮历史的中段——lost in the middle 高发区：它在窗口里，但注意力命中率已显著下降。"在窗口内" ≠ "被看见"。';
    }

    var logEl = $('log');
    logEl.innerHTML = state.log.map(function (l) {
      return '<div class="' + l.cls + '">' + l.msg + '</div>';
    }).join('');
    logEl.scrollTop = logEl.scrollHeight;

    var v = $('verdict');
    if (state.cropped === 0 && state.rounds.length === 0) return;
    var lines = [];
    lines.push('当前每轮请求的输入是 <b>' + Math.round(totalTok() / 100) / 10 + 'K Token</b>——' +
      '注意成本真相：<b>每一轮都要为全部历史重新付一次输入费</b>，第 N 轮的累计输入费 ≈ N²/2 × 单轮增长量。');
    if (state.cropped > 0) {
      if ($('sum').checked) {
        lines.push('已裁剪 <b>' + state.cropped + '</b> 轮，但摘要区以 ' + Math.round(SUMMARY_RATIO * 100) +
          '% 的体积保留了骨架——这就是篇06"状态压缩"的核心交易：<b>用信息保真度换窗口寿命</b>。');
      } else {
        lines.push('已直接丢弃 <b>' + state.cropped + '</b> 轮历史。被丢弃的不只是闲聊——早期的需求澄清、中间的关键规则，都在其中。');
      }
    }
    lines.push('工程结论：① 工具返回要截断+摘要，别原样回填；② 关键约束放 System 开头或问题尾部；③ ' +
      '窗口要当<b>预算</b>管理（篇06），不是当仓库用——<b>最小充分</b>。');
    v.innerHTML = lines.join('<br>');
  }

  $('uTok').addEventListener('input', function () { $('uV').textContent = $('uTok').value; });
  $('tTok').addEventListener('input', function () { $('tV').textContent = $('tTok').value; });
  $('step').addEventListener('click', runRound);
  $('run8').addEventListener('click', function () {
    var n = 0;
    var timer = setInterval(function () {
      runRound();
      if (++n >= 8) clearInterval(timer);
    }, 260);
  });
  $('reset').addEventListener('click', function () {
    state = { rounds: [], cropped: 0, summary: 0, ruleFate: 'alive', log: [] };
    $('verdict').textContent = '点「跑 1 轮」开始模拟一个 Agent 循环。注意观察：历史越滚越长，第几轮开始触发裁剪？';
    render();
  });
  $('win').addEventListener('change', function () { enforceBudget(); render(); });
  $('sum').addEventListener('change', render);

  render();
};
