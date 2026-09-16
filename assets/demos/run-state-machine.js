/* run-state-machine —— Agent Run 状态机交互（篇05 §3）
 * 点击事件按钮驱动状态迁移，右侧同步打印 Event 日志与 Checkpoint 记录，
 * 理解"状态由事件驱动、可重放"。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['run-state-machine'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  // 状态机定义（与篇05 §3.2/§3.3 一致）
  var STATES = {
    PENDING:           { label: 'PENDING',           desc: '已创建，等待 Worker 领取', terminal: false },
    RUNNING:           { label: 'RUNNING',           desc: 'Worker 持有 Lease，推进 Step', terminal: false },
    RETRYING:          { label: 'RETRYING',          desc: 'Step 失败，退避后重试 Attempt', terminal: false },
    WAITING_APPROVAL:  { label: 'WAITING_APPROVAL',  desc: 'Human Gate 挂起，等待审批回调', terminal: false },
    SUSPENDED:         { label: 'SUSPENDED',         desc: '心跳丢失，等待他机接管', terminal: false },
    SUCCEEDED:         { label: 'SUCCEEDED',         desc: 'Verifier 确认 done', terminal: true },
    FAILED:            { label: 'FAILED',            desc: '重试耗尽 / 预算耗尽', terminal: true },
    CANCELLED:         { label: 'CANCELLED',         desc: '审批拒绝 / 人工终止', terminal: true }
  };

  // 事件按钮：label、源状态 → 目标状态、产生的事件类型
  var EVENTS = [
    { label: 'Worker 领取 (Lease)',     ev: 'run.leased',           from: ['PENDING'],          to: 'RUNNING' },
    { label: 'Step 成功',               ev: 'step.committed',       from: ['RUNNING'],          to: 'RUNNING',  checkpoint: true },
    { label: '模型调用成功',            ev: 'llm.call_ok',          from: ['RUNNING'],          to: 'RUNNING' },
    { label: '工具调用失败(可重试)',    ev: 'step.attempt_failed',  from: ['RUNNING'],          to: 'RETRYING' },
    { label: 'Attempt 重试成功',        ev: 'step.retry_ok',        from: ['RETRYING'],         to: 'RUNNING',  checkpoint: true },
    { label: '重试耗尽',                ev: 'step.retries_exhausted', from: ['RETRYING'],       to: 'FAILED' },
    { label: '进入 Human Gate',         ev: 'run.waiting_approval', from: ['RUNNING'],          to: 'WAITING_APPROVAL', checkpoint: true },
    { label: '审批通过',                ev: 'approval.granted',     from: ['WAITING_APPROVAL'], to: 'RUNNING' },
    { label: '审批拒绝 / 超时',         ev: 'approval.rejected',    from: ['WAITING_APPROVAL'], to: 'CANCELLED' },
    { label: '崩溃 / 心跳丢失',         ev: 'worker.lease_expired', from: ['RUNNING', 'RETRYING'], to: 'SUSPENDED' },
    { label: 'Resume (加载 Checkpoint)', ev: 'run.resumed',         from: ['SUSPENDED'],        to: 'RUNNING' },
    { label: 'Verifier 确认 done',      ev: 'verifier.done',        from: ['RUNNING'],          to: 'SUCCEEDED' },
    { label: '预算耗尽且无降级出口',    ev: 'budget.exhausted',     from: ['RUNNING'],          to: 'FAILED' },
    { label: '人工终止',                ev: 'run.cancelled',        from: ['PENDING', 'RUNNING', 'RETRYING', 'WAITING_APPROVAL', 'SUSPENDED'], to: 'CANCELLED' }
  ];

  var state = 'PENDING';
  var seq = 0;
  var stepNo = 0;
  var eventLog = [];   // {seq, ev, from, to}
  var checkpoints = []; // {step, atSeq, note}

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    '.layout{display:flex;gap:16px;flex-wrap:wrap;}' +
    '.left{flex:1.2;min-width:280px;}' +
    '.right{flex:1;min-width:240px;}' +
    '.states{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;}' +
    '.st{border:1px solid #e5e1d8;border-radius:6px;padding:6px 10px;font-size:11px;font-family:ui-monospace,Menlo,monospace;background:#fafaf9;color:#78716c;transition:all .2s;}' +
    '.st.cur{background:#0f766e;color:#fff;border-color:#0f766e;font-weight:600;}' +
    '.st.done{background:#f0fdfa;color:#115e59;border-color:#99d5cf;}' +
    '.curdesc{font-size:12px;color:#57534e;margin-bottom:12px;min-height:18px;}' +
    '.btns{display:flex;flex-wrap:wrap;gap:6px;}' +
    'button{background:#0f766e;color:#fff;border:none;border-radius:6px;padding:6px 10px;font-size:12px;cursor:pointer;}' +
    'button:hover:not(:disabled){background:#115e59;}' +
    'button:disabled{background:#e7e5e4;color:#a8a29e;cursor:not-allowed;}' +
    'button.reset{background:#fff;color:#0f766e;border:1px solid #0f766e;}' +
    'button.replay{background:#fff;color:#7c3aed;border:1px solid #7c3aed;}' +
    '.panel h4{margin:0 0 6px;font-size:12px;color:#57534e;font-weight:600;}' +
    '.log{font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.7;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;height:170px;overflow-y:auto;white-space:pre-wrap;}' +
    '.log .tr{color:#0f766e;font-weight:600;}' +
    '.log .bad{color:#dc2626;}' +
    '.cps{font-size:11px;line-height:1.8;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;padding:8px 10px;min-height:56px;color:#5b21b6;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:10px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · Agent Run 状态机：状态由事件驱动，可重放（篇05 §3）</div>' +
    '  <div class="layout">' +
    '    <div class="left">' +
    '      <div class="states" id="states"></div>' +
    '      <div class="curdesc" id="curdesc"></div>' +
    '      <div class="btns" id="btns"></div>' +
    '      <div class="btns" style="margin-top:10px;">' +
    '        <button class="replay" id="replay">从事件流重放 (Replay)</button>' +
    '        <button class="reset" id="reset">重置 Run</button>' +
    '      </div>' +
    '      <div class="note">试试这条路径：Worker 领取 → Step 成功 → 进入 Human Gate → 审批通过 → 崩溃 → Resume → Verifier 确认 done。再点"重放"——状态会被清空后按事件流逐条重建，结果一致，这就是"状态即事件的结果"。</div>' +
    '    </div>' +
    '    <div class="right">' +
    '      <div class="panel"><h4>Event 日志（append-only）</h4><div class="log" id="log"></div></div>' +
    '      <div class="panel" style="margin-top:8px;"><h4>Checkpoint 记录（Step 边界快照）</h4><div class="cps" id="cps">尚无 Checkpoint。带快照标记的事件（Step 成功 / 进入 Gate / 重试成功）会生成一条。</div></div>' +
    '    </div>' +
    '  </div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  function renderStates() {
    var el = $('states');
    el.innerHTML = '';
    Object.keys(STATES).forEach(function (k) {
      var d = document.createElement('div');
      d.className = 'st' + (k === state ? ' cur' : '') + (STATES[k].terminal && k === state ? ' done' : '');
      d.textContent = STATES[k].label;
      el.appendChild(d);
    });
    $('curdesc').textContent = '当前状态：' + state + ' —— ' + STATES[state].desc +
      (STATES[state].terminal ? '（终态：只能重置或重放）' : '');
  }

  function renderButtons() {
    var el = $('btns');
    el.innerHTML = '';
    EVENTS.forEach(function (e) {
      var b = document.createElement('button');
      b.textContent = e.label;
      var ok = e.from.indexOf(state) >= 0 && !STATES[state].terminal;
      b.disabled = !ok;
      b.addEventListener('click', function () { applyEvent(e, true); });
      el.appendChild(b);
    });
  }

  function applyEvent(e, animate) {
    var from = state;
    state = e.to;
    seq++;
    eventLog.push({ seq: seq, ev: e.ev, from: from, to: e.to });
    if (e.checkpoint) {
      stepNo++;
      checkpoints.push({ step: stepNo, atSeq: seq, note: 'state 快照 @ ' + e.ev });
    }
    renderLog();
    renderCps();
    renderStates();
    renderButtons();
  }

  function renderLog() {
    $('log').innerHTML = eventLog.map(function (l) {
      var cls = (l.to === 'FAILED' || l.to === 'CANCELLED') ? 'bad' : 'tr';
      return '#' + String(l.seq).padStart(2, '0') + ' ' + l.ev +
        '  <span class="' + cls + '">' + l.from + ' → ' + l.to + '</span>';
    }).join('\n') || '（空）';
    $('log').scrollTop = $('log').scrollHeight;
  }

  function renderCps() {
    $('cps').innerHTML = checkpoints.length
      ? checkpoints.map(function (c) {
          return 'Checkpoint step=' + c.step + ' · event_cursor=' + c.atSeq + ' · ' + c.note;
        }).join('<br>')
      : '尚无 Checkpoint。带快照标记的事件（Step 成功 / 进入 Gate / 重试成功）会生成一条。';
  }

  function resetAll() {
    state = 'PENDING'; seq = 0; stepNo = 0;
    eventLog = []; checkpoints = [];
    renderLog(); renderCps(); renderStates(); renderButtons();
  }

  function replay() {
    var saved = eventLog.slice();
    var savedCps = checkpoints.slice();
    var savedStep = stepNo;
    // 清空后逐条重放（带动画延迟），验证"事件流可重建状态"
    state = 'PENDING'; seq = 0; stepNo = 0;
    eventLog = []; checkpoints = [];
    renderLog(); renderCps(); renderStates(); renderButtons();
    var i = 0;
    var btns = Array.prototype.slice.call(shadow.querySelectorAll('button'));
    btns.forEach(function (b) { b.disabled = true; });
    function stepReplay() {
      if (i >= saved.length) {
        renderButtons();
        $('curdesc').textContent = '重放完成：' + saved.length + ' 条事件重建出相同终态 ' + state +
          '（' + savedStep + ' 个 Checkpoint）。Replay 不改输入、不产生新事件——排障与审计靠的就是它。';
        return;
      }
      var l = saved[i];
      var e = null;
      for (var k = 0; k < EVENTS.length; k++) {
        if (EVENTS[k].ev === l.ev && EVENTS[k].to === l.to) { e = EVENTS[k]; break; }
      }
      if (e) applyEvent(e, false);
      i++;
      setTimeout(stepReplay, 350);
    }
    setTimeout(stepReplay, 400);
  }

  $('reset').addEventListener('click', resetAll);
  $('replay').addEventListener('click', replay);

  renderStates();
  renderButtons();
  renderLog();
};
