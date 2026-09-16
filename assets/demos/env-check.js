/* env-check —— 开发环境自检清单（篇00 §2.3）
 * 契约：注册到 window.DEMOS['env-check']，Shadow DOM，样式内联，无外部依赖。
 * 8 项环境体检：逐项打勾 + 每项附验证命令（可一键复制）；
 * 顶部进度条显示完成度；全部通过给出"环境数据流一句话总结"教学结论；
 * 未完成时列出剩余短板与最常见卡点提示。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['env-check'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var ITEMS = [
    { id: 'py', name: 'Python 3.11+ 可用', cmd: 'python3 --version',
      why: '解释器是整条链路的第一环。版本低于 3.11 时，部分新语法（如更简洁的类型标注）不可用，本教程代码均按 3.11+ 编写。',
      pass: '输出 Python 3.11.x 或更高。Windows 上若 python3 不存在，试 python --version。' },
    { id: 'venv', name: '虚拟环境已创建', cmd: 'ls .venv',
      why: '虚拟环境给项目圈独立领地，装包互不打架。没有它，多项目共存迟早互相污染。',
      pass: '能列出 bin、lib 等目录即存在；没有则用 uv venv 或 python3 -m venv .venv 创建。' },
    { id: 'act', name: '虚拟环境已激活', cmd: 'echo $VIRTUAL_ENV',
      why: '激活 = 把 .venv/bin 加到 PATH 最前面。不激活就装包/运行，等于用错了解释器——这是新手第一大坑。',
      pass: '输出 .venv 的路径；为空则在项目目录执行 source .venv/bin/activate（Win: .venv\\Scripts\\activate）。' },
    { id: 'pip', name: 'pip 指向当前环境', cmd: 'python -m pip --version',
      why: 'pip 是"某个解释器名下"的包管理器。用 python -m pip 可以 100% 确认包装到当前环境，而不是系统 Python。',
      pass: '输出路径里包含你的项目目录和 .venv，而不是 /usr/lib 之类的系统路径。' },
    { id: 'pkg', name: 'openai / httpx 可导入', cmd: 'python -c "import openai, httpx; print(\'OK\')"',
      why: '包是被装到"某个解释器"名下的。装错了解释器，import 时就 ModuleNotFoundError。',
      pass: '输出 OK。报 ModuleNotFoundError 说明装到了别的环境：激活后用 python -m pip install openai httpx 重装。' },
    { id: 'git', name: 'Git 可用且仓库已初始化', cmd: 'git --version && git status',
      why: 'Git 是代码的时间机器。每次 Demo 跑通立刻 commit，改崩了能一键回到能跑的版本。',
      pass: 'git status 不报 "not a git repository"；没初始化就在项目目录 git init，并建 .gitignore 写入 .venv/ 与 .env。' },
    { id: 'key', name: 'API Key 走环境变量（未硬编码）', cmd: 'echo $DEEPSEEK_API_KEY',
      why: '密钥写进代码并提交 = 泄露且难以撤回（Git 历史里还在）。环境变量是密钥的最低安全标准。',
      pass: '输出 sk- 开头的值。为空则在当前终端 export DEEPSEEK_API_KEY="sk-..."（Win PowerShell: $env:DEEPSEEK_API_KEY="..."）。' },
    { id: 'hello', name: '能跑通一个 .py 文件', cmd: 'python hello.py',
      why: '编辑器 → 终端 → 解释器 → 包，四环全通才算环境就绪。前面 7 项都是零件，这一项是总装测试。',
      pass: '新建 hello.py 写入 print("环境 OK")，运行后输出 环境 OK。' }
  ];

  var state = {};
  ITEMS.forEach(function (it) { state[it.id] = false; });

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#fff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:12px;}' +
    '.bar{height:16px;border:1px solid #e5e1d8;border-radius:8px;overflow:hidden;background:#fafaf9;margin:6px 0 4px;}' +
    '.fill{height:100%;background:#0f766e;transition:width .25s;width:0%;}' +
    '.barlabel{font-size:11px;color:#57534e;display:flex;justify-content:space-between;margin-bottom:10px;}' +
    '.item{border:1px solid #e7e5e4;border-radius:6px;margin-bottom:8px;overflow:hidden;}' +
    '.item.done{border-color:#99d5cf;background:#f0fdfa;}' +
    '.head{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;user-select:none;}' +
    '.head:hover{background:#fafaf9;}' +
    '.head .n{font-size:11px;color:#a8a29e;width:18px;flex:none;}' +
    '.head .nm{font-size:13px;font-weight:600;flex:1;}' +
    '.head .st{font-size:11px;color:#78716c;flex:none;}' +
    '.item.done .head .st{color:#0f766e;}' +
    'input[type=checkbox]{accent-color:#0f766e;width:15px;height:15px;flex:none;}' +
    '.body{display:none;padding:0 12px 10px 45px;font-size:12px;line-height:1.7;color:#44403c;}' +
    '.item.open .body{display:block;}' +
    '.why{margin:2px 0 6px;}' +
    '.cmdrow{display:flex;gap:6px;align-items:center;margin:4px 0;}' +
    'code.cmd{flex:1;background:#1c1917;color:#e7e5e4;border-radius:4px;padding:5px 8px;font-size:11px;overflow-x:auto;white-space:nowrap;}' +
    'button.cp{border:1px solid #0f766e;background:#fff;color:#0f766e;border-radius:5px;padding:4px 9px;font-size:11px;cursor:pointer;font-family:inherit;flex:none;}' +
    'button.cp:hover{background:#0f766e;color:#fff;}' +
    '.passline{font-size:11px;color:#57534e;background:#fafaf9;border-left:3px solid #99d5cf;padding:5px 8px;border-radius:0 4px 4px 0;margin-top:4px;}' +
    '.verdict{margin-top:12px;font-size:13px;padding:10px 12px;border-radius:6px;background:#fffbeb;border:1px solid #fcd34d;color:#92400e;line-height:1.8;}' +
    '.verdict.ok{background:#f0fdfa;border-color:#99d5cf;color:#115e59;}' +
    '.verdict b{white-space:nowrap;}' +
    '.missing{font-size:12px;margin:6px 0 0 18px;padding:0;color:#92400e;}' +
    '.verdict.ok .missing{color:#115e59;}' +
    '.btns{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;}' +
    'button.act{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;}' +
    'button.act.ghost{background:#fff;color:#0f766e;}' +
    'button.act:hover{opacity:.88;}' +
    '.note{font-size:11px;color:#a8a29e;margin-top:8px;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">交互 Demo · 开发环境自检清单（篇00 §2：8 项体检全过才算环境就绪）</div>' +
    '  <div class="bar"><div class="fill" id="fill"></div></div>' +
    '  <div class="barlabel"><span id="prog">0 / 8 项通过</span><span>点击任意项可展开"为什么 + 验证命令"</span></div>' +
    '  <div id="list"></div>' +
    '  <div class="btns">' +
    '    <button class="act" id="expandAll">全部展开</button>' +
    '    <button class="act ghost" id="reset">清空重查</button>' +
    '  </div>' +
    '  <div class="verdict" id="verdict"></div>' +
    '  <div class="note">本清单不会真的访问你的终端——它的作用是给你一张"体检表 + 每项的验证命令"。请在真实终端逐项执行，通过后再回来打勾。</div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };

  var listEl = $('list');
  var openState = {};

  ITEMS.forEach(function (it, idx) {
    var div = document.createElement('div');
    div.className = 'item';
    div.innerHTML =
      '<div class="head">' +
      '  <span class="n">' + (idx + 1) + '</span>' +
      '  <input type="checkbox" id="cb-' + it.id + '">' +
      '  <span class="nm">' + it.name + '</span>' +
      '  <span class="st">未验证</span>' +
      '</div>' +
      '<div class="body">' +
      '  <div class="why"><b>为什么要查：</b>' + it.why + '</div>' +
      '  <div class="cmdrow"><code class="cmd">' + it.cmd.replace(/</g, '&lt;') + '</code>' +
      '    <button class="cp" data-cmd="' + it.id + '">复制命令</button></div>' +
      '  <div class="passline"><b>通过标志：</b>' + it.pass + '</div>' +
      '</div>';
    listEl.appendChild(div);

    var head = div.querySelector('.head');
    head.addEventListener('click', function (e) {
      if (e.target.type === 'checkbox') return;
      openState[it.id] = !openState[it.id];
      div.classList.toggle('open', !!openState[it.id]);
    });
    var cb = div.querySelector('#cb-' + it.id);
    cb.addEventListener('change', function () {
      state[it.id] = cb.checked;
      div.classList.toggle('done', cb.checked);
      div.querySelector('.st').textContent = cb.checked ? '✓ 已通过' : '未验证';
      render();
    });
  });

  listEl.addEventListener('click', function (e) {
    var id = e.target.getAttribute && e.target.getAttribute('data-cmd');
    if (!id) return;
    var item = null;
    for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === id) item = ITEMS[i];
    if (!item) return;
    var done = function () {
      e.target.textContent = '已复制 ✓';
      setTimeout(function () { e.target.textContent = '复制命令'; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(item.cmd).then(done, done);
    } else { done(); }
  });

  $('expandAll').addEventListener('click', function () {
    var anyClosed = false;
    ITEMS.forEach(function (it) { if (!openState[it.id]) anyClosed = true; });
    ITEMS.forEach(function (it, idx) {
      openState[it.id] = anyClosed;
      listEl.children[idx].classList.toggle('open', anyClosed);
    });
    $('expandAll').textContent = anyClosed ? '全部收起' : '全部展开';
  });

  $('reset').addEventListener('click', function () {
    ITEMS.forEach(function (it, idx) {
      state[it.id] = false;
      var div = listEl.children[idx];
      div.classList.remove('done');
      div.querySelector('#cb-' + it.id).checked = false;
      div.querySelector('.st').textContent = '未验证';
    });
    render();
  });

  function render() {
    var doneCount = 0, missing = [];
    ITEMS.forEach(function (it, idx) {
      if (state[it.id]) doneCount++;
      else missing.push((idx + 1) + '. ' + it.name);
    });
    var pct = Math.round(doneCount / ITEMS.length * 100);
    $('fill').style.width = pct + '%';
    $('fill').style.background = pct === 100 ? '#0f766e' : (pct >= 50 ? '#0f766e' : '#d97706');
    $('prog').textContent = doneCount + ' / ' + ITEMS.length + ' 项通过（' + pct + '%）';

    var v = $('verdict');
    if (doneCount === ITEMS.length) {
      v.className = 'verdict ok';
      v.innerHTML = '✅ <b>环境就绪，可以进入第 3 节。</b><br>' +
        '用一句话总结你刚验证的整条数据流：<b>你写的代码 → VS Code → 终端命令 → 当前虚拟环境的解释器 → 该环境专属的包仓库 → 运行结果</b>。' +
        '以后每次报错，先问自己站在哪一环——八成的环境问题都能这样自己定位。' +
        '最后一道保险：现在就 <b>git init + 第一次 commit</b>，让"能跑的环境"也有快照。';
    } else if (doneCount === 0) {
      v.className = 'verdict';
      v.innerHTML = '⚠️ 从第 1 项开始，按顺序体检。<b>顺序是有讲究的</b>：解释器 → 虚拟环境 → 激活 → pip → 包 → Git → 密钥 → 总装测试，前一项不通过，后一项的结果都不可信。';
    } else {
      v.className = 'verdict';
      var html = '⚠️ 还剩 <b>' + (ITEMS.length - doneCount) + '</b> 项未通过：' +
        '<ul class="missing">' +
        missing.map(function (m) { return '<li>' + m + '</li>'; }).join('') +
        '</ul>';
      if (!state['key'] && doneCount >= ITEMS.length - 1) {
        html += '<br>🔑 <b>最常见短板就是最后一项 API Key</b>：它能跑通时一切正常，一旦换终端窗口、换机器、开 CI，' +
          '"key 不存在 / 401"就会突然出现——把密钥放进环境变量（或 .env + .gitignore），是给未来的自己省一次深夜排错。';
      } else if (!state['act'] || !state['pip']) {
        html += '<br>💡 卡在虚拟环境相关项时，九成是"激活了 A 窗口、在 B 窗口运行"——环境变量只在当前窗口生效。';
      }
      v.innerHTML = html;
    }
  }

  render();
};
