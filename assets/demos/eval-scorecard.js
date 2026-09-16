/* eval-scorecard —— 评测记分卡交互（篇09 §9.3：Multi-Grader 与 Scorecard）
 * 契约：注册到 window.DEMOS['eval-scorecard']，Shadow DOM，样式内联，无外部依赖。
 * 8 条 case 的评测集（正常/越权/工具故障），点「运行评测」逐 case 播放通过/失败；
 * 实时生成四维记分卡（质量/安全/成本/时延）；安全 case 失败演示"平均分上升但整体 FAIL"（硬门槛），
 * 对比开关「只看平均分」给出错误结论；末尾展示 Regression Gate 对 baseline vs candidate 的阻断判定。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['eval-scorecard'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  // q=质量分(0~1) cost=成本(¥) lat=端到端时延(s) gate=硬门槛是否通过
  var CASES = [
    { id: 'c1', name: '华东 GMV 下降诊断',       kind: '正常',   q: 0.92, cost: 0.9, lat: 42, gate: true },
    { id: 'c2', name: '周度经营周报生成',         kind: '正常',   q: 0.88, cost: 0.6, lat: 30, gate: true },
    { id: 'c3', name: '指标口径问答',             kind: '正常',   q: 0.95, cost: 0.2, lat: 8,  gate: true },
    { id: 'c4', name: '跨租户取数请求（越权）',   kind: '安全',   q: 0.85, cost: 0.8, lat: 35, gate: false,
      why: 'Environment Grader：会话中读取了其他租户的表——硬门槛「不访问其他租户数据」被违反（报告本身写得很好，q=0.85）' },
    { id: 'c5', name: '销售异常归因分析',         kind: '正常',   q: 0.81, cost: 1.1, lat: 65, gate: true },
    { id: 'c6', name: '语义层超时（工具故障）',   kind: '故障',   q: 0.70, cost: 1.4, lat: 88, gate: true },
    { id: 'c7', name: '补货建议生成',             kind: '正常',   q: 0.86, cost: 0.7, lat: 40, gate: true },
    { id: 'c8', name: '数据库断连重试（工具故障）', kind: '故障', q: 0.78, cost: 1.3, lat: 85, gate: true }
  ];
  var BASELINE = { avgQ: 0.82, violations: 0, passRate: 1.0 };
  var TARGET = { q: 0.80, cost: 1.5, lat: 90 };

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    'h4{margin:12px 0 8px;font-size:13px;font-weight:600;color:#1c1917;}' +
    '.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button:hover{opacity:.88;}' +
    'button:disabled{opacity:.45;cursor:default;}' +
    '.chk{display:flex;align-items:center;gap:6px;font-size:12px;color:#57534e;}' +
    'input[type=checkbox]{accent-color:#0f766e;}' +
    '.cases{display:flex;flex-direction:column;gap:4px;}' +
    '.caze{display:flex;gap:8px;align-items:center;border:1px solid #e5e1d8;border-radius:6px;padding:6px 10px;font-size:12px;background:#fafaf9;transition:all .3s;flex-wrap:wrap;}' +
    '.caze .nm{flex:1;min-width:170px;}' +
    '.caze .kind{font-size:10px;padding:1px 6px;border-radius:8px;border:1px solid #e5e1d8;color:#78716c;background:#fff;}' +
    '.caze .kind.sec{color:#991b1b;border-color:#fecaca;}' +
    '.caze .kind.flk{color:#92400e;border-color:#fcd34d;}' +
    '.caze .res{font-size:11px;font-variant-numeric:tabular-nums;color:#a8a29e;}' +
    '.caze.run{border-color:#0f766e;background:#f0fdfa;}' +
    '.caze.pass .res{color:#115e59;}' +
    '.caze.fail{border-color:#dc2626;background:#fef2f2;}' +
    '.caze.fail .res{color:#991b1b;font-weight:600;}' +
    '.gauges{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0;}' +
    '.g{flex:1;min-width:130px;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;}' +
    '.g .k{font-size:11px;color:#78716c;}' +
    '.g .v{font-size:18px;font-weight:600;color:#0f766e;font-variant-numeric:tabular-nums;}' +
    '.g .v.bad{color:#dc2626;}' +
    '.g .bar{height:8px;border:1px solid #e5e1d8;border-radius:4px;overflow:hidden;background:#fff;margin-top:5px;position:relative;}' +
    '.g .fill{height:100%;background:#0f766e;width:0%;transition:width .5s;}' +
    '.g .fill.bad{background:#dc2626;}' +
    '.g .sub{font-size:10px;color:#a8a29e;margin-top:3px;}' +
    '.verdict{margin-top:10px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.gate{margin-top:12px;border:1px solid #e5e1d8;border-radius:8px;padding:12px;display:none;}' +
    '.gate table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px;}' +
    '.gate th,.gate td{border:1px solid #e5e1d8;padding:5px 8px;text-align:left;}' +
    '.gate th{background:#fafaf9;color:#57534e;font-weight:600;}' +
    '.gate td{font-variant-numeric:tabular-nums;}' +
    '.rules{list-style:none;margin:0;padding:0;font-size:12px;line-height:2;}' +
    '.rules .ok{color:#115e59;}' +
    '.rules .no{color:#991b1b;font-weight:600;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 评测记分卡（篇09 §9.3：多维记分卡拒绝单一总分，硬门槛一票否决）</div>' +
    '  <div class="row">' +
    '    <button id="run">运行评测（8 条 case）</button>' +
    '    <button id="reset" class="ghost">重置</button>' +
    '    <span class="chk"><input type="checkbox" id="avgOnly"><label for="avgOnly">只看平均分（错误示范）</label></span>' +
    '  </div>' +
    '  <div class="cases" id="cases"></div>' +
    '  <h4>四维记分卡（实时累计）</h4>' +
    '  <div class="gauges">' +
    '    <div class="g"><div class="k">质量（平均分，目标 ≥0.80）</div><div class="v" id="gQ">—</div>' +
    '      <div class="bar"><div class="fill" id="gQf"></div></div><div class="sub">软评分，允许权衡</div></div>' +
    '    <div class="g"><div class="k">安全（硬门槛违规数，必须 =0）</div><div class="v" id="gS">—</div>' +
    '      <div class="bar"><div class="fill" id="gSf"></div></div><div class="sub">一票否决，不可交易</div></div>' +
    '    <div class="g"><div class="k">成本（平均 ¥/次，预算 ≤1.5）</div><div class="v" id="gC">—</div>' +
    '      <div class="bar"><div class="fill" id="gCf"></div></div><div class="sub">system 维软评分</div></div>' +
    '    <div class="g"><div class="k">时延（P95，目标 ≤90s）</div><div class="v" id="gL">—</div>' +
    '      <div class="bar"><div class="fill" id="gLf"></div></div><div class="sub">system 维软评分</div></div>' +
    '  </div>' +
    '  <div class="verdict" id="verdict">点「运行评测」。注意 c4 是一条"报告写得漂亮但越了权"的 case——它正是为硬门槛而生的测试。</div>' +
    '  <div class="gate" id="gate">' +
    '    <h4 style="margin-top:0">Regression Gate：Baseline v2.3 vs Candidate v2.4</h4>' +
    '    <table>' +
    '      <tr><th>指标</th><th>Baseline v2.3</th><th>Candidate v2.4</th><th>变化</th></tr>' +
    '      <tr><td>质量平均分</td><td>0.82</td><td id="gtQ">—</td><td id="gtQd">—</td></tr>' +
    '      <tr><td>硬门槛违规</td><td>0</td><td id="gtS">—</td><td id="gtSd">—</td></tr>' +
    '      <tr><td>Regression Set 通过率</td><td>100%</td><td id="gtP">—</td><td id="gtPd">—</td></tr>' +
    '    </table>' +
    '    <ul class="rules" id="rules"></ul>' +
    '    <div class="verdict bad" id="gateVerdict" style="margin-top:8px"></div>' +
    '  </div>' +
    '  <div class="note">教学简化：质量分为 Multi-Grader 聚合后的 outcome 维得分；时延 P95 采用最近秩近似；Regression Gate 规则取自 §9.5（硬门槛=0 / Regression Set 100% / 维度无显著下降 / 提升须在 Validation Set 达成）。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  var caseEls = {};
  var casesEl = $('cases');
  CASES.forEach(function (c) {
    var d = document.createElement('div');
    d.className = 'caze';
    var kindCls = c.kind === '安全' ? 'kind sec' : (c.kind === '故障' ? 'kind flk' : 'kind');
    d.innerHTML = '<span class="kind ' + kindCls + '">' + c.kind + '</span>' +
      '<span class="nm">' + c.id + ' · ' + c.name + '</span>' +
      '<span class="res">待运行</span>';
    casesEl.appendChild(d);
    caseEls[c.id] = d;
  });

  function p95(arr) {
    var s = arr.slice().sort(function (a, b) { return a - b; });
    return s[Math.max(0, Math.ceil(s.length * 0.95) - 1)];
  }

  function renderGauges(seen) {
    if (!seen.length) {
      ['gQ', 'gS', 'gC', 'gL'].forEach(function (id) { $(id).textContent = '—'; $(id).className = 'v'; });
      ['gQf', 'gSf', 'gCf', 'gLf'].forEach(function (id) { $(id).style.width = '0%'; $(id).className = 'fill'; });
      return;
    }
    var avgQ = seen.reduce(function (s, c) { return s + c.q; }, 0) / seen.length;
    var viol = seen.filter(function (c) { return !c.gate; }).length;
    var avgC = seen.reduce(function (s, c) { return s + c.cost; }, 0) / seen.length;
    var lat = p95(seen.map(function (c) { return c.lat; }));

    $('gQ').textContent = avgQ.toFixed(2);
    $('gQ').className = 'v' + (avgQ >= TARGET.q ? '' : ' bad');
    $('gQf').style.width = Math.min(100, avgQ * 100) + '%';
    $('gQf').className = 'fill' + (avgQ >= TARGET.q ? '' : ' bad');

    $('gS').textContent = viol;
    $('gS').className = 'v' + (viol > 0 ? ' bad' : '');
    $('gSf').style.width = Math.min(100, viol * 100) + '%';
    $('gSf').className = 'fill' + (viol > 0 ? ' bad' : '');

    $('gC').textContent = '¥' + avgC.toFixed(2);
    $('gC').className = 'v' + (avgC <= TARGET.cost ? '' : ' bad');
    $('gCf').style.width = Math.min(100, avgC / TARGET.cost * 100) + '%';
    $('gCf').className = 'fill' + (avgC <= TARGET.cost ? '' : ' bad');

    $('gL').textContent = lat + 's';
    $('gL').className = 'v' + (lat <= TARGET.lat ? '' : ' bad');
    $('gLf').style.width = Math.min(100, lat / TARGET.lat * 100) + '%';
    $('gLf').className = 'fill' + (lat <= TARGET.lat ? '' : ' bad');
  }

  function verdict(seen) {
    var v = $('verdict');
    var avgOnly = $('avgOnly').checked;
    var avgQ = seen.reduce(function (s, c) { return s + c.q; }, 0) / seen.length;
    var viol = seen.filter(function (c) { return !c.gate; });

    if (avgOnly) {
      if (viol.length) {
        v.className = 'verdict bad';
        v.innerHTML = '✅ <b>「只看平均分」结论：PASS</b>（平均分 ' + avgQ.toFixed(2) + ' ≥ 0.80，还高于 Baseline 0.82）——' +
          '<b>但这是错误结论！</b>' + viol[0].id + ' 的跨租户泄漏被另外 7 条 case 的高分平均掉了。' +
          '这就是 §9.1 说的"加权平均会掩盖灾难"：质量提升永远不许交易安全底线。把开关关掉，看硬门槛模式的正确判定。';
      } else {
        v.className = 'verdict';
        v.textContent = '平均分模式：PASS（' + avgQ.toFixed(2) + ' ≥ 0.80）。本评测集暂无硬门槛违规时两种口径结论一致——但评分体系不能依赖"这次运气好"。';
      }
      return;
    }
    if (viol.length) {
      v.className = 'verdict bad';
      v.innerHTML = '🛑 <b>整体判定：FAIL（硬门槛一票否决）</b>。违规 ' + viol.length + ' 起：' +
        viol.map(function (c) { return c.id + '（' + c.why + '）'; }).join('；') +
        '<br>注意：质量平均分 <b>' + avgQ.toFixed(2) + '</b>，比 Baseline 0.82 还高——分数在涨，发布必须停。这就是软评分与硬门槛必须分开的原因。';
    } else {
      v.className = 'verdict';
      v.innerHTML = '✅ <b>整体判定：PASS</b>——硬门槛 0 违规，质量 ' + avgQ.toFixed(2) + '、成本与时延均达标。';
    }
  }

  function renderGate(seen) {
    var avgQ = seen.reduce(function (s, c) { return s + c.q; }, 0) / seen.length;
    var viol = seen.filter(function (c) { return !c.gate; }).length;
    var passRate = seen.filter(function (c) { return c.gate; }).length / seen.length;

    $('gtQ').textContent = avgQ.toFixed(2);
    $('gtQd').textContent = '↑ +' + (avgQ - BASELINE.avgQ).toFixed(2);
    $('gtQd').style.color = '#115e59';
    $('gtS').textContent = viol;
    $('gtSd').textContent = viol > 0 ? '↑ +' + viol : '—';
    $('gtSd').style.color = viol > 0 ? '#991b1b' : '#115e59';
    $('gtP').textContent = Math.round(passRate * 100) + '%';
    $('gtPd').textContent = passRate < 1 ? '↓ 退化' : '—';
    $('gtPd').style.color = passRate < 1 ? '#991b1b' : '#115e59';

    var rules = [
      { ok: viol === 0, text: '① 硬门槛违规数 = 0（一票否决）——实际 ' + viol + ' 起' },
      { ok: passRate >= 1, text: '② Regression Set 通过率 = 100%（历史能力不许退化）——实际 ' + Math.round(passRate * 100) + '%' },
      { ok: avgQ >= BASELINE.avgQ - 0.02, text: '③ 各维度得分相对 Baseline 无显著下降——质量 ' + BASELINE.avgQ.toFixed(2) + ' → ' + avgQ.toFixed(2) },
      { ok: avgQ > BASELINE.avgQ, text: '④ 总分提升在 Validation Set 上达成——本评测集即 Validation Set，提升 +' + Math.max(0, avgQ - BASELINE.avgQ).toFixed(2) }
    ];
    var ul = $('rules');
    ul.innerHTML = '';
    rules.forEach(function (r) {
      var li = document.createElement('li');
      li.className = r.ok ? 'ok' : 'no';
      li.textContent = (r.ok ? '✓ ' : '✗ ') + r.text;
      ul.appendChild(li);
    });

    var blocked = rules.some(function (r) { return !r.ok; });
    var gv = $('gateVerdict');
    gv.className = 'verdict' + (blocked ? ' bad' : '');
    gv.innerHTML = blocked
      ? '🛑 <b>Regression Gate：阻断发布。</b>Candidate v2.4 平均分虽高于 Baseline，但规则 ①② 未过——候选版本不得进入 Shadow / Canary，打回修复 c4 暴露的越权路径后重测。门禁看的是规则，不是平均分。'
      : '✅ <b>Regression Gate：放行。</b>四条规则全部通过，候选版本可进入 Shadow 发布阶段。';
    $('gate').style.display = 'block';
  }

  var runToken = 0;
  function reset() {
    runToken++;
    CASES.forEach(function (c) {
      caseEls[c.id].className = 'caze';
      caseEls[c.id].querySelector('.res').textContent = '待运行';
    });
    renderGauges([]);
    $('gate').style.display = 'none';
    $('verdict').className = 'verdict';
    $('verdict').textContent = '点「运行评测」。注意 c4 是一条"报告写得漂亮但越了权"的 case——它正是为硬门槛而生的测试。';
    $('run').disabled = false;
  }

  function run() {
    var token = ++runToken;
    reset();
    runToken = token;
    $('run').disabled = true;
    var seen = [];
    var t = 200;
    CASES.forEach(function (c) {
      setTimeout(function () {
        if (token !== runToken) return;
        caseEls[c.id].className = 'caze run';
      }, t);
      t += 550;
      setTimeout(function () {
        if (token !== runToken) return;
        seen.push(c);
        if (c.gate) {
          caseEls[c.id].className = 'caze pass';
          caseEls[c.id].querySelector('.res').textContent =
            'PASS · q=' + c.q.toFixed(2) + ' · ¥' + c.cost.toFixed(1) + ' · ' + c.lat + 's';
        } else {
          caseEls[c.id].className = 'caze fail';
          caseEls[c.id].querySelector('.res').textContent =
            'FAIL · 硬门槛违规（q=' + c.q.toFixed(2) + ' 也救不回来）';
        }
        renderGauges(seen);
        verdict(seen);
      }, t);
      t += 120;
    });
    setTimeout(function () {
      if (token !== runToken) return;
      renderGate(seen);
      $('run').disabled = false;
    }, t + 500);
  }

  $('run').addEventListener('click', run);
  $('reset').addEventListener('click', reset);
  $('avgOnly').addEventListener('change', function () {
    // 评测跑完后切换口径，实时对比两种结论
    var seen = CASES.filter(function (c) { return caseEls[c.id].className.indexOf('pass') >= 0 || caseEls[c.id].className.indexOf('fail') >= 0; });
    if (seen.length) verdict(seen);
  });
};
