/* isolation-oversell · 隔离级别超卖模拟器（纯前端，无外部依赖） */
window.DEMOS = window.DEMOS || {};
window.DEMOS['isolation-oversell'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });
  shadow.innerHTML = [
    '<style>',
    ':host{display:block}',
    '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;font-family:inherit;color:#292524;font-size:13px;line-height:1.5}',
    '.cap{font-size:12px;color:#78716c;letter-spacing:.03em;margin-bottom:10px}',
    '.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}',
    'button{font-family:inherit;font-size:12px;padding:6px 14px;border-radius:6px;border:1px solid #0f766e;background:#0f766e;color:#fff;cursor:pointer;transition:opacity .15s}',
    'button.ghost{background:#fff;color:#0f766e}',
    'button.mode.on{background:#0f766e;color:#fff}',
    'button.mode{background:#fff;color:#0f766e}',
    'button:hover{opacity:.85}button:disabled{opacity:.4;cursor:default}',
    '.panel{display:flex;gap:12px;flex-wrap:wrap;align-items:stretch}',
    '.stock{border:1px solid #eee7d8;border-radius:6px;padding:10px 16px;text-align:center;min-width:120px}',
    '.stock .v{font-size:30px;font-weight:700;color:#0f766e}',
    '.stock .v.neg{color:#b91c1c}',
    '.stock .l{font-size:11px;color:#78716c}',
    '.lanes{flex:1;min-width:260px;display:flex;flex-direction:column;gap:8px}',
    '.lane{border:1px solid #eee7d8;border-radius:6px;padding:8px;min-height:52px}',
    '.lane .who{font-size:11px;font-weight:600;color:#0f766e;margin-bottom:4px}',
    '.chip{display:inline-block;border:1px solid #d6d3d1;border-radius:4px;background:#fafaf9;padding:2px 7px;margin:2px;font-size:11px}',
    '.chip.cur{border-color:#0f766e;background:#f0fdfa}',
    '.chip.bad{border-color:#b91c1c;background:#fef2f2;color:#b91c1c}',
    '.chip.wait{border-style:dashed;color:#78716c}',
    '.banner{margin-top:10px;border-radius:6px;padding:8px 12px;font-size:12px;font-weight:600;display:none}',
    '.banner.bad{display:block;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}',
    '.banner.good{display:block;background:#f0fdfa;color:#0f766e;border:1px solid #99f6e4}',
    '.hint{font-size:11px;color:#a8a29e;margin-top:8px}',
    '</style>',
    '<div class="wrap">',
    '  <div class="cap">模拟器 · 隔离级别与超卖：库存 = 1，两个并发事务同时下单</div>',
    '  <div class="bar">',
    '    <button class="mode on" id="mNaive">Read Committed · 先读后写</button>',
    '    <button class="mode" id="mAtomic">原子 UPDATE · 串行化效果</button>',
    '    <button id="step">单步执行</button>',
    '    <button id="play" class="ghost">自动播放</button>',
    '    <button id="reset" class="ghost">重置</button>',
    '  </div>',
    '  <div class="panel">',
    '    <div class="stock"><div class="v" id="stock">1</div><div class="l">库存 stock</div><div class="l" id="sold">成功下单 0 件</div></div>',
    '    <div class="lanes">',
    '      <div class="lane"><div class="who">事务 A（买家甲）</div><div id="lane1"></div></div>',
    '      <div class="lane"><div class="who">事务 B（买家乙）</div><div id="lane2"></div></div>',
    '    </div>',
    '  </div>',
    '  <div class="banner" id="banner"></div>',
    '  <div class="hint" id="hint">点"单步执行"逐步推进两个事务的交错执行。</div>',
    '</div>'
  ].join('\n');

  var $ = function (id) { return shadow.getElementById(id); };
  var mode, idx, stock, sold, steps, playTimer;

  // 每步：{ lane:1|2, text, cls, run }
  function buildSteps(m) {
    if (m === 'naive') {
      var t1read = null, t2read = null;
      return [
        { lane: 1, text: 'BEGIN 开始事务', run: function () {} },
        { lane: 1, text: 'SELECT stock → 读到 1', run: function () { t1read = stock; } },
        { lane: 2, text: 'BEGIN 开始事务', run: function () {} },
        { lane: 2, text: 'SELECT stock → 读到 1（A 未提交，读到同样的值）', run: function () { t2read = stock; } },
        { lane: 1, text: '判断 ' + 1 + ' ≥ 1 ✓ 允许下单', run: function () {} },
        { lane: 2, text: '判断 ' + 1 + ' ≥ 1 ✓ 允许下单', run: function () {} },
        { lane: 1, text: 'UPDATE stock = stock - 1 → 0，下单成功', run: function () { stock--; sold++; } },
        { lane: 2, text: 'UPDATE stock = stock - 1 → -1，下单也成功 ⚠ 超卖！', cls: 'bad', run: function () { stock--; sold++; } },
        { lane: 0, text: '', run: function () {
          banner('bad', '超卖发生：库存 = ' + stock + '，卖出 ' + sold + ' 件但实际只有 1 件库存。两个事务基于同一个"读到的旧值"各自写回——这就是丢失更新，Read Committed 防不住它。');
        } }
      ];
    }
    return [
      { lane: 1, text: 'BEGIN 开始事务', run: function () {} },
      { lane: 1, text: 'UPDATE ... WHERE stock >= 1 → 影响 1 行（获得行锁），stock = 0', run: function () { stock--; } },
      { lane: 2, text: 'BEGIN 开始事务', run: function () {} },
      { lane: 2, text: 'UPDATE ... WHERE stock >= 1 → 阻塞：等待 A 的行锁 …', cls: 'wait', run: function () {} },
      { lane: 1, text: 'COMMIT，下单成功', run: function () { sold++; } },
      { lane: 2, text: '锁释放后重新检查：stock = 0 不满足 stock >= 1 → 影响 0 行，安全失败', run: function () {} },
      { lane: 0, text: '', run: function () {
        banner('good', '互斥正确：库存 = ' + stock + '，恰好卖出 ' + sold + ' 件。原子 UPDATE 让数据库单行锁把两个写串行化——防超卖靠的是原子操作，与默认隔离级别无关。');
      } }
    ];
  }

  function banner(kind, msg) {
    var b = $('banner');
    b.className = 'banner ' + kind;
    b.textContent = msg;
  }

  function render() {
    var v = $('stock');
    v.textContent = stock;
    v.className = 'v' + (stock < 0 ? ' neg' : '');
    $('sold').textContent = '成功下单 ' + sold + ' 件';
  }

  function doStep() {
    if (idx >= steps.length) return;
    var s = steps[idx];
    if (s.lane > 0) {
      var laneEl = $(s.lane === 1 ? 'lane1' : 'lane2');
      var chip = document.createElement('span');
      chip.className = 'chip cur' + (s.cls ? ' ' + s.cls : '');
      chip.textContent = s.text;
      laneEl.appendChild(chip);
      setTimeout(function () { chip.classList.remove('cur'); }, 1200);
    }
    s.run();
    idx++;
    render();
    if (idx >= steps.length) stopPlay();
  }

  function stopPlay() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; $('play').textContent = '自动播放'; }
  }

  function init(m) {
    stopPlay();
    mode = m;
    idx = 0; stock = 1; sold = 0;
    steps = buildSteps(m);
    $('lane1').innerHTML = '';
    $('lane2').innerHTML = '';
    $('banner').className = 'banner';
    $('banner').textContent = '';
    $('mNaive').className = 'mode' + (m === 'naive' ? ' on' : '');
    $('mAtomic').className = 'mode' + (m === 'atomic' ? ' on' : '');
    $('hint').textContent = m === 'naive'
      ? '危险写法：先 SELECT 判断、再 UPDATE 写回。单步看两个事务如何都读到 1。'
      : '正确写法：UPDATE ... WHERE stock >= 1，让影响行数告诉你成败。';
    render();
  }

  $('mNaive').addEventListener('click', function () { init('naive'); });
  $('mAtomic').addEventListener('click', function () { init('atomic'); });
  $('step').addEventListener('click', doStep);
  $('play').addEventListener('click', function () {
    if (playTimer) { stopPlay(); return; }
    if (idx >= steps.length) init(mode);
    $('play').textContent = '暂停';
    playTimer = setInterval(doStep, 900);
  });
  $('reset').addEventListener('click', function () { init(mode); });

  init('naive');
};
