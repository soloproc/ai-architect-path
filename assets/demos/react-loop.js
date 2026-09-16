/* react-loop —— ReAct 思考-行动-观察循环可视化（篇05 §2.2）
 * 契约：注册到 window.DEMOS['react-loop']，Shadow DOM，样式内联，无外部依赖。
 * 交互：点「执行一步」推进一次 Thought → Action → Observation；
 * 有 Harness 模式下 Verifier 检查、Stop Condition 判定、预算计量逐格呈现；
 * 切换「无 Harness（裸 while 循环）」对照模式，同一任务会原地打转直到预算烧穿。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['react-loop'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var MAX_STEPS = 10;

  // 有 Harness 的剧本：每步都产生信息增益，第 4 步 Verifier 确认 done
  var SCRIPT = [
    {
      thought: 'GMV 环比 -12%。按计划先验证假设1：流量是否下滑？',
      action: 'sql_query: SELECT uv FROM dwd_traffic_di WHERE week=...',
      obs: 'UV 环比 -18%（artifact#8821，截至周一）',
      gain: true, note: '假设1 → supported（挂证据 artifact#8821）'
    },
    {
      thought: '流量下滑已证实。再验证假设2：转化率是否也在恶化？',
      action: 'sql_query: SELECT cvr FROM dwd_trade_di WHERE week=...',
      obs: 'CVR 环比 -9%（artifact#8822）',
      gain: true, note: '假设2 → supported'
    },
    {
      thought: '验证假设3：客单价是否下降？',
      action: 'sql_query: SELECT gmv/orders AS aov ...',
      obs: '客单价环比 ±1%，基本持平（artifact#8824）',
      gain: true, note: '假设3 → rejected（排除同样写进报告）'
    },
    {
      thought: '三个一级假设都有结论，每个 Claim 都挂了证据引用。',
      action: 'verifier.check(done_criteria)',
      obs: 'Verifier：4 个因子全部覆盖，证据链完整 → DONE',
      gain: true, note: '成功停止：Verifier 确认 done_criteria 满足'
    }
  ];

  // 无 Harness 的剧本：模型礼貌地原地打转，信息增益为零
  var LOOP_FOREVER = [
    { thought: '让我再看一个维度，也许渠道拆分有线索……', action: 'sql_query: 按渠道拆分 GMV', obs: '各渠道均下滑，无新增信息', gain: false },
    { thought: '再拉一个月的数据看看趋势……', action: 'sql_query: 扩展到近 90 天', obs: '趋势与已知结论一致，无新增信息', gain: false },
    { thought: '也许应该再细分到城市级别？', action: 'sql_query: 按城市拆分', obs: '数据量很大，但结论不变', gain: false },
    { thought: '我再检查一下流量的口径……', action: 'sql_query: 重复查询 UV', obs: '与 artifact#8821 完全相同（重复劳动）', gain: false }
  ];

  var state = { steps: [], harness: true };

  // 五类停止条件面板：命中的会点亮
  var STOP_CONDITIONS = [
    { id: 'done', name: '成功停止', desc: 'Verifier 确认 done_criteria' },
    { id: 'budget', name: '预算耗尽', desc: '步数/token/成本触顶走降级' },
    { id: 'nogain', name: '无进展检测', desc: '连续 N 步零信息增益' },
    { id: 'err', name: '错误升级', desc: '同类错误重试 K 次仍失败' },
    { id: 'human', name: '人工停止', desc: '审批拒绝 / 运维终止' }
  ];

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:10px;}' +
    'h4{margin:12px 0 6px;font-size:13px;font-weight:600;}' +
    '.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button:hover{opacity:.88;}' +
    'button:disabled{opacity:.45;cursor:not-allowed;}' +
    '.sw{display:flex;align-items:center;gap:6px;font-size:12px;color:#57534e;}' +
    'input[type=checkbox]{accent-color:#0f766e;}' +
    '.budget{flex:1;min-width:220px;}' +
    '.bar{height:16px;border:1px solid #e5e1d8;border-radius:8px;overflow:hidden;background:#fafaf9;}' +
    '.fill{height:100%;background:#0f766e;transition:width .25s;}' +
    '.blabel{font-size:11px;color:#57534e;display:flex;justify-content:space-between;margin-top:2px;}' +
    '.step{border:1px solid #e5e1d8;border-radius:6px;margin:8px 0;overflow:hidden;}' +
    '.step .hd{background:#fafaf9;padding:5px 10px;font-size:11px;color:#78716c;display:flex;justify-content:space-between;}' +
    '.tao{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;}' +
    '.tao>div{padding:8px 10px;font-size:12px;line-height:1.55;border-left:1px solid #e5e1d8;}' +
    '.tao>div:first-child{border-left:none;}' +
    '.tao .k{font-size:10px;font-weight:700;letter-spacing:1px;margin-bottom:3px;}' +
    '.t .k{color:#0f766e;}.a .k{color:#d97706;}.o .k{color:#57534e;}' +
    '.step .ft{padding:5px 10px;font-size:11px;border-top:1px solid #e5e1d8;background:#f0fdfa;color:#115e59;}' +
    '.step .ft.zero{background:#fef2f2;color:#991b1b;}' +
    '.step.dull{opacity:.85;}' +
    '.hyps{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;}' +
    '.hyp{flex:1;min-width:150px;border:1px solid #e5e1d8;border-radius:6px;padding:6px 9px;font-size:11px;background:#fafaf9;color:#78716c;}' +
    '.hyp .st{display:inline-block;font-size:10px;padding:1px 6px;border-radius:8px;margin-top:3px;color:#fff;background:#a8a29e;}' +
    '.hyp.sup{border-color:#99d5cf;background:#f0fdfa;color:#115e59;}' +
    '.hyp.sup .st{background:#0f766e;}' +
    '.hyp.rej{border-color:#fde68a;background:#fffbeb;color:#92400e;}' +
    '.hyp.rej .st{background:#d97706;}' +
    '.stops{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;}' +
    '.stop{font-size:10px;border:1px solid #e5e1d8;border-radius:10px;padding:2px 8px;color:#a8a29e;background:#fafaf9;}' +
    '.stop.hit{border-color:#0f766e;color:#0f766e;background:#f0fdfa;font-weight:600;}' +
    '.stop.hitbad{border-color:#dc2626;color:#dc2626;background:#fef2f2;font-weight:600;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.verdict.warn{background:#fffbeb;border-color:#fde68a;color:#92400e;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · ReAct 循环与 Harness（篇05 §2.2：Loop 是思考节奏，Harness 是管理制度）</div>' +
    '  <div class="row">' +
    '    <button id="next">执行一步（Think → Act → Observe）</button>' +
    '    <button id="reset" class="ghost">重置</button>' +
    '    <span class="sw"><input type="checkbox" id="noharness"><label for="noharness">无 Harness（裸 while 循环，对照）</label></span>' +
    '  </div>' +
    '  <div class="budget">' +
    '    <div class="bar"><div class="fill" id="fill" style="width:0%"></div></div>' +
    '    <div class="blabel"><span>Autonomy Budget（步数）</span><span id="bv">0 / ' + MAX_STEPS + '</span></div>' +
    '  </div>' +
    '  <h4>Analysis State · 假设树（Harness 管理的结构化状态，不是聊天记录）</h4>' +
    '  <div class="hyps" id="hyps"></div>' +
    '  <h4>Run Timeline</h4>' +
    '  <div id="tl"><div style="font-size:12px;color:#a8a29e">尚未开始。任务：GMV 环比 -12% 归因（done_criteria：四个因子均有证据结论）。</div></div>' +
    '  <h4>五类停止条件（任一命中即停）</h4>' +
    '  <div class="stops" id="stops"></div>' +
    '  <div class="verdict" id="verdict">默认是<b>有 Harness</b> 的模式：每步后 Verifier 检查信息增益，满足 done_criteria 即停。走完后勾选「无 Harness」再跑一遍同一个任务，对比结局。</div>' +
    '  <div class="note">教学简化：真实 ReAct 中 Thought 由模型自由生成，这里用剧本化步骤突出 Harness 四个动作——验证、计量、停止、留痕。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  function used() { return state.steps.length; }

  function render() {
    var pct = used() / MAX_STEPS * 100;
    $('fill').style.width = pct + '%';
    $('fill').style.background = pct >= 90 ? '#dc2626' : (pct >= 60 ? '#d97706' : '#0f766e');
    $('bv').textContent = used() + ' / ' + MAX_STEPS;

    // 假设树面板：有 Harness 时随剧本推进，无 Harness 时永远 pending（没人维护状态）
    var HYPS = ['假设1 流量下滑', '假设2 转化下降', '假设3 客单价下降'];
    var hh = '';
    HYPS.forEach(function (h, i) {
      var cls = '', st = 'pending';
      if (state.harness) {
        if (used() > i && i < 2) { cls = ' sup'; st = 'supported ✓'; }
        if (used() > 2 && i === 2) { cls = ' rej'; st = 'rejected（已排除）'; }
      }
      hh += '<div class="hyp' + cls + '">' + h + '<br><span class="st">' + st + '</span></div>';
    });
    $('hyps').innerHTML = hh;

    // 停止条件面板
    var hits = {};
    if (state.harness && used() >= SCRIPT.length) hits.done = true;
    if (!state.harness) {
      if (used() >= 3) hits.nogain = true;
      if (used() >= MAX_STEPS) hits.budget = true;
    }
    var sh = '';
    STOP_CONDITIONS.forEach(function (sc) {
      var cls = hits[sc.id] ? (sc.id === 'budget' ? ' hitbad' : ' hit') : '';
      sh += '<span class="stop' + cls + '" title="' + sc.desc + '">' + sc.name + '</span>';
    });
    $('stops').innerHTML = sh;

    var html = '';
    state.steps.forEach(function (s, i) {
      html += '<div class="step' + (s.gain ? '' : ' dull') + '">' +
        '<div class="hd"><span>Step ' + (i + 1) + '</span><span>' + (s.gain ? '信息增益 ✓' : '信息增益 ✗') + '</span></div>' +
        '<div class="tao">' +
        '<div class="t"><div class="k">THOUGHT</div>' + s.thought + '</div>' +
        '<div class="a"><div class="k">ACTION</div>' + s.action + '</div>' +
        '<div class="o"><div class="k">OBSERVATION</div>' + s.obs + '</div>' +
        '</div>' +
        (s.note ? '<div class="ft' + (s.gain ? '' : ' zero') + '">' + (state.harness ? 'Harness 记录：' : '') + s.note + '</div>' : '') +
        '</div>';
    });
    $('tl').innerHTML = html || '<div style="font-size:12px;color:#a8a29e">尚未开始。任务：GMV 环比 -12% 归因（done_criteria：四个因子均有证据结论）。</div>';
  }

  function verdict(cls, html) {
    var v = $('verdict');
    v.className = 'verdict' + (cls ? ' ' + cls : '');
    v.innerHTML = html;
  }

  $('next').addEventListener('click', function () {
    var n = used();
    if (n >= MAX_STEPS) return;

    if (state.harness) {
      if (n < SCRIPT.length) {
        state.steps.push(SCRIPT[n]);
      }
      render();
      if (used() === SCRIPT.length) {
        $('next').disabled = true;
        verdict('', '✅ <b>成功停止</b>：第 ' + SCRIPT.length + ' 步 Verifier 确认 done_criteria 全部满足，Run → SUCCEEDED。' +
          '只花了 ' + SCRIPT.length + '/' + MAX_STEPS + ' 步预算。注意三件事：停止决定是<b>代码</b>做的（不是模型说"我做完了"）；' +
          '被排除的假设3同样留在记录里；每步信息增益都有据可查。');
      } else {
        verdict('', 'Step ' + used() + ' 完成：Verifier 确认本步有信息增益，继续。命中 done_criteria 时循环会立即终止——不会"为了用完预算而探索"。');
      }
    } else {
      var s = LOOP_FOREVER[n % LOOP_FOREVER.length];
      state.steps.push({ thought: s.thought, action: s.action, obs: s.obs, gain: s.gain, note: '无 Verifier / 无 Stop Condition，循环继续……' });
      render();
      var zeroStreak = used();
      if (used() >= MAX_STEPS) {
        $('next').disabled = true;
        verdict('bad', '🛑 <b>预算烧穿</b>：' + MAX_STEPS + ' 步全部耗尽，任务却离 done 一样远——模型每一步都"看起来很努力"，' +
          '但没有 Verifier 判定增益、没有 Stop Condition 喊停、没有 done_criteria 对齐方向。<b>这就是裸 while 循环进生产的死法：</b>' +
          '不是崩了，是安静地烧钱。切回有 Harness 模式，看同一个任务几步能停。');
      } else if (zeroStreak >= 3) {
        verdict('warn', '🔶 已连续 ' + zeroStreak + ' 步零信息增益——有 Harness 时这里早已触发「无进展检测」停止条件。裸循环里没有谁喊停。');
      } else {
        verdict('warn', '循环继续。观察一个细节：每步的 Thought 都"合情合理"，这正是裸循环最危险的地方——<b>跑偏不是以报错的形式出现的</b>。');
      }
    }
  });

  $('reset').addEventListener('click', function () {
    state.steps = [];
    $('next').disabled = false;
    render();
    verdict('', state.harness
      ? '默认是<b>有 Harness</b> 的模式：每步后 Verifier 检查信息增益，满足 done_criteria 即停。走完后勾选「无 Harness」再跑一遍同一个任务，对比结局。'
      : '对照模式：没有 Verifier、没有 Stop Condition。持续点「执行一步」，观察循环如何原地打转直到预算耗尽。');
  });

  $('noharness').addEventListener('change', function () {
    state.harness = !$('noharness').checked;
    state.steps = [];
    $('next').disabled = false;
    render();
    verdict('', state.harness
      ? '已切回<b>有 Harness</b> 模式。'
      : '对照模式：没有 Verifier、没有 Stop Condition。持续点「执行一步」，观察循环如何原地打转直到预算耗尽。');
  });

  render();
};
