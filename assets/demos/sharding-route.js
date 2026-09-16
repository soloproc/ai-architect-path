/* sharding-route —— 分库分表路由模拟器（卷02 §3.3）
 * 契约：注册到 window.DEMOS['sharding-route']，Shadow DOM，样式内联，无外部依赖。
 * 24+ 笔订单（订单号/租户/月份三属性）按三种分片策略路由到 4 个分片：
 * 按订单号取模、按租户取模、按日期范围。
 * 可执行两类查询（查单个订单 / 查某租户全部订单）观察命中单分片还是广播；
 * 可插入一批新月份订单观察范围分片的写入热点；底部输出教学结论。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['sharding-route'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var SHARDS = ['db0', 'db1', 'db2', 'db3'];
  var SHARD_COLORS = ['#0f766e', '#d97706', '#57534e', '#dc2626'];

  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }

  // 初始订单：T1 是大租户（12 笔），T2/T3 各 6 笔；月份在 06/07/08 轮转
  function initialOrders() {
    var orders = [];
    for (var i = 1; i <= 24; i++) {
      orders.push({
        id: i,
        tenant: i <= 12 ? 'T1' : (i <= 18 ? 'T2' : 'T3'),
        month: ['2025-06', '2025-07', '2025-08'][i % 3]
      });
    }
    return orders;
  }

  var state = {
    strategy: 'id',          // id | tenant | range
    orders: initialOrders(),
    hits: null,              // 最近一次查询命中的分片名数组
    queryDesc: '',
    nextId: 25
  };

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    'h5{margin:10px 0 6px;font-size:12px;color:#57534e;font-weight:600;}' +
    '.row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;align-items:center;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 12px;' +
    'font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button.mode{background:#fff;color:#0f766e;}' +
    'button.mode.on{background:#0f766e;color:#fff;}' +
    'button.warn{background:#fff;color:#d97706;border-color:#d97706;}' +
    'button:hover{opacity:.88;}' +
    '.shards{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0;}' +
    '.shard{flex:1;min-width:120px;background:#fafaf9;border:2px solid #e7e5e4;border-radius:6px;padding:8px 10px;' +
    'transition:border-color .2s;}' +
    '.shard.hit{border-color:#0f766e;background:#f0fdfa;}' +
    '.shard .nm{font-size:12px;font-weight:700;color:#1c1917;}' +
    '.shard .cnt{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;margin:2px 0;}' +
    '.bar{height:8px;border-radius:4px;background:#f5f5f4;overflow:hidden;margin:4px 0;}' +
    '.bar>div{height:100%;}' +
    '.shard .sub{font-size:10px;color:#a8a29e;}' +
    '.metrics{display:flex;gap:10px;flex-wrap:wrap;margin:8px 0;}' +
    '.metric{flex:1;min-width:130px;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;}' +
    '.metric .k{font-size:11px;color:#78716c;}' +
    '.metric .v{font-size:16px;font-weight:600;color:#0f766e;}' +
    '.metric .v.warn{color:#d97706;}' +
    '.metric .v.bad{color:#dc2626;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;' +
    'border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 分库分表路由模拟器（卷02 §3.3：分片键决定查询的命运）</div>' +
    '  <h5>① 选择分片策略</h5>' +
    '  <div class="row">' +
    '    <button class="mode on" data-m="id">按订单号取模</button>' +
    '    <button class="mode" data-m="tenant">按租户取模</button>' +
    '    <button class="mode" data-m="range">按日期范围</button>' +
    '  </div>' +
    '  <h5>② 执行查询 / 写入</h5>' +
    '  <div class="row">' +
    '    <button id="qPoint" class="ghost">查询：订单 #13</button>' +
    '    <button id="qTenant" class="ghost">查询：租户 T1 全部订单</button>' +
    '    <button id="insert" class="warn">插入 8 笔新订单（2025-09）</button>' +
    '    <button id="reset" class="ghost">重置</button>' +
    '  </div>' +
    '  <div class="metrics">' +
    '    <div class="metric"><div class="k">订单总数</div><div class="v" id="mTotal">-</div></div>' +
    '    <div class="metric"><div class="k">最近查询</div><div class="v" id="mQuery">-</div></div>' +
    '    <div class="metric"><div class="k">命中分片数</div><div class="v" id="mHits">-</div></div>' +
    '  </div>' +
    '  <div class="shards" id="shards"></div>' +
    '  <div class="verdict" id="verdict">先选策略，再执行查询，观察命中几个分片。</div>' +
    '  <div class="note">教学简化：共 4 个分片；T1 是大租户（订单量是 T2/T3 的两倍）；日期范围策略按月份顺序映射到分片，新月份去新分片。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  function route(o) {
    if (state.strategy === 'id') return 'db' + (o.id % 4);
    if (state.strategy === 'tenant') return 'db' + (hash(o.tenant) % 4);
    // range：按月份顺序映射，未知新月份顺延到下一个分片
    var months = ['2025-06', '2025-07', '2025-08', '2025-09'];
    return 'db' + Math.min(months.indexOf(o.month), 3);
  }

  function counts() {
    var c = { db0: 0, db1: 0, db2: 0, db3: 0 };
    state.orders.forEach(function (o) { c[route(o)]++; });
    return c;
  }

  var STRATEGY_TEXT = {
    id: '按订单号取模：数据最均匀，按 ID 查单条命中 1 个分片；但任何"不按 ID"的查询（如查某租户）都要广播到全部 4 个分片再汇总。',
    tenant: '按租户取模：同一租户的数据集中在一起，租户维度查询只命中 1 个分片；但大租户 T1 让所在分片数据量翻倍（数据倾斜/热点），且按订单号查单条反而要广播。',
    range: '按日期范围：时间段查询只命中 1 个分片、归档旧数据最方便；但新数据全部写向最新分片——写入热点，且老分片越来越闲。'
  };

  function render() {
    var c = counts();
    var max = 1;
    SHARDS.forEach(function (s) { if (c[s] > max) max = c[s]; });

    var html = '';
    SHARDS.forEach(function (s, i) {
      var hit = state.hits && state.hits.indexOf(s) >= 0;
      html += '<div class="shard' + (hit ? ' hit' : '') + '">' +
        '<div class="nm">' + s + (hit ? ' ✓ 命中' : '') + '</div>' +
        '<div class="cnt" style="color:' + SHARD_COLORS[i] + '">' + c[s] + '</div>' +
        '<div class="bar"><div style="width:' + (c[s] * 100 / max) + '%;background:' + SHARD_COLORS[i] + '"></div></div>' +
        '<div class="sub">' + Math.round(c[s] * 100 / state.orders.length) + '% 的数据</div></div>';
    });
    $('shards').innerHTML = html;

    $('mTotal').textContent = state.orders.length;
    $('mQuery').textContent = state.queryDesc || '—';
    if (state.hits) {
      var bcast = state.hits.length > 1;
      $('mHits').textContent = state.hits.length + ' 个' + (bcast ? '（广播）' : '（单点）');
      $('mHits').className = 'v' + (bcast ? ' bad' : '');
    } else {
      $('mHits').textContent = '—';
      $('mHits').className = 'v';
    }

    // 倾斜度提示
    var skew = c.db0 === 0 || c.db1 === 0 || c.db2 === 0 || c.db3 === 0 || max >= state.orders.length * 0.45;
    var v = $('verdict');
    v.innerHTML = '<b>当前策略</b>：' + STRATEGY_TEXT[state.strategy] +
      (skew ? '<br>⚠️ 注意柱图：<b>分片间数据量明显不均</b>——这就是"数据倾斜"，热点分片会先成为瓶颈。' : '') +
      '<br><br><b>你观察到了什么：</b>没有"最好的分片键"，只有"最匹配查询模式的分片键"。' +
      '选键三问：① 最高频的查询按什么条件过滤？② 写入会随时间集中在一头吗？③ 有没有一个"超级大租户"？' +
      '三个答案合起来，才构成你的分片决策。';
  }

  function pointQuery() {
    var o = null;
    state.orders.forEach(function (x) { if (x.id === 13) o = x; });
    if (!o) { state.hits = null; state.queryDesc = '订单 #13 已被重置'; render(); return; }
    if (state.strategy === 'id') {
      state.hits = [route(o)];
      state.queryDesc = '订单 #13（按 ID 直接路由）';
    } else {
      // 路由器手里只有订单号，无法推出租户/月份 → 广播
      state.hits = SHARDS.slice();
      state.queryDesc = '订单 #13（路由键不是 ID，只能广播）';
    }
    render();
  }

  function tenantQuery() {
    if (state.strategy === 'tenant') {
      state.hits = ['db' + (hash('T1') % 4)];
      state.queryDesc = '租户 T1 全部订单（按租户路由）';
    } else {
      state.hits = SHARDS.slice();
      state.queryDesc = '租户 T1 全部订单（T1 散布在所有分片）';
    }
    render();
  }

  function insertNew() {
    for (var i = 0; i < 8; i++) {
      state.orders.push({
        id: state.nextId++,
        tenant: i < 4 ? 'T2' : 'T3',
        month: '2025-09'
      });
    }
    state.hits = null;
    state.queryDesc = '写入 8 笔 2025-09 新订单';
    if (state.strategy === 'range') {
      state.hits = ['db3'];
    }
    render();
  }

  var modeBtns = shadow.querySelectorAll('button.mode');
  modeBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      modeBtns.forEach(function (x) { x.className = 'mode'; });
      b.className = 'mode on';
      state.strategy = b.getAttribute('data-m');
      state.hits = null;
      state.queryDesc = '';
      render();
    });
  });
  $('qPoint').addEventListener('click', pointQuery);
  $('qTenant').addEventListener('click', tenantQuery);
  $('insert').addEventListener('click', insertNew);
  $('reset').addEventListener('click', function () {
    state.orders = initialOrders();
    state.hits = null;
    state.queryDesc = '';
    state.nextId = 25;
    render();
  });

  render();
};
