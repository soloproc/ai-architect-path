/* circuit-breaker · 熔断器状态机模拟器（纯前端，无外部依赖） */
window.DEMOS = window.DEMOS || {};
window.DEMOS['circuit-breaker'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });
  shadow.innerHTML = [
    '<style>',
    ':host{display:block}',
    '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;font-family:inherit;color:#292524;font-size:13px;line-height:1.5}',
    '.cap{font-size:12px;color:#78716c;letter-spacing:.03em;margin-bottom:10px}',
    '.bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px}',
    'button{font-family:inherit;font-size:12px;padding:6px 14px;border-radius:6px;border:1px solid #0f766e;background:#0f766e;color:#fff;cursor:pointer;transition:opacity .15s}',
    'button.ghost{background:#fff;color:#0f766e}',
    'button:hover{opacity:.85}button:disabled{opacity:.4;cursor:default}',
    'label{font-size:12px;color:#57534e;display:flex;align-items:center;gap:6px}',
    'input[type=range]{accent-color:#0f766e;width:140px}',
    '.machine{display:flex;align-items:center;gap:6px;justify-content:center;margin:8px 0 12px;flex-wrap:wrap}',
    '.st{border:2px solid #d6d3d1;border-radius:8px;padding:8px 14px;font-size:12px;text-align:center;background:#fafaf9;transition:all .3s;min-width:86px}',
    '.st small{display:block;color:#78716c;font-size:10px;margin-top:2px}',
    '.st.on{border-color:#0f766e;background:#f0fdfa;color:#0f766e;font-weight:700;box-shadow:0 0 0 3px #ccfbf1}',
    '.st.open.on{border-color:#b91c1c;background:#fef2f2;color:#b91c1c;box-shadow:0 0 0 3px #fee2e2}',
    '.st.half.on{border-color:#b45309;background:#fffbeb;color:#b45309;box-shadow:0 0 0 3px #fef3c7}',
    '.arr{color:#a8a29e;font-size:14px}',
    '.stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px}',
    '.stat{flex:1;min-width:100px;border:1px solid #eee7d8;border-radius:6px;padding:8px;text-align:center}',
    '.stat .v{font-size:22px;font-weight:700}',
    '.stat .l{font-size:11px;color:#78716c}',
    '.ok .v{color:#0f766e}.fail .v{color:#b91c1c}.rej .v{color:#b45309}',
    '.meta{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#57534e;margin-bottom:6px}',
    '.log{border-top:1px solid #eee7d8;padding-top:8px;font-size:12px;color:#57534e;min-height:34px;white-space:pre-line}',
    '</style>',
    '<div class="wrap">',
    '  <div class="cap">模拟器 · 熔断器状态机：连续失败 5 次断开，冷却 3 秒后半开试探</div>',
    '  <div class="bar">',
    '    <label>下游故障率 <input type="range" id="rate" min="0" max="100" value="70"><b id="rateV">70%</b></label>',
    '    <button id="send">发送请求</button>',
    '    <button id="auto" class="ghost">自动发送：开</button>',
    '    <button id="reset" class="ghost">重置</button>',
    '  </div>',
    '  <div class="machine">',
    '    <div class="st on" id="stClosed">闭合 Closed<small>正常放行，统计失败</small></div>',
    '    <span class="arr">—失败达阈值→</span>',
    '    <div class="st open" id="stOpen">断开 Open<small>快速失败，不触达下游</small></div>',
    '    <span class="arr">—冷却到点→</span>',
    '    <div class="st half" id="stHalf">半开 Half-Open<small>放行试探请求</small></div>',
    '  </div>',
    '  <div class="meta"><span>连续失败：<b id="cf">0</b> / 5</span><span id="cool"></span><span>上次调用耗时：<b id="lat">—</b></span></div>',
    '  <div class="stats">',
    '    <div class="stat ok"><div class="v" id="cOk">0</div><div class="l">成功</div></div>',
    '    <div class="stat fail"><div class="v" id="cFail">0</div><div class="l">真实失败</div></div>',
    '    <div class="stat rej"><div class="v" id="cRej">0</div><div class="l">熔断拒绝（快速失败）</div></div>',
    '  </div>',
    '  <div class="log" id="log">就绪。建议：把故障率拉到 70% 以上，打开自动发送，观察状态机迁移。</div>',
    '</div>'
  ].join('\n');

  var $ = function (id) { return shadow.getElementById(id); };
  var THRESHOLD = 5, COOLDOWN = 3000;
  var state, consecFail, openedAt, cOk, cFail, cRej, logs, autoTimer;

  function log(msg) {
    logs.unshift(msg);
    if (logs.length > 3) logs.pop();
    $('log').textContent = logs.join('\n');
  }

  function render() {
    $('stClosed').className = 'st' + (state === 'closed' ? ' on' : '');
    $('stOpen').className = 'st open' + (state === 'open' ? ' on' : '');
    $('stHalf').className = 'st half' + (state === 'half' ? ' on' : '');
    $('cf').textContent = consecFail;
    $('cOk').textContent = cOk;
    $('cFail').textContent = cFail;
    $('cRej').textContent = cRej;
    if (state === 'open') {
      var left = Math.max(0, COOLDOWN - (Date.now() - openedAt));
      $('cool').textContent = '冷却剩余 ' + (left / 1000).toFixed(1) + ' s';
    } else {
      $('cool').textContent = '';
    }
  }

  function send() {
    var rate = parseInt($('rate').value, 10);
    if (state === 'open') {
      if (Date.now() - openedAt >= COOLDOWN) {
        state = 'half';
        log('冷却结束 → 半开，放行 1 个试探请求');
      } else {
        cRej++;
        $('lat').textContent = '<1 ms（快速失败）';
        log('熔断拒绝：请求未触达下游，直接快速失败（保护下游 + 本服务线程池）');
        render();
        return;
      }
    }
    var failed = Math.random() * 100 < rate;
    $('lat').textContent = failed ? '~800 ms（超时/报错）' : '~15 ms';
    if (failed) {
      cFail++;
      consecFail++;
      if (state === 'half') {
        state = 'open'; openedAt = Date.now();
        log('试探请求失败 → 重新断开，继续冷却');
      } else if (consecFail >= THRESHOLD) {
        state = 'open'; openedAt = Date.now();
        log('连续失败 ' + consecFail + ' 次 → 熔断断开！后续请求将快速失败');
      } else {
        log('调用失败（连续失败 ' + consecFail + '/' + THRESHOLD + '）');
      }
    } else {
      cOk++;
      if (state === 'half') {
        state = 'closed'; consecFail = 0;
        log('试探成功 → 熔断闭合，恢复正常流量');
      } else {
        consecFail = 0;
        log('调用成功');
      }
    }
    render();
  }

  function init() {
    state = 'closed'; consecFail = 0; openedAt = 0;
    cOk = 0; cFail = 0; cRej = 0; logs = [];
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; $('auto').textContent = '自动发送：关'; }
    $('lat').textContent = '—';
    log('就绪。建议：把故障率拉到 70% 以上，打开自动发送，观察状态机迁移。');
    render();
  }

  $('rate').addEventListener('input', function () { $('rateV').textContent = $('rate').value + '%'; });
  $('send').addEventListener('click', send);
  $('auto').addEventListener('click', function () {
    if (autoTimer) {
      clearInterval(autoTimer); autoTimer = null;
      $('auto').textContent = '自动发送：关';
    } else {
      autoTimer = setInterval(send, 700);
      $('auto').textContent = '自动发送：开';
    }
  });
  $('reset').addEventListener('click', init);
  // 冷却倒计时刷新
  setInterval(function () { if (state === 'open') render(); }, 200);

  init();
  $('auto').textContent = '自动发送：关';
};
