/* raft-election —— Raft 选主与日志复制动画（卷04 §3.6 / 共识算法）
 * 契约：注册到 window.DEMOS['raft-election']，Shadow DOM，样式内联，无外部依赖。
 * 交互：点"某节点选举超时"发起选主，观察 term 递增、拉票、多数派胜出；
 * 当选后点"客户端写入一条日志"，观察 Leader 复制到多数派后才标记"已提交"；
 * "杀死 Leader"后重新选举；"制造网络分区(2|3)"体验少数派无法当选、无法提交。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['raft-election'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var N = 5;
  var MAJORITY = 3;
  var nodes = [];
  var seq = 0;
  var busy = false;

  function reset() {
    nodes = [];
    for (var i = 0; i < N; i++) {
      nodes.push({ id: i, role: 'follower', term: 1, votes: 0, alive: true, zone: 0, log: [], commit: -1 });
    }
    seq = 0;
    busy = false;
    logLines = [];
  }
  var logLines = [];
  reset();

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    'h4{margin:14px 0 8px;font-size:13px;color:#1c1917;font-weight:600;}' +
    '.row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button.danger{border-color:#dc2626;background:#dc2626;}' +
    'button.warn{border-color:#d97706;background:#d97706;}' +
    'button:hover{opacity:.88;}' +
    'button:disabled{opacity:.45;cursor:not-allowed;}' +
    '.cluster{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;}' +
    '.node{flex:1;min-width:96px;border:2px solid #d6d3d1;border-radius:8px;padding:8px;background:#fafaf9;text-align:center;transition:border-color .3s,background .3s;}' +
    '.node .nid{font-size:12px;font-weight:700;color:#44403c;}' +
    '.node .role{font-size:11px;margin:2px 0;color:#78716c;}' +
    '.node .term{font-size:11px;color:#57534e;font-variant-numeric:tabular-nums;}' +
    '.node .votes{font-size:16px;font-weight:700;color:#d97706;min-height:20px;font-variant-numeric:tabular-nums;}' +
    '.node .entries{font-size:10px;color:#57534e;font-family:ui-monospace,monospace;word-break:break-all;min-height:26px;}' +
    '.node.leader{border-color:#0f766e;background:#f0fdfa;}' +
    '.node.candidate{border-color:#d97706;background:#fffbeb;}' +
    '.node.dead{border-color:#dc2626;background:#fef2f2;opacity:.6;}' +
    '.node.dead .nid{text-decoration:line-through;}' +
    '.zonediv{text-align:center;font-size:11px;color:#dc2626;margin:2px 0 6px;font-weight:600;}' +
    '.log{margin-top:8px;max-height:130px;overflow:auto;font-size:11px;line-height:1.7;color:#57534e;background:#fafaf9;border:1px solid #e7e5e4;border-radius:6px;padding:8px 10px;font-family:ui-monospace,monospace;}' +
    '.log .ok{color:#0f766e;}' +
    '.log .bad{color:#dc2626;}' +
    '.log .warn{color:#d97706;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · Raft 选主与日志复制（卷04：共识算法——"多数派"是一切的答案）</div>' +
    '  <h4>① 选主</h4>' +
    '  <div class="row">' +
    '    <button id="elect">某节点选举超时，发起选主</button>' +
    '    <button id="kill" class="danger">杀死 Leader</button>' +
    '    <button id="partition" class="warn">制造网络分区（2 | 3）</button>' +
    '    <button id="heal" class="ghost">恢复网络 / 重启节点</button>' +
    '  </div>' +
    '  <h4>② 日志复制（需先有 Leader）</h4>' +
    '  <div class="row">' +
    '    <button id="append" class="ghost">客户端写入一条日志</button>' +
    '    <button id="reset" class="ghost">重置集群</button>' +
    '  </div>' +
    '  <div class="zonediv" id="zonediv" style="display:none">— 网络分区中：左侧区域 A（节点 0-1）｜右侧区域 B（节点 2-4）互不通信 —</div>' +
    '  <div class="cluster" id="cluster"></div>' +
    '  <div class="log" id="log"></div>' +
    '  <div class="verdict" id="verdict">5 节点集群刚启动，大家都是 Follower，term=1。点「某节点选举超时，发起选主」，看一个 Candidate 如何靠<b>多数派（≥3 票）</b>当选。</div>' +
    '  <div class="note">教学简化：真实 Raft 的选举超时是 150–300ms 随机值（避免选票瓜分），日志还有任期号与一致性检查，此处略去；多数派 = ⌊N/2⌋+1，5 节点集群容忍 2 个节点故障。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  function addLog(text, cls) {
    logLines.unshift({ t: text, c: cls || '' });
    if (logLines.length > 40) logLines.pop();
    $('log').innerHTML = logLines.map(function (l) {
      return '<div class="' + l.c + '">' + l.t + '</div>';
    }).join('');
  }

  function reachable(a, b) {
    // 同一网络区域且都活着才能通信
    return nodes[a].alive && nodes[b].alive && nodes[a].zone === nodes[b].zone;
  }
  function leader() {
    for (var i = 0; i < N; i++) if (nodes[i].role === 'leader' && nodes[i].alive) return nodes[i];
    return null;
  }
  function maxTerm() {
    var t = 1;
    for (var i = 0; i < N; i++) if (nodes[i].term > t) t = nodes[i].term;
    return t;
  }

  function render() {
    var html = '';
    for (var i = 0; i < N; i++) {
      var nd = nodes[i];
      var cls = nd.alive ? nd.role : 'dead';
      var roleTxt = !nd.alive ? '已宕机' : (nd.role === 'leader' ? '👑 Leader' : (nd.role === 'candidate' ? '🗳 Candidate' : 'Follower'));
      var entries = nd.log.map(function (e, idx) {
        return idx <= nd.commit ? '<b>' + e + '</b>' : e;
      }).join(' ');
      html += '<div class="node ' + cls + '">' +
        '<div class="nid">节点 ' + nd.id + (nd.zone === 1 ? ' ·B区' : (anyPartition() ? ' ·A区' : '')) + '</div>' +
        '<div class="role">' + roleTxt + '</div>' +
        '<div class="term">term=' + nd.term + '</div>' +
        '<div class="votes">' + (nd.role === 'candidate' && nd.alive ? nd.votes + ' 票' : '') + '</div>' +
        '<div class="entries">' + (entries || '（日志空）') + '</div></div>';
    }
    $('cluster').innerHTML = html;
    $('zonediv').style.display = anyPartition() ? 'block' : 'none';
  }
  function anyPartition() {
    for (var i = 0; i < N; i++) if (nodes[i].zone !== nodes[0].zone) return true;
    return false;
  }

  function setVerdict(html, bad) {
    var v = $('verdict');
    v.className = bad ? 'verdict bad' : 'verdict';
    v.innerHTML = html;
  }

  function elect() {
    if (busy) return;
    // 挑一个活着的 follower 当候选人
    var cand = null;
    for (var i = 0; i < N; i++) {
      if (nodes[i].alive && nodes[i].role !== 'leader') { cand = nodes[i]; break; }
    }
    if (!cand) { setVerdict('已有 Leader 或没有可用候选节点。可先「杀死 Leader」。', true); return; }
    busy = true;
    cand.role = 'candidate';
    cand.term = maxTerm() + 1;
    cand.votes = 1; // 投自己
    addLog('⏰ 节点 ' + cand.id + ' 选举超时 → 成为 Candidate，term 升到 ' + cand.term + '，先投自己 1 票', 'warn');
    render();
    setVerdict('节点 ' + cand.id + ' 发起 term=' + cand.term + ' 的选举。Candidate 向<b>可达的</b>所有节点拉票——注意：只有拿到多数派（≥' + MAJORITY + ' 票）才能当选。');
    var others = [];
    for (var j = 0; j < N; j++) if (j !== cand.id) others.push(j);
    var step = 0;
    var timer = setInterval(function () {
      if (step >= others.length) {
        clearInterval(timer);
        busy = false;
        if (cand.votes >= MAJORITY) {
          cand.role = 'leader';
          for (var k = 0; k < N; k++) {
            if (nodes[k].alive && nodes[k].id !== cand.id && reachable(cand.id, k)) {
              nodes[k].role = 'follower';
              nodes[k].term = cand.term;
            }
          }
          addLog('👑 节点 ' + cand.id + ' 拿到 ' + cand.votes + '/' + N + ' 票（≥多数派 ' + MAJORITY + '），当选 term=' + cand.term + ' 的 Leader', 'ok');
          setVerdict('✅ <b>选举成功</b>：节点 ' + cand.id + ' 以 ' + cand.votes + ' 票当选。其余节点见到更高的 term=' + cand.term +
            ' 后自动退回 Follower——<b>term 单调递增</b>是 Raft 防止"两个皇帝"的第一道锁。现在可以点「客户端写入一条日志」。');
        } else {
          cand.role = 'follower';
          addLog('❌ 节点 ' + cand.id + ' 只拿到 ' + cand.votes + '/' + N + ' 票，不足多数派 ' + MAJORITY + '，选举失败，退回 Follower', 'bad');
          setVerdict('❌ <b>选举失败</b>：只拿到 ' + cand.votes + ' 票（需要 ≥' + MAJORITY + '）。这就是少数派区域的宿命——' +
            '<b>网络分区时，小的一方永远选不出 Leader，也就拒绝写入</b>，这就是 CAP 里"P 发生时选 C（一致性）"的具体机制。点「恢复网络」后再选。', true);
        }
        render();
        return;
      }
      var o = others[step++];
      if (reachable(cand.id, o)) {
        if (nodes[o].term <= cand.term) {
          nodes[o].term = cand.term;
          nodes[o].role = 'follower';
          cand.votes++;
          addLog('🗳 节点 ' + o + ' 投票给节点 ' + cand.id + '（当前 ' + cand.votes + ' 票）');
        } else {
          addLog('🚫 节点 ' + o + ' 的 term 更高（' + nodes[o].term + '），拒绝投票', 'bad');
        }
      } else {
        addLog('✉️✗ 拉票消息到不了节点 ' + o + '（宕机或跨分区）', 'bad');
      }
      render();
    }, 350);
  }

  function appendEntry() {
    if (busy) return;
    var ld = leader();
    if (!ld) { setVerdict('没有 Leader，客户端写入被拒绝——Raft 里只有 Leader 接收写。先选主。', true); return; }
    busy = true;
    seq++;
    var entry = 'x' + seq;
    ld.log.push(entry);
    addLog('📥 客户端写入 ' + entry + ' → Leader 先追加到自己日志（<b>未提交</b>状态）');
    render();
    var acked = 1; // Leader 自己
    var others = [];
    for (var j = 0; j < N; j++) if (j !== ld.id) others.push(j);
    var step = 0;
    var committed = false;
    var timer = setInterval(function () {
      if (step >= others.length) {
        clearInterval(timer);
        busy = false;
        if (!committed) {
          addLog('⏸ 日志 ' + entry + ' 只复制到 ' + acked + '/' + N + ' 节点（<多数派 ' + MAJORITY + '），<b>不能提交</b>，客户端等待', 'bad');
          setVerdict('⏸ <b>无法提交</b>：' + entry + ' 只到了 ' + acked + ' 个节点。Raft 的铁律——<b>只有复制到多数派的日志才允许提交</b>（提交后才对客户端可见、才永不丢失）。少数派区域的分区里，写入会卡住，一致性优先于可用性。恢复网络后重试。', true);
        }
        render();
        return;
      }
      var o = others[step++];
      if (reachable(ld.id, o)) {
        nodes[o].log.push(entry);
        nodes[o].commit = Math.min(nodes[o].commit, nodes[o].log.length - 1);
        acked++;
        addLog('📨 ' + entry + ' 复制到节点 ' + o + '（已复制 ' + acked + '/' + N + '）');
        if (!committed && acked >= MAJORITY) {
          committed = true;
          for (var k = 0; k < N; k++) {
            if (nodes[k].alive && reachable(ld.id, k)) nodes[k].commit = nodes[k].log.length - 1;
          }
          addLog('✅ ' + entry + ' 已复制到多数派（' + acked + ' 个），Leader 标记<b>已提交</b>并向客户端返回成功', 'ok');
          setVerdict('✅ <b>提交成功</b>：' + entry + ' 已落到 ' + acked + ' 个节点（≥多数派）。此后即使 Leader 宕机，' +
            '新 Leader 也一定从"含有这条日志的多数派"中产生——<b>多数派相交原理</b>：任意两个多数派至少共享 1 个节点，这就是已提交日志永不丢的数学保证。试试现在「杀死 Leader」再选举，日志还在。');
        }
        render();
      } else {
        addLog('✉️✗ ' + entry + ' 到不了节点 ' + o + '（宕机或跨分区）', 'bad');
      }
    }, 350);
  }

  $('elect').addEventListener('click', elect);
  $('append').addEventListener('click', appendEntry);
  $('kill').addEventListener('click', function () {
    var ld = leader();
    if (!ld) { setVerdict('当前没有 Leader 可杀（可以杀任意节点制造故障，用分区按钮也行）。', true); return; }
    ld.alive = false;
    ld.role = 'follower';
    addLog('💥 Leader（节点 ' + ld.id + '）宕机！心跳停止，集群进入"无政府状态"', 'bad');
    setVerdict('💥 Leader 挂了。剩余节点等不到心跳，各自开始随机倒计时——谁先到点谁就发起选举（真实 Raft 用 150–300ms <b>随机</b>超时错开大家）。点「发起选主」看恢复过程；注意看已提交日志（<b>加粗</b>的条目）是否原样保留。');
    render();
  });
  $('partition').addEventListener('click', function () {
    nodes[0].zone = 0; nodes[1].zone = 0;
    nodes[2].zone = 1; nodes[3].zone = 1; nodes[4].zone = 1;
    addLog('🔀 网络分区：{节点0,1} 与 {节点2,3,4} 互不通信', 'warn');
    setVerdict('🔀 <b>网络分区形成</b>：A 区 2 个节点、B 区 3 个节点。现在分别在两边发起选举试试——' +
      'A 区最多拿 2 票（<多数派 3）永远选不出 Leader；B 区能拿到 3 票，服务继续。' +
      '这就是"多数派"设计的意义：<b>分区时宁可小的一侧停摆，也不允许两侧各自为政（脑裂）</b>。');
    render();
  });
  $('heal').addEventListener('click', function () {
    for (var i = 0; i < N; i++) {
      nodes[i].zone = 0;
      if (!nodes[i].alive) {
        nodes[i].alive = true;
        nodes[i].role = 'follower';
        nodes[i].term = maxTerm();
        addLog('🔧 节点 ' + i + ' 重启归队，以 term=' + nodes[i].term + ' 的 Follower 身份追赶日志');
      }
    }
    addLog('🔗 网络恢复，所有节点重新连通');
    setVerdict('🔗 网络已恢复、宕机节点已重启。重启节点会作为 Follower 从 Leader 那里补齐缺失的日志（日志复制的一致性检查保证不重不漏）。可以重新选主或写入。');
    render();
  });
  $('reset').addEventListener('click', function () {
    reset();
    addLog('🔄 集群重置：5 个 Follower，term=1');
    setVerdict('已重置。推荐动线：① 选主 → ② 写 2 条日志 → ③ 杀死 Leader → ④ 重新选主（看日志还在）→ ⑤ 制造分区，在 A 区（2 节点侧）选主和写入，体验少数派的"不可用"。');
    render();
  });

  render();
};
