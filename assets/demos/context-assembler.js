/* context-assembler —— 上下文装配模拟器（篇06 §3：动态上下文装配与预算）
 * 契约：注册到 window.DEMOS['context-assembler']，Shadow DOM，样式内联，无外部依赖。
 * 左侧 15 条候选 ContextItem（含跨租户/不可信/冲突版本/重复证据）；滑块调总 Token Budget；
 * 点「开始装配」动画演示四段管线：① 硬过滤 → ② 去重冲突 → ③ 分区装填（含可信压缩）→ ④ 充分性检查；
 * 右侧输出最终 Prompt 预览与取舍审计日志；「关闭硬过滤」开关展示注入与跨租户泄漏后果。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['context-assembler'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var ITEMS = [
    { id: 'sys-rules',   title: '系统指令与行为准则',            zone: 'rules',    tokens: 600,  tenant: 'A', trust: 'system',             required: true,  prio: 1 },
    { id: 'fmt-contract',title: '输出格式契约（Markdown 模板）', zone: 'rules',    tokens: 300,  tenant: 'A', trust: 'system',             required: true,  prio: 2 },
    { id: 'task-contract',title: 'Task Contract：诊断华东 GMV 下降', zone: 'task', tokens: 350,  tenant: 'A', trust: 'system',             required: true,  prio: 1 },
    { id: 'step-goal',   title: '当前 Step 目标：确认指标口径',   zone: 'task',     tokens: 200,  tenant: 'A', trust: 'system',             required: true,  prio: 2 },
    { id: 'state-sum',   title: 'Analysis State 摘要（3 个未闭合问题）', zone: 'task', tokens: 450, tenant: 'A', trust: 'governed',         prio: 3 },
    { id: 'gmv-v42',     title: 'GMV 口径 v42（不含运费·现行）',  zone: 'semantic', tokens: 380,  tenant: 'A', trust: 'governed', group: 'gmv', ver: 42, prio: 1 },
    { id: 'gmv-v41',     title: 'GMV 口径 v41（含运费·已过期）',  zone: 'semantic', tokens: 380,  tenant: 'A', trust: 'governed', group: 'gmv', ver: 41, prio: 2 },
    { id: 'dim-east',    title: '维度定义：华东区门店层级',       zone: 'semantic', tokens: 300,  tenant: 'A', trust: 'governed',            prio: 3 },
    { id: 'gmv-b',       title: 'GMV 口径（租户 B 私有版）',      zone: 'semantic', tokens: 400,  tenant: 'B', trust: 'governed',            prio: 1 },
    { id: 'ev-anomaly',  title: '证据：异常检测报告 artifact#2211', zone: 'evidence', tokens: 1500, tenant: 'A', trust: 'governed',          prio: 1 },
    { id: 'ev-dup',      title: '证据副本：异常检测报告（重复投递）', zone: 'evidence', tokens: 1500, tenant: 'A', trust: 'governed', dupOf: 'ev-anomaly', prio: 9 },
    { id: 'ev-weather',  title: '证据：天气数据快照 artifact#2215', zone: 'evidence', tokens: 1200, tenant: 'A', trust: 'governed',          prio: 2 },
    { id: 'ev-refund',   title: '证据：退款率原始查询结果（5 万行）', zone: 'evidence', tokens: 3000, tenant: 'A', trust: 'governed',        prio: 3 },
    { id: 'ev-history',  title: '历史对话记录（20 轮原文）',       zone: 'evidence', tokens: 2000, tenant: 'A', trust: 'external',           prio: 4 },
    { id: 'ev-inject',   title: '外部文档：含「忽略以上指令」字样', zone: 'evidence', tokens: 800,  tenant: 'A', trust: 'external_untrusted', prio: 0 }
  ];

  var ZONES = [
    { id: 'rules',    name: '规则区',     share: 0.20 },
    { id: 'task',     name: '任务/状态区', share: 0.20 },
    { id: 'semantic', name: '语义区',     share: 0.26 },
    { id: 'evidence', name: '证据区',     share: 0.34 }
  ];
  var RESERVE = 0.15; // 输出预留占比
  var ZONE_NAME = {};
  ZONES.forEach(function (z) { ZONE_NAME[z.id] = z.name; });

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    '.cols{display:flex;gap:14px;flex-wrap:wrap;}' +
    '.col-l{flex:1 1 300px;min-width:280px;}' +
    '.col-r{flex:1 1 320px;min-width:300px;}' +
    'h4{margin:4px 0 8px;font-size:13px;font-weight:600;color:#1c1917;}' +
    '.pool{display:flex;flex-direction:column;gap:5px;max-height:420px;overflow:auto;padding-right:2px;}' +
    '.it{border:1px solid #e5e1d8;border-radius:6px;padding:6px 8px;font-size:12px;background:#fafaf9;transition:all .3s;}' +
    '.it .t{font-weight:600;font-size:12px;}' +
    '.it .badges{margin-top:3px;display:flex;gap:4px;flex-wrap:wrap;}' +
    '.bd{font-size:10px;padding:1px 5px;border-radius:8px;border:1px solid #e5e1d8;color:#78716c;background:#fff;}' +
    '.bd.zone{color:#0f766e;border-color:#99d5cf;}' +
    '.bd.tb{color:#991b1b;border-color:#fecaca;}' +
    '.bd.untrust{color:#991b1b;border-color:#fecaca;}' +
    '.bd.req{color:#115e59;border-color:#5eead4;}' +
    '.it.hard{opacity:.45;background:#f5f5f4;border-style:dashed;}' +
    '.it.hard .t{text-decoration:line-through;}' +
    '.it.dedup{opacity:.5;background:#fffbeb;border-color:#fcd34d;}' +
    '.it.dedup .t{text-decoration:line-through;}' +
    '.it.drop{opacity:.4;background:#f5f5f4;}' +
    '.it.drop .t{text-decoration:line-through;}' +
    '.it.pack{border-color:#0f766e;background:#f0fdfa;}' +
    '.it.comp{border-color:#d97706;background:#fffbeb;}' +
    '.row{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;}' +
    '.ctl{display:flex;flex-direction:column;gap:3px;min-width:160px;flex:1;}' +
    '.ctl label{font-size:11px;color:#57534e;display:flex;justify-content:space-between;gap:8px;}' +
    '.ctl label b{color:#0f766e;font-variant-numeric:tabular-nums;}' +
    'input[type=range]{width:100%;accent-color:#0f766e;}' +
    'input[type=checkbox]{accent-color:#0f766e;}' +
    '.chk{display:flex;align-items:center;gap:6px;font-size:12px;color:#57534e;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button:hover{opacity:.88;}' +
    '.stages{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 10px;}' +
    '.stg{font-size:11px;padding:3px 9px;border-radius:10px;border:1px solid #e5e1d8;color:#a8a29e;background:#fafaf9;transition:all .25s;}' +
    '.stg.on{background:#0f766e;color:#fff;border-color:#0f766e;}' +
    '.zbar{margin-bottom:7px;}' +
    '.zbar .lb{font-size:11px;color:#57534e;display:flex;justify-content:space-between;margin-bottom:2px;}' +
    '.zbar .lb b{font-variant-numeric:tabular-nums;color:#0f766e;}' +
    '.bar{height:12px;border:1px solid #e5e1d8;border-radius:6px;overflow:hidden;background:#fafaf9;}' +
    '.fill{height:100%;background:#0f766e;width:0%;transition:width .6s;}' +
    '.fill.amber{background:#d97706;}' +
    'pre{background:#1c1917;color:#d6d3d1;border-radius:6px;padding:10px 12px;font-size:11px;line-height:1.7;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:auto;margin:6px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}' +
    '.log{border:1px solid #e5e1d8;border-radius:6px;background:#fafaf9;padding:8px 10px;font-size:11px;line-height:1.8;max-height:170px;overflow:auto;color:#44403c;}' +
    '.verdict{margin-top:10px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 上下文装配模拟器（篇06 §3：先过滤后排序，分区预算保底）</div>' +
    '  <div class="cols">' +
    '    <div class="col-l">' +
    '      <h4>候选信息池（15 条 ContextItem）</h4>' +
    '      <div class="pool" id="pool"></div>' +
    '    </div>' +
    '    <div class="col-r">' +
    '      <div class="row">' +
    '        <div class="ctl" style="max-width:240px"><label>总 Token Budget <b id="budgetV">6000</b></label>' +
    '          <input id="budget" type="range" min="3000" max="9000" step="250" value="6000"></div>' +
    '        <div class="ctl" style="flex:0;min-width:auto"><button id="run">开始装配</button></div>' +
    '        <div class="ctl" style="flex:0;min-width:auto;justify-content:flex-end">' +
    '          <span class="chk"><input type="checkbox" id="noFilter"><label for="noFilter">关闭硬过滤（危险演示）</label></span></div>' +
    '      </div>' +
    '      <div class="stages">' +
    '        <span class="stg" id="stg1">① 硬过滤</span>' +
    '        <span class="stg" id="stg2">② 去重冲突</span>' +
    '        <span class="stg" id="stg3">③ 分区装填</span>' +
    '        <span class="stg" id="stg4">④ 充分性检查</span>' +
    '      </div>' +
    '      <div id="zbars"></div>' +
    '      <h4 style="margin-top:10px">最终 Prompt 预览</h4>' +
    '      <pre id="preview">点击「开始装配」，观察四段管线如何裁决每一条候选信息。</pre>' +
    '      <h4>取舍审计日志（Context Decision Trace）</h4>' +
    '      <div class="log" id="plog">—</div>' +
    '      <div class="verdict" id="verdict">候选池里埋了四处隐患：一条租户 B 的口径、一份含注入指令的外部文档、一对冲突的 GMV 口径版本、一条重复投递的证据。点「开始装配」看管线如何处理它们。</div>' +
    '      <div class="note">教学简化：输出预留固定 15%，四区按比例瓜分其余预算；证据区放不下的条目先尝试压缩为 15% 大小的 Artifact 引用卡，仍放不下才整体剔除。</div>' +
    '    </div>' +
    '  </div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  // ---- 候选池渲染 ----
  var itemEls = {};
  var pool = $('pool');
  ITEMS.forEach(function (it) {
    var d = document.createElement('div');
    d.className = 'it';
    var badges = '<span class="bd zone">' + ZONE_NAME[it.zone] + '</span>' +
      '<span class="bd' + (it.tenant === 'B' ? ' tb' : '') + '">租户 ' + it.tenant + '</span>' +
      '<span class="bd' + (it.trust === 'external_untrusted' ? ' untrust' : '') + '">' + it.trust + '</span>' +
      (it.required ? '<span class="bd req">必需</span>' : '') +
      '<span class="bd">' + it.tokens + ' tok</span>';
    d.innerHTML = '<div class="t">' + it.title + '</div><div class="badges">' + badges + '</div>';
    pool.appendChild(d);
    itemEls[it.id] = d;
  });

  // ---- 分区预算条 ----
  var zbarFill = {}, zbarVal = {};
  var zbarsEl = $('zbars');
  ZONES.forEach(function (z) {
    var d = document.createElement('div');
    d.className = 'zbar';
    d.innerHTML = '<div class="lb"><span>' + z.name + '（' + Math.round(z.share * 100) + '%）</span><b id="zv-' + z.id + '">—</b></div>' +
      '<div class="bar"><div class="fill" id="zf-' + z.id + '"></div></div>';
    zbarsEl.appendChild(d);
  });
  ZONES.forEach(function (z) {
    zbarFill[z.id] = shadow.getElementById('zf-' + z.id);
    zbarVal[z.id] = shadow.getElementById('zv-' + z.id);
  });

  // ---- 装配计算（纯函数） ----
  function assemble(budget, hardOn) {
    var usable = Math.round(budget * (1 - RESERVE));
    var st = {}, compTok = {}, log = [], risks = [];
    ITEMS.forEach(function (it) { st[it.id] = 'idle'; });

    // ① 硬过滤：租户 / 信任边界，不可被相关性绕过
    var kept = [];
    ITEMS.forEach(function (it) {
      if (hardOn && it.tenant !== 'A') {
        st[it.id] = 'hard';
        log.push('① 硬过滤：「' + it.title + '」跨租户（tenant=B），出局——无论它与问题多相关');
      } else if (hardOn && it.trust === 'external_untrusted') {
        st[it.id] = 'hard';
        log.push('① 硬过滤：「' + it.title + '」trust=external_untrusted，疑含注入指令，出局');
      } else kept.push(it);
    });
    if (!hardOn) log.push('① 硬过滤：⚠️ 开关已关闭——跨租户与不可信内容被放行进入后续阶段');

    // ② 去重与冲突裁决：版本新者优先
    var groups = {};
    kept.forEach(function (it) { if (it.group) (groups[it.group] = groups[it.group] || []).push(it); });
    var conflictDropped = {};
    Object.keys(groups).forEach(function (g) {
      var arr = groups[g].slice().sort(function (a, b) { return b.ver - a.ver; });
      for (var i = 1; i < arr.length; i++) {
        conflictDropped[arr[i].id] = true;
        st[arr[i].id] = 'dedup';
        log.push('② 冲突裁决：「' + arr[i].title + '」与「' + arr[0].title + '」矛盾，版本新者优先，旧版出局（冲突事实本身已写入上下文）');
      }
    });
    var pass2 = kept.filter(function (it) {
      if (it.dupOf) {
        st[it.id] = 'dedup';
        log.push('② 去重：「' + it.title + '」与「' + it.dupOf + '」内容重复，仅留引用计数');
        return false;
      }
      return !conflictDropped[it.id];
    });

    // ③ 分区预算装填：必需保底，证据区弹性压缩
    var zoneBudget = {}, zoneUsed = {}, packed = [];
    ZONES.forEach(function (z) { zoneBudget[z.id] = Math.round(usable * z.share); zoneUsed[z.id] = 0; });
    ZONES.forEach(function (z) {
      var items = pass2.filter(function (it) { return it.zone === z.id; })
        .sort(function (a, b) { return ((b.required ? 1 : 0) - (a.required ? 1 : 0)) || (a.prio - b.prio); });
      items.forEach(function (it) {
        if (zoneUsed[z.id] + it.tokens <= zoneBudget[z.id]) {
          zoneUsed[z.id] += it.tokens; st[it.id] = 'pack'; packed.push(it);
        } else if (z.id === 'evidence') {
          var ct = Math.ceil(it.tokens * 0.15);
          if (zoneUsed[z.id] + ct <= zoneBudget[z.id]) {
            zoneUsed[z.id] += ct; st[it.id] = 'comp'; compTok[it.id] = ct; packed.push(it);
            log.push('③ 可信压缩：「' + it.title + '」' + it.tokens + ' → ' + ct + ' tok，压缩为 Artifact 引用卡（保留来源与数据时间）');
          } else {
            st[it.id] = 'drop';
            log.push('③ 预算挤占：「' + it.title + '」连引用卡（' + ct + ' tok）都放不下，整体剔除，artifact 指针留存于 State');
          }
        } else {
          st[it.id] = 'drop';
          log.push('③ 预算挤占：「' + it.title + '」超出' + z.name + '预算，出局');
        }
      });
      log.push('③ 装填：' + z.name + ' ' + zoneUsed[z.id] + ' / ' + zoneBudget[z.id] + ' tok');
    });

    // 注入风险（硬过滤关闭时）
    packed.forEach(function (it) {
      if (it.tenant === 'B') risks.push('跨租户口径「' + it.title + '」进入 Prompt——模型将基于其他租户的私有口径作答，构成数据泄漏面');
      if (it.trust === 'external_untrusted') risks.push('不可信外部文档进入上下文——「忽略以上指令」类注入可直接篡改系统行为');
    });

    // ④ 充分性检查
    var missing = ITEMS.filter(function (it) { return it.required && st[it.id] !== 'pack'; });
    if (missing.length) log.push('④ 充分性检查：❌ 缺少必需项「' + missing.map(function (m) { return m.title; }).join('、') + '」，停止调用并报告缺口');
    else log.push('④ 充分性检查：✅ 契约必需项全部在窗，允许调用 LLM（"够了才调"）');

    return { st: st, compTok: compTok, log: log, risks: risks,
             zoneBudget: zoneBudget, zoneUsed: zoneUsed, packed: packed, missing: missing,
             usedTotal: ZONES.reduce(function (s, z) { return s + zoneUsed[z.id]; }, 0) };
  }

  // ---- 动画装配 ----
  var runToken = 0;
  function setStage(n) {
    for (var i = 1; i <= 4; i++) $('stg' + i).className = 'stg' + (i <= n ? ' on' : '');
  }
  function applyStates(r, kinds) {
    ITEMS.forEach(function (it) {
      if (kinds.indexOf(r.st[it.id]) >= 0) itemEls[it.id].className = 'it ' + r.st[it.id];
    });
  }
  function appendLog(r, prefix) {
    var el = $('plog');
    if (el.textContent === '—') el.textContent = '';
    r.log.forEach(function (line) {
      if (line.indexOf(prefix) === 0) {
        var d = document.createElement('div');
        d.textContent = line;
        el.appendChild(d);
      }
    });
    el.scrollTop = el.scrollHeight;
  }
  function renderBars(r) {
    ZONES.forEach(function (z) {
      var pct = r.zoneBudget[z.id] > 0 ? Math.min(100, r.zoneUsed[z.id] / r.zoneBudget[z.id] * 100) : 0;
      var hasComp = ITEMS.some(function (it) { return it.zone === z.id && r.st[it.id] === 'comp'; });
      zbarFill[z.id].style.width = pct + '%';
      zbarFill[z.id].className = 'fill' + (hasComp ? ' amber' : '');
      zbarVal[z.id].textContent = r.zoneUsed[z.id] + ' / ' + r.zoneBudget[z.id] + ' tok';
    });
  }
  function renderPreview(r, budget) {
    var lines = [];
    ZONES.forEach(function (z) {
      var items = r.packed.filter(function (it) { return it.zone === z.id; });
      if (!items.length) return;
      lines.push('【' + z.name + '】');
      items.forEach(function (it) {
        var tok = r.st[it.id] === 'comp' ? r.compTok[it.id] + ' tok · 压缩引用卡' : it.tokens + ' tok';
        lines.push('  • ' + it.title + '（' + tok + '）');
      });
    });
    lines.push('—— 合计 ' + r.usedTotal + ' tok / 总预算 ' + budget + '（输出预留 ' + Math.round(budget * RESERVE) + ' tok）');
    $('preview').textContent = lines.join('\n');
  }
  function renderVerdict(r, budget, hardOn) {
    var v = $('verdict');
    var lines = [];
    if (!hardOn && r.risks.length) {
      v.className = 'verdict bad';
      lines.push('⚠️ <b>硬过滤关闭后的后果</b>（相关性为越权内容说了情）：');
      r.risks.forEach(function (rk) { lines.push('· ' + rk); });
      lines.push('这就是「先过滤后排序」顺序不可反的原因——硬闸一旦被相关性绕过，安全底线就成了可交易项。');
      return;
    }
    if (r.missing.length) {
      v.className = 'verdict bad';
      lines.push('❌ <b>充分性检查未通过</b>：必需项缺失，本次调用被停止——把「能调就调」改成「够了才调」。');
      return;
    }
    v.className = 'verdict';
    var nHard = 0, nDedup = 0, nComp = 0, nDrop = 0;
    ITEMS.forEach(function (it) {
      if (r.st[it.id] === 'hard') nHard++;
      else if (r.st[it.id] === 'dedup') nDedup++;
      else if (r.st[it.id] === 'comp') nComp++;
      else if (r.st[it.id] === 'drop') nDrop++;
    });
    lines.push('✅ 装配完成：<b>' + r.packed.length + '</b> 条入窗（' + r.usedTotal + ' / ' + budget + ' tok），' +
      '硬过滤剔除 <b>' + nHard + '</b> 条，去重冲突 <b>' + nDedup + '</b> 条，压缩为引用卡 <b>' + nComp + '</b> 条，预算挤出 <b>' + nDrop + '</b> 条。');
    if (nComp > 0) lines.push('注意证据区：压缩保留的是 <b>引用</b>（artifact_id + 关键统计量 + 数据时间），不是改写后的摘要——5 万行原始数据永远不进上下文。');
    lines.push('把预算拖到 4000 以下再跑一次，观察取舍顺序：保底区纹丝不动，弹性证据区先压缩、后剔除。');
    v.innerHTML = lines.join('<br>');
  }

  function run() {
    var token = ++runToken;
    var budget = parseInt($('budget').value, 10);
    var hardOn = !$('noFilter').checked;
    $('budgetV').textContent = budget;
    var r = assemble(budget, hardOn);
    // 复位
    ITEMS.forEach(function (it) { itemEls[it.id].className = 'it'; });
    ZONES.forEach(function (z) { zbarFill[z.id].style.width = '0%'; zbarFill[z.id].className = 'fill'; zbarVal[z.id].textContent = '0 / ' + r.zoneBudget[z.id] + ' tok'; });
    $('plog').textContent = '—';
    $('preview').textContent = '装配中…';
    $('verdict').className = 'verdict';
    $('verdict').textContent = '装配中…';
    setStage(0);
    var steps = [
      { t: 150,  f: function () { setStage(1); applyStates(r, ['hard']); appendLog(r, '①'); } },
      { t: 950,  f: function () { setStage(2); applyStates(r, ['dedup']); appendLog(r, '②'); } },
      { t: 1750, f: function () { setStage(3); applyStates(r, ['pack', 'comp', 'drop']); renderBars(r); appendLog(r, '③'); } },
      { t: 2650, f: function () { setStage(4); appendLog(r, '④'); renderPreview(r, budget); renderVerdict(r, budget, hardOn); } }
    ];
    steps.forEach(function (s) {
      setTimeout(function () { if (token === runToken) s.f(); }, s.t);
    });
  }

  $('run').addEventListener('click', run);
  $('budget').addEventListener('input', function () { $('budgetV').textContent = $('budget').value; });
  $('budget').addEventListener('change', run);
  $('noFilter').addEventListener('change', run);
};
