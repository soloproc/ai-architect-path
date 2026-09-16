/* consistent-hash —— 一致性哈希模拟器（卷02 §5.3）
 * 契约：注册到 window.DEMOS['consistent-hash']，Shadow DOM，样式内联，无外部依赖。
 * SVG 圆环上摆放 12 个 key 与若干节点；两种算法可切换：普通取模 hash%N vs 一致性哈希（顺时针后继）。
 * 支持添加/移除节点、开关虚拟节点；每次拓扑或算法变更后统计 key 迁移比例，
 * 并用柱状图展示各节点负载分布；底部输出教学结论。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['consistent-hash'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var NODE_DEFS = {
    A: { angle: 15, color: '#0f766e' },
    B: { angle: 130, color: '#d97706' },
    C: { angle: 250, color: '#dc2626' },
    D: { angle: 55, color: '#57534e' }
  };
  var VNODE_OFFSETS = [0, 47, 113]; // 每个物理节点的虚拟节点角度偏移
  var KEY_COUNT = 12;

  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }
  var KEYS = [];
  for (var i = 1; i <= KEY_COUNT; i++) KEYS.push({ name: 'k' + i, angle: hash('key-' + i) % 360 });

  var state = {
    mode: 'ring',            // 'mod' 普通取模 | 'ring' 一致性哈希
    vnode: false,
    nodes: ['A', 'B', 'C'],  // 当前在线节点
    prevAssign: null,        // 上一次分配的 {keyName: nodeName}
    moved: null              // 最近一次变更的迁移 key 数
  };

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    '.row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 12px;' +
    'font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button.mode{background:#fff;color:#0f766e;}' +
    'button.mode.on{background:#0f766e;color:#fff;}' +
    'button.warn{background:#fff;color:#d97706;border-color:#d97706;}' +
    'button:hover{opacity:.88;}' +
    'button:disabled{opacity:.4;cursor:default;}' +
    '.chk{display:flex;align-items:center;gap:6px;font-size:12px;color:#57534e;}' +
    'input[type=checkbox]{accent-color:#0f766e;}' +
    '.body{display:flex;gap:14px;flex-wrap:wrap;}' +
    '.svgbox{flex:0 0 auto;}' +
    '.side{flex:1;min-width:220px;}' +
    '.metrics{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 10px;}' +
    '.metric{flex:1;min-width:100px;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;}' +
    '.metric .k{font-size:11px;color:#78716c;}' +
    '.metric .v{font-size:18px;font-weight:600;color:#0f766e;font-variant-numeric:tabular-nums;}' +
    '.metric .v.warn{color:#d97706;}' +
    '.metric .v.bad{color:#dc2626;}' +
    'h5{margin:8px 0 6px;font-size:12px;color:#57534e;font-weight:600;}' +
    '.bar-row{display:flex;align-items:center;gap:8px;margin:3px 0;font-size:11px;color:#57534e;}' +
    '.bar-row .nm{width:56px;flex:none;font-weight:600;}' +
    '.bar-track{flex:1;height:12px;background:#f5f5f4;border-radius:3px;overflow:hidden;}' +
    '.bar-fill{height:100%;}' +
    '.bar-n{width:28px;text-align:right;font-variant-numeric:tabular-nums;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;' +
    'border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 一致性哈希模拟器（卷02 §5.3：节点增减时，key 要搬几次家）</div>' +
    '  <div class="row">' +
    '    <button class="mode" data-m="mod">普通取模 hash % N</button>' +
    '    <button class="mode on" data-m="ring">一致性哈希</button>' +
    '    <span class="chk"><input type="checkbox" id="vnode"><label for="vnode">虚拟节点 ×3</label></span>' +
    '  </div>' +
    '  <div class="row">' +
    '    <button id="toggleD" class="ghost">添加节点 D</button>' +
    '    <button id="toggleC" class="warn">移除节点 C</button>' +
    '    <button id="reset" class="ghost">重置</button>' +
    '  </div>' +
    '  <div class="body">' +
    '    <div class="svgbox" id="svgbox"></div>' +
    '    <div class="side">' +
    '      <div class="metrics">' +
    '        <div class="metric"><div class="k">节点数</div><div class="v" id="mNodes">-</div></div>' +
    '        <div class="metric"><div class="k">本次变更迁移</div><div class="v" id="mMoved">-</div></div>' +
    '        <div class="metric"><div class="k">迁移比例</div><div class="v" id="mRatio">-</div></div>' +
    '      </div>' +
    '      <h5>各节点负载（key 数）</h5>' +
    '      <div id="bars"></div>' +
    '    </div>' +
    '  </div>' +
    '  <div class="verdict" id="verdict">切换算法、增删节点，观察迁移比例的变化。</div>' +
    '  <div class="note">教学简化：key 与节点位置由内置哈希函数映射到 0–359° 环上；一致性哈希下 key 归顺时针方向最近的（虚拟）节点；普通取模按 hash(key) % 节点数直接分配。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  function ringPoints() {
    var pts = [];
    state.nodes.forEach(function (n) {
      if (state.vnode) {
        VNODE_OFFSETS.forEach(function (off) {
          pts.push({ node: n, angle: (NODE_DEFS[n].angle + off) % 360, v: true });
        });
      } else {
        pts.push({ node: n, angle: NODE_DEFS[n].angle, v: false });
      }
    });
    pts.sort(function (a, b) { return a.angle - b.angle; });
    return pts;
  }

  function assign() {
    var a = {};
    if (state.mode === 'mod') {
      var sorted = state.nodes.slice().sort();
      KEYS.forEach(function (k) { a[k.name] = sorted[hash(k.name) % sorted.length]; });
    } else {
      var pts = ringPoints();
      KEYS.forEach(function (k) {
        var owner = pts[0];
        for (var i = 0; i < pts.length; i++) {
          if (pts[i].angle >= k.angle) { owner = pts[i]; break; }
        }
        a[k.name] = owner.node;
      });
    }
    return a;
  }

  function polar(angle, r) {
    var rad = (angle - 90) * Math.PI / 180;
    return { x: 160 + r * Math.cos(rad), y: 160 + r * Math.sin(rad) };
  }

  function render(changeLabel) {
    var a = assign();
    // 迁移统计
    var moved = null;
    if (state.prevAssign) {
      moved = 0;
      KEYS.forEach(function (k) { if (state.prevAssign[k.name] !== a[k.name]) moved++; });
    }
    state.prevAssign = a;

    // SVG
    var s = '';
    s += '<svg width="320" height="320" viewBox="0 0 320 320">';
    s += '<circle cx="160" cy="160" r="110" fill="#fafaf9" stroke="#e7e5e4" stroke-width="2"/>';
    var pts = ringPoints();
    pts.forEach(function (p) {
      var c = polar(p.angle, 110);
      s += '<circle cx="' + c.x.toFixed(1) + '" cy="' + c.y.toFixed(1) + '" r="' + (p.v ? 4 : 9) +
        '" fill="' + NODE_DEFS[p.node].color + '" stroke="#fff" stroke-width="1.5"/>';
      if (!p.v) {
        var t = polar(p.angle, 132);
        s += '<text x="' + t.x.toFixed(1) + '" y="' + t.y.toFixed(1) + '" font-size="12" font-weight="700" ' +
          'fill="' + NODE_DEFS[p.node].color + '" text-anchor="middle" dominant-baseline="middle">' + p.node + '</text>';
      }
    });
    KEYS.forEach(function (k) {
      var c = polar(k.angle, 88);
      s += '<circle cx="' + c.x.toFixed(1) + '" cy="' + c.y.toFixed(1) + '" r="5" fill="' +
        NODE_DEFS[a[k.name]].color + '" opacity="0.85"><title>' + k.name + ' → 节点 ' + a[k.name] + '</title></circle>';
    });
    s += '<text x="160" y="160" font-size="11" fill="#a8a29e" text-anchor="middle">' +
      (state.mode === 'mod' ? 'hash % N' : '哈希环') + '</text>';
    s += '</svg>';
    $('svgbox').innerHTML = s;

    // 指标
    $('mNodes').textContent = state.nodes.length + (state.vnode && state.mode === 'ring' ? '（×3 虚拟）' : '');
    if (moved === null) {
      $('mMoved').textContent = '—';
      $('mRatio').textContent = '—';
      $('mMoved').className = 'v';
      $('mRatio').className = 'v';
    } else {
      var ratio = moved / KEY_COUNT;
      $('mMoved').textContent = moved + ' / ' + KEY_COUNT;
      $('mRatio').textContent = Math.round(ratio * 100) + '%';
      var cls = ratio > 0.5 ? ' bad' : (ratio > 0.25 ? ' warn' : '');
      $('mMoved').className = 'v' + cls;
      $('mRatio').className = 'v' + cls;
    }

    // 负载柱图
    var counts = {};
    state.nodes.forEach(function (n) { counts[n] = 0; });
    KEYS.forEach(function (k) { counts[a[k.name]]++; });
    var bars = '';
    state.nodes.forEach(function (n) {
      bars += '<div class="bar-row"><span class="nm" style="color:' + NODE_DEFS[n].color + '">节点 ' + n + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="display:block;width:' +
        (counts[n] * 100 / KEY_COUNT) + '%;background:' + NODE_DEFS[n].color + '"></span></span>' +
        '<span class="bar-n">' + counts[n] + '</span></div>';
    });
    $('bars').innerHTML = bars;

    // 结论
    var v = $('verdict');
    if (moved === null) {
      v.innerHTML = '当前为初始分配（' + (state.mode === 'mod' ? '普通取模' : '一致性哈希') +
        '）。现在点「添加节点 D」或「移除节点 C」，观察有多少 key 被迫搬家。';
    } else {
      var theory = state.mode === 'mod'
        ? '理论上取模后几乎所有 key 的余数都变了——缓存集群里这意味着集体失效、集体回源。'
        : '理论上只有环上"相邻一段"的 key 受影响，期望迁移 ≈ 1/' + state.nodes.length +
          '（约 ' + Math.round(100 / state.nodes.length) + '%）。';
      v.innerHTML = '<b>' + (changeLabel || '本次变更') + '</b>：迁移 <b>' + moved + '/' + KEY_COUNT +
        '</b>（' + Math.round(moved * 100 / KEY_COUNT) + '%）。' + theory +
        (state.mode === 'ring'
          ? '<br><br><b>你观察到了什么：</b>一致性哈希解决的是<b>迁移量</b>；再看负载柱图——节点越少分布越容易不均，' +
            '打开「虚拟节点 ×3」让每个物理节点在环上占多个点，负载会明显摊平。虚拟节点解决的是<b>分布不均</b>，两者别混。'
          : '<br><br><b>你观察到了什么：</b>切到「一致性哈希」重复同样的增删操作，对比迁移比例。');
    }

    $('toggleD').textContent = state.nodes.indexOf('D') >= 0 ? '移除节点 D' : '添加节点 D';
    $('toggleC').textContent = state.nodes.indexOf('C') >= 0 ? '移除节点 C' : '恢复节点 C';
    $('toggleC').disabled = state.nodes.length <= 2 && state.nodes.indexOf('C') >= 0;
  }

  var modeBtns = shadow.querySelectorAll('button.mode');
  modeBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      modeBtns.forEach(function (x) { x.className = 'mode'; });
      b.className = 'mode on';
      state.mode = b.getAttribute('data-m');
      render(state.mode === 'mod' ? '切换到普通取模' : '切换到一致性哈希');
    });
  });
  $('vnode').addEventListener('change', function () {
    state.vnode = $('vnode').checked;
    render(state.vnode ? '开启虚拟节点' : '关闭虚拟节点');
  });
  $('toggleD').addEventListener('click', function () {
    var i = state.nodes.indexOf('D');
    if (i >= 0) { state.nodes.splice(i, 1); render('移除节点 D'); }
    else { state.nodes.push('D'); render('添加节点 D'); }
  });
  $('toggleC').addEventListener('click', function () {
    var i = state.nodes.indexOf('C');
    if (i >= 0) { state.nodes.splice(i, 1); render('移除节点 C'); }
    else { state.nodes.push('C'); render('恢复节点 C'); }
  });
  $('reset').addEventListener('click', function () {
    state.mode = 'ring'; state.vnode = false;
    state.nodes = ['A', 'B', 'C']; state.prevAssign = null;
    $('vnode').checked = false;
    modeBtns.forEach(function (x) {
      x.className = x.getAttribute('data-m') === 'ring' ? 'mode on' : 'mode';
    });
    render();
  });

  render();
};
