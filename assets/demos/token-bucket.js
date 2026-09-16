/* token-bucket · 令牌桶限流模拟器（纯前端，无外部依赖） */
window.DEMOS = window.DEMOS || {};
window.DEMOS['token-bucket'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });
  shadow.innerHTML = [
    '<style>',
    ':host{display:block}',
    '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;font-family:inherit;color:#292524;font-size:13px;line-height:1.5}',
    '.cap{font-size:12px;color:#78716c;letter-spacing:.03em;margin-bottom:10px}',
    '.bar{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:12px}',
    'button{font-family:inherit;font-size:12px;padding:6px 14px;border-radius:6px;border:1px solid #0f766e;background:#0f766e;color:#fff;cursor:pointer;transition:opacity .15s}',
    'button.ghost{background:#fff;color:#0f766e}',
    'button:hover{opacity:.85}button:disabled{opacity:.4;cursor:default}',
    'label{font-size:12px;color:#57534e;display:flex;align-items:center;gap:6px}',
    'input[type=range]{accent-color:#0f766e;width:120px}',
    '.lanes{display:flex;gap:12px;flex-wrap:wrap}',
    '.lane{flex:1;min-width:240px;border:1px solid #eee7d8;border-radius:6px;padding:10px}',
    '.lane h4{margin:0 0 8px;font-size:12px;color:#0f766e;font-weight:600}',
    '.lane.no h4{color:#b91c1c}',
    '.bucket{display:flex;align-items:flex-end;gap:12px;margin-bottom:8px}',
    '.tube{width:44px;height:110px;border:2px solid #0f766e;border-radius:0 0 8px 8px;position:relative;background:#fafaf9;overflow:hidden}',
    '.fill{position:absolute;bottom:0;left:0;right:0;background:#99f6e4;transition:height .15s}',
    '.tk{font-size:11px;color:#57534e;line-height:1.7}',
    '.tk b{color:#0f766e;font-size:15px}',
    '.meterWrap{margin:6px 0}',
    '.meterLbl{font-size:11px;color:#78716c;display:flex;justify-content:space-between}',
    '.meter{height:14px;border:1px solid #d6d3d1;border-radius:4px;background:#fafaf9;position:relative;overflow:hidden}',
    '.mfill{position:absolute;top:0;bottom:0;left:0;background:#5eead4;transition:width .15s}',
    '.mfill.over{background:#fca5a5}',
    '.safe{position:absolute;top:-2px;bottom:-2px;width:2px;background:#b91c1c}',
    '.nums{display:flex;gap:10px;font-size:11px;color:#57534e;margin-top:6px;flex-wrap:wrap}',
    '.nums b{font-size:14px}',
    '.g b{color:#0f766e}.r b{color:#b91c1c}',
    '.status{margin-top:10px;font-size:12px;color:#57534e;min-height:18px}',
    '</style>',
    '<div class="wrap">',
    '  <div class="cap">模拟器 · 令牌桶限流：速率决定稳态吞吐，容量决定突发容忍（系统安全水位 = 10）</div>',
    '  <div class="bar">',
    '    <label>令牌生成速率 <input type="range" id="rate" min="1" max="20" value="5"><b id="rateV">5</b>/秒</label>',
    '    <label>桶容量 <input type="range" id="cap" min="5" max="50" value="10" step="5"><b id="capV">10</b></label>',
    '    <button id="one">发送 1 个请求</button>',
    '    <button id="burst" class="ghost">突发流量 ×30</button>',
    '    <button id="reset" class="ghost">重置</button>',
    '  </div>',
    '  <div class="lanes">',
    '    <div class="lane">',
    '      <h4>车道 A：令牌桶保护</h4>',
    '      <div class="bucket">',
    '        <div class="tube"><div class="fill" id="fill"></div></div>',
    '        <div class="tk">桶内令牌：<b id="tkv">10.0</b><br>通过：<b id="ok">0</b><br>被拒绝（429）：<b id="rej" style="color:#b45309">0</b></div>',
    '      </div>',
    '      <div class="meterWrap">',
    '        <div class="meterLbl"><span>系统水位</span><span>红线 = 安全上限 10</span></div>',
    '        <div class="meter"><div class="mfill" id="mA"></div><div class="safe" style="left:33.3%"></div></div>',
    '      </div>',
    '    </div>',
    '    <div class="lane no">',
    '      <h4>车道 B：无限制（对照组）</h4>',
    '      <div class="tk" style="margin-bottom:8px">同样的流量直接打进来<br>涌入请求：<b id="inB" style="color:#b91c1c">0</b></div>',
    '      <div class="meterWrap">',
    '        <div class="meterLbl"><span>系统水位</span><span>红线 = 安全上限 10</span></div>',
    '        <div class="meter"><div class="mfill" id="mB"></div><div class="safe" style="left:33.3%"></div></div>',
    '      </div>',
    '      <div class="nums"><span class="r">过载时长：<b id="overT">0.0</b> s</span></div>',
    '    </div>',
    '  </div>',
    '  <div class="status" id="status">就绪。点"突发流量 ×30"，对比两条车道的系统水位。</div>',
    '</div>'
  ].join('\n');

  var $ = function (id) { return shadow.getElementById(id); };
  var SAFE = 10, MAXW = 30, TICK = 100;
  var tokens, ok, rej, inB, loadA, loadB, overT;

  function rate() { return parseInt($('rate').value, 10); }
  function cap() { return parseInt($('cap').value, 10); }

  function render() {
    $('tkv').textContent = tokens.toFixed(1);
    $('ok').textContent = ok;
    $('rej').textContent = rej;
    $('inB').textContent = inB;
    $('fill').style.height = Math.min(100, tokens / cap() * 100) + '%';
    var wA = Math.min(100, loadA / MAXW * 100);
    var wB = Math.min(100, loadB / MAXW * 100);
    $('mA').style.width = wA + '%';
    $('mB').style.width = wB + '%';
    $('mA').className = 'mfill' + (loadA > SAFE ? ' over' : '');
    $('mB').className = 'mfill' + (loadB > SAFE ? ' over' : '');
    $('overT').textContent = overT.toFixed(1);
  }

  // 系统消化能力：每 tick（100ms）处理 1 个请求 → 10/秒 = 安全水位
  setInterval(function () {
    tokens = Math.min(cap(), tokens + rate() * TICK / 1000);
    if (loadA > 0) loadA--;
    if (loadB > 0) loadB--;
    if (loadB > SAFE) overT += TICK / 1000;
    render();
  }, TICK);

  function admit() {
    if (tokens >= 1) { tokens -= 1; ok++; loadA++; return true; }
    rej++;
    return false;
  }

  $('one').addEventListener('click', function () {
    var passed = admit();
    $('status').textContent = passed
      ? '请求取到令牌 → 放行。'
      : '桶已空 → 拒绝（返回 429 Too Many Requests）。等令牌补一点再来。';
    render();
  });

  $('burst').addEventListener('click', function () {
    var passed = 0;
    for (var i = 0; i < 30; i++) { if (admit()) passed++; }
    inB += 30; loadB += 30;
    $('status').textContent = '突发 30 个请求：车道 A 放行 ' + passed + ' 个、拒绝 ' + (30 - passed) +
      ' 个；车道 B 照单全收 30 个，水位越红线 3 倍——队列堆积、延迟飙升，这就是没有限流的秒杀现场。（把桶容量调到 20 以上再突发一次：容量超过安全线时，限流车道照样过载——桶容量必须按系统真实承受力设定。）';
    render();
  });

  $('reset').addEventListener('click', function () {
    tokens = cap(); ok = 0; rej = 0; inB = 0; loadA = 0; loadB = 0; overT = 0;
    $('status').textContent = '就绪。点"突发流量 ×30"，对比两条车道的系统水位。';
    render();
  });

  $('rate').addEventListener('input', function () { $('rateV').textContent = $('rate').value; });
  $('cap').addEventListener('input', function () {
    $('capV').textContent = $('cap').value;
    tokens = Math.min(tokens, cap());
    render();
  });

  tokens = cap(); ok = 0; rej = 0; inB = 0; loadA = 0; loadB = 0; overT = 0;
  render();
};
