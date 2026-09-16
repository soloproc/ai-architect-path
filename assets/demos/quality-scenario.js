/* quality-scenario —— 质量属性场景构建器（卷05 §3.2）
 * 契约：注册到 window.DEMOS['quality-scenario']，Shadow DOM，样式内联，无外部依赖。
 * 六个下拉框分别选择"刺激源/刺激/环境/制品/响应/响应度量"，
 * 拼出一条完整的质量属性场景句子；内置"加载满分示例"与"加载病句示例"；
 * 质量检查器按规则打分：六要素齐全、响应度量含数字与单位、无"较高/尽量"类模糊词；
 * 结论区给出逐条诊断，解释为什么"系统可用性要高"不是需求。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['quality-scenario'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var OPTS = {
    src: ['（选择刺激源）', '租户用户', '基础设施', '恶意调用方', '业务方（变更需求）', '外部依赖服务'],
    sti: ['（选择刺激）', '并发查询请求到达', '单个服务实例崩溃', '10 倍配额突发请求', '新增一种报表指标口径', '依赖服务延迟突增 5 倍'],
    env: ['（选择环境）', '正常运行', '晚高峰 3 倍日常流量', '大促 10 倍流量', '降级模式运行中'],
    art: ['（选择制品）', '订单查询接口', '库存扣减链路', '报表生成管线', '全平台接口', '推理服务'],
    res: ['（选择响应）', '正常返回结果', '自动摘除故障实例并转移流量', '限流拒绝并返回 429', '仅修改指标配置，不触及其他服务', '熔断打开并走兜底逻辑'],
    mea: ['（选择响应度量）', 'P99 ≤ 300ms，错误率 <0.1%',
          '用户侧错误率 30 秒内恢复至 <0.1%，无人工介入',
          '越限请求 100% 返回 429；其他租户 P99 劣化 <10%',
          '从需求到上线 ≤3 人日；不触发其他服务重新部署',
          'TTFT P95 < 2s，回退内容在 1s 内可见',
          '响应要快、可用性要高']
  };
  var GOOD = [1, 1, 2, 1, 1, 1];
  var BAD = [0, 0, 0, 0, 0, 6];
  var BANNED = ['较高', '尽量', '尽快', '要快', '要高', '友好', '较好', '高性能', '高可用'];
  var NAMES = ['刺激源', '刺激', '环境', '制品', '响应', '响应度量'];

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;}' +
    '@media(max-width:560px){.grid{grid-template-columns:1fr;}}' +
    '.f{display:flex;flex-direction:column;gap:2px;}' +
    '.f label{font-size:11px;color:#57534e;font-weight:600;}' +
    'select{border:1px solid #d6d3d1;border-radius:6px;padding:6px 8px;font-size:12px;' +
    'font-family:inherit;background:#fafaf9;color:#1c1917;}' +
    'select.miss{border-color:#dc2626;background:#fef2f2;}' +
    '.btns{display:flex;gap:8px;margin:12px 0 4px;flex-wrap:wrap;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;' +
    'padding:5px 12px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button:hover{opacity:.88;}' +
    '.card{margin-top:12px;padding:12px 14px;border-radius:8px;background:#fafaf9;' +
    'border:1px solid #e5e1d8;font-size:13.5px;line-height:2;}' +
    '.card b{color:#0f766e;}' +
    '.card .miss{color:#dc2626;font-weight:600;}' +
    '.score{display:flex;align-items:center;gap:10px;margin-top:10px;}' +
    '.bar{flex:1;height:10px;border:1px solid #e5e1d8;border-radius:5px;overflow:hidden;background:#f5f5f4;}' +
    '.fill{height:100%;background:#0f766e;transition:width .2s;}' +
    '.num{font-size:15px;font-weight:700;color:#0f766e;font-variant-numeric:tabular-nums;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;' +
    'background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.8;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.verdict ul{margin:6px 0 0;padding-left:18px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 质量属性场景构建器（卷05 §3.2：六要素，缺一不可）</div>' +
    '  <div class="grid">' +
    '    <div class="f"><label>① 刺激源（谁发起）</label><select id="s0"></select></div>' +
    '    <div class="f"><label>② 刺激（发生了什么）</label><select id="s1"></select></div>' +
    '    <div class="f"><label>③ 环境（系统处于什么状态）</label><select id="s2"></select></div>' +
    '    <div class="f"><label>④ 制品（作用在哪）</label><select id="s3"></select></div>' +
    '    <div class="f"><label>⑤ 响应（系统应如何表现）</label><select id="s4"></select></div>' +
    '    <div class="f"><label>⑥ 响应度量（怎么算达标）</label><select id="s5"></select></div>' +
    '  </div>' +
    '  <div class="btns">' +
    '    <button id="good" class="ghost">加载满分示例（PERF-01）</button>' +
    '    <button id="bad" class="ghost">加载病句示例</button>' +
    '    <button id="rand" class="ghost">随机组合一条</button>' +
    '    <button id="check">检查场景质量</button>' +
    '    <button id="copy" class="ghost">复制场景文本</button>' +
    '  </div>' +
    '  <div class="card" id="card">选择六要素后，这里会拼出完整场景句。</div>' +
    '  <div class="score"><div class="bar"><div class="fill" id="fill" style="width:0%"></div></div>' +
    '    <span class="num" id="scoreNum">–</span></div>' +
    '  <div class="verdict" id="verdict">提示：先点「加载病句示例」跑一次检查，看看一条"愿望式需求"会得多少分。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };
  var sels = [];

  function fill() {
    ['src', 'sti', 'env', 'art', 'res', 'mea'].forEach(function (k, i) {
      var sel = $('s' + i);
      OPTS[k].forEach(function (t, j) {
        var o = document.createElement('option');
        o.value = j; o.textContent = t;
        sel.appendChild(o);
      });
      sel.addEventListener('change', compose);
      sels.push(sel);
    });
  }

  function vals() {
    return sels.map(function (s, i) {
      var v = parseInt(s.value, 10);
      return v > 0 ? OPTS[['src', 'sti', 'env', 'art', 'res', 'mea'][i]][v] : null;
    });
  }

  function compose() {
    var v = vals();
    var parts = [];
    for (var i = 0; i < 6; i++) {
      parts.push(v[i] ? '<b>' + v[i] + '</b>' : '<span class="miss">【缺：' + NAMES[i] + '】</span>');
      sels[i].className = v[i] ? '' : 'miss';
    }
    $('card').innerHTML =
      '当 <b>' + (v[0] || '？') + '</b> 在 <b>' + (v[2] || '？') + '</b> 下对 <b>' + (v[3] || '？') +
      '</b> 施加「' + (v[1] || '？') + '」时，系统应当 <b>' + (v[4] || '？') + '</b>，' +
      '且满足：<b>' + (v[5] || '？') + '</b>。';
    $('fill').style.width = '0%';
    $('scoreNum').textContent = '–';
  }

  function check() {
    var v = vals();
    var issues = [], score = 0;
    for (var i = 0; i < 6; i++) {
      if (v[i]) score += 12;
      else issues.push('缺少要素「' + NAMES[i] + '」——六要素缺一个，这条"需求"就无法设计、无法测试、无法评审。');
    }
    var mea = v[5] || '';
    if (mea) {
      if (/\d/.test(mea)) score += 14;
      else issues.push('响应度量没有任何数字——没有数字的度量是愿望不是指标。');
      var banned = BANNED.filter(function (w) { return mea.indexOf(w) >= 0; });
      if (banned.length > 0) {
        score = Math.max(0, score - 30);
        issues.push('响应度量含模糊词「' + banned.join('」「') + '」——评审人无法挑战"较高"，测试无法验证"尽量"。' +
          '把形容词换成"数字 + 单位 + 统计口径"（如 P99 ≤ 300ms）。');
      }
      if (/\d/.test(mea) && banned.length === 0 && mea.indexOf('率') < 0 && mea.indexOf('内') < 0
          && mea.indexOf('≤') < 0 && mea.indexOf('<') < 0) {
        issues.push('度量建议补充统计口径（分位点 / 时间窗 / 成功率），单点数字容易被钻空子。');
        score = Math.min(score, 85);
      }
    }
    // 进阶启发式：故障类刺激只写"正常运行"环境，漏掉了最严苛的场景
    if (v[1] && v[2] && (v[1].indexOf('崩溃') >= 0 || v[1].indexOf('突增') >= 0)
        && v[2] === '正常运行') {
      issues.push('故障类刺激的环境是「正常运行」——建议再写一条高峰变体：' +
        '同一个故障在 10 倍流量下的响应度量往往完全不同（恢复时间更长、影响面更大）。');
      score = Math.min(score, 90);
    }
    score = Math.min(100, score);
    $('fill').style.width = score + '%';
    $('fill').style.background = score >= 85 ? '#0f766e' : (score >= 50 ? '#d97706' : '#dc2626');
    $('scoreNum').textContent = score + ' 分';
    $('scoreNum').style.color = score >= 85 ? '#0f766e' : (score >= 50 ? '#d97706' : '#dc2626');

    var el = $('verdict');
    if (issues.length === 0) {
      el.className = 'verdict';
      el.innerHTML = '✅ 合格场景！它已经可以直接进入三样东西：<b>设计</b>（选配什么战术兑现）、' +
        '<b>测试</b>（按度量写验证用例）、<b>评审</b>（评审人逐要素挑战）。' +
        '把它写进架构文档的质量属性场景清单，并配上一条混沌实验或压测来兑现。';
    } else {
      el.className = 'verdict bad';
      el.innerHTML = '❌ 还不能进文档：<ul><li>' + issues.join('</li><li>') + '</li></ul>' +
        '对照卷05 §3.2 的反例："系统可用性要高"在这条检查器里只能得 0 分——它缺了全部六个要素。';
    }
  }

  $('good').addEventListener('click', function () {
    GOOD.forEach(function (j, i) { sels[i].value = j; });
    compose();
    $('verdict').className = 'verdict';
    $('verdict').textContent = '已加载卷05 §10.4 的 PERF-01。点「检查场景质量」验证它能拿满分，然后随便改掉一个要素再检查一次。';
  });
  $('bad').addEventListener('click', function () {
    BAD.forEach(function (j, i) { sels[i].value = j; });
    compose();
    $('verdict').className = 'verdict';
    $('verdict').textContent = '已加载一条典型病句（只有一句模糊的度量，其余要素全缺）。点「检查场景质量」看诊断。';
  });
  $('rand').addEventListener('click', function () {
    // 随机组合：每个要素在有效选项里随机取一条，立刻检查。
    // 用来快速刷出"看似像样实则漏项"的组合，训练识别力。
    for (var i = 0; i < 6; i++) {
      var key = ['src', 'sti', 'env', 'art', 'res', 'mea'][i];
      var n = OPTS[key].length;
      sels[i].value = 1 + Math.floor(Math.random() * (n - 1));
    }
    compose();
    check();
  });
  $('copy').addEventListener('click', function () {
    // 把当前场景导出为纯文本，方便粘贴进架构文档的质量属性场景清单。
    var v = vals();
    var text = '刺激源：' + (v[0] || '（缺）') + '；刺激：' + (v[1] || '（缺）') +
      '；环境：' + (v[2] || '（缺）') + '；制品：' + (v[3] || '（缺）') +
      '；响应：' + (v[4] || '（缺）') + '；响应度量：' + (v[5] || '（缺）');
    var done = function () {
      $('verdict').className = 'verdict';
      $('verdict').textContent = '已复制到剪贴板，可直接粘贴进架构文档（六要素分号格式，与卷05 §10.4 表格一致）：' + text;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        $('verdict').className = 'verdict';
        $('verdict').textContent = '复制被浏览器拦截，场景文本如下，请手动复制：' + text;
      });
    } else {
      $('verdict').className = 'verdict';
      $('verdict').textContent = '当前环境不支持自动复制，场景文本如下，请手动复制：' + text;
    }
  });
  $('check').addEventListener('click', check);

  fill();
  compose();
};
