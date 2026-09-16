/* retry-timeout —— Retry / Timeout / Deadline 时间线模拟（篇04 §3.2）
 * 配置失败率、重试次数、单次超时、总 Deadline，动画播放一次 Logical Call 的时间线，
 * 对比"只重试不设 Deadline"导致的总时长失控。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['retry-timeout'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    '.controls{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:12px;}' +
    '.ctl{display:flex;flex-direction:column;gap:3px;min-width:120px;}' +
    '.ctl label{font-size:11px;color:#57534e;display:flex;justify-content:space-between;gap:8px;}' +
    '.ctl label b{color:#0f766e;font-variant-numeric:tabular-nums;}' +
    'input[type=range]{width:100%;accent-color:#0f766e;}' +
    'button{background:#0f766e;color:#fff;border:none;border-radius:6px;padding:7px 16px;font-size:13px;cursor:pointer;}' +
    'button:hover{background:#115e59;}' +
    'button:disabled{background:#a8a29e;cursor:default;}' +
    '.lane-label{font-size:11px;color:#57534e;margin:10px 0 4px;display:flex;justify-content:space-between;}' +
    '.lane-label b{font-variant-numeric:tabular-nums;}' +
    '.lane{position:relative;height:64px;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;overflow:hidden;}' +
    '.attempt{position:absolute;top:18px;height:22px;border-radius:4px;font-size:10px;line-height:22px;color:#fff;text-align:center;white-space:nowrap;overflow:hidden;transition:all .1s linear;}' +
    '.a-ok{background:#0f766e;}' +
    '.a-fail{background:#dc2626;}' +
    '.a-timeout{background:#d97706;}' +
    '.a-cut{background:#7c3aed;}' +
    '.cursor{position:absolute;top:0;bottom:0;width:2px;background:#1c1917;opacity:.5;}' +
    '.deadline-line{position:absolute;top:0;bottom:0;width:0;border-left:2px dashed #7c3aed;}' +
    '.dl-tag{position:absolute;top:1px;font-size:9px;color:#7c3aed;transform:translateX(3px);white-space:nowrap;}' +
    '.result{margin-top:12px;font-size:13px;padding:8px 12px;border-radius:6px;display:none;}' +
    '.r-ok{display:block;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;}' +
    '.r-fail{display:block;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;}' +
    '.r-cut{display:block;background:#f5f3ff;border:1px solid #ddd6fe;color:#5b21b6;}' +
    '.legend{display:flex;gap:14px;font-size:11px;color:#57534e;margin-top:10px;flex-wrap:wrap;}' +
    '.dot{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 一次 Logical Call 的时间线：Retry / Timeout / Deadline 如何分工（篇04 §3.2）</div>' +
    '  <div class="controls">' +
    '    <div class="ctl"><label>单次失败率 <b id="fv">60%</b></label><input id="fail" type="range" min="0" max="95" step="5" value="60"></div>' +
    '    <div class="ctl"><label>最大 Attempt 数 <b id="rv">5</b></label><input id="retry" type="range" min="1" max="8" step="1" value="5"></div>' +
    '    <div class="ctl"><label>单次耗时(成功时) <b id="dv">800ms</b></label><input id="dur" type="range" min="300" max="3000" step="100" value="800"></div>' +
    '    <div class="ctl"><label>Attempt Timeout <b id="tv">1500ms</b></label><input id="timeout" type="range" min="500" max="5000" step="100" value="1500"></div>' +
    '    <div class="ctl"><label>总 Deadline <b id="dlv">6000ms</b></label><input id="deadline" type="range" min="2000" max="20000" step="500" value="6000"></div>' +
    '    <div class="ctl" style="justify-content:flex-end;"><button id="run">执行一次调用</button></div>' +
    '  </div>' +
    '  <div class="lane-label"><span>方案 A：Retry + Timeout + <b>Deadline</b>（推荐）</span><b id="ta"></b></div>' +
    '  <div class="lane" id="laneA"></div>' +
    '  <div class="lane-label"><span>方案 B：只有 Retry + Timeout，<b>不设 Deadline</b></span><b id="tb"></b></div>' +
    '  <div class="lane" id="laneB"></div>' +
    '  <div class="result" id="result"></div>' +
    '  <div class="legend">' +
    '    <span><span class="dot" style="background:#0f766e"></span>成功 Attempt</span>' +
    '    <span><span class="dot" style="background:#dc2626"></span>失败（快速失败/4xx）</span>' +
    '    <span><span class="dot" style="background:#d97706"></span>超时（慢失败）</span>' +
    '    <span><span class="dot" style="background:#7c3aed"></span>被 Deadline 截断</span>' +
    '    <span><span style="color:#7c3aed">┆</span> Deadline 线</span>' +
    '  </div>' +
    '  <div class="note">绿色短条之间的小间隙是指数退避等待。注意：失败的 Attempt 也消耗 Deadline 预算——Deadline 是所有 Attempt 共享的天花板，Timeout 只是单次地板。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };
  var running = false;

  function bindLabel(id, out, fmt) {
    $(id).addEventListener('input', function () { $(out).textContent = fmt($(id).value); });
  }
  bindLabel('fail', 'fv', function (v) { return v + '%'; });
  bindLabel('retry', 'rv', function (v) { return v; });
  bindLabel('dur', 'dv', function (v) { return v + 'ms'; });
  bindLabel('timeout', 'tv', function (v) { return v + 'ms'; });
  bindLabel('deadline', 'dlv', function (v) { return v + 'ms'; });

  // 预演整条时间线（确定性算完，再动画回放）
  // 返回 { attempts: [{start, dur, kind}], total, outcome }
  function plan(opts, useDeadline) {
    var failRate = opts.fail / 100;
    var attempts = [];
    var t = 0;
    var outcome = 'failed';
    for (var n = 1; n <= opts.retry; n++) {
      if (useDeadline && t >= opts.deadline) { outcome = 'deadline'; break; }
      var kind, dur;
      if (Math.random() < failRate) {
        // 失败：一半是快速失败（200~500ms），一半是慢失败拖到 Timeout
        if (Math.random() < 0.5) { kind = 'fail'; dur = 200 + Math.random() * 300; }
        else { kind = 'timeout'; dur = opts.timeout; }
      } else {
        kind = 'ok'; dur = opts.dur * (0.8 + Math.random() * 0.4);
      }
      var end = t + dur;
      if (useDeadline && end > opts.deadline) {
        attempts.push({ start: t, dur: opts.deadline - t, kind: 'cut', no: n });
        t = opts.deadline;
        outcome = 'deadline';
        break;
      }
      attempts.push({ start: t, dur: dur, kind: kind, no: n });
      t = end;
      if (kind === 'ok') { outcome = 'ok'; break; }
      // 指数退避 + 抖动
      var backoff = Math.min(Math.pow(2, n), 8) * 100 + Math.random() * 100;
      t += backoff;
    }
    return { attempts: attempts, total: t, outcome: outcome };
  }

  var KIND_LABEL = { ok: 'OK', fail: 'FAIL', timeout: 'T/O', cut: 'CUT' };

  function renderLane(lane, sim, scale, showDeadline, deadlineMs) {
    lane.innerHTML = '';
    sim.attempts.forEach(function (a) {
      var el = document.createElement('div');
      el.className = 'attempt a-' + a.kind;
      el.style.left = (a.start * scale) + 'px';
      el.style.width = Math.max(a.dur * scale, 4) + 'px';
      el.textContent = '#' + a.no + ' ' + KIND_LABEL[a.kind];
      el.style.opacity = '0';
      lane.appendChild(el);
    });
    if (showDeadline) {
      var dl = document.createElement('div');
      dl.className = 'deadline-line';
      dl.style.left = (deadlineMs * scale) + 'px';
      var tag = document.createElement('span');
      tag.className = 'dl-tag';
      tag.textContent = 'Deadline ' + deadlineMs + 'ms';
      dl.appendChild(tag);
      lane.appendChild(dl);
    }
    var cur = document.createElement('div');
    cur.className = 'cursor';
    lane.appendChild(cur);
    return cur;
  }

  function run() {
    if (running) return;
    running = true;
    $('run').disabled = true;
    var opts = {
      fail: parseInt($('fail').value, 10),
      retry: parseInt($('retry').value, 10),
      dur: parseInt($('dur').value, 10),
      timeout: parseInt($('timeout').value, 10),
      deadline: parseInt($('deadline').value, 10)
    };
    var simA = plan(opts, true);
    var simB = plan(opts, false);
    var viewMs = Math.max(simB.total, opts.deadline) * 1.08;

    var laneA = $('laneA'), laneB = $('laneB');
    var scaleA = laneA.clientWidth / viewMs;
    var scaleB = laneB.clientWidth / viewMs;
    var curA = renderLane(laneA, simA, scaleA, true, opts.deadline);
    var curB = renderLane(laneB, simB, scaleB, false, 0);

    var bars = Array.prototype.slice.call(shadow.querySelectorAll('.attempt'));
    var startTs = null;
    var SPEED = 3; // 动画加速倍数
    $('result').className = 'result';
    $('result').style.display = 'none';
    $('ta').textContent = '';
    $('tb').textContent = '';

    function frame(ts) {
      if (startTs === null) startTs = ts;
      var now = (ts - startTs) * SPEED;
      curA.style.left = Math.min(now * scaleA, laneA.clientWidth) + 'px';
      curB.style.left = Math.min(now * scaleB, laneB.clientWidth) + 'px';
      bars.forEach(function (b) {
        var left = parseFloat(b.style.left) / (b.parentElement === laneA ? scaleA : scaleB);
        if (left <= now) b.style.opacity = '1';
      });
      $('ta').textContent = '已用 ' + Math.min(now, simA.total).toFixed(0) + ' ms';
      $('tb').textContent = '已用 ' + Math.min(now, simB.total).toFixed(0) + ' ms';
      if (now < viewMs) {
        requestAnimationFrame(frame);
      } else {
        finish();
      }
    }

    function outcomeText(sim, name) {
      var map = {
        ok: '成功（' + sim.attempts.length + ' 次 Attempt）',
        failed: '失败（重试耗尽）',
        deadline: '被 Deadline 终止（快速失败，释放资源）'
      };
      return name + '：总耗时 ' + sim.total.toFixed(0) + ' ms，' + map[sim.outcome];
    }

    function finish() {
      $('ta').textContent = '总耗时 ' + simA.total.toFixed(0) + ' ms';
      $('tb').textContent = '总耗时 ' + simB.total.toFixed(0) + ' ms';
      var r = $('result');
      var over = simB.total - simA.total;
      if (simA.outcome === 'ok') r.className = 'result r-ok';
      else if (simA.outcome === 'deadline') r.className = 'result r-cut';
      else r.className = 'result r-fail';
      r.innerHTML = outcomeText(simA, '方案 A') + '<br>' + outcomeText(simB, '方案 B') +
        (over > 0 ? '<br>同样运气下，不设 Deadline 多耗 <b>' + over.toFixed(0) + ' ms</b>——高并发故障期，这就是请求堆积、小故障放大成雪崩的机制。'
                  : '<br>这次两者相同：运气好没触发长时间重试。把失败率拉高再多跑几次看看。');
      running = false;
      $('run').disabled = false;
    }

    requestAnimationFrame(frame);
  }

  $('run').addEventListener('click', run);
};
