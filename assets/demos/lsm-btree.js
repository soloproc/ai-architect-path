/* lsm-btree · LSM-Tree vs B-Tree 写入路径对比模拟器（纯前端，无外部依赖） */
window.DEMOS = window.DEMOS || {};
window.DEMOS['lsm-btree'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });
  shadow.innerHTML = [
    '<style>',
    ':host{display:block}',
    '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;font-family:inherit;color:#292524;font-size:13px;line-height:1.5}',
    '.cap{font-size:12px;color:#78716c;letter-spacing:.03em;margin-bottom:10px}',
    '.bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}',
    'button{font-family:inherit;font-size:12px;padding:6px 14px;border-radius:6px;border:1px solid #0f766e;background:#0f766e;color:#fff;cursor:pointer;transition:opacity .15s}',
    'button.ghost{background:#fff;color:#0f766e}',
    'button:hover{opacity:.85}button:disabled{opacity:.4;cursor:default}',
    '.cols{display:flex;gap:12px;flex-wrap:wrap}',
    '.col{flex:1;min-width:240px;border:1px solid #eee7d8;border-radius:6px;padding:10px}',
    '.col h4{margin:0 0 6px;font-size:12px;color:#0f766e;font-weight:600}',
    '.io{font-size:12px;margin-bottom:8px}.io b{font-size:18px;margin-left:2px}',
    '.bt .io b{color:#b91c1c}.lsm .io b{color:#0f766e}',
    '.tree{display:flex;flex-direction:column;gap:6px;align-items:center}',
    '.node{border:1px solid #d6d3d1;border-radius:4px;padding:3px 8px;font-size:11px;background:#fafaf9;transition:all .25s}',
    '.node.hit{border-color:#0f766e;background:#f0fdfa}',
    '.node.hot{border-color:#b91c1c;background:#fef2f2;color:#b91c1c}',
    '.leaves{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}',
    '.lbl{font-size:11px;color:#78716c;margin:6px 0 2px}',
    '.mem{border:1px dashed #0f766e;border-radius:4px;padding:5px;min-height:26px}',
    '.k{display:inline-block;background:#f0fdfa;border:1px solid #99f6e4;border-radius:3px;padding:1px 5px;margin:2px;font-size:10px}',
    '.ssts{display:flex;gap:6px;flex-wrap:wrap;margin-top:2px}',
    '.sst{border:1px solid #a8a29e;border-radius:4px;padding:3px 8px;font-size:11px;background:#fafaf9;transition:all .25s}',
    '.sst.merge{border-color:#b91c1c;background:#fef2f2}',
    '.status{margin-top:10px;font-size:12px;color:#57534e;min-height:18px}',
    '.final{margin-top:8px;font-size:12px;font-weight:600;color:#0f766e;display:none}',
    '</style>',
    '<div class="wrap">',
    '  <div class="cap">模拟器 · LSM-Tree vs B-Tree 写入路径（每次点击 = 写入 1 条记录）</div>',
    '  <div class="bar">',
    '    <button id="w">写入一条数据</button>',
    '    <button id="auto" class="ghost">自动写入 20 条</button>',
    '    <button id="reset" class="ghost">重置</button>',
    '  </div>',
    '  <div class="cols">',
    '    <div class="col bt">',
    '      <h4>B-Tree（InnoDB）：定位页 → 原地更新</h4>',
    '      <div class="io">随机 IO 次数：<b id="bio">0</b></div>',
    '      <div class="tree"><div class="node" id="root">根页</div><div class="leaves" id="leaves"></div></div>',
    '    </div>',
    '    <div class="col lsm">',
    '      <h4>LSM-Tree（RocksDB）：WAL → MemTable → SSTable</h4>',
    '      <div class="io">顺序 IO 次数：<b id="lio">0</b></div>',
    '      <div class="lbl">WAL 追加日志：<span id="wal" style="color:#0f766e"></span></div>',
    '      <div class="lbl">MemTable（内存，满 4 条 Flush）</div>',
    '      <div class="mem" id="mem"></div>',
    '      <div class="lbl">磁盘 SSTable（不可变段，≥3 个触发 Compaction）</div>',
    '      <div class="ssts" id="ssts"></div>',
    '    </div>',
    '  </div>',
    '  <div class="status" id="status">准备就绪。连点 20 次，观察两侧 IO 计数器的差距。</div>',
    '  <div class="final" id="final"></div>',
    '</div>'
  ].join('\n');

  var $ = function (id) { return shadow.getElementById(id); };
  var MEM_CAP = 4, COMPACT_AT = 3;
  var bio, lio, mem, ssts, leafCounts, counter, autoTimer;

  function init() {
    bio = 0; lio = 0; mem = []; ssts = []; leafCounts = [0, 0, 0, 0]; counter = 0;
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    $('auto').disabled = false; $('w').disabled = false;
    $('final').style.display = 'none';
    $('status').textContent = '准备就绪。连点 20 次，观察两侧 IO 计数器的差距。';
    render();
  }

  function render() {
    $('bio').textContent = bio;
    $('lio').textContent = lio;
    var leaves = $('leaves');
    leaves.innerHTML = '';
    leafCounts.forEach(function (n, i) {
      var d = document.createElement('div');
      d.className = 'node'; d.id = 'leaf' + i;
      d.textContent = '页 ' + i + '（' + n + ' 条）';
      leaves.appendChild(d);
    });
    $('wal').textContent = counter > 0 ? ('… ' + Math.max(1, counter - 2) + ' 条已追加，最新 k#' + counter) : '（空）';
    var memEl = $('mem');
    memEl.innerHTML = mem.length ? '' : '<span style="color:#a8a29e;font-size:11px">（空）</span>';
    mem.forEach(function (k) {
      var s = document.createElement('span');
      s.className = 'k'; s.textContent = 'k#' + k;
      memEl.appendChild(s);
    });
    var sstEl = $('ssts');
    sstEl.innerHTML = ssts.length ? '' : '<span style="color:#a8a29e;font-size:11px">（尚无段）</span>';
    ssts.forEach(function (t, i) {
      var d = document.createElement('div');
      d.className = 'sst' + (t.merge ? ' merge' : '');
      d.textContent = 'SSTable ' + (i + 1) + '（' + t.n + ' 条）';
      sstEl.appendChild(d);
    });
  }

  function flash(el, cls, ms) {
    if (!el) return;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms || 500);
  }

  function writeOne() {
    counter++;
    var notes = [];
    // B-Tree：定位（2 次读）+ 原地写回（1 次随机写）
    var leaf = Math.floor(Math.random() * 4);
    bio += 3;
    leafCounts[leaf]++;
    flash($('root'), 'hit', 500);
    setTimeout(function () {
      render();
      flash($('leaf' + leaf), 'hot', 700);
    }, 200);
    notes.push('B-Tree：根页定位 → 页 ' + leaf + ' 原地更新（+3 随机 IO）');
    // LSM：WAL 追加（1 次顺序写）
    lio += 1;
    mem.push(counter);
    notes.push('LSM：WAL 追加 + MemTable 写入（+1 顺序 IO）');
    if (mem.length >= MEM_CAP) {
      mem = [];
      lio += 1;
      ssts.push({ n: MEM_CAP });
      notes.push('MemTable 满 → Flush 成 SSTable（+1 顺序 IO）');
      if (ssts.length >= COMPACT_AT) {
        var total = 0;
        ssts.forEach(function (t) { total += t.n; t.merge = true; });
        var merged = ssts.length;
        lio += merged + 1; // 读出全部段 + 写入新段
        notes.push('Compaction：合并 ' + merged + ' 个段（+' + (merged + 1) + ' 顺序 IO）');
        setTimeout(function () { ssts = [{ n: total }]; render(); }, 900);
      }
    }
    render();
    $('status').textContent = '写入 k#' + counter + ' —— ' + notes.join('；');
    if (counter >= 20) showFinal();
  }

  function showFinal() {
    var f = $('final');
    f.style.display = 'block';
    f.textContent = '已写入 ' + counter + ' 条：B-Tree 共 ' + bio + ' 次随机 IO，LSM 共 ' + lio +
      ' 次顺序 IO。LSM 把随机写变成顺序写，代价是后台 Compaction 与读时查多层（布隆过滤器兜底）。';
  }

  $('w').addEventListener('click', writeOne);
  $('auto').addEventListener('click', function () {
    if (autoTimer) return;
    $('auto').disabled = true;
    var n = 0;
    autoTimer = setInterval(function () {
      writeOne();
      if (++n >= 20) { clearInterval(autoTimer); autoTimer = null; $('auto').disabled = false; }
    }, 350);
  });
  $('reset').addEventListener('click', init);

  init();
};
