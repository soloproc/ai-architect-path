/* replication-lag —— 主从复制延迟与读写一致性模拟器（卷03 §5）
 * 契约：注册到 window.DEMOS['replication-lag']，Shadow DOM，样式内联，无外部依赖。
 * 交互：选复制模式（异步/半同步/同步），点"写入一笔订单"观察主库立即生效、
 * 从库沿时间轴追赶；写入后立刻"从从库读"，体验"读不到自己刚写的数据"；
 * 勾选"写后读主"修复；点"主库宕机"看异步模式的丢数据窗口。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['replication-lag'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var MODES = {
    async: { label: '异步复制', desc: '主库写完立即返回，从库后台追赶（MySQL 默认）', waitAck: 0 },
    semi:  { label: '半同步复制', desc: '主库等至少 1 个从库收到日志才返回', waitAck: 1 },
    sync:  { label: '全同步复制', desc: '主库等全部从库应用完才返回（吞吐骤降）', waitAck: 2 }
  };
  var state = {
    mode: 'async',
    seq: 0,               // 主库已写入的订单数
    replicas: [0, 0],     // 两个从库各自已应用到的序号
    pendingAcks: 0,
    staleReads: 0,
    goodReads: 0,
    readLeader: false,
    primaryDead: false,
    lostWrites: 0,
    timer: null,
    log: []
  };

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    'h4{margin:14px 0 8px;font-size:13px;color:#1c1917;font-weight:600;}' +
    '.row{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;align-items:flex-end;}' +
    '.ctl{display:flex;flex-direction:column;gap:3px;min-width:150px;flex:1;}' +
    '.ctl label{font-size:11px;color:#57534e;display:flex;justify-content:space-between;gap:8px;}' +
    '.ctl label b{color:#0f766e;font-variant-numeric:tabular-nums;}' +
    'input[type=range]{width:100%;accent-color:#0f766e;}' +
    'select{font-family:inherit;font-size:12px;padding:5px 8px;border:1px solid #d6d3d1;border-radius:6px;background:#fff;color:#1c1917;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button.danger{border-color:#dc2626;background:#dc2626;}' +
    'button:hover{opacity:.88;}' +
    'button:disabled{opacity:.45;cursor:not-allowed;}' +
    '.chk{display:flex;align-items:center;gap:6px;font-size:12px;color:#57534e;}' +
    '.chk input{accent-color:#0f766e;}' +
    '.cluster{display:flex;gap:12px;flex-wrap:wrap;margin:10px 0;}' +
    '.node{flex:1;min-width:170px;border:1px solid #e5e1d8;border-radius:8px;padding:10px;background:#fafaf9;}' +
    '.node.primary{border-color:#0f766e;background:#f0fdfa;}' +
    '.node.dead{border-color:#dc2626;background:#fef2f2;opacity:.75;}' +
    '.node .nh{display:flex;justify-content:space-between;font-size:12px;font-weight:600;color:#44403c;margin-bottom:6px;}' +
    '.node .pos{font-size:20px;font-weight:700;color:#0f766e;font-variant-numeric:tabular-nums;}' +
    '.node .sub{font-size:11px;color:#78716c;}' +
    '.lagbar{height:8px;border-radius:4px;background:#e7e5e4;overflow:hidden;margin-top:6px;}' +
    '.lagbar i{display:block;height:100%;background:#0f766e;transition:width .3s;}' +
    '.lagbar i.behind{background:#d97706;}' +
    '.metrics{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;}' +
    '.metric{flex:1;min-width:110px;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;}' +
    '.metric .k{font-size:11px;color:#78716c;}' +
    '.metric .v{font-size:17px;font-weight:600;color:#0f766e;font-variant-numeric:tabular-nums;}' +
    '.metric .v.warn{color:#d97706;}' +
    '.metric .v.bad{color:#dc2626;}' +
    '.log{margin-top:8px;max-height:120px;overflow:auto;font-size:11px;line-height:1.7;color:#57534e;background:#fafaf9;border:1px solid #e7e5e4;border-radius:6px;padding:8px 10px;font-family:ui-monospace,monospace;}' +
    '.log .bad{color:#dc2626;}' +
    '.log .ok{color:#0f766e;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 主从复制延迟与读写一致性（卷03 §5：复制的代价）</div>' +
    '  <h4>① 选复制模式，写入订单</h4>' +
    '  <div class="row">' +
    '    <div class="ctl" style="max-width:260px"><label>复制模式</label>' +
    '      <select id="mode"><option value="async">异步复制（默认）</option>' +
    '      <option value="semi">半同步复制</option><option value="sync">全同步复制</option></select></div>' +
    '    <div class="ctl"><label>网络/应用延迟（从库每条日志的追赶耗时）<b id="delayV">600ms</b></label>' +
    '      <input id="delay" type="range" min="100" max="2000" step="100" value="600"></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto"><button id="write">写入一笔订单</button></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto"><button id="burst" class="ghost">连写 5 笔</button></div>' +
    '  </div>' +
    '  <div class="cluster" id="cluster"></div>' +
    '  <h4>② 立刻读一次，看会不会"读不到自己刚写的"</h4>' +
    '  <div class="row">' +
    '    <div class="ctl" style="flex:0;min-width:auto"><button id="read" class="ghost">从从库读我的最新订单</button></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto;justify-content:flex-end">' +
    '      <span class="chk"><input type="checkbox" id="readLeader"><label for="readLeader">写后读主（读己之写修复）</label></span></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto"><button id="kill" class="danger">主库宕机！</button></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto"><button id="reset" class="ghost">重置</button></div>' +
    '  </div>' +
    '  <div class="metrics">' +
    '    <div class="metric"><div class="k">本次写入客户端等待</div><div class="v" id="mWait">-</div></div>' +
    '    <div class="metric"><div class="k">从库最大落后</div><div class="v" id="mLag">-</div></div>' +
    '    <div class="metric"><div class="k">读到旧值次数</div><div class="v" id="mStale">0</div></div>' +
    '    <div class="metric"><div class="k">宕机丢失写入</div><div class="v" id="mLost">0</div></div>' +
    '  </div>' +
    '  <div class="log" id="log"></div>' +
    '  <div class="verdict" id="verdict">选「异步复制」，写入一笔订单后<b>立刻</b>点「从从库读我的最新订单」——大概率读不到，这就是复制延迟导致的"读己之写"违反。</div>' +
    '  <div class="note">教学简化：写入等待 = 模式要求的 ACK 数 × 追赶延迟；追赶用真实定时器模拟，所以写入后 1 秒内读从库最容易抓到"旧值"。半同步只保证"日志到了从库"，不保证已应用。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  function delay() { return parseInt($('delay').value, 10); }

  function addLog(text, cls) {
    state.log.unshift({ text: text, cls: cls || '' });
    if (state.log.length > 30) state.log.pop();
    $('log').innerHTML = state.log.map(function (l) {
      return '<div class="' + l.cls + '">' + l.text + '</div>';
    }).join('');
  }

  function maxLag() {
    var m = 0;
    for (var i = 0; i < state.replicas.length; i++) {
      m = Math.max(m, state.seq - state.replicas[i]);
    }
    return m;
  }

  function renderCluster() {
    var html = '<div class="node' + (state.primaryDead ? ' dead' : ' primary') + '">' +
      '<div class="nh"><span>主库' + (state.primaryDead ? '（已宕机）' : '（可写）') + '</span><span>orders</span></div>' +
      '<div class="pos">' + state.seq + '</div><div class="sub">已提交订单数</div></div>';
    for (var i = 0; i < state.replicas.length; i++) {
      var lag = state.seq - state.replicas[i];
      var pct = state.seq === 0 ? 100 : Math.round(state.replicas[i] / state.seq * 100);
      html += '<div class="node">' +
        '<div class="nh"><span>从库 ' + (i + 1) + '（只读）</span><span>' +
        (lag === 0 ? '已追平' : '落后 ' + lag + ' 笔') + '</span></div>' +
        '<div class="pos">' + state.replicas[i] + '</div><div class="sub">已应用订单数</div>' +
        '<div class="lagbar"><i class="' + (lag > 0 ? 'behind' : '') + '" style="width:' + pct + '%"></i></div></div>';
    }
    $('cluster').innerHTML = html;
    $('mLag').textContent = maxLag() + ' 笔';
    $('mLag').className = 'v' + (maxLag() > 0 ? ' warn' : '');
    $('mStale').textContent = String(state.staleReads);
    $('mStale').className = 'v' + (state.staleReads > 0 ? ' bad' : '');
    $('mLost').textContent = String(state.lostWrites);
    $('mLost').className = 'v' + (state.lostWrites > 0 ? ' bad' : '');
    $('kill').disabled = state.primaryDead;
    $('write').disabled = state.primaryDead;
    $('burst').disabled = state.primaryDead;
  }

  function catchUpLoop() {
    if (state.timer) return;
    state.timer = setInterval(function () {
      var moved = false;
      for (var i = 0; i < state.replicas.length; i++) {
        if (state.replicas[i] < state.seq) {
          state.replicas[i]++;
          moved = true;
        }
      }
      if (!moved) {
        clearInterval(state.timer);
        state.timer = null;
      }
      renderCluster();
    }, delay());
  }

  function doWrite() {
    if (state.primaryDead) return;
    var mode = MODES[state.mode];
    var waitMs = mode.waitAck * delay();
    var before = state.seq;
    // 客户端视角：按模式等待不同数量的 ACK
    setTimeout(function () {
      state.seq = before + 1;
      addLog('✍️ 写入订单 #' + state.seq + '：' + mode.label + '，客户端等待 ' +
        waitMs + 'ms 后返回成功', 'ok');
      $('mWait').textContent = waitMs + 'ms';
      renderCluster();
      catchUpLoop();
      updateVerdictAfterWrite();
    }, waitMs);
  }

  function updateVerdictAfterWrite() {
    var v = $('verdict');
    v.className = 'verdict';
    v.innerHTML = '写入已返回。注意：主库是 <b>' + state.seq + '</b>，从库还在追赶中。' +
      '现在立刻点「从从库读我的最新订单」，体会异步复制的"读己之写"窗口；' +
      '也可以勾选「写后读主」再读，对比差异。';
  }

  $('mode').addEventListener('change', function () {
    state.mode = $('mode').value;
    var mode = MODES[state.mode];
    addLog('切换为' + mode.label + '：' + mode.desc);
    var v = $('verdict');
    v.className = 'verdict';
    var hint = { async: '异步模式：写入最快返回，但从库滞后窗口最大——最容易读到旧值，宕机丢数据窗口也最大。',
                 semi: '半同步模式：写入多等一跳，但换到"至少一个从库有日志"——主库宕机时数据不丢（故障切换后新主有全部数据）。',
                 sync: '全同步模式：写延迟 = 2 × 追赶延迟，吞吐骤降，换取任意时刻从库与主库完全一致。' };
    v.innerHTML = '<b>' + mode.label + '</b>：' + hint[state.mode];
  });
  $('delay').addEventListener('input', function () {
    $('delayV').textContent = delay() + 'ms';
  });
  $('write').addEventListener('click', doWrite);
  $('burst').addEventListener('click', function () {
    for (var i = 0; i < 5; i++) setTimeout(doWrite, i * 80);
  });
  $('read').addEventListener('click', function () {
    var v = $('verdict');
    if (state.readLeader) {
      state.goodReads++;
      addLog('📖 读主库：看到订单 #' + state.seq + '（写后读主，永远最新）', 'ok');
      v.className = 'verdict';
      v.innerHTML = '✅ <b>写后读主</b>：直接读主库，读到 #' + state.seq + '，永远是最新的。' +
        '代价：这部分读流量打回主库，从库读扩容被削弱——所以工程上只对"刚写过的人"读主（按用户路由），旁人仍读从库。';
      return;
    }
    // 随机挑一个从库读
    var idx = Math.random() < 0.5 ? 0 : 1;
    var seen = state.replicas[idx];
    if (seen < state.seq) {
      state.staleReads++;
      addLog('📖 读从库 ' + (idx + 1) + '：只看到 #' + seen + '，最新订单 #' + state.seq + ' 不见了！', 'bad');
      v.className = 'verdict bad';
      v.innerHTML = '⚠️ <b>读己之写被违反</b>：你刚下的单（#' + state.seq + '）在从库 ' + (idx + 1) +
        ' 上还不存在（它只追到 #' + seen + '）。用户视角就是"付完款刷新订单列表是空的"。' +
        '修法有三种：写后读主（本 Demo 的开关）、按用户粘住同一从库（单调读）、或客户端记住最后写位置要求从库至少追到该位点。';
    } else {
      state.goodReads++;
      addLog('📖 读从库 ' + (idx + 1) + '：看到 #' + seen + '，恰好已追平', 'ok');
      v.className = 'verdict';
      v.innerHTML = '这次从库已追平，读到了最新值——但<b>这只是运气</b>：延迟窗口内多读几次、或连写 5 笔后立刻读，旧值就会出现。最终一致 = "总会对，但不保证现在就对"。';
    }
    renderCluster();
  });
  $('readLeader').addEventListener('change', function () {
    state.readLeader = $('readLeader').checked;
  });
  $('kill').addEventListener('click', function () {
    if (state.primaryDead) return;
    state.primaryDead = true;
    var unapplied = maxLag();
    if (state.mode === 'async' && unapplied > 0) {
      state.lostWrites += unapplied;
      state.seq = Math.max(state.replicas[0], state.replicas[1]); // 新主只剩追平部分
      addLog('💥 主库宕机！有 ' + unapplied + ' 笔已提交订单尚未传到任何从库——故障切换后永久丢失', 'bad');
      var v = $('verdict');
      v.className = 'verdict bad';
      v.innerHTML = '💥 <b>异步复制的代价显形</b>：主库返回"写入成功"的 ' + unapplied +
        ' 笔订单随主库磁盘一起消失（已重置为新主上的 #' + state.seq + '）。' +
        '这就是零售订单库要开<b>半同步</b>的原因：写入多等一跳，换"主库宕机不丢已确认数据"。再点重置换一种模式对比。';
    } else {
      addLog('💥 主库宕机。当前模式/时序下从库已有全部数据，切换不丢单', 'ok');
      var v2 = $('verdict');
      v2.className = 'verdict';
      v2.innerHTML = '💥 主库宕机，但' + (state.mode === 'async' ? '从库恰好已追平' : MODES[state.mode].label + '保证日志已在从库') +
        '——故障切换不丢数据。试试：重置后选<b>异步复制</b>，连写 5 笔，在从库追平<b>之前</b>点宕机，对比丢失窗口。';
    }
    renderCluster();
  });
  $('reset').addEventListener('click', function () {
    state.seq = 0;
    state.replicas = [0, 0];
    state.staleReads = 0;
    state.goodReads = 0;
    state.lostWrites = 0;
    state.primaryDead = false;
    state.log = [];
    $('log').innerHTML = '';
    $('mWait').textContent = '-';
    var v = $('verdict');
    v.className = 'verdict';
    v.innerHTML = '已重置。建议顺序：异步模式连写 5 笔 → 立刻读从库（抓到旧值）→ 趁从库未追平点宕机（看到丢单）→ 换半同步重放。';
    renderCluster();
  });

  renderCluster();
};
