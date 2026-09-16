/* context-budget —— 上下文预算分配与挤压模拟器（篇06 §3.3）
 * 契约：注册到 window.DEMOS['context-budget']，Shadow DOM，样式内联，无外部依赖。
 * 交互：拖动总窗口与证据需求滑块，点「SQL 洪峰」注入 5 万行结果；
 * 分区模式下观察保底区纹丝不动、弹性证据区先压缩成 Artifact 引用卡再被剔除；
 * 切换「无分区（谁长谁占）」对照，看洪峰如何把指标口径挤出窗口。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['context-budget'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  // 分区定义：保底区（gua=true）+ 弹性区
  var PARTS = [
    { key: 'rules',    name: '规则区',   ratio: 0.15, gua: true,  desc: '系统指令 / 输出格式' },
    { key: 'task',     name: '任务区',   ratio: 0.10, gua: true,  desc: 'Task Contract / 本步目标' },
    { key: 'state',    name: '状态区',   ratio: 0.15, gua: true,  desc: 'Analysis State 摘要' },
    { key: 'semantic', name: '语义区',   ratio: 0.20, gua: false, desc: '指标口径（GMV 定义等）' },
    { key: 'evidence', name: '证据区',   ratio: 0.25, gua: false, desc: 'SQL 结果 / 证据摘要' },
    { key: 'output',   name: '输出预留', ratio: 0.15, gua: true,  desc: '模型回答空间' }
  ];

  var state = { win: 16000, evNeed: 4000, flood: false, partitioned: true };

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:10px;}' +
    'h4{margin:12px 0 6px;font-size:13px;font-weight:600;}' +
    '.row{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:8px;}' +
    '.ctl{display:flex;flex-direction:column;gap:3px;min-width:160px;flex:1;}' +
    '.ctl label{font-size:11px;color:#57534e;display:flex;justify-content:space-between;gap:8px;}' +
    '.ctl label b{color:#0f766e;font-variant-numeric:tabular-nums;}' +
    'input[type=range]{width:100%;accent-color:#0f766e;}' +
    'input[type=checkbox]{accent-color:#0f766e;}' +
    'button{border:1px solid #d97706;background:#d97706;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{border-color:#0f766e;background:#fff;color:#0f766e;}' +
    'button:hover{opacity:.88;}' +
    '.sw{display:flex;align-items:center;gap:6px;font-size:12px;color:#57534e;}' +
    '.stack{display:flex;height:64px;border:1px solid #d6d3d1;border-radius:8px;overflow:hidden;margin-top:6px;}' +
    '.seg{height:100%;position:relative;transition:width .25s;overflow:hidden;}' +
    '.seg .in{position:absolute;inset:0;padding:4px 6px;font-size:10px;line-height:1.35;color:#fff;}' +
    '.seg .in b{display:block;font-size:11px;}' +
    '.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#57534e;margin-top:6px;}' +
    '.swd{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:-1px;margin-right:4px;}' +
    '.alist{margin-top:8px;font-size:12px;line-height:1.7;}' +
    '.alist .it{padding:3px 8px;border-radius:4px;margin:2px 0;}' +
    '.it.in{background:#f0fdfa;color:#115e59;}' +
    '.it.sq{background:#fffbeb;color:#92400e;}' +
    '.it.out{background:#fef2f2;color:#991b1b;text-decoration:line-through;}' +
    'table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px;}' +
    'th,td{border:1px solid #e5e1d8;padding:4px 7px;text-align:left;}' +
    'th{background:#fafaf9;color:#57534e;font-weight:600;}' +
    'td.num{font-variant-numeric:tabular-nums;text-align:right;}' +
    '.st-ok{color:#0f766e;font-weight:600;}.st-warn{color:#d97706;font-weight:600;}.st-bad{color:#dc2626;font-weight:600;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.verdict.warn{background:#fffbeb;border-color:#fde68a;color:#92400e;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 分区 Token Budget（篇06 §3.3：必需信息优先保障，弹性区内竞争）</div>' +
    '  <div class="row">' +
    '    <div class="ctl"><label>上下文总窗口 <b id="winV">16000 tokens</b></label>' +
    '      <input id="win" type="range" min="4000" max="32000" step="2000" value="16000"></div>' +
    '    <div class="ctl"><label>证据区需求（检索/查询结果原始体量）<b id="evV">4000 tokens</b></label>' +
    '      <input id="ev" type="range" min="1000" max="60000" step="1000" value="4000"></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto"><button id="flood">注入 SQL 洪峰（5 万行结果）</button></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto;justify-content:flex-end">' +
    '      <span class="sw"><input type="checkbox" id="nopart"><label for="nopart">无分区对照（谁长谁占）</label></span></div>' +
    '  </div>' +
    '  <h4>窗口占用（保底区 55% + 弹性区 45%）</h4>' +
    '  <div class="stack" id="stack"></div>' +
    '  <div class="legend" id="legend"></div>' +
    '  <h4>分区明细与调用前充分性检查</h4>' +
    '  <div id="detail"></div>' +
    '  <div class="alist" id="alist"></div>' +
    '  <div class="verdict" id="verdict">先点一次「注入 SQL 洪峰」，观察分区模式下证据区的两级自保：<b>先压缩成 Artifact 引用卡，仍不够才按排序剔除</b>——语义区的 GMV 口径始终在位。然后勾选「无分区对照」再注入一次。</div>' +
    '  <div class="note">教学简化：分区占比取自正文表（规则 15 / 任务 10 / 状态 15 / 语义 20 / 证据 25 / 输出 15）；压缩为引用卡后按原文 3% 估算。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  var COLORS = { rules: '#0f766e', task: '#14b8a6', state: '#5eead4', semantic: '#d97706', evidence: '#78716c', output: '#d6d3d1' };

  // 计算各分区实际装入量与事件列表
  function compute() {
    var win = state.win;
    var evNeed = state.evNeed + (state.flood ? 50000 : 0);
    var events = [];

    if (state.partitioned) {
      var alloc = {}, evCap = 0;
      PARTS.forEach(function (p) {
        alloc[p.key] = Math.round(win * p.ratio);
        if (p.key === 'evidence') evCap = alloc[p.key];
      });
      var evUsed, evNote;
      if (evNeed <= evCap) {
        evUsed = evNeed; evNote = 'ok';
      } else {
        var card = Math.max(300, Math.round(evNeed * 0.03)); // 压缩成 Artifact 引用卡
        if (card <= evCap) {
          evUsed = card; evNote = 'compressed';
          events.push({ cls: 'sq', txt: '证据需求 ' + evNeed.toLocaleString() + ' tokens 超出证据区容量 ' + evCap.toLocaleString() + ' → 可信压缩：原始结果入 Artifact Store，窗口只留引用卡（约 ' + card + ' tokens，含行列规模/关键统计/数据时间）' });
        } else {
          evUsed = evCap; evNote = 'dropped';
          events.push({ cls: 'out', txt: '引用卡仍装不下 → 按软性排序剔除低优先证据（被剔原因写入 Decision Trace）' });
        }
      }
      alloc.evidence = evUsed;
      events.push({ cls: 'in', txt: '保底区（规则/任务/状态/输出）共 ' + Math.round(win * 0.55).toLocaleString() + ' tokens：无论证据洪峰多大，纹丝不动' });
      events.push({ cls: 'in', txt: '语义区（GMV 口径等）' + alloc.semantic.toLocaleString() + ' tokens 在位 → 调用前充分性检查通过' });
      return { alloc: alloc, events: events, evNote: evNote, evNeed: evNeed, overflow: false };
    }

    // 无分区：按需求从大到小抢窗口
    var need = {
      evidence: evNeed, semantic: Math.round(win * 0.20), rules: Math.round(win * 0.15),
      state: Math.round(win * 0.15), output: Math.round(win * 0.15), task: Math.round(win * 0.10)
    };
    var order = ['evidence', 'semantic', 'rules', 'state', 'output', 'task'];
    var left = win, a2 = {};
    order.forEach(function (k) {
      a2[k] = Math.min(need[k], Math.max(left, 0));
      left -= a2[k];
    });
    var squeezed = [];
    PARTS.forEach(function (p) {
      if (a2[p.key] < need[p.key] * 0.5 && p.key !== 'evidence') {
        squeezed.push(p.name);
        events.push({ cls: 'out', txt: p.name + '（' + p.desc + '）被挤出/严重截断——只剩 ' + a2[p.key].toLocaleString() + ' / 需求 ' + need[p.key].toLocaleString() + ' tokens' });
      }
    });
    if (squeezed.length === 0) {
      events.push({ cls: 'in', txt: '当前证据需求不大，无分区模式暂时相安无事——这正是它隐蔽的地方：平时看不出问题，洪峰一来就出事' });
    }
    return { alloc: a2, events: events, evNote: 'raw', evNeed: evNeed, overflow: squeezed.length > 0, squeezed: squeezed };
  }

  function render() {
    var r = compute();
    var win = state.win;

    var stackHtml = '';
    PARTS.forEach(function (p) {
      var w = Math.max(r.alloc[p.key] / win * 100, 0);
      var dark = p.key === 'state' || p.key === 'output' ? '#44403c' : '#fff';
      stackHtml += '<div class="seg" style="width:' + w + '%;background:' + COLORS[p.key] + '">' +
        '<div class="in" style="color:' + dark + '"><b>' + p.name + '</b>' + r.alloc[p.key].toLocaleString() + '</div></div>';
    });
    $('stack').innerHTML = stackHtml;

    var lg = '';
    PARTS.forEach(function (p) {
      lg += '<span><span class="swd" style="background:' + COLORS[p.key] + '"></span>' + p.name + (p.gua ? '（保底）' : '（弹性）') + '</span>';
    });
    $('legend').innerHTML = lg;

    // 分区明细表：容量 / 需求 / 实际装入 / 状态
    var dt = '<table><tr><th>分区</th><th>性质</th><th>内容</th><th>容量</th><th>需求</th><th>实际装入</th><th>状态</th></tr>';
    PARTS.forEach(function (p) {
      var cap = Math.round(win * p.ratio);
      var need = p.key === 'evidence' ? r.evNeed : cap;
      var used = r.alloc[p.key];
      var st, cls;
      if (p.key === 'evidence') {
        if (r.evNote === 'ok') { st = '原始装入'; cls = 'st-ok'; }
        else if (r.evNote === 'compressed') { st = '压缩为引用卡'; cls = 'st-warn'; }
        else if (r.evNote === 'dropped') { st = '打满+低优先剔除'; cls = 'st-warn'; }
        else { st = r.overflow ? '洪峰抢占' : '原始装入'; cls = r.overflow ? 'st-bad' : 'st-ok'; }
      } else {
        var short_ = used < cap * 0.5;
        st = short_ ? '被挤出/截断' : '在位';
        cls = short_ ? 'st-bad' : 'st-ok';
      }
      dt += '<tr><td>' + p.name + '</td><td>' + (p.gua ? '硬性保底' : '弹性') + '</td><td>' + p.desc + '</td>' +
        '<td class="num">' + (state.partitioned ? cap.toLocaleString() : '—') + '</td>' +
        '<td class="num">' + need.toLocaleString() + '</td>' +
        '<td class="num">' + used.toLocaleString() + '</td>' +
        '<td class="' + cls + '">' + st + '</td></tr>';
    });
    dt += '</table>';
    // 充分性检查：本步契约必需项 = 任务区目标 + 语义区 GMV 口径
    var semOk = r.alloc.semantic >= Math.round(win * 0.20) * 0.5;
    var taskOk = r.alloc.task >= Math.round(win * 0.10) * 0.5;
    if (semOk && taskOk) {
      dt += '<div class="it in" style="margin-top:6px">充分性检查 ✅：本步「必须看到」的任务目标与 GMV 口径均在位 → 允许发起 LLM 调用</div>';
    } else {
      dt += '<div class="it out" style="margin-top:6px;text-decoration:none">充分性检查 🛑：必需项缺失（' +
        (!taskOk ? '任务区目标 ' : '') + (!semOk ? '语义区指标口径' : '') +
        '）→ 装配器拒绝调用并报缺失项。在无分区模式下，这道闸根本不存在。</div>';
    }
    $('detail').innerHTML = dt;

    var al = '';
    r.events.forEach(function (e) { al += '<div class="it ' + e.cls + '">' + e.txt + '</div>'; });
    $('alist').innerHTML = al;

    var v = $('verdict');
    if (!state.partitioned && r.overflow) {
      v.className = 'verdict bad';
      v.innerHTML = '🛑 <b>无分区 + 洪峰 = 口径出局</b>：被挤掉的是 ' + r.squeezed.join('、') +
        '。模型随后会对着表结构「猜」GMV 口径——报告看起来一切正常，只是安静地错了。' +
        '这就是「谁嗓门大谁占窗口」的代价：故障不报错，只生产错误结论。';
    } else if (state.partitioned && r.evNote === 'compressed') {
      v.className = 'verdict warn';
      v.innerHTML = '🔶 <b>分区模式接住洪峰</b>：5 万行结果没有进窗口，进了 Artifact Store；窗口里只有一张引用卡。' +
        '语义区口径、状态区假设树、输出预留全部无恙。代价：模型看到的是统计摘要而非明细——明细需要时再用工具按 artifact_id 下钻。';
    } else if (state.partitioned && r.evNote === 'dropped') {
      v.className = 'verdict warn';
      v.innerHTML = '🔶 证据区预算打满，低优先证据被按排序剔除——注意剔除不是静默的：原因写进 Decision Trace，未闭合缺口会出现在最终报告里。';
    } else {
      v.className = 'verdict';
      v.innerHTML = state.partitioned
        ? '✅ 当前装填健康。试着把证据需求拉过证据区容量（' + Math.round(win * 0.25).toLocaleString() + ' tokens），或直接注入洪峰，观察压缩与剔除两级自保。'
        : '当前无洪峰，无分区模式看起来没问题——问题恰恰在于「看起来」。点「注入 SQL 洪峰」看它失守。';
    }
  }

  $('win').addEventListener('input', function () {
    state.win = parseInt($('win').value, 10);
    $('winV').textContent = state.win.toLocaleString() + ' tokens';
    render();
  });
  $('ev').addEventListener('input', function () {
    state.evNeed = parseInt($('ev').value, 10);
    $('evV').textContent = state.evNeed.toLocaleString() + ' tokens';
    render();
  });
  $('flood').addEventListener('click', function () {
    state.flood = !state.flood; // 洪峰开关：注入 / 退去
    $('flood').textContent = state.flood ? '洪峰退去（恢复正常查询）' : '注入 SQL 洪峰（5 万行结果）';
    render();
  });
  $('nopart').addEventListener('change', function () {
    state.partitioned = !$('nopart').checked;
    render();
  });

  render();
};
