/* tcp-handshake —— TCP 三次握手 / 四次挥手状态机（卷01 §1.5）
 * 契约：注册到 window.DEMOS['tcp-handshake']，Shadow DOM，样式内联，无外部依赖。
 * 点「下一步」逐个发出 SYN / SYN+ACK / ACK / FIN 报文，左右面板同步高亮两端状态；
 * 「自动播放」连续走完；「如果只有两次握手」演示迷途旧 SYN 的反例；
 * 「丢包场景」演示最后的 ACK 丢失时服务端重发 FIN、TIME_WAIT 兜底；
 * 走完全程后出现 TIME_WAIT（2×MSL）倒计时条；底部输出区逐步给出教学结论。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['tcp-handshake'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var CLIENT_STATES = ['CLOSED', 'SYN_SENT', 'ESTABLISHED', 'FIN_WAIT_1', 'FIN_WAIT_2', 'TIME_WAIT'];
  var SERVER_STATES = ['LISTEN', 'SYN_RCVD', 'ESTABLISHED', 'CLOSE_WAIT', 'LAST_ACK', 'CLOSED'];

  var STEPS = [
    { phase: '准备', c: 'CLOSED', s: 'LISTEN', pkt: null,
      note: '服务端执行 listen() 后进入 LISTEN，随时等待连接；客户端还没有动作。' },
    { phase: '握手 1/3', pkt: { from: 'c', label: 'SYN  seq=100' }, c: 'SYN_SENT', s: 'LISTEN',
      note: '客户端发出 SYN，进入 SYN_SENT："我想建立连接，我的起始序号是 100。"' },
    { phase: '握手 2/3', pkt: { from: 's', label: 'SYN+ACK  seq=300, ack=101' }, c: 'SYN_SENT', s: 'SYN_RCVD',
      note: '服务端回 SYN+ACK，进入 SYN_RCVD："你的 100 我收到了（ack=101），我的起始序号是 300。"SYN 与 ACK 合并在一个包里——这就是握手不必是四次的原因。' },
    { phase: '握手 3/3', pkt: { from: 'c', label: 'ACK  ack=301' }, c: 'ESTABLISHED', s: 'ESTABLISHED',
      note: '客户端回 ACK，双方 ESTABLISHED。这第三次握手是客户端的"活人证明"——服务端由此确认"我的回包你能收到"。' },
    { phase: '数据传输', pkt: { from: 'c', label: 'GET /orders/42 HTTP/1.1' }, c: 'ESTABLISHED', s: 'ESTABLISHED',
      note: '连接上开始跑 HTTP。开启 Keep-Alive 时，这条连接可以反复跑很多次请求——握手只付一次税。' },
    { phase: '数据传输', pkt: { from: 's', label: '200 OK + JSON' }, c: 'ESTABLISHED', s: 'ESTABLISHED',
      note: '响应返回。如果没有 Keep-Alive，接下来就要拆掉这条连接了——拆除也要走流程。' },
    { phase: '挥手 1/4', pkt: { from: 'c', label: 'FIN' }, c: 'FIN_WAIT_1', s: 'ESTABLISHED',
      note: '客户端先说完："我没有数据要发了"（FIN），进入 FIN_WAIT_1。注意：它只是"不说了"，还能"听"。' },
    { phase: '挥手 2/4', pkt: { from: 's', label: 'ACK' }, c: 'FIN_WAIT_2', s: 'CLOSE_WAIT',
      note: '服务端确认收到 FIN，进入 CLOSE_WAIT——它可能还有数据没发完。这就是"半关闭"：客户端闭麦，服务端还能继续讲。所以 ACK 和 FIN 往往无法合并，挥手比握手多一次。' },
    { phase: '挥手 3/4', pkt: { from: 's', label: 'FIN' }, c: 'FIN_WAIT_2', s: 'LAST_ACK',
      note: '服务端把剩余数据发完，也说"我说完了"（FIN），进入 LAST_ACK，等最后一次确认。' },
    { phase: '挥手 4/4', pkt: { from: 'c', label: 'ACK' }, c: 'TIME_WAIT', s: 'CLOSED',
      note: '客户端回最后的 ACK。服务端收到立即 CLOSED；客户端进入 TIME_WAIT"罚站" 2 倍 MSL——只有主动关闭方才付这个代价。' },
    { phase: '结束', pkt: null, c: 'CLOSED', s: 'CLOSED',
      note: '2 倍 MSL 到期，客户端也 CLOSED。等待期间完成了两件事：① 万一最后的 ACK 丢了，服务端会重发 FIN，TIME_WAIT 保证还能补 ACK；② 本连接的迷途报文已全部老死在网络里，不会污染下一条同四元组的连接。' }
  ];

  var state = { step: 0, timer: null, log: [] };

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    '.panels{display:flex;gap:12px;align-items:stretch;}' +
    '.panel{flex:1;background:#fafaf9;border:1px solid #e7e5e4;border-radius:6px;padding:10px;}' +
    '.panel h5{margin:0 0 8px;font-size:12px;color:#57534e;font-weight:600;}' +
    '.chip{display:inline-block;margin:2px 3px 2px 0;padding:2px 8px;font-size:11px;border-radius:10px;' +
    'background:#f5f5f4;border:1px solid #e7e5e4;color:#a8a29e;font-variant-numeric:tabular-nums;}' +
    '.chip.on{background:#0f766e;border-color:#0f766e;color:#fff;font-weight:600;}' +
    '.chip.warn-on{background:#d97706;border-color:#d97706;color:#fff;font-weight:600;}' +
    '.lane{flex:1.2;display:flex;flex-direction:column;justify-content:center;align-items:center;' +
    'background:#fafaf9;border:1px dashed #d6d3d1;border-radius:6px;padding:10px;min-height:110px;}' +
    '.pkt{padding:6px 14px;border-radius:14px;font-size:12px;font-weight:600;color:#fff;' +
    'background:#0f766e;opacity:0;transform:translateX(0);transition:all .35s;}' +
    '.pkt.show{opacity:1;}' +
    '.pkt.from-c{transform:translateX(-24px);}' +
    '.pkt.from-s{transform:translateX(24px);background:#57534e;}' +
    '.lane .ph{font-size:11px;color:#78716c;margin-top:8px;}' +
    '.row{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 8px;align-items:center;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 12px;' +
    'font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button.danger{background:#fff;color:#dc2626;border-color:#dc2626;}' +
    'button.warn{background:#fff;color:#d97706;border-color:#d97706;}' +
    'button:hover{opacity:.88;}' +
    'button:disabled{opacity:.4;cursor:default;}' +
    '.log{background:#fafaf9;border:1px solid #e7e5e4;border-radius:6px;padding:8px 10px;font-size:11px;' +
    'color:#57534e;max-height:92px;overflow:auto;line-height:1.8;font-variant-numeric:tabular-nums;}' +
    '.log b{color:#0f766e;}' +
    '.tw-wrap{margin-top:10px;display:none;}' +
    '.tw-label{font-size:11px;color:#57534e;display:flex;justify-content:space-between;margin-bottom:3px;}' +
    '.tw-bar{height:14px;border:1px solid #e5e1d8;border-radius:7px;overflow:hidden;background:#fafaf9;}' +
    '.tw-fill{height:100%;background:#d97706;transition:width .2s linear;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;' +
    'border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · TCP 握手与挥手状态机（卷01 §1.5：连接的一生）</div>' +
    '  <div class="panels">' +
    '    <div class="panel"><h5>客户端状态</h5><div id="cStates"></div></div>' +
    '    <div class="lane"><div class="pkt" id="pkt">—</div><div class="ph" id="ph">准备就绪</div></div>' +
    '    <div class="panel"><h5>服务端状态</h5><div id="sStates"></div></div>' +
    '  </div>' +
    '  <div class="row">' +
    '    <button id="next">下一步 ▶</button>' +
    '    <button id="auto" class="ghost">自动播放</button>' +
    '    <button id="reset" class="ghost">重置</button>' +
    '    <button id="twice" class="danger">如果只有两次握手？</button>' +
    '    <button id="lost" class="warn">丢包场景：最后的 ACK 丢了</button>' +
    '  </div>' +
    '  <div class="tw-wrap" id="twWrap">' +
    '    <div class="tw-label"><span>TIME_WAIT 倒计时（2 × MSL）</span><span id="twPct">100%</span></div>' +
    '    <div class="tw-bar"><div class="tw-fill" id="twFill" style="width:100%"></div></div>' +
    '  </div>' +
    '  <div class="log" id="log">报文记录：尚未开始。</div>' +
    '  <div class="verdict" id="verdict">点「下一步」开始建立连接。边走边看两端状态如何变化。</div>' +
    '  <div class="note">教学简化：省略了序号递增、重传计时器与同时打开/同时关闭等边角情形；MSL（报文最大存活时间）按规范通常取 30 秒~2 分钟。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  function chipHtml(states, current, warnState) {
    return states.map(function (st) {
      var cls = 'chip';
      if (st === current) cls += (st === warnState ? ' warn-on' : ' on');
      return '<span class="' + cls + '">' + st + '</span>';
    }).join('');
  }

  function render() {
    var st = STEPS[state.step];
    $('cStates').innerHTML = chipHtml(CLIENT_STATES, st.c, 'TIME_WAIT');
    $('sStates').innerHTML = chipHtml(SERVER_STATES, st.s, null);
    $('ph').textContent = st.phase + '（第 ' + state.step + '/' + (STEPS.length - 1) + ' 步）';
    var pkt = $('pkt');
    if (st.pkt) {
      pkt.textContent = (st.pkt.from === 'c' ? '→ ' : '← ') + st.pkt.label;
      pkt.className = 'pkt show ' + (st.pkt.from === 'c' ? 'from-c' : 'from-s');
      state.log.unshift('<b>' + st.phase + '</b>　' +
        (st.pkt.from === 'c' ? '客户端 → 服务端' : '服务端 → 客户端') + '：' + st.pkt.label);
    } else {
      pkt.className = 'pkt';
      pkt.textContent = '—';
    }
    $('log').innerHTML = state.log.length ? state.log.join('<br>') : '报文记录：尚未开始。';
    var v = $('verdict');
    v.className = 'verdict';
    v.innerHTML = st.note;
    if (state.step === STEPS.length - 1) {
      v.innerHTML += '<br><br><b>你观察到了什么：</b>① 握手三次 = 双方各自确认"我能发、你能收"，第三次是客户端的活人证明；' +
        '② 挥手四次 = 两个方向独立关闭，半关闭期间服务端仍可发数据；' +
        '③ TIME_WAIT 是主动关闭方替全网付出的清理成本——短连接高并发下它堆积成灾，所以工程上用 Keep-Alive 与连接池把"建拆连接的税"摊平。';
    }
    $('next').disabled = state.step >= STEPS.length - 1;
    // 到达终点后展示 TIME_WAIT 倒计时条
    if (state.step === STEPS.length - 1) startTwCountdown();
  }

  function startTwCountdown() {
    stopTw();
    var wrap = $('twWrap');
    wrap.style.display = 'block';
    var pct = 100;
    $('twFill').style.width = '100%';
    $('twPct').textContent = '100%';
    state.twTimer = setInterval(function () {
      pct -= 4;
      if (pct <= 0) { stopTw(); pct = 0; }
      $('twFill').style.width = pct + '%';
      $('twPct').textContent = pct + '%';
    }, 200);
  }

  function stopTw() {
    if (state.twTimer) { clearInterval(state.twTimer); state.twTimer = null; }
    var wrap = shadow.getElementById('twWrap');
    if (wrap) wrap.style.display = 'none';
  }

  function stopAuto() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    $('auto').textContent = '自动播放';
  }

  $('next').addEventListener('click', function () {
    stopAuto();
    if (state.step < STEPS.length - 1) { state.step++; render(); }
  });
  $('auto').addEventListener('click', function () {
    if (state.timer) { stopAuto(); return; }
    if (state.step >= STEPS.length - 1) { state.step = 0; state.log = []; render(); }
    $('auto').textContent = '暂停';
    state.timer = setInterval(function () {
      if (state.step >= STEPS.length - 1) { stopAuto(); return; }
      state.step++; render();
    }, 1600);
  });
  $('reset').addEventListener('click', function () {
    stopAuto();
    stopTw();
    state.step = 0; state.log = [];
    render();
  });
  $('twice').addEventListener('click', function () {
    stopAuto();
    stopTw();
    state.step = 0; state.log = [];
    render();
    var v = $('verdict');
    v.className = 'verdict bad';
    v.innerHTML = '<b>反例推演：握手只有两次会怎样？</b><br>' +
      '① 几分钟前客户端发出的一个 SYN 因网络拥塞滞留，此刻才"迷途"到达服务端；<br>' +
      '② 两次握手下，服务端回完 SYN+ACK 就直接建立连接、分配内存与端口资源——但那个客户端早已下线，永远不会再说话；<br>' +
      '③ 服务端抱着一条"僵尸连接"空等到超时。攻击者伪造海量 SYN 就是 SYN Flood 攻击。<br>' +
      '<b>第三次握手的意义正在于此：</b>服务端只有在收到客户端对"它的序号"的确认后，才确信对面是个活人、这次连接请求是"当下"的而非"历史残留"。';
    state.log.unshift('<b>反例</b>　迷途旧 SYN 到达 → 服务端为不存在的客户端白开连接');
    $('log').innerHTML = state.log.join('<br>');
  });
  $('lost').addEventListener('click', function () {
    stopAuto();
    stopTw();
    // 直接跳到挥手 4/4：客户端已回最后的 ACK，进入 TIME_WAIT，服务端等待中
    state.step = 9;
    state.log = [
      '<b>挥手 3/4</b>　服务端 → 客户端：FIN',
      '<b>挥手 2/4</b>　服务端 → 客户端：ACK',
      '<b>挥手 1/4</b>　客户端 → 服务端：FIN'
    ];
    render();
    var v = $('verdict');
    v.className = 'verdict bad';
    v.innerHTML = '<b>丢包推演：客户端最后的 ACK 在路上丢了。</b><br>' +
      '① 服务端没收到 ACK，重传计时器到期后<b>重发 FIN</b>；<br>' +
      '② 客户端若已直接 CLOSED，这条重发的 FIN 将无人应答，服务端只能在 LAST_ACK 里空等到超时；<br>' +
      '③ 正因为客户端还"罚站"在 TIME_WAIT，它能补回这个 ACK，让服务端正常 CLOSED。<br>' +
      '<b>结论：</b>TIME_WAIT 的第一个使命就是给"最后的 ACK 可能丢失"兜底——这就是主动关闭方才需要它的原因。';
    state.log.unshift('<b>丢包</b>　最后的 ACK 丢失 → 服务端重发 FIN → TIME_WAIT 中的客户端补 ACK');
    state.log.unshift('<b>挥手 4/4</b>　客户端 → 服务端：ACK（丢失！）');
    $('log').innerHTML = state.log.join('<br>');
  });

  render();
};
