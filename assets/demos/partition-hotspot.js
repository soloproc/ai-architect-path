/* partition-hotspot —— 分区热点与打散策略模拟器（卷03 §6）
 * 契约：注册到 window.DEMOS['partition-hotspot']，Shadow DOM，样式内联，无外部依赖。
 * 交互：注入请求流，观察 8 分区负载柱状图；开启"大租户"后某分区被打爆；
 * 切换三种对策（纯哈希 / 哈希+随机前缀 / VIP 专属分区）对比热点消除效果。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['partition-hotspot'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var P = 8;            // 固定分区数
  var NODES = 4;        // 节点数：每节点 2 个分区
  var STRATEGIES = {
    hash:   { label: '纯哈希分区', desc: 'hash(tenant_id) % 8 —— 大租户全部流量落进同一个分区' },
    salt:   { label: '哈希 + 随机前缀打散', desc: 'hash(tenant_id + 随机后缀0/1/2) % 8 —— 热点租户被拆到 3 个分区，代价是查询要广播' },
    vip:    { label: 'VIP 租户专属分区', desc: '大租户独占分区 7（甚至独占节点），普通租户共享 0-6' }
  };
  var state = {
    strategy: 'hash',
    bigTenant: true,
    bigShare: 40,       // 大租户流量占比 %
    loads: [],          // 每分区累计请求数
    total: 0,
    rejected: 0,        // 过载分区拒绝的请求
    timer: null
  };
  var CAPACITY = 220;   // 单分区容量（超过即过载标红）

  function resetLoads() {
    state.loads = [];
    for (var i = 0; i < P; i++) state.loads.push(0);
    state.total = 0;
    state.rejected = 0;
  }
  resetLoads();

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
    'button:hover{opacity:.88;}' +
    '.chk{display:flex;align-items:center;gap:6px;font-size:12px;color:#57534e;}' +
    '.chk input{accent-color:#0f766e;}' +
    '.grid{display:flex;gap:8px;align-items:flex-end;margin:12px 0 4px;}' +
    '.col{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;}' +
    '.bar{width:100%;max-width:56px;height:150px;background:#fafaf9;border:1px solid #e7e5e4;border-radius:4px;position:relative;overflow:hidden;}' +
    '.bar i{position:absolute;bottom:0;left:0;right:0;background:#0f766e;transition:height .15s;}' +
    '.bar i.hot{background:#d97706;}' +
    '.bar i.over{background:#dc2626;}' +
    '.cap{position:absolute;left:0;right:0;border-top:2px dashed #dc2626;}' +
    '.bl{font-size:11px;color:#57534e;font-variant-numeric:tabular-nums;}' +
    '.bn{font-size:11px;font-weight:600;color:#44403c;}' +
    '.nodes{display:flex;gap:8px;margin:2px 0 8px;}' +
    '.nd{flex:2;text-align:center;font-size:11px;color:#78716c;border-top:2px solid #d6d3d1;padding-top:3px;}' +
    '.nd.hot{color:#dc2626;border-top-color:#dc2626;font-weight:600;}' +
    '.metrics{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;}' +
    '.metric{flex:1;min-width:110px;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;}' +
    '.metric .k{font-size:11px;color:#78716c;}' +
    '.metric .v{font-size:17px;font-weight:600;color:#0f766e;font-variant-numeric:tabular-nums;}' +
    '.metric .v.warn{color:#d97706;}' +
    '.metric .v.bad{color:#dc2626;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 分区热点与打散策略（卷03 §6：哈希均匀 ≠ 负载均匀）</div>' +
    '  <h4>① 设定流量形态与分区策略</h4>' +
    '  <div class="row">' +
    '    <div class="ctl" style="max-width:250px"><label>分区策略</label>' +
    '      <select id="strategy"><option value="hash">纯哈希分区</option>' +
    '      <option value="salt">哈希 + 随机前缀打散</option>' +
    '      <option value="vip">VIP 租户专属分区</option></select></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto;justify-content:flex-end">' +
    '      <span class="chk"><input type="checkbox" id="big" checked><label for="big">有大租户（头部租户占 40% 流量）</label></span></div>' +
    '    <div class="ctl"><label>大租户流量占比 <b id="shareV">40%</b></label>' +
    '      <input id="share" type="range" min="10" max="80" step="5" value="40"></div>' +
    '  </div>' +
    '  <h4>② 注入请求</h4>' +
    '  <div class="row">' +
    '    <div class="ctl" style="flex:0;min-width:auto"><button id="once">注入 100 请求</button></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto"><button id="auto" class="ghost">自动持续注入</button></div>' +
    '    <div class="ctl" style="flex:0;min-width:auto"><button id="reset" class="ghost">清零重放</button></div>' +
    '  </div>' +
    '  <div class="grid" id="grid"></div>' +
    '  <div class="nodes" id="nodes"></div>' +
    '  <div class="metrics">' +
    '    <div class="metric"><div class="k">总请求</div><div class="v" id="mTotal">0</div></div>' +
    '    <div class="metric"><div class="k">最热分区负载</div><div class="v" id="mMax">0</div></div>' +
    '    <div class="metric"><div class="k">负载倾斜比（最热/平均）</div><div class="v" id="mSkew">1.0×</div></div>' +
    '    <div class="metric"><div class="k">过载拒绝请求</div><div class="v" id="mRej">0</div></div>' +
    '  </div>' +
    '  <div class="verdict" id="verdict">直接点「自动持续注入」：纯哈希策略下，大租户的 40% 流量全部砸进<b>同一个分区</b>，看它变红过载、开始拒绝请求——而旁边 7 个分区还很空闲。这就是"哈希均匀 ≠ 负载均匀"。</div>' +
    '  <div class="note">教学简化：单分区容量 220 请求（红色虚线），超过即拒绝；分区 0-1 在节点 1、2-3 在节点 2，依此类推——一个分区过热意味着整台节点过热。VIP 策略里分区 7 是大租户专属（可视作独占一台高配节点）。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  function route(isBig) {
    var s = state.strategy;
    if (s === 'vip' && isBig) return 7;                    // VIP 专属分区
    if (s === 'salt' && isBig) {                           // 大租户拆到 3 个子 key
      var suffix = Math.floor(Math.random() * 3);
      return (97 + suffix * 31) % P;                       // 稳定的伪哈希落点
    }
    if (isBig) return 3;                                   // 纯哈希：大租户恒定落分区 3
    return Math.floor(Math.random() * (s === 'vip' ? P - 1 : P)); // 普通租户
  }

  function inject(n) {
    for (var i = 0; i < n; i++) {
      var isBig = state.bigTenant && Math.random() * 100 < state.bigShare;
      var p = route(isBig);
      state.total++;
      if (state.loads[p] >= CAPACITY) {
        state.rejected++;
      } else {
        state.loads[p]++;
      }
    }
    render();
  }

  function render() {
    var maxLoad = Math.max.apply(null, state.loads.concat([1]));
    var html = '';
    for (var i = 0; i < P; i++) {
      var h = Math.min(state.loads[i] / CAPACITY * 100, 100);
      var cls = state.loads[i] >= CAPACITY ? 'over' : (state.loads[i] > CAPACITY * 0.6 ? 'hot' : '');
      html += '<div class="col"><div class="bn">P' + i + '</div>' +
        '<div class="bar"><div class="cap" style="bottom:100%"></div>' +
        '<i class="' + cls + '" style="height:' + h + '%"></i></div>' +
        '<div class="bl">' + state.loads[i] + '</div></div>';
    }
    $('grid').innerHTML = html;
    var nh = '';
    for (var n = 0; n < NODES; n++) {
      var load = state.loads[n * 2] + state.loads[n * 2 + 1];
      var hot = load > CAPACITY * 1.2;
      nh += '<div class="nd' + (hot ? ' hot' : '') + '">节点 ' + (n + 1) + '：' + load + (hot ? ' ⚠过热' : '') + '</div>';
    }
    $('nodes').innerHTML = nh;

    var avg = state.total > 0 ? state.loads.reduce(function (a, b) { return a + b; }, 0) / P : 0;
    var skew = avg > 0 ? (maxLoad / avg) : 1;
    $('mTotal').textContent = String(state.total);
    $('mMax').textContent = String(Math.max.apply(null, state.loads));
    $('mMax').className = 'v' + (maxLoad >= CAPACITY ? ' bad' : (maxLoad > CAPACITY * 0.6 ? ' warn' : ''));
    $('mSkew').textContent = skew.toFixed(1) + '×';
    $('mSkew').className = 'v' + (skew > 3 ? ' bad' : (skew > 1.8 ? ' warn' : ''));
    $('mRej').textContent = String(state.rejected);
    $('mRej').className = 'v' + (state.rejected > 0 ? ' bad' : '');

    var v = $('verdict');
    var s = STRATEGIES[state.strategy];
    if (state.total === 0) return;
    if (state.rejected > 0 && state.strategy === 'hash' && state.bigTenant) {
      v.className = 'verdict bad';
      v.innerHTML = '🔥 <b>热点事故</b>：大租户被纯哈希恒定路由到分区 3，该分区已过载，累计拒绝 <b>' + state.rejected +
        '</b> 个请求——同节点的分区 2 也被拖累，而其他节点大量闲置。倾斜比 <b>' + skew.toFixed(1) +
        '×</b>。现在<b>不要清零</b>，直接切换上方策略为「随机前缀打散」或「VIP 专属分区」，继续注入，对比新请求的落点。';
    } else if (state.strategy === 'salt') {
      v.className = 'verdict';
      v.innerHTML = '🧂 <b>' + s.label + '</b>：大租户流量被拆到 3 个分区，单分区压力降为约 1/3，倾斜比降到 <b>' +
        skew.toFixed(1) + '×</b>。代价写在课文里：查"该租户全部订单"要并发查 3 个分区再合并（scatter-gather），写放大换读放大，值不值看读写比。';
    } else if (state.strategy === 'vip') {
      v.className = 'verdict';
      v.innerHTML = '👑 <b>' + s.label + '</b>：大租户独占分区 7（可再绑高配节点），普通租户共享 0-6 互不受影响，倾斜比 <b>' +
        skew.toFixed(1) + '×</b>。这是 RetailHub 课文采用的方案——它既是技术决策也是商业决策：大客户付了钱，买的就是"不被邻居拖累"。';
    } else {
      v.className = 'verdict';
      v.innerHTML = '当前策略：<b>' + s.label + '</b>。倾斜比 <b>' + skew.toFixed(1) + '×</b>。' +
        (state.bigTenant ? '继续注入，观察分区 3 逼近红色容量线。' : '关闭大租户后哈希相当均匀——热点问题本质是"流量的业务分布"与"哈希的数学均匀"错位。');
    }
  }

  $('strategy').addEventListener('change', function () {
    state.strategy = $('strategy').value;
    addStrategyHint();
    render();
  });
  function addStrategyHint() {
    var v = $('verdict');
    v.className = 'verdict';
    v.innerHTML = '<b>' + STRATEGIES[state.strategy].label + '</b>：' + STRATEGIES[state.strategy].desc + '。点「注入 100 请求」或「自动持续注入」观察效果。';
  }
  $('big').addEventListener('change', function () {
    state.bigTenant = $('big').checked;
    render();
  });
  $('share').addEventListener('input', function () {
    state.bigShare = parseInt($('share').value, 10);
    $('shareV').textContent = state.bigShare + '%';
  });
  $('once').addEventListener('click', function () { inject(100); });
  $('auto').addEventListener('click', function () {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
      $('auto').textContent = '自动持续注入';
    } else {
      state.timer = setInterval(function () { inject(40); }, 200);
      $('auto').textContent = '停止注入';
    }
  });
  $('reset').addEventListener('click', function () {
    resetLoads();
    var v = $('verdict');
    v.className = 'verdict';
    v.innerHTML = '已清零。建议顺序：纯哈希 + 大租户注入到分区 3 打红 → 不清零切「随机前缀」继续注入 → 再切「VIP 专属分区」对比三种曲线。';
    render();
  });

  render();
};
