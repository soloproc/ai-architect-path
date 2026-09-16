/* prompt-compare —— 提示词质量对比实验（篇02 §3 术）
 * 契约：注册到 window.DEMOS['prompt-compare']，Shadow DOM，样式内联，无外部依赖。
 * 同一个需求的三档提示词（烂/普通/五段式）并排切换；
 * 展示五段式结构覆盖率（角色/目标/约束/格式/示例）与预期产出差异；
 * 底部"诊断模式"：给自己的真实提示词逐段打分，输出结构缺口与改进建议。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['prompt-compare'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var SEGS = ['角色', '目标', '约束', '格式', '示例'];

  var LEVELS = [
    { key: 'bad', name: '烂提示词',
      prompt: '帮我写个查询 GMV 的函数。',
      cover: [0, 1, 0, 0, 0],
      risks: [
        'AI 不知道用什么语言/框架——自由发挥，八成和你的技术栈不符',
        '不知道库表结构——幻觉出表名和字段名',
        '没有验收标准——你无法判断它做得对不对，只能"看着行"',
        '多租户隔离？没提就是没有—— tenant_id 过滤大概率缺席'
      ] },
    { key: 'mid', name: '普通提示词',
      prompt: '用 Python 为 orders 表写一个查询函数，按租户和日期范围统计 GMV（订单金额求和），只统计已完成订单，用参数化查询。',
      cover: [0, 1, 1, 0, 0],
      risks: [
        '目标和约束有了，主路径通常能对',
        '但返回什么结构没说——每次给的格式都不一样，没法接进代码',
        '没有仓库里的参考风格——命名、异常处理和项目不一致',
        '没有边界说明——空日期、跨月、时区问题随缘处理'
      ] },
    { key: 'good', name: '五段式提示词',
      prompt: '【角色】你是资深数据工程师，熟悉零售 SaaS 多租户架构。\n【目标】为 orders 表写按租户+日期范围查 GMV 的函数。\n【约束】只读；必须带 tenant_id 过滤；禁止 SELECT *；参数化查询；只统计"已完成"状态。\n【格式】返回：Python 函数 + SQL + 三条边界测试用例；不要解释原理。\n【示例】参考 query_orders(status) 的风格：<20 行参考代码>',
      cover: [1, 1, 1, 1, 1],
      risks: [
        '角色激活相关分布：命名、异常处理自然贴近数据工程惯例',
        '负面约束（禁止 SELECT *）直接压缩不合规输出的概率空间',
        '格式=提前写进请求的验收标准，产出可直接集成',
        '示例调用 ICL：20 行参考胜过长篇"请保持代码风格"'
      ] }
  ];

  var DIAG_QUESTIONS = [
    '有没有写明角色/领域背景？',
    '目标是否一句话说清"做成什么样"？',
    '有没有约束（尤其"不许做什么"）？',
    '有没有指定输出格式/结构？',
    '有没有给参考示例或现有代码风格？'
  ];

  var state = { level: 2, diag: [false, false, false, false, false] };

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    '.tabs{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;}' +
    '.tab{border:1px solid #d6d3d1;background:#fafaf9;color:#57534e;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    '.tab.on{border-color:#0f766e;background:#0f766e;color:#fff;font-weight:600;}' +
    'h4{margin:12px 0 6px;font-size:13px;color:#1c1917;font-weight:600;}' +
    '.promptbox{background:#1c1917;color:#e7e5e4;border-radius:6px;padding:10px 12px;font-size:12px;line-height:1.8;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}' +
    '.segs{display:flex;flex-direction:column;gap:5px;margin:8px 0;}' +
    '.segrow{display:flex;align-items:center;gap:8px;font-size:12px;}' +
    '.segrow .nm{width:34px;color:#57534e;flex:none;}' +
    '.segbar{flex:1;height:14px;background:#f5f5f4;border:1px solid #e7e5e4;border-radius:7px;overflow:hidden;}' +
    '.segfill{height:100%;background:#0f766e;transition:width .25s;}' +
    '.segfill.off{background:#e7e5e4;}' +
    '.segst{width:56px;font-size:11px;color:#78716c;flex:none;}' +
    'ul.risks{margin:6px 0 0 18px;padding:0;font-size:12px;line-height:1.9;color:#44403c;}' +
    'ul.risks li::marker{color:#d97706;}' +
    '.good li::marker{color:#0f766e;}' +
    '.diag{border-top:1px dashed #d6d3d1;margin-top:14px;padding-top:10px;}' +
    '.q{display:flex;align-items:center;gap:8px;font-size:12px;color:#44403c;margin:5px 0;}' +
    'input[type=checkbox]{accent-color:#0f766e;width:15px;height:15px;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.8;}' +
    '.verdict.warn{background:#fffbeb;border-color:#fcd34d;color:#92400e;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 提示词质量对比（篇02 §3：五段式——同一思想在单次任务尺度的应用）</div>' +
    '  <div class="tabs" id="tabs"></div>' +
    '  <h4>① 提示词原文</h4>' +
    '  <div class="promptbox" id="pbox"></div>' +
    '  <h4>② 五段式结构覆盖率</h4>' +
    '  <div class="segs" id="segs"></div>' +
    '  <h4>③ 预期产出差异</h4>' +
    '  <ul class="risks" id="risks"></ul>' +
    '  <div class="diag">' +
    '    <h4 style="margin-top:4px">④ 诊断模式：给你自己的一条提示词打分</h4>' +
    '    <div id="diagQs"></div>' +
    '  </div>' +
    '  <div class="verdict" id="verdict"></div>' +
    '  <div class="note">教学简化：结构覆盖 ≠ 质量保证（SPEC、上下文、验证共同决定最终质量），但结构缺口几乎必然对应一类确定的翻车模式。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  var tabsEl = $('tabs');
  LEVELS.forEach(function (lv, i) {
    var b = document.createElement('button');
    b.className = 'tab';
    b.textContent = lv.name;
    b.addEventListener('click', function () { state.level = i; renderCompare(); });
    tabsEl.appendChild(b);
  });

  var qsEl = $('diagQs');
  DIAG_QUESTIONS.forEach(function (q, i) {
    var div = document.createElement('div');
    div.className = 'q';
    div.innerHTML = '<input type="checkbox" id="dq' + i + '"><label for="dq' + i + '">' +
      SEGS[i] + '：' + q + '</label>';
    qsEl.appendChild(div);
    div.querySelector('#dq' + i).addEventListener('change', function (e) {
      state.diag[i] = e.target.checked;
      renderVerdict();
    });
  });

  function renderCompare() {
    var lv = LEVELS[state.level];
    for (var i = 0; i < tabsEl.children.length; i++) {
      tabsEl.children[i].classList.toggle('on', i === state.level);
    }
    $('pbox').textContent = lv.prompt;
    var segsEl = $('segs');
    segsEl.innerHTML = '';
    var covered = 0;
    SEGS.forEach(function (s, i) {
      if (lv.cover[i]) covered++;
      var row = document.createElement('div');
      row.className = 'segrow';
      row.innerHTML = '<span class="nm">' + s + '</span>' +
        '<div class="segbar"><div class="segfill' + (lv.cover[i] ? '' : ' off') +
        '" style="width:' + (lv.cover[i] ? 100 : 100) + '%"></div></div>' +
        '<span class="segst">' + (lv.cover[i] ? '✓ 有' : '✗ 缺失') + '</span>';
      segsEl.appendChild(row);
    });
    var risksEl = $('risks');
    risksEl.className = 'risks' + (lv.key === 'good' ? ' good' : '');
    risksEl.innerHTML = lv.risks.map(function (r) { return '<li>' + r + '</li>'; }).join('');
    renderVerdict();
  }

  function renderVerdict() {
    var lv = LEVELS[state.level];
    var covered = 0;
    lv.cover.forEach(function (c) { covered += c; });
    var v = $('verdict');

    var diagCount = 0, missing = [];
    state.diag.forEach(function (d, i) {
      if (d) diagCount++;
      else missing.push(SEGS[i]);
    });
    var anyDiag = false;
    state.diag.forEach(function (d) { if (d) anyDiag = true; });

    var lines = [];
    lines.push('当前档位「' + lv.name + '」结构覆盖 <b>' + covered + '/5</b>。');
    if (lv.key === 'bad') {
      lines.push('一句话需求 = 把目标、约束、验收三类不确定性全部留给模型自由发挥——这不是在用人，是在抽签。');
    } else if (lv.key === 'mid') {
      lines.push('主路径够用，但"格式"和"示例"的缺失意味着：产出无法直接集成、风格不可预期——返工就藏在这两段里。');
    } else {
      lines.push('五段齐全后，剩下的质量变量就移交给了上下文（CE）与验证（Independent Verification）——这正是"法"的流水线要接管的部分。');
    }

    if (anyDiag) {
      if (diagCount === 5) {
        v.className = 'verdict';
        lines.push('🎯 你的提示词五段齐全。下一个杠杆：<b>示例的质量</b>——3~5 个覆盖边界的示例胜过长篇规则（ICL 是最高杠杆的 Prompt 资产）。');
      } else {
        v.className = diagCount >= 3 ? 'verdict warn' : 'verdict bad';
        lines.push('🔍 你的提示词缺 <b>' + missing.join('、') + '</b>。优先补「' +
          (missing.indexOf('约束') >= 0 ? '约束' : missing[0]) +
          '」——负面约束（不许做什么）通常是单条改动收益最大的一段。');
      }
    } else {
      v.className = 'verdict';
      lines.push('👆 在「诊断模式」里勾一勾你最近发的一条真实提示词覆盖了哪几段，看看缺口在哪。');
    }
    lines.push('思考题：为什么「示例」比「约束」更难写、杠杆却更高？——因为约束只能"排除错的"，示例能直接"演示对的"；模型对演示的学习（ICL）比对规则描述敏感得多。');
    v.innerHTML = lines.join('<br>');
  }

  renderCompare();
};
