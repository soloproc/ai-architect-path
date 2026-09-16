/* structured-output —— 结构化输出三道防线与修复循环模拟器（篇04 §3.3）
 * 契约：注册到 window.DEMOS['structured-output']，Shadow DOM，样式内联，无外部依赖。
 * 交互：选择防线档位（裸 Prompt 约定 / JSON Mode / Structured Output），点「生成一次」
 * 模拟模型输出 → 本地 Schema 校验逐条报错 → 失败进入"带错误反馈重问"修复循环，
 * 观察修复收敛或耗尽；「批量模拟 100 次」对比三档的一次通过率与平均 Attempts。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['structured-output'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  // 目标 Schema：DataAgent 的 SQL 生成 Output Contract
  var SCHEMA_TXT =
    '{\n' +
    '  "metric": "gmv",            // 必填, 枚举\n' +
    '  "sql": "SELECT ...",        // 必填, 非空字符串\n' +
    '  "confidence": 0.0~1.0,      // 必填, 数值\n' +
    '  "evidence_period": "2024-W23" // 必填, 字符串\n' +
    '}';

  // 三档防线的一次通过概率与失败形态分布（教学化设定，非真实统计）
  var MODES = [
    {
      key: 'prompt', label: '① 裸 Prompt 约定', pass: 0.45, repairGain: 0.30,
      desc: '只在 Prompt 里写"请返回 JSON"，无任何强制',
      fails: [
        { w: 0.34, kind: 'fence', err: '输出被 Markdown 代码围栏包裹，不是纯 JSON' },
        { w: 0.26, kind: 'missing', err: '缺少必填字段 "evidence_period"' },
        { w: 0.22, kind: 'type', err: '"confidence" 应为数值，实际为字符串 "high"' },
        { w: 0.18, kind: 'chat', err: '输出混入解释性文字："好的，这是您要的 SQL……"' }
      ]
    },
    {
      key: 'json', label: '② JSON Mode', pass: 0.78, repairGain: 0.16,
      desc: '强制输出是合法 JSON，但不保证字段与类型',
      fails: [
        { w: 0.44, kind: 'missing', err: '缺少必填字段 "evidence_period"' },
        { w: 0.34, kind: 'type', err: '"confidence" 应为数值，实际为字符串 "high"' },
        { w: 0.22, kind: 'enum', err: '"metric" 取值 "sales" 不在枚举 [gmv, orders, aov] 内' }
      ]
    },
    {
      key: 'so', label: '③ Structured Output（约束解码）', pass: 0.96, repairGain: 0.03,
      desc: 'Provider 在解码层按 Schema 约束词表，格式近乎必对',
      fails: [
        { w: 0.60, kind: 'trunc', err: 'max_tokens 过小，输出被截断（finish_reason=length）' },
        { w: 0.40, kind: 'enum', err: '"metric" 取值越界（极低概率语义错误，非格式错误）' }
      ]
    }
  ];

  var state = { attempts: [], batch: null };

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:10px;}' +
    'h4{margin:12px 0 6px;font-size:13px;font-weight:600;}' +
    '.modes{display:flex;gap:8px;flex-wrap:wrap;}' +
    '.mode{flex:1;min-width:170px;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;cursor:pointer;background:#fafaf9;}' +
    '.mode.on{border-color:#0f766e;background:#f0fdfa;}' +
    '.mode .nm{font-size:12px;font-weight:600;color:#0f766e;}' +
    '.mode .ds{font-size:11px;color:#78716c;margin-top:3px;line-height:1.5;}' +
    '.cols{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;}' +
    '.col{flex:1;min-width:260px;}' +
    '.box{border:1px solid #e5e1d8;border-radius:6px;background:#fafaf9;padding:8px 10px;font-size:12px;}' +
    '.box .hd{font-size:11px;color:#78716c;margin-bottom:5px;}' +
    'pre{margin:0;font-size:11px;line-height:1.55;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;color:#44403c;}' +
    '.att{border-left:3px solid #e5e1d8;padding:6px 9px;margin:6px 0;background:#fafaf9;border-radius:0 6px 6px 0;font-size:12px;}' +
    '.att.ok{border-left-color:#0f766e;background:#f0fdfa;}' +
    '.att.bad{border-left-color:#dc2626;background:#fef2f2;}' +
    '.att.fix{border-left-color:#d97706;background:#fffbeb;}' +
    '.att .tag{display:inline-block;font-size:10px;padding:1px 6px;border-radius:8px;margin-right:6px;color:#fff;}' +
    '.tag.g{background:#0f766e;}.tag.r{background:#dc2626;}.tag.o{background:#d97706;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button:hover{opacity:.88;}' +
    '.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 4px;}' +
    'table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px;}' +
    'th,td{border:1px solid #e5e1d8;padding:5px 8px;text-align:left;}' +
    'th{background:#fafaf9;color:#57534e;font-weight:600;}' +
    'td.num{font-variant-numeric:tabular-nums;}' +
    '.good{color:#0f766e;font-weight:600;}.mid{color:#d97706;font-weight:600;}.poor{color:#dc2626;font-weight:600;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.7;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 结构化输出三道防线与修复循环（篇04 §3.3：无效输出不许越过 Runtime 边界）</div>' +
    '  <h4>① 选择防线档位（目标 Schema 如右）</h4>' +
    '  <div class="cols">' +
    '    <div class="col" style="flex:1.4"><div class="modes" id="modes"></div></div>' +
    '    <div class="col"><div class="box"><div class="hd">Output Contract（response_schema）</div><pre>' + SCHEMA_TXT + '</pre></div></div>' +
    '  </div>' +
    '  <div class="row">' +
    '    <button id="gen">生成一次（含校验与修复）</button>' +
    '    <button id="batch" class="ghost">批量模拟 100 次</button>' +
    '    <button id="reset" class="ghost">清空记录</button>' +
    '  </div>' +
    '  <div class="cols">' +
    '    <div class="col"><div class="box"><div class="hd">② 单次调用过程（Attempt → 校验 → 修复重问）</div><div id="log"><pre>点「生成一次」开始。</pre></div></div></div>' +
    '    <div class="col"><div class="box"><div class="hd">③ 100 次批量统计（三档对比）</div><div id="stat"><pre>点「批量模拟 100 次」开始。</pre></div></div></div>' +
    '  </div>' +
    '  <div class="verdict" id="verdict">教学观察点：防线越靠前（解码层），一次通过率越高、修复成本越低；但无论哪一档，本地 Schema 校验都不能省——Provider 的承诺不可尽信。</div>' +
    '  <div class="note">教学简化：通过率为示意设定（真实分布随模型与 Schema 复杂度变化）；修复重问最多 2 次，与正文"通常 1–2 次内收敛"一致。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };
  var curMode = 0;

  function renderModes() {
    var html = '';
    MODES.forEach(function (m, i) {
      html += '<div class="mode' + (i === curMode ? ' on' : '') + '" data-i="' + i + '">' +
        '<div class="nm">' + m.label + '</div><div class="ds">' + m.desc +
        '<br>一次通过率 ≈ ' + Math.round(m.pass * 100) + '%</div></div>';
    });
    $('modes').innerHTML = html;
    var nodes = $('modes').querySelectorAll('.mode');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].addEventListener('click', function () {
        curMode = parseInt(this.getAttribute('data-i'), 10);
        renderModes();
      });
    }
  }

  function pickFail(m) {
    var r = Math.random(), acc = 0;
    for (var i = 0; i < m.fails.length; i++) {
      acc += m.fails[i].w;
      if (r <= acc) return m.fails[i];
    }
    return m.fails[m.fails.length - 1];
  }

  // 模拟一次 Logical Call：最多 1 + 2 次修复重问，返回 attempt 记录
  function simulateOnce(m) {
    var atts = [];
    var p = m.pass;
    for (var n = 1; n <= 3; n++) {
      if (Math.random() < p) {
        atts.push({ no: n, ok: true });
        return { ok: true, atts: atts };
      }
      var f = pickFail(m);
      atts.push({ no: n, ok: false, err: f.err });
      p = Math.min(p + m.repairGain + 0.12, 0.995); // 修复重问：错误反馈让下次更可能收敛
    }
    return { ok: false, atts: atts };
  }

  $('gen').addEventListener('click', function () {
    var m = MODES[curMode];
    var r = simulateOnce(m);
    var html = '<div style="font-size:11px;color:#78716c;margin-bottom:4px">防线：' + m.label + '</div>';
    r.atts.forEach(function (a, idx) {
      if (a.ok) {
        html += '<div class="att ok"><span class="tag g">Attempt ' + a.no + '</span>Schema 校验通过 → <b>COMMITTED</b>，parsed 交付业务层</div>';
      } else {
        html += '<div class="att bad"><span class="tag r">Attempt ' + a.no + '</span>校验失败：' + a.err + '</div>';
        if (idx < r.atts.length - 1) {
          html += '<div class="att fix"><span class="tag o">修复重问</span>把校验错误追加进上下文重问模型（不是简单重试——输入变了）</div>';
        }
      }
    });
    if (!r.ok) {
      html += '<div class="att bad"><span class="tag r">终态</span>修复耗尽 → Logical Call 失败，错误聚合上报，<b>半个 JSON 也不会漏给下游</b></div>';
    }
    $('log').innerHTML = html;
    var v = $('verdict');
    if (r.ok && r.atts.length === 1) {
      v.innerHTML = '✅ 一次通过。注意：即使如此，<b>本地校验仍然执行了</b>——Structured Output 是第一道、成本最低的防线，不是唯一防线。';
    } else if (r.ok) {
      v.innerHTML = '🔶 第 ' + r.atts.length + ' 次 Attempt 才通过。<b>修复循环的价值</b>：校验错误本身就是最好的反馈——模型看到"缺 evidence_period"比看到"再试一次"有效得多。';
    } else {
      v.innerHTML = '🛑 修复耗尽仍失败。这是 Output Contract 的合法终态：失败要显式、要聚合原因、要进 Trace——<b>而不是把坏输出偷偷放行</b>。试试更高档的防线，看这个结局出现的频率如何变化。';
    }
  });

  $('batch').addEventListener('click', function () {
    var html = '<table><tr><th>防线</th><th>一次通过</th><th>修复后通过</th><th>最终失败</th><th>平均 Attempts</th></tr>';
    MODES.forEach(function (m) {
      var first = 0, repaired = 0, failed = 0, sum = 0;
      for (var i = 0; i < 100; i++) {
        var r = simulateOnce(m);
        sum += r.atts.length;
        if (r.ok && r.atts.length === 1) first++;
        else if (r.ok) repaired++;
        else failed++;
      }
      var fc = failed <= 3 ? 'good' : (failed <= 15 ? 'mid' : 'poor');
      html += '<tr><td>' + m.label + '</td><td class="num">' + first + '</td>' +
        '<td class="num">' + repaired + '</td>' +
        '<td class="num ' + fc + '">' + failed + '</td>' +
        '<td class="num">' + (sum / 100).toFixed(2) + '</td></tr>';
    });
    html += '</table>';
    $('stat').innerHTML = html;
    $('verdict').innerHTML = '📊 批量结果说明两件事：① 防线越靠前，<b>最终失败率</b>越低——把格式问题消灭在解码层，比事后修复便宜一个数量级；② 即便裸 Prompt 档，修复循环也能救回相当一部分——所以三件套是<b>组合拳</b>：Structured Output 尽量防、本地校验兜底查、修复重问负责救。';
  });

  $('reset').addEventListener('click', function () {
    $('log').innerHTML = '<pre>点「生成一次」开始。</pre>';
    $('stat').innerHTML = '<pre>点「批量模拟 100 次」开始。</pre>';
    $('verdict').innerHTML = '教学观察点：防线越靠前（解码层），一次通过率越高、修复成本越低；但无论哪一档，本地 Schema 校验都不能省——Provider 的承诺不可尽信。';
  });

  renderModes();
};
