/* memory-pipeline —— 记忆写入管线可视化（篇08 §2：可信写入链路）
 * 契约：注册到 window.DEMOS['memory-pipeline']，Shadow DOM，样式内联，无外部依赖。
 * 模拟 Run 事件流逐条进入五段管线（提取→标准化→校验→策略→提交）：
 * 临时结论/原始查询结果/模型推测在「校验」被拦下变红并标注拒绝原因；
 * 重复事件演示幂等拦截；同 scope 新偏好演示旧版本标记 superseded；
 * 底部记忆库面板实时更新（scope/版本/状态徽标）。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['memory-pipeline'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var STAGES = ['提取 Extract', '标准化 Normalize', '校验 Validate', '策略 Policy', '提交 Commit'];
  var EVENTS = [
    { id: 'e1', label: '用户指令：以后报告都用环比口径', type: 'user_preference', scope: '租户A · 小王', act: 'commit', ver: 'v1' },
    { id: 'e2', label: '模型推测：用户可能喜欢深色主题', act: 'reject', stage: 2, reason: '模型单次推测，无证据引用——最弱信号，默认只进候选队列不进主库' },
    { id: 'e3', label: '原始查询结果：GMV 明细 5 万行', act: 'reject', stage: 2, reason: '权威数据禁止写入长期记忆——要数字请实时查询，记忆只存指针' },
    { id: 'e4', label: '临时结论：GMV 下降可能是天气原因', act: 'reject', stage: 2, reason: '未验证的临时结论，推理中途的产物不得落库' },
    { id: 'e5', label: '（重试重复）用户指令：以后报告都用环比口径', act: 'idem', reason: '幂等键 write_request_id 已处理过，直接返回首次写入结果——重试不会产生第二条' },
    { id: 'e6', label: '用户反馈：归因分析很有用（第 3 次）', type: 'process_experience', scope: '租户A · 共享', act: 'confirm', ver: 'v1' },
    { id: 'e7', label: '用户指令：改成同比口径', type: 'user_preference', scope: '租户A · 小王', act: 'commit', ver: 'v2', supersedes: 'e1' },
    { id: 'e8', label: '任务完成：Q3 经营分析报告 artifact#8817', type: 'task_reference', scope: '租户A · 小王', act: 'commit', ver: 'v1' }
  ];
  var TYPE_NAME = {
    user_preference: '用户偏好',
    process_experience: '过程经验',
    task_reference: '任务引用'
  };

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    'h4{margin:12px 0 8px;font-size:13px;font-weight:600;color:#1c1917;}' +
    '.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button:hover{opacity:.88;}' +
    'button:disabled{opacity:.45;cursor:default;}' +
    '.evq{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px;}' +
    '.ev{font-size:10px;padding:2px 7px;border-radius:9px;border:1px solid #e5e1d8;color:#78716c;background:#fafaf9;transition:all .25s;}' +
    '.ev.cur{border-color:#0f766e;color:#0f766e;background:#f0fdfa;}' +
    '.ev.ok{border-color:#99d5cf;color:#115e59;background:#f0fdfa;}' +
    '.ev.no{border-color:#fecaca;color:#991b1b;background:#fef2f2;}' +
    '.ev.dup{border-color:#fcd34d;color:#92400e;background:#fffbeb;}' +
    '.beltwrap{margin:6px 0 4px;}' +
    '.stations{display:flex;gap:6px;}' +
    '.sta{flex:1;text-align:center;font-size:11px;padding:5px 2px;border-radius:6px;border:1px solid #e5e1d8;color:#a8a29e;background:#fafaf9;transition:all .25s;}' +
    '.sta.on{background:#0f766e;color:#fff;border-color:#0f766e;}' +
    '.sta.done{background:#f0fdfa;color:#115e59;border-color:#99d5cf;}' +
    '.belt{position:relative;height:58px;margin-top:8px;border:1px dashed #e5e1d8;border-radius:6px;background:#fafaf9;}' +
    '.card{position:absolute;top:7px;left:1%;width:17.5%;min-width:110px;background:#fff;border:1px solid #0f766e;border-radius:6px;padding:6px 8px;font-size:11px;line-height:1.5;transition:left .32s ease,opacity .3s,background .25s,border-color .25s;box-shadow:0 1px 3px rgba(0,0,0,.08);}' +
    '.card.red{background:#fef2f2;border-color:#dc2626;color:#991b1b;}' +
    '.card.amber{background:#fffbeb;border-color:#d97706;color:#92400e;}' +
    '.card.green{background:#f0fdfa;border-color:#0f766e;color:#115e59;}' +
    '.store{border:1px solid #e5e1d8;border-radius:6px;margin-top:6px;}' +
    '.srow{display:flex;gap:8px;align-items:center;padding:7px 10px;border-bottom:1px solid #f5f5f4;font-size:12px;flex-wrap:wrap;transition:background .4s;}' +
    '.srow:last-child{border-bottom:none;}' +
    '.srow.new{background:#f0fdfa;}' +
    '.srow .c{flex:1;min-width:200px;}' +
    '.bd{font-size:10px;padding:1px 6px;border-radius:8px;border:1px solid #e5e1d8;color:#78716c;background:#fff;white-space:nowrap;}' +
    '.bd.type{color:#0f766e;border-color:#99d5cf;}' +
    '.bd.active{color:#115e59;border-color:#5eead4;background:#f0fdfa;}' +
    '.bd.sup{color:#78716c;background:#f5f5f4;text-decoration:line-through;}' +
    '.log{border:1px solid #e5e1d8;border-radius:6px;background:#fafaf9;padding:8px 10px;font-size:11px;line-height:1.8;max-height:150px;overflow:auto;color:#44403c;margin-top:6px;}' +
    '.log .rej{color:#991b1b;}' +
    '.log .idem{color:#92400e;}' +
    '.log .cmt{color:#115e59;}' +
    '.verdict{margin-top:10px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 记忆写入管线（篇08 §2：事件驱动 + 五段防线，宁可不记不可记错）</div>' +
    '  <div class="row">' +
    '    <button id="run">开始写入（8 条 Run 事件）</button>' +
    '    <button id="reset" class="ghost">重置</button>' +
    '    <span style="font-size:11px;color:#78716c">事件在 Run 结束后由独立的 Memory Writer 逐条处理，不在推理中途写入。</span>' +
    '  </div>' +
    '  <div class="evq" id="evq"></div>' +
    '  <div class="beltwrap">' +
    '    <div class="stations" id="stations"></div>' +
    '    <div class="belt" id="belt"><div class="card" id="card" style="opacity:0">—</div></div>' +
    '  </div>' +
    '  <h4>记忆库（主库 · 唯一事实来源）</h4>' +
    '  <div class="store" id="store"><div class="srow" style="color:#a8a29e;font-size:11px">尚无任何记忆——先跑一遍事件流。</div></div>' +
    '  <h4>管线日志</h4>' +
    '  <div class="log" id="plog">—</div>' +
    '  <div class="verdict" id="verdict">点「开始写入」，重点观察三件事：① 临时结论 / 原始查询结果 / 模型推测在「校验」站被拦下；② e5 是 e1 的重试重复，在「提交」站被幂等键拦截；③ e7 与 e1 同 scope 冲突，旧版本标记 superseded 而非删除。</div>' +
    '  <div class="note">教学简化：e6 走「需确认」队列并模拟用户已批准；真实系统中确认队列由用户在前台逐条审批。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  // 事件队列 chips
  var evEls = {};
  var evq = $('evq');
  EVENTS.forEach(function (ev, i) {
    var s = document.createElement('span');
    s.className = 'ev';
    s.textContent = 'e' + (i + 1);
    s.title = ev.label;
    evq.appendChild(s);
    evEls[ev.id] = s;
  });

  // 五段管线站
  var staEls = [];
  var stations = $('stations');
  STAGES.forEach(function (name) {
    var d = document.createElement('div');
    d.className = 'sta';
    d.textContent = name;
    stations.appendChild(d);
    staEls.push(d);
  });

  var card = $('card');
  var store = $('store');
  var storeRows = {};

  function setStages(upto, failAt) {
    staEls.forEach(function (el, i) {
      el.className = 'sta' + (i < upto ? ' done' : (i === upto ? ' on' : ''));
    });
  }
  function moveCard(idx) { card.style.left = (idx * 20 + 1) + '%'; }
  function log(cls, text) {
    var el = $('plog');
    if (el.textContent === '—') el.textContent = '';
    var d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = text;
    el.appendChild(d);
    el.scrollTop = el.scrollHeight;
  }
  function clearStorePlaceholder() {
    if (storeRows.__empty !== false && !storeRows.__any) {
      store.innerHTML = '';
      storeRows.__any = true;
    }
  }
  function addStoreRow(ev) {
    clearStorePlaceholder();
    var d = document.createElement('div');
    d.className = 'srow new';
    d.innerHTML = '<span class="bd type">' + (TYPE_NAME[ev.type] || ev.type) + '</span>' +
      '<span class="c">' + ev.label + '</span>' +
      '<span class="bd">scope: ' + ev.scope + '</span>' +
      '<span class="bd">' + ev.ver + '</span>' +
      '<span class="bd active" data-st>active</span>';
    store.appendChild(d);
    storeRows[ev.id] = d;
    setTimeout(function () { d.className = 'srow'; }, 1200);
  }
  function supersedeRow(id) {
    var row = storeRows[id];
    if (!row) return;
    var st = row.querySelector('[data-st]');
    if (st) { st.textContent = 'superseded'; st.className = 'bd sup'; }
  }

  var runToken = 0;
  function reset() {
    runToken++;
    card.style.opacity = '0';
    card.className = 'card';
    setStages(-1);
    EVENTS.forEach(function (ev) { evEls[ev.id].className = 'ev'; });
    store.innerHTML = '<div class="srow" style="color:#a8a29e;font-size:11px">尚无任何记忆——先跑一遍事件流。</div>';
    storeRows = {};
    $('plog').textContent = '—';
    $('verdict').textContent = '点「开始写入」，重点观察三件事：① 临时结论 / 原始查询结果 / 模型推测在「校验」站被拦下；② e5 是 e1 的重试重复，在「提交」站被幂等键拦截；③ e7 与 e1 同 scope 冲突，旧版本标记 superseded 而非删除。';
    $('run').disabled = false;
  }

  function run() {
    var token = ++runToken;
    reset();
    runToken = token; // reset 里 runToken++ 了，恢复本次令牌
    $('run').disabled = true;
    var STEP = 300, OUTCOME = 900, GAP = 260;
    var t = 200;
    var rejected = 0, committed = 0, idem = 0;

    EVENTS.forEach(function (ev) {
      // 卡片入场
      setTimeout(function () {
        if (token !== runToken) return;
        card.textContent = ev.label;
        card.className = 'card';
        card.style.left = '1%';
        card.style.opacity = '1';
        setStages(0);
        EVENTS.forEach(function (e2) { if (e2 !== ev && evEls[e2.id].className === 'ev cur') evEls[e2.id].className = 'ev'; });
        evEls[ev.id].className = 'ev cur';
      }, t);
      t += STEP;

      if (ev.act === 'reject') {
        // 走到被拒站，变红
        for (var s = 1; s <= ev.stage; s++) {
          (function (stage) {
            setTimeout(function () { if (token === runToken) return; setStages(stage); moveCard(stage); }, t);
            t += STEP;
          })(s);
        }
        setTimeout(function () {
          if (token !== runToken) return;
          card.className = 'card red';
          card.textContent = '✗ 拦截：' + ev.reason;
          evEls[ev.id].className = 'ev no';
          log('rej', '✗ [' + STAGES[ev.stage] + '] 拒绝「' + ev.label + '」——' + ev.reason);
          rejected++;
        }, t);
        t += OUTCOME;
        setTimeout(function () { if (token === runToken) return; card.style.opacity = '0'; }, t);
        t += GAP;
      } else if (ev.act === 'idem') {
        for (var s2 = 1; s2 <= 4; s2++) {
          (function (stage) {
            setTimeout(function () { if (token === runToken) return; setStages(stage); moveCard(stage); }, t);
            t += STEP;
          })(s2);
        }
        setTimeout(function () {
          if (token !== runToken) return;
          card.className = 'card amber';
          card.textContent = '⧉ 幂等拦截：不重复写入';
          evEls[ev.id].className = 'ev dup';
          log('idem', '⧉ [提交 Commit] 「' + ev.label + '」——' + ev.reason);
          idem++;
        }, t);
        t += OUTCOME;
        setTimeout(function () { if (token === runToken) return; card.style.opacity = '0'; }, t);
        t += GAP;
      } else {
        // commit / confirm：走全程
        for (var s3 = 1; s3 <= 4; s3++) {
          (function (stage) {
            setTimeout(function () {
              if (token !== runToken) return;
              setStages(stage); moveCard(stage);
              if (ev.act === 'confirm' && stage === 3) {
                card.className = 'card amber';
                card.textContent = ev.label + '　⏸ 需确认：进入用户确认队列…';
              }
            }, t);
            t += (ev.act === 'confirm' && stage === 3) ? STEP + 800 : STEP;
          })(s3);
        }
        setTimeout(function () {
          if (token !== runToken) return;
          card.className = 'card green';
          card.textContent = '✓ 已提交主库 + 向量索引 + 证据归档';
          evEls[ev.id].className = 'ev ok';
          if (ev.act === 'confirm') log('cmt', '✓ [策略 Policy] 需确认 → 用户批准 → [提交]「' + ev.label + '」（' + ev.scope + '，' + ev.ver + '）');
          else log('cmt', '✓ [提交 Commit] 写入「' + ev.label + '」（' + ev.scope + '，' + ev.ver + '），登记版本 + 更新向量索引 + 归档证据');
          addStoreRow(ev);
          if (ev.supersedes) {
            supersedeRow(ev.supersedes);
            log('cmt', '↺ 冲突仲裁：新版本 ' + ev.ver + ' 取代旧版本，旧版本状态 active → superseded（保留历史，不参与召回）');
          }
          committed++;
        }, t);
        t += OUTCOME;
        setTimeout(function () { if (token === runToken) return; card.style.opacity = '0'; setStages(-1); }, t);
        t += GAP;
      }
    });

    setTimeout(function () {
      if (token !== runToken) return;
      $('verdict').innerHTML = '事件流处理完毕：<b>' + committed + '</b> 条写入主库，<b>' + rejected + '</b> 条在「校验」站被拦下，<b>' + idem + '</b> 条被幂等拦截。' +
        '记忆库现有 4 条 active / 1 条 superseded——五段管线各防一类故障：提取防"一时兴起"、标准化防"十份写法"、校验防"记错记脏"、策略防"越权越界"、提交防"重复写入"。';
      $('run').disabled = false;
    }, t + 200);
  }

  $('run').addEventListener('click', run);
  $('reset').addEventListener('click', reset);
};
