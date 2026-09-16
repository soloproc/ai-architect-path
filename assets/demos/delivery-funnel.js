/* delivery-funnel —— POC→生产交付成熟度阶梯（卷07 §2/§5：每一级都有准入条件，跳级要付返工税）
 * 契约：注册到 window.DEMOS['delivery-funnel']，Shadow DOM，样式内联，无外部依赖。
 * 玩家扮演 FDE，把项目从 L0 演示Demo 一路推进到 L4 规模化运营：
 * 每次晋级前必须勾齐该级准入条件（对应正文四份交付物与工程纪律），条件不齐强行晋级
 * 会被打回：返工成本 +若干人日、客户信任度下降；信任跌破阈值项目终止。
 * 教学结论区实时解释"这一级到底在验证什么"，收尾给出成熟度与返工税的总账。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['delivery-funnel'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var LEVELS = [
    { name: 'L0 演示 Demo', goal: '证明"技术可行"——在精心准备的数据上跑通核心链路',
      reqs: [
        ['核心价值假设写成一句话且可证伪', '"早 8:30 前自动产出异常门店清单，准确率≥80%"——写不出这句话，后面全是白忙'],
        ['范围裁剪书面化（移出项 ≥3 条）', '移出范围项不书面化，两周后 PoC 一定膨胀成六周'],
        ['与客户书面确认 2 周时间盒与验收假设', '开工第一天就锚定"什么样算成了"，防止目标移动']
      ], rework: 4 },
    { name: 'L1 PoC', goal: '证明"价值真实"——在真实数据、真实提问上验证核心价值假设',
      reqs: [
        ['直连过一次真实源系统（哪怕一张表）', '导出表是清洗过的，脏数据的冰山只有直连才看得见'],
        ['评测集来自 ≥50 条真实提问（含方言/简称）', '演示集过拟合是"演示很好、生产很糟"的头号成因'],
        ['北极星业务指标已锚定（基线/目标/窗口）', '没有业务锚点，验收时必然陷入"我觉得还不够聪明"的扯皮']
      ], rework: 7 },
    { name: 'L2 试点', goal: '证明"能被真实使用"——小范围真实用户按日常工作流使用',
      reqs: [
        ['权限、审批与审计闭环上线', '客户安全团队不过审，一切免谈；这也是篇07 的交付形态'],
        ['评测门禁进 CI，Regression Set 冻结', '试点期每一次改动都要过门禁，否则质量在客户眼皮底下退化'],
        ['已向客户主动展示失败案例与能力边界', '期望值的棘轮：第一次演示越惊艳，之后每个"正常水平"都被视为退步'],
        ['隐性利益相关者已识别并安置', '"现在手工做这件事的人"可能是项目最隐蔽的反对者']
      ], rework: 10 },
    { name: 'L3 生产', goal: '证明"能承诺"——SLO 可承诺、事故可回滚、成本可解释',
      reqs: [
        ['SLA 与一键回滚演练完成（卷08 纪律）', '没在和平时期演练过的回滚，战争时期一定失败'],
        ['发布窗口与安全扫描（SBOM）合规', '客户变更窗口每月一次：发布包必须提前演练'],
        ['成本账本可解释（Token/推理费用归集）', '老板看到账单时你要答得出每一分钱换来了什么']
      ], rework: 14 },
    { name: 'L4 规模化运营', goal: '证明"可移交、可复制"——客户能自己运营，平台因你变强',
      reqs: [
        ['运营移交培训完成（告警/Prompt 变更/badcase 处理）', '移交培训完成 = 验收的一部分，不是验收后的善举'],
        ['≥3 项资产回流平台且过 Regression Gate', '没有资产回流，第十个客户和第一个客户一样难——FDE 退化为驻场外包'],
        ['复盘报告含资产表与下次交付成本预估', '本次 14 人日 → 下次 ≤9 人日，复利必须写进数字里'],
        ['量化验收窗口关闭（北极星指标复测）', '"上线后持续观察" = 项目永远无法关闭，尾款永远无法回收']
      ], rework: 18 }
  ];

  var state = { level: 0, checked: {}, rework: 0, trust: 100, over: false };

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:10px;}' +
    '.ladder{display:flex;gap:5px;margin:10px 0 4px;}' +
    '.lv{flex:1;text-align:center;font-size:11px;padding:7px 3px;border-radius:6px;border:1px solid #e7e5e4;background:#fafaf9;color:#a8a29e;font-weight:600;}' +
    '.lv.cur{background:#0f766e;border-color:#0f766e;color:#fff;}' +
    '.lv.done{background:#f0fdfa;border-color:#99d5cf;color:#115e59;}' +
    '.goal{font-size:12px;color:#57534e;background:#fafaf9;border-left:3px solid #0f766e;padding:7px 10px;border-radius:0 6px 6px 0;margin:8px 0;line-height:1.7;}' +
    'h4{margin:12px 0 6px;font-size:13px;font-weight:600;}' +
    '.req{display:flex;gap:8px;align-items:flex-start;font-size:12px;margin:6px 0;line-height:1.6;color:#44403c;}' +
    '.req input{margin-top:3px;accent-color:#0f766e;flex-shrink:0;}' +
    '.req .hint{color:#a8a29e;font-size:11px;}' +
    'button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.ghost{background:#fff;color:#0f766e;}' +
    'button:hover{opacity:.88;}' +
    'button:disabled{opacity:.4;cursor:not-allowed;}' +
    '.metrics{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 4px;}' +
    '.metric{flex:1;min-width:110px;background:#fafaf9;border:1px solid #e5e1d8;border-radius:6px;padding:8px 10px;}' +
    '.metric .k{font-size:11px;color:#78716c;}' +
    '.metric .v{font-size:18px;font-weight:600;color:#0f766e;font-variant-numeric:tabular-nums;}' +
    '.metric .v.warn{color:#d97706;}.metric .v.bad{color:#dc2626;}' +
    '.bar{height:14px;border:1px solid #e5e1d8;border-radius:7px;overflow:hidden;background:#fafaf9;margin:4px 0 2px;}' +
    '.fill{height:100%;background:#0f766e;transition:width .25s;}' +
    '.msg{margin-top:10px;font-size:12px;padding:9px 12px;border-radius:6px;line-height:1.7;display:none;}' +
    '.msg.ok{display:block;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;}' +
    '.msg.bad{display:block;background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#f0fdfa;border:1px solid #99d5cf;color:#115e59;line-height:1.75;}' +
    '.verdict.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b;}' +
    '.verdict.warn{background:#fffbeb;border-color:#fde68a;color:#92400e;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · POC→生产交付成熟度阶梯（卷07：每一级都在证明一件不同的事）</div>' +
    '  <div class="ladder" id="ladder"></div>' +
    '  <div class="goal" id="goal"></div>' +
    '  <h4>晋级准入条件（勾齐再申请——也可以试试强行闯关）</h4>' +
    '  <div id="reqs"></div>' +
    '  <div style="margin-top:10px"><button id="promote">申请晋级</button> <button id="reset" class="ghost">重开项目</button></div>' +
    '  <div class="msg" id="msg"></div>' +
    '  <div class="metrics">' +
    '    <div class="metric"><div class="k">当前成熟度</div><div class="v" id="mLv">L0</div></div>' +
    '    <div class="metric"><div class="k">返工税（人日）</div><div class="v warn" id="mRw">0</div></div>' +
    '    <div class="metric" style="flex:2"><div class="k">客户信任度</div>' +
    '      <div class="bar"><div class="fill" id="trustFill" style="width:100%"></div></div>' +
    '      <div class="v" id="mTrust" style="font-size:14px">100 / 100</div></div>' +
    '  </div>' +
    '  <div class="verdict" id="verdict">教学结论：试着一次条件都不勾就点「申请晋级」——感受"跳级"的代价。然后再老老实实一级级爬。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  function renderLadder() {
    $('ladder').innerHTML = '';
    LEVELS.forEach(function (lv, i) {
      var d = document.createElement('div');
      d.className = 'lv' + (i < state.level ? ' done' : (i === state.level ? ' cur' : ''));
      d.textContent = lv.name;
      $('ladder').appendChild(d);
    });
  }

  function renderReqs() {
    var lv = LEVELS[state.level];
    $('goal').innerHTML = '<b>' + lv.name + '</b> · 本级要证明：' + lv.goal;
    $('reqs').innerHTML = '';
    lv.reqs.forEach(function (r, i) {
      var key = state.level + '-' + i;
      var row = document.createElement('label');
      row.className = 'req';
      row.innerHTML = '<input type="checkbox" ' + (state.checked[key] ? 'checked' : '') + '> ' +
        '<span>' + r[0] + '<br><span class="hint">为什么必须：' + r[1] + '</span></span>';
      row.querySelector('input').addEventListener('change', function (e) {
        state.checked[key] = e.target.checked;
      });
      $('reqs').appendChild(row);
    });
  }

  function renderMeters() {
    $('mLv').textContent = 'L' + state.level;
    $('mRw').textContent = state.rework;
    $('mRw').className = 'v' + (state.rework >= 20 ? ' bad' : (state.rework > 0 ? ' warn' : ''));
    var t = Math.max(0, state.trust);
    $('mTrust').textContent = t + ' / 100';
    var fill = $('trustFill');
    fill.style.width = t + '%';
    fill.style.background = t <= 35 ? '#dc2626' : (t <= 65 ? '#d97706' : '#0f766e');
  }

  function verdict(final) {
    var v = $('verdict');
    if (state.over) {
      v.className = 'verdict bad';
      v.innerHTML = '💥 <b>项目终止：客户信任度耗尽。</b>累计返工 ' + state.rework + ' 人日。' +
        'FDE 现场最贵的成本不是人力，是信任——客户说"答错数字被我们抓包两次以上，信任崩了就回不来了"。' +
        '每一级准入条件都是用别人的学费写成的，跳级省下的时间，会以返工税和信任损失的形式连本带利收回来。';
      return;
    }
    if (final) {
      v.className = 'verdict';
      v.innerHTML = '🎉 <b>L4 达成：项目可移交、可复制。</b>总返工税 ' + state.rework + ' 人日，信任度 ' + Math.max(0, state.trust) + '。<br>' +
        '回看五级阶梯：L0 证明技术可行 → L1 证明价值真实 → L2 证明能被真实使用 → L3 证明能承诺 → L4 证明可移交可复制。' +
        '每一级验证的问题不同，"上一个级别的达标证据"永远替代不了下一级。这就是 POC→生产成熟度模型的全部要义。';
      return;
    }
    if (state.rework === 0 && state.level === 0) {
      v.className = 'verdict';
      v.textContent = '教学结论：试着一次条件都不勾就点「申请晋级」——感受"跳级"的代价。然后再老老实实一级级爬。';
    } else if (state.rework > 0) {
      v.className = 'verdict warn';
      v.innerHTML = '已缴纳返工税 <b>' + state.rework + '</b> 人日。注意信任度——它不像返工可以加回来：' +
        '每次"没准备好就汇报/演示"，客户对团队的判断就下一档。慢即是快：条件勾齐的晋级才是真的晋级。';
    } else {
      v.className = 'verdict';
      v.innerHTML = '✅ 零返工推进到 L' + state.level + '。保持这个纪律：每一级的准入条件，都是上一个项目用返工换来的 checklist。';
    }
  }

  $('promote').addEventListener('click', function () {
    if (state.over) return;
    var lv = LEVELS[state.level];
    var missing = 0;
    lv.reqs.forEach(function (r, i) { if (!state.checked[state.level + '-' + i]) missing++; });
    var msg = $('msg');
    if (missing === 0) {
      state.level++;
      if (state.level >= LEVELS.length) {
        renderLadder(); renderMeters();
        $('goal').innerHTML = '<b>项目收官</b>：全部成熟度等级达成。';
        $('reqs').innerHTML = '';
        $('promote').disabled = true;
        msg.className = 'msg ok';
        msg.innerHTML = '✅ 验收关闭：北极星指标复测达标，资产回流平台，尾款与信任双收。';
        verdict(true);
        return;
      }
      msg.className = 'msg ok';
      msg.innerHTML = '✅ 晋级成功：进入 <b>' + LEVELS[state.level].name + '</b>。本级要证明的不再是上一件事——看清新的准入条件再动手。';
      renderLadder(); renderReqs(); renderMeters(); verdict(false);
    } else {
      state.rework += lv.rework;
      state.trust -= 8 + missing * 4;
      msg.className = 'msg bad';
      msg.innerHTML = '🛑 <b>晋级被打回</b>：还有 ' + missing + ' 项准入条件未满足。客户评审会上被问住——返工 +' + lv.rework +
        ' 人日（级别越高返工越贵），信任度下降。补救动作：回到现场把 ' + missing + ' 项补齐，再约评审。';
      if (state.trust <= 0) { state.over = true; $('promote').disabled = true; }
      renderMeters(); verdict(false);
    }
  });

  $('reset').addEventListener('click', function () {
    state = { level: 0, checked: {}, rework: 0, trust: 100, over: false };
    $('promote').disabled = false;
    $('msg').className = 'msg'; $('msg').textContent = '';
    renderLadder(); renderReqs(); renderMeters(); verdict(false);
  });

  renderLadder(); renderReqs(); renderMeters(); verdict(false);
};
