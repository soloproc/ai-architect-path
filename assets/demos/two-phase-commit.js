/* two-phase-commit —— 两阶段提交（2PC）时序与阻塞演示（卷04 §3.1）
 * 契约：注册到 window.DEMOS['two-phase-commit']，Shadow DOM，样式内联，无外部依赖。
 * 交互：点"发起下单事务"走 prepare → commit 两阶段动画；
 * 开关一：让某参与者投 NO，看全局回滚；
 * 开关二：让参与者"prepare 后宕机"，看协调者无法推进、资源锁死——2PC 的阻塞本质。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['two-phase-commit'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var PARTICIPANTS = [
    { id: 'order', name: '订单服务', resource: '订单草稿行' },
    { id: 'inventory', name: '库存服务', resource: '库存行锁（10 件）' },
    { id: 'marketing', name: '营销服务', resource: '优惠券额度' }
  ];
  var state = {
    phase: 'idle',      // idle | preparing | committing | done | blocked | aborted
    votes: {},          // id -> 'yes' | 'no' | null
    locked: {},         // id -> bool
    committed: {},      // id -> bool
    dead: {},           // id -> bool
    sabotageNo: false,
    sabotageDead: false,
    busy: false,
    log: []
  };

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    'h4{margin:14px 0 8px;font-size:13px;color:#1c1917;font-weight:600;}' +
    '.row{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;align-items:center;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button.danger{border-color:#dc2626;background:#dc2626;}' +
    'button:hover{opacity:.88;}' +
    'button:disabled{opacity:.45;cursor:not-allowed;}' +
    '.chk{display:flex;align-items:center;gap:6px;font-size:12px;color:#57534e;}' +
    '.chk input{accent-color:#d97706;}' +
    '.swim{display:flex;gap:10px;margin:10px 0;}' +
    '.lane{flex:1;min-width:110px;}' +
    '.lane .lh{text-align:center;font-size:12px;font-weight:600;color:#44403c;padding:6px;border-radius:6px;background:#fafaf9;border:1px solid #e5e1d8;}' +
    '.lane.coord .lh{background:#f0fdfa;border-color:#0f766e;color:#0f766e;}' +
    '.lane.deadlane .lh{background:#fef2f2;border-color:#dc2626;color:#dc2626;text-decoration:line-through;}' +
    '.slots{margin-top:8px;display:flex;flex-direction:column;gap:6px;min-height:170px;}' +
    '.slot{font-size:11px;padding:6px 8px;border-radius:6px;border:1px dashed #d6d3d1;color:#a8a29e;background:#fff;transition:all .3s;}' +
    '.slot.msg{border-style:solid;border-color:#0f766e;color:#0f766e;background:#f0fdfa;}' +
    '.slot.lock{border-style:solid;border-color:#d97706;color:#92400e;background:#fffbeb;}' +
    '.slot.done{border-style:solid;border-color:#0f766e;color:#115e59;background:#ccfbf1;}' +
    '.slot.abort{border-style:solid;border-color:#dc2626;color:#991b1b;background:#fef2f2;}' +
    '.phasebar{display:flex;gap:8px;margin:8px 0;}' +
    '.ph{flex:1;text-align:center;font-size:11px;padding:5px;border-radius:6px;background:#f5f5f4;color:#a8a29e;border:1px solid #e7e5e4;cursor:pointer;transition:all .2s;}' +
    '.ph:hover{border-color:#0f766e;color:#0f766e;}' +
    '.ph.on{background:#f0fdfa;color:#0f766e;border-color:#0f766e;font-weight:600;}' +
    '.ph.bad{background:#fef2f2;color:#dc2626;border-color:#dc2626;font-weight:600;}' +
    '.log{margin-top:8px;max-height:120px;overflow:auto;font-size:11px;line-height:1.7;color:#57534e;background:#fafaf9;border:1px solid #e7e5e4;border-radius:6px;padding:8px 10px;font-family:ui-monospace,monospace;}' +
    '.log .ok{color:#0f766e;}' +
    '.log .bad{color:#dc2626;}' +
    '.log .warn{color:#d97706;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 两阶段提交 2PC（卷04 §3.1：强一致的代价是"阻塞"）</div>' +
    '  <div class="phasebar">' +
    '    <div class="ph" id="ph1" title="点击查看阶段一详解">阶段一 Prepare（询问+锁资源）ⓘ</div>' +
    '    <div class="ph" id="ph2" title="点击查看阶段二详解">阶段二 Commit / Rollback ⓘ</div>' +
    '  </div>' +
    '  <div class="row">' +
    '    <button id="start">发起"下单+扣库存+发券"事务</button>' +
    '    <button id="intervene" class="danger" style="display:none">管理员介入：强制回滚解锁</button>' +
    '    <button id="reset" class="ghost">重置</button>' +
    '  </div>' +
    '  <div class="row">' +
    '    <span class="chk"><input type="checkbox" id="voteNo"><label for="voteNo">捣乱：库存服务投 NO</label></span>' +
    '    <span class="chk"><input type="checkbox" id="goDead"><label for="goDead">捣乱：库存服务 prepare 后立刻宕机</label></span>' +
    '  </div>' +
    '  <div class="swim" id="swim"></div>' +
    '  <div class="log" id="log"></div>' +
    '  <div class="verdict" id="verdict">先<b>点击上方两个阶段标签</b>，看清 Prepare 和 Commit 各自在做什么；再点「发起事务」走一遍<b>正常流程</b>：协调者逐个询问三个服务"能不能提交"（prepare），全部 YES 后统一下达 commit。然后勾选捣乱项重放，看 2PC 为什么在高并发互联网链路被弃用。</div>' +
    '  <div class="note">教学简化：真实 2PC 由 XA 协议在数据库层实现，prepare 后参与者把 redo/undo 日志落盘保证"醒来后还记得承诺"；此处聚焦时序与阻塞问题。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  function addLog(text, cls) {
    state.log.unshift({ t: text, c: cls || '' });
    if (state.log.length > 40) state.log.pop();
    renderLog();
  }
  function renderLog() {
    $('log').innerHTML = state.log.map(function (l) {
      return '<div class="' + l.c + '">' + l.t + '</div>';
    }).join('');
  }
  function setVerdict(html, bad) {
    var v = $('verdict');
    v.className = bad ? 'verdict bad' : 'verdict';
    v.innerHTML = html;
  }
  function phase(name) {
    $('ph1').className = 'ph' + (name === 'prepare' ? ' on' : (name === 'commit' || name === 'abort' ? '' : ''));
    $('ph2').className = 'ph' + (name === 'commit' ? ' on' : (name === 'abort' ? ' bad' : ''));
    if (name === 'prepare') $('ph2').className = 'ph';
  }

  function renderSwim() {
    var html = '<div class="lane coord"><div class="lh">协调者<br>（事务管理器）</div><div class="slots">' +
      slotHtml('coord') + '</div></div>';
    for (var i = 0; i < PARTICIPANTS.length; i++) {
      var p = PARTICIPANTS[i];
      var deadCls = state.dead[p.id] ? ' deadlane' : '';
      html += '<div class="lane' + deadCls + '"><div class="lh">' + p.name +
        (state.dead[p.id] ? ' 💀' : '') + '</div><div class="slots">' + slotHtml(p.id) + '</div></div>';
    }
    $('swim').innerHTML = html;
  }
  function slotHtml(id) {
    var out = [];
    if (id === 'coord') {
      if (state.phase === 'preparing') out.push(['msg', '→ 广播 PREPARE']);
      if (state.phase === 'committing') out.push(['msg', '→ 广播 COMMIT']);
      if (state.phase === 'aborted') out.push(['abort', '→ 广播 ROLLBACK']);
      if (state.phase === 'blocked') out.push(['abort', '⏳ COMMIT 发不出去，阻塞中…']);
      if (state.phase === 'done') out.push(['done', '✅ 事务提交完成']);
      return out.map(function (s) { return '<div class="slot ' + s[0] + '">' + s[1] + '</div>'; }).join('') || '<div class="slot">待命中</div>';
    }
    var v = state.votes[id];
    if (v === 'yes') out.push(['msg', '← 投票 YES']);
    if (v === 'no') out.push(['abort', '← 投票 NO']);
    if (state.locked[id] && !state.committed[id]) out.push(['lock', '🔒 已锁定：' + resName(id)]);
    if (state.committed[id]) out.push(['done', '✅ 已提交：' + resName(id)]);
    if (state.phase === 'aborted' && v) out.push(['abort', '↩ 已回滚，锁释放']);
    if (state.dead[id]) out.push(['abort', '💀 宕机：锁不释放、问话不应答']);
    return out.map(function (s) { return '<div class="slot ' + s[0] + '">' + s[1] + '</div>'; }).join('') || '<div class="slot">待命中</div>';
  }
  function resName(id) {
    for (var i = 0; i < PARTICIPANTS.length; i++) if (PARTICIPANTS[i].id === id) return PARTICIPANTS[i].resource;
    return '';
  }

  function resetState() {
    state.phase = 'idle';
    state.votes = {};
    state.locked = {};
    state.committed = {};
    state.dead = {};
    state.busy = false;
    state.log = [];
    $('intervene').style.display = 'none';
    phase('idle');
    renderSwim();
    renderLog();
  }

  function runTx() {
    if (state.busy) return;
    state.busy = true;
    state.sabotageNo = $('voteNo').checked;
    state.sabotageDead = $('goDead').checked;
    state.phase = 'preparing';
    phase('prepare');
    addLog('🚀 协调者开启全局事务：下单 + 扣库存 10 件 + 发券');
    renderSwim();
    setVerdict('阶段一进行中：协调者逐个询问参与者「你能不能提交？」——注意每个回答 YES 的服务都同时<b>锁住了自己的资源</b>，这是 2PC 强一致的来源，也是一切麻烦的源头。');

    var idx = 0;
    var timer = setInterval(function () {
      if (idx < PARTICIPANTS.length) {
        var p = PARTICIPANTS[idx++];
        addLog('📨 协调者 → ' + p.name + '：PREPARE？');
        setTimeout(function () {
          var voteNo = state.sabotageNo && p.id === 'inventory';
          state.votes[p.id] = voteNo ? 'no' : 'yes';
          if (voteNo) {
            addLog('📩 ' + p.name + '：NO（库存不足），未锁资源', 'bad');
          } else {
            state.locked[p.id] = true;
            addLog('📩 ' + p.name + '：YES，已锁定「' + p.resource + '」并写入 undo/redo 日志', 'warn');
          }
          if (state.sabotageDead && p.id === 'inventory') {
            setTimeout(function () {
              state.dead[p.id] = true;
              addLog('💀 ' + p.name + ' 宕机！但它已经投了 YES、锁还攥在手里', 'bad');
              renderSwim();
            }, 200);
          }
          renderSwim();
        }, 250);
        return;
      }
      clearInterval(timer);
      setTimeout(decide, 700);
    }, 700);

    function decide() {
      var allYes = PARTICIPANTS.every(function (p) { return state.votes[p.id] === 'yes'; });
      if (!allYes) {
        state.phase = 'aborted';
        phase('abort');
        state.locked = {};
        addLog('⛔ 有参与者投 NO → 协调者广播 ROLLBACK，所有锁释放，全局回滚', 'bad');
        setVerdict('⛔ <b>全局回滚</b>：任何一个 NO 都足以让整个事务作废——2PC 的"全或无"语义就是这么实现的。' +
          '注意代价：订单服务从 prepare 到收到 rollback 的这几秒里，它的资源也一直锁着。<b>参与者越多、链路越长，锁被攥住的时间越久</b>。' +
          '取消捣乱项再跑一遍正常流程，或试试"prepare 后宕机"。', true);
        state.busy = false;
        renderSwim();
        return;
      }
      if (state.sabotageDead) {
        state.phase = 'blocked';
        phase('commit');
        addLog('📣 协调者收到全部 YES → 决定 COMMIT，开始广播…');
        setTimeout(function () {
          ['order', 'marketing'].forEach(function (id) {
            state.committed[id] = true;
            state.locked[id] = false;
          });
          addLog('✅ 订单、营销服务收到 COMMIT，提交并释放锁', 'ok');
          addLog('⏳ 库存服务宕机收不到 COMMIT——它的「库存行锁」<b>无法释放</b>，协调者只能无限重试/等待', 'bad');
          state.busy = false;
          $('intervene').style.display = 'inline-block';
          renderSwim();
          setVerdict('🚨 <b>这就是 2PC 的阻塞（blocking）本质</b>：参与者在 prepare 阶段投出 YES 后，就把命运交给了协调者——' +
            '此刻它宕机，锁一直攥着，其他事务访问这行库存全部排队等待；协调者若也跟着宕机，恢复前<b>整个系统没人知道该提交还是该回滚</b>。' +
            '3PC 用"超时自动提交"缓解，但引入了脑裂下可能错提交的新问题——所以工程界的答案是：核心链路绕开 2PC，用 TCC/Saga/本地消息表。点「管理员介入」收场。', true);
        }, 600);
        return;
      }
      state.phase = 'committing';
      phase('commit');
      addLog('📣 全部 YES → 协调者广播 COMMIT');
      var c = 0;
      var timer2 = setInterval(function () {
        if (c >= PARTICIPANTS.length) {
          clearInterval(timer2);
          state.phase = 'done';
          state.busy = false;
          addLog('🎉 全局事务提交完成', 'ok');
          setVerdict('🎉 <b>事务成功</b>：三个服务要么都提交、要么都回滚，强一致达成。回顾成本账：' +
            '① 两轮网络往返，延迟翻倍；② prepare 到 commit 期间所有资源锁定，吞吐被最慢的参与者拖垮；' +
            '③ 协调者是单点。这就是为什么互联网高并发下单链路弃 2PC 而取本地消息表（最终一致）——勾选"prepare 后宕机"重放，看最坏情况。');
          renderSwim();
          return;
        }
        var p = PARTICIPANTS[c++];
        state.committed[p.id] = true;
        state.locked[p.id] = false;
        addLog('✅ ' + p.name + ' 收到 COMMIT，提交「' + p.resource + '」并释放锁', 'ok');
        renderSwim();
      }, 500);
    }
  }

  var PHASE_INFO = {
    ph1: '📖 <b>阶段一 · Prepare（准备/投票阶段）</b><br>' +
      '① 协调者向所有参与者广播 PREPARE：「你能不能提交？」<br>' +
      '② 每个参与者在本地执行事务（扣库存、写订单草稿……）但<b>不提交</b>，把 redo/undo 日志落盘，并<b>锁住涉及的资源</b>；<br>' +
      '③ 能干成就投 YES，干不成（如库存不足）投 NO。<br>' +
      '<b>关键：</b>投出 YES 是一个不可撤销的承诺——从这一刻起，资源被攥住，参与者把命运交给了协调者。锁等待、阻塞、宕机风险全都源于这个承诺。',
    ph2: '📖 <b>阶段二 · Commit / Rollback（决策执行阶段）</b><br>' +
      '① 协调者收齐投票：<b>全部 YES</b> → 广播 COMMIT，各参与者正式提交并释放锁；<b>任一 NO 或超时</b> → 广播 ROLLBACK，全局回滚、释放所有锁；<br>' +
      '② 参与者在阶段一投了 YES 后只能干等协调者的决定——这就是 2PC 的<b>阻塞本质</b>：协调者此刻宕机，没人知道该提交还是回滚；<br>' +
      '<b>关键：</b>两轮网络往返 = 延迟翻倍；锁持有时间 = 最慢参与者的耗时。高并发链路因此弃用 2PC，改用 TCC / Saga / 本地消息表（最终一致）。'
  };
  ['ph1', 'ph2'].forEach(function (id) {
    $(id).addEventListener('click', function () {
      if (state.busy) return;
      setVerdict(PHASE_INFO[id]);
    });
  });

  $('start').addEventListener('click', function () {
    resetState();
    runTx();
  });
  $('intervene').addEventListener('click', function () {
    state.dead = {};
    state.locked = {};
    state.phase = 'aborted';
    phase('abort');
    $('intervene').style.display = 'none';
    addLog('🛠 管理员人工核对后强制回滚库存服务，锁释放——2PC 的阻塞最终靠"人"兜底', 'warn');
    setVerdict('🛠 事故收场：靠人工介入解锁。请把这一幕记住——<b>需要人半夜爬起来解锁的事务协议，不适合每秒几千单的下单链路</b>。' +
      '这正是 §3.4 选择本地消息表（Outbox）的根本理由：用"最终一致 + 幂等重试"换掉"强一致 + 阻塞等待"。', true);
    renderSwim();
  });
  $('reset').addEventListener('click', function () {
    resetState();
    setVerdict('已重置。推荐动线：① 不勾选捣乱项跑一遍正常流程 → ② 勾「投 NO」看全局回滚 → ③ 勾「prepare 后宕机」看阻塞与资源锁死，最后管理员介入。');
  });

  resetState();
};
