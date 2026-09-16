/* tool-permission —— 工具权限沙箱决策模拟（篇07 §2.4 / §3.2：动态 ToolSet 编译 + 风险分级 + 审批门禁）
 * 契约：注册到 window.DEMOS['tool-permission']，Shadow DOM，样式内联，无外部依赖。
 * 选择角色（只读分析师/运营专员/租户管理员），把 7 个预置工具调用请求逐个送入决策链：
 * ① ToolSet 编译（最小可见面）→ ② Schema 校验 → ③ 授权（用户×租户×角色）→
 * ④ 风险分级（L1 自动 / L2 自动+通知 / L3 强制人工审批）→ ⑤ 执行（幂等去重）→ ⑥ 审计留痕。
 * 可打开「关闭 ToolSet 编译」对照开关，观察全量工具暴露后越权请求如何穿透到更后面的环节。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['tool-permission'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var ROLES = {
    analyst: { label: '只读分析师', tools: ['query_metrics', 'run_python_analysis'] },
    operator: { label: '运营专员', tools: ['query_metrics', 'run_python_analysis', 'create_ticket_draft'] },
    admin: { label: '租户管理员', tools: ['query_metrics', 'run_python_analysis', 'create_ticket_draft', 'adjust_ad_budget'] }
  };

  // 预置请求序列：覆盖正常、越界、跨租户伪造、重复重放四类典型情形
  var REQUESTS = [
    { id: 'r1', tool: 'query_metrics', label: '查询本店昨日 GMV', risk: 'L1', tenant: 'A', schemaOK: true,
      desc: '只读指标查询，本租户数据' },
    { id: 'r2', tool: 'export_order_detail', label: '导出原始订单明细', risk: 'L1', tenant: 'A', schemaOK: true, hidden: true,
      desc: '数据分级为机密，不在任何角色的 ToolSet 内' },
    { id: 'r3', tool: 'create_ticket_draft', label: '创建补货工单草稿', risk: 'L2', tenant: 'A', schemaOK: true,
      desc: '可逆写入：仅创建草稿，可撤销' },
    { id: 'r4', tool: 'query_metrics', label: '查询华北区 GMV（参数伪造 tenant=B）', risk: 'L1', tenant: 'B', schemaOK: true,
      desc: '模型/用户自报租户 B，授权环节必须拦截' },
    { id: 'r5', tool: 'adjust_ad_budget', label: '把广告预算 5 万 → 8 万', risk: 'L3', tenant: 'A', schemaOK: true, req: 'req-9001',
      desc: '资金类生产变更，强制人工审批' },
    { id: 'r6', tool: 'adjust_ad_budget', label: '同一请求重放（request_id 相同）', risk: 'L3', tenant: 'A', schemaOK: true, req: 'req-9001', replay: true,
      desc: 'Runtime 重试导致的重复投递，幂等键应去重' },
    { id: 'r7', tool: 'adjust_ad_budget', label: '预算参数缺失（缺 campaign_id）', risk: 'L3', tenant: 'A', schemaOK: false,
      desc: 'Schema 校验应最早拦下，附 FIX_PARAMS 反馈' }
  ];

  var STAGES = ['ToolSet 编译', 'Schema 校验', '授权', '风险分级', '执行', '审计'];
  var state = { role: 'analyst', results: {}, pendingApproval: null, seenReqs: {}, audit: [] };

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:10px;}' +
    'h4{margin:12px 0 8px;font-size:13px;font-weight:600;}' +
    '.roles{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:5px 11px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button.role-on{background:#115e59;border-color:#115e59;}' +
    'button:hover{opacity:.88;}' +
    'button:disabled{opacity:.4;cursor:not-allowed;}' +
    '.chk{display:flex;align-items:center;gap:6px;font-size:12px;color:#57534e;margin:6px 0;}' +
    'input[type=checkbox]{accent-color:#dc2626;}' +
    '.reqs{display:flex;flex-direction:column;gap:6px;margin:8px 0;}' +
    '.req{display:flex;align-items:center;gap:10px;border:1px solid #e7e5e4;border-radius:6px;padding:7px 10px;font-size:12px;background:#fafaf9;}' +
    '.req .nm{flex:1;}' +
    '.req .tag{font-size:10px;border-radius:3px;padding:1px 6px;color:#fff;white-space:nowrap;}' +
    '.tag.L1{background:#0f766e;}.tag.L2{background:#d97706;}.tag.L3{background:#dc2626;}' +
    '.badge{font-size:11px;font-weight:600;white-space:nowrap;}' +
    '.b-ok{color:#0f766e;}.b-warn{color:#d97706;}.b-bad{color:#dc2626;}.b-mut{color:#a8a29e;}' +
    '.pipe{display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin:8px 0;}' +
    '.st{border:1px solid #e7e5e4;border-radius:5px;padding:5px 9px;font-size:11px;background:#fafaf9;color:#a8a29e;transition:all .2s;}' +
    '.st.on{background:#f0fdfa;border-color:#99d5cf;color:#115e59;font-weight:600;}' +
    '.st.hit{background:#0f766e;border-color:#0f766e;color:#fff;font-weight:600;}' +
    '.st.block{background:#fef2f2;border-color:#fecaca;color:#991b1b;font-weight:600;}' +
    '.arrow{color:#d6d3d1;font-size:11px;}' +
    '.trace{font-size:12px;background:#fafaf9;border:1px solid #e7e5e4;border-radius:6px;padding:8px 10px;min-height:34px;line-height:1.7;color:#44403c;}' +
    '.approve{margin:8px 0;padding:9px 12px;border:1px solid #fbbf24;background:#fffbeb;border-radius:6px;font-size:12px;display:none;line-height:1.7;}' +
    '.audit{max-height:130px;overflow:auto;font-size:11px;border:1px solid #e7e5e4;border-radius:6px;background:#fafaf9;padding:6px 10px;line-height:1.8;color:#57534e;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.metrics{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;}' +
    '.metric{flex:1;min-width:96px;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:7px 10px;}' +
    '.metric .k{font-size:11px;color:#78716c;}.metric .v{font-size:18px;font-weight:600;color:#0f766e;}' +
    '.metric .v.warn{color:#d97706;}.metric .v.bad{color:#dc2626;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 工具权限沙箱决策模拟（篇07：最小可见面 × 风险分级 × 审批门禁）</div>' +
    '  <h4>① 选择当前角色（决定 ToolSet 编译结果）</h4>' +
    '  <div class="roles" id="roles"></div>' +
    '  <label class="chk"><input type="checkbox" id="noCompile"> 关闭 ToolSet 编译（全量工具暴露·危险对照）</label>' +
    '  <h4>② 把请求送入决策链（逐个点「发送」，观察每一站在哪拦截）</h4>' +
    '  <div class="reqs" id="reqs"></div>' +
    '  <h4>③ 决策链现场</h4>' +
    '  <div class="pipe" id="pipe"></div>' +
    '  <div class="trace" id="trace">尚未发送请求。先选角色，再从 r1 开始逐个发送。</div>' +
    '  <div class="approve" id="approve"></div>' +
    '  <div class="metrics">' +
    '    <div class="metric"><div class="k">放行执行</div><div class="v" id="mOk">0</div></div>' +
    '    <div class="metric"><div class="k">编译期不可见</div><div class="v" id="mHide">0</div></div>' +
    '    <div class="metric"><div class="k">校验/授权拦截</div><div class="v warn" id="mBlock">0</div></div>' +
    '    <div class="metric"><div class="k">人工审批</div><div class="v warn" id="mAppr">0</div></div>' +
    '    <div class="metric"><div class="k">幂等去重</div><div class="v" id="mDedup">0</div></div>' +
    '  </div>' +
    '  <h4>④ 审计日志（Tool Trace）</h4>' +
    '  <div class="audit" id="audit">— 空 —</div>' +
    '  <div style="margin-top:8px"><button id="reset" class="ghost">重置沙箱</button></div>' +
    '  <div class="verdict" id="verdict">教学结论会随着你的操作在这里汇总。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  // 渲染角色按钮
  Object.keys(ROLES).forEach(function (key) {
    var b = document.createElement('button');
    b.textContent = ROLES[key].label;
    b.className = key === state.role ? 'role-on' : 'ghost';
    b.addEventListener('click', function () {
      state.role = key;
      Array.prototype.forEach.call($('roles').children, function (c) { c.className = 'ghost'; });
      b.className = 'role-on';
      $('trace').textContent = '已切换为「' + ROLES[key].label + '」。注意：同一个请求，角色不同，命运不同——重发几条试试。';
      verdict();
    });
    $('roles').appendChild(b);
  });

  // 渲染决策链站点
  var stageEls = STAGES.map(function (name) {
    var el = document.createElement('span');
    el.className = 'st'; el.textContent = name;
    $('pipe').appendChild(el);
    if (name !== '审计') {
      var a = document.createElement('span'); a.className = 'arrow'; a.textContent = '→';
      $('pipe').appendChild(a);
    }
    return el;
  });

  function paintPipe(upto, blockAt) {
    stageEls.forEach(function (el, i) {
      el.className = 'st';
      if (blockAt !== null && i === blockAt) el.className = 'st block';
      else if (blockAt === null && i <= upto) el.className = 'st hit';
      else if (blockAt !== null && i < blockAt) el.className = 'st on';
    });
  }

  function log(text) {
    if (state.audit.length === 0) $('audit').innerHTML = '';
    state.audit.push(text);
    var div = document.createElement('div');
    div.innerHTML = text;
    $('audit').appendChild(div);
    $('audit').scrollTop = $('audit').scrollHeight;
  }

  function counts() {
    var c = { ok: 0, hide: 0, block: 0, appr: 0, dedup: 0 };
    Object.keys(state.results).forEach(function (k) {
      var r = state.results[k];
      if (r === 'ok') c.ok++; else if (r === 'hide') c.hide++;
      else if (r === 'appr') c.appr++; else if (r === 'dedup') c.dedup++;
      else c.block++;
    });
    return c;
  }

  function verdict() {
    var c = counts();
    $('mOk').textContent = c.ok; $('mHide').textContent = c.hide;
    $('mBlock').textContent = c.block; $('mAppr').textContent = c.appr; $('mDedup').textContent = c.dedup;
    var v = $('verdict');
    var total = Object.keys(state.results).length;
    if (total === 0) { v.className = 'verdict'; v.textContent = '教学结论会随着你的操作在这里汇总。'; return; }
    var lines = [];
    lines.push('已裁决 <b>' + total + '</b> 次请求：放行 ' + c.ok + ' · 编译期不可见 ' + c.hide +
      ' · 校验/授权拦截 ' + c.block + ' · 经人工审批 ' + c.appr + ' · 幂等去重 ' + c.dedup + '。');
    if ($('noCompile').checked && c.block > 0) {
      v.className = 'verdict bad';
      lines.push('⚠️ 全量工具暴露模式下，越权请求穿透到了 ②③ 环节才被拦——每一道后置防线都有失效概率，' +
        '「模型根本看不见这把刀」才是最便宜、最可靠的权限控制。这就是最小可见面原则。');
    } else {
      v.className = 'verdict';
      lines.push('✅ 注意三道防线的分工：编译期剔除是<b>结构性不可见</b>（成本零、不可绕过）；' +
        '授权校验是<b>身份性拦截</b>（不信模型自报的 tenant_id）；审批门禁是<b>风险性拦截</b>（L3 动作永远要人点头）。' +
        '再加上幂等键去重重放——模型的「提议面」与系统的「执行面」就这样被彻底分开。');
    }
    v.innerHTML = lines.join('<br>');
  }

  function decide(req) {
    var role = ROLES[state.role];
    var noCompile = $('noCompile').checked;
    // ① ToolSet 编译
    if (!noCompile && (req.hidden || role.tools.indexOf(req.tool) < 0)) {
      return { stop: 0, kind: 'hide', msg: '① ToolSet 编译：「' + req.tool + '」不在「' + role.label + '」的最小工具集内——模型本轮根本看不到它，调用在提议阶段即被丢弃。' };
    }
    // ② Schema 校验
    if (!req.schemaOK) {
      return { stop: 1, kind: 'block', msg: '② Schema 校验：缺少必填参数 campaign_id，拒绝并回传 error_action=FIX_PARAMS——模型应修正参数后重调，重试一百次原样参数也没用。' };
    }
    // ③ 授权：租户伪造
    if (req.tenant !== 'A') {
      return { stop: 2, kind: 'block', msg: '③ 授权：请求自报 tenant=B，但安全上下文中的真实租户是 A。Scope 只信安全上下文、不信模型/用户自报——跨租户访问拦截，error_action=STOP 并升级人工。' };
    }
    // ③ 授权：角色无此工具权限（全量暴露对照模式下才会走到这里）
    if (role.tools.indexOf(req.tool) < 0) {
      return { stop: 2, kind: 'block', msg: '③ 授权：「' + role.label + '」无「' + req.tool + '」的执行权限。注意：因为关闭了 ToolSet 编译，这个请求穿透到了第三道防线才被拦——防线越靠后，失效代价越大。' };
    }
    // ⑤ 幂等去重（先于风险分级后的真实执行）
    if (req.replay && state.seenReqs[req.req]) {
      return { stop: 4, kind: 'dedup', msg: '⑤ 执行：request_id=' + req.req + ' 已见于去重表——直接返回首次执行结果，不发生二次扣款。重试与重复投递是生产常态，幂等键是唯一的护身符。' };
    }
    // ④ 风险分级
    if (req.risk === 'L3') {
      return { stop: 3, kind: 'need_approval', msg: '④ 风险分级：L3 资金/生产变更——模型只能走到「提议 + 生成预览」，审批权永远在人手里。请在下方审批区做决定。' };
    }
    var note = req.risk === 'L2' ? 'L2 可逆写：自动执行 + 通知相关人，全程可撤销。' : 'L1 只读：自动放行，仅记录审计。';
    return { stop: null, kind: 'ok', msg: '④ 风险分级：' + note + ' ⑤ 执行成功（短期窄范围凭据，用完即焚），⑥ 已写入 Tool Trace。' };
  }

  function send(req, btn) {
    var d = decide(req);
    var badge = btn.parentNode.querySelector('.badge');
    if (d.kind === 'need_approval') {
      paintPipe(3, null);
      $('trace').innerHTML = '<b>' + req.label + '</b><br>' + d.msg;
      var ap = $('approve');
      ap.style.display = 'block';
      ap.innerHTML = '🔔 <b>人工审批（L3）</b> 预算调整预览：campaign=华东618会场，5 万 → 8 万（+60%），理由：' + req.desc +
        '<br><br><button id="apY">批准执行</button> <button id="apN" class="ghost">驳回</button>';
      $('apY').addEventListener('click', function () {
        ap.style.display = 'none';
        state.seenReqs[req.req] = true;
        state.results[req.id] = 'appr';
        paintPipe(5, null);
        $('trace').innerHTML = '<b>' + req.label + '</b><br>审批通过 → ⑤ 执行（幂等键 ' + req.req + ' 登记）→ 验真回读一致 → ⑥ 审计归档。';
        badge.textContent = '审批通过·已执行'; badge.className = 'badge b-warn';
        log('[' + req.id + '] L3 审批通过并执行：' + req.label + '（审批人：当前用户）');
        verdict();
      });
      $('apN').addEventListener('click', function () {
        ap.style.display = 'none';
        state.results[req.id] = 'block';
        paintPipe(3, 3);
        $('trace').innerHTML = '<b>' + req.label + '</b><br>审批人驳回 → 终止并记录原因。模型收到「未获批准」的结果语义，应如实转告用户，不得换个说法重试。';
        badge.textContent = '审批驳回'; badge.className = 'badge b-bad';
        log('[' + req.id + '] L3 审批驳回：' + req.label);
        verdict();
      });
      return;
    }
    state.results[req.id] = d.kind;
    if (d.kind === 'ok') {
      paintPipe(5, null);
      badge.textContent = '已执行'; badge.className = 'badge b-ok';
    } else if (d.kind === 'dedup') {
      paintPipe(4, null);
      badge.textContent = '幂等去重'; badge.className = 'badge b-ok';
    } else {
      paintPipe(d.stop, d.stop);
      badge.textContent = d.kind === 'hide' ? '编译期不可见' : '已拦截';
      badge.className = d.kind === 'hide' ? 'badge b-mut' : 'badge b-bad';
    }
    $('trace').innerHTML = '<b>' + req.label + '</b>（' + req.desc + '）<br>' + d.msg;
    log('[' + req.id + '] ' + badge.textContent + '：' + req.label + '（角色：' + ROLES[state.role].label + '）');
    verdict();
  }

  // 渲染请求列表
  REQUESTS.forEach(function (req) {
    var row = document.createElement('div');
    row.className = 'req';
    row.innerHTML = '<span class="tag ' + req.risk + '">' + req.risk + '</span>' +
      '<span class="nm"><b>[' + req.id + ']</b> ' + req.label + '</span>' +
      '<span class="badge b-mut">未发送</span>';
    var b = document.createElement('button');
    b.textContent = '发送'; b.className = 'ghost';
    b.addEventListener('click', function () { send(req, b); });
    row.appendChild(b);
    $('reqs').appendChild(row);
  });

  $('reset').addEventListener('click', function () {
    state.results = {}; state.seenReqs = {}; state.audit = [];
    $('audit').innerHTML = '— 空 —';
    $('approve').style.display = 'none';
    Array.prototype.forEach.call($('reqs').children, function (row) {
      var badge = row.querySelector('.badge');
      badge.textContent = '未发送'; badge.className = 'badge b-mut';
    });
    paintPipe(-1, null);
    $('trace').textContent = '沙箱已重置。换个角色再玩一遍：同一个 r4 请求，只读分析师与运营专员的命运有何不同？';
    verdict();
  });

  paintPipe(-1, null);
};
