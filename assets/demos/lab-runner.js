/* lab-runner —— 里程碑「在线运行」通用组件（浏览器内 Pyodide，无需安装）
 *
 * 用法：window.LABRUNNER(container, config)
 *   config = { title, subtitle, code, expected }
 *     title    展开条与面板标题（如 "M1 · GMV 口径汇总"）
 *     subtitle 面板顶部说明（可选）
 *     code     预填进编辑区的「在线逻辑版」Python 代码（仅标准库）
 *     expected CDN 不可用时的降级展示输出（本地实跑的真实结果）
 *
 * 行为：
 *   - 默认折叠为一条展开条，点击展开编辑区 + 运行按钮 + 深色输出区
 *   - Pyodide 懒加载（jsdelivr CDN v0.26.4），首次运行才下载
 *   - CDN 失败 → 优雅降级：显示「在线运行暂时不可用」+ expected 预计算输出
 * 风格对齐 assets/demos/python-runner.js（Shadow DOM / 中文 UI / 站点色系）
 */
window.LABRUNNER = function (container, config) {
  var shadow = container.attachShadow({ mode: 'open' });

  var PYODIDE_VER = 'v0.26.4';
  var PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/' + PYODIDE_VER + '/full/';

  var title = config.title || '里程碑实战';
  var subtitle = config.subtitle ||
    '代码可直接编辑。首次运行需从 CDN 下载 Pyodide 运行时（约 10MB+，仅首次，之后由浏览器缓存）。';
  var DEFAULT_CODE = config.code || '';
  var EXPECTED = config.expected || '';

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.bar-toggle{width:100%;box-sizing:border-box;text-align:left;background:#fffdf9;border:1px solid #e5e1d8;border-radius:8px;padding:11px 14px;font-size:13px;color:#0f766e;cursor:pointer;font-weight:600;}' +
    '.bar-toggle:hover{background:#f0fdfa;border-color:#99d5cf;}' +
    '.wrap{display:none;background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.wrap.open{display:block;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:4px;}' +
    '.subtitle{font-size:11px;color:#a8a29e;margin-bottom:12px;}' +
    'textarea{width:100%;box-sizing:border-box;height:320px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;border:1px solid #e5e1d8;border-radius:6px;padding:10px;resize:vertical;background:#fafaf9;color:#1c1917;tab-size:4;}' +
    '.bar{display:flex;align-items:center;gap:10px;margin:10px 0;flex-wrap:wrap;}' +
    'button{background:#0f766e;color:#fff;border:none;border-radius:6px;padding:7px 16px;font-size:13px;cursor:pointer;}' +
    'button:hover:not(:disabled){background:#115e59;}' +
    'button:disabled{background:#a8a29e;cursor:not-allowed;}' +
    'button.ghost{background:#fff;color:#0f766e;border:1px solid #0f766e;}' +
    '.status{font-size:12px;color:#57534e;}' +
    '.progress{flex:1;min-width:120px;height:6px;background:#e7e5e4;border-radius:3px;overflow:hidden;display:none;}' +
    '.progress>div{height:100%;width:30%;background:#0f766e;border-radius:3px;animation:slide 1.2s ease-in-out infinite;}' +
    '@keyframes slide{0%{margin-left:-30%}100%{margin-left:100%}}' +
    '.out{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;background:#1c1917;color:#e7e5e4;border-radius:6px;padding:10px 12px;min-height:120px;white-space:pre-wrap;word-break:break-all;max-height:380px;overflow-y:auto;}' +
    '.out .err{color:#fca5a5;}' +
    '.out .sys{color:#99d5cf;}' +
    '.badge{display:inline-block;font-size:10px;border-radius:4px;padding:1px 6px;margin-left:6px;vertical-align:1px;}' +
    '.b-ok{background:#f0fdfa;color:#0f766e;border:1px solid #99d5cf;}' +
    '.b-fallback{background:#fffbeb;color:#b45309;border:1px solid #fde68a;}' +
    '</style>' +
    '<button class="bar-toggle" id="toggle">▶ 在线运行：' + title + '（浏览器内运行，无需安装）</button>' +
    '<div class="wrap" id="wrap">' +
    '  <div class="title">在线运行 Python · ' + title + '<span id="badge"></span></div>' +
    '  <div class="subtitle" id="subtitle"></div>' +
    '  <textarea id="code" spellcheck="false"></textarea>' +
    '  <div class="bar">' +
    '    <button id="run">▶ 运行</button>' +
    '    <button id="restore" class="ghost">还原示例代码</button>' +
    '    <button id="collapse" class="ghost">收起</button>' +
    '    <div class="progress" id="prog"><div></div></div>' +
    '    <span class="status" id="status">点「运行」执行代码；首次会先自动下载 Python 运行时。</span>' +
    '  </div>' +
    '  <div class="out" id="out"><span class="sys">输出面板：运行后 stdout / stderr 显示在这里。</span></div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };
  $('subtitle').textContent = subtitle;
  $('code').value = DEFAULT_CODE;

  var pyodide = null;
  var booting = false;
  var failed = false;

  function setStatus(t) { $('status').textContent = t; }
  function setBadge(cls, text) {
    $('badge').innerHTML = text ? '<span class="badge ' + cls + '">' + text + '</span>' : '';
  }
  function printOut(text, cls) {
    var out = $('out');
    var span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    out.appendChild(span);
    out.scrollTop = out.scrollHeight;
  }
  function clearOut() { $('out').innerHTML = ''; }

  /* CDN 失败 → 降级为预计算输出（本地实跑的真实结果） */
  function fallback(reason) {
    failed = true;
    $('prog').style.display = 'none';
    $('run').disabled = true;
    setBadge('b-fallback', '离线演示模式');
    setStatus('在线运行暂时不可用（' + reason + '）。已降级为预计算输出展示。');
    clearOut();
    printOut('[降级模式] 在线运行暂时不可用：无法从 CDN 加载 Python 运行时（' + reason + '）。\n' +
      '以下是这段代码在本地 Python 3 实跑的真实输出，与在线执行一致：\n\n', 'sys');
    printOut(EXPECTED + '\n');
  }

  function boot(thenRun) {
    if (pyodide) { if (thenRun) run(); return; }
    if (failed || booting) return;
    booting = true;
    $('run').disabled = true;
    $('prog').style.display = 'block';
    setStatus('正在下载 Pyodide 运行时（约 10MB+，仅首次）…');

    var script = document.createElement('script');
    script.src = PYODIDE_BASE + 'pyodide.js';
    var settled = false;
    var timer = setTimeout(function () {
      if (!settled) { settled = true; booting = false; fallback('加载超时'); }
    }, 60000);
    script.onerror = function () {
      if (!settled) { settled = true; clearTimeout(timer); booting = false; fallback('网络不可达或被拦截'); }
    };
    script.onload = function () {
      setStatus('运行时下载完成，正在初始化 WebAssembly…');
      window.loadPyodide({ indexURL: PYODIDE_BASE }).then(function (py) {
        if (settled) return;
        settled = true; clearTimeout(timer);
        pyodide = py; booting = false;
        $('prog').style.display = 'none';
        $('run').disabled = false;
        setBadge('b-ok', 'Python ' + py.runPython('import sys; sys.version.split()[0]') + ' (Pyodide)');
        setStatus('环境就绪（已缓存，下次秒开）。');
        if (thenRun) run();
      }).catch(function (e) {
        if (!settled) { settled = true; clearTimeout(timer); booting = false; fallback(String(e)); }
      });
    };
    document.head.appendChild(script);
  }

  function run() {
    if (failed) return;
    if (!pyodide) { boot(true); return; }
    $('run').disabled = true;
    setStatus('运行中…');
    clearOut();
    pyodide.setStdout({ batched: function (s) { printOut(s + '\n'); } });
    pyodide.setStderr({ batched: function (s) { printOut(s + '\n', 'err'); } });
    setTimeout(function () {
      try {
        pyodide.runPython($('code').value);
        setStatus('运行完成。');
      } catch (e) {
        /* traceback 友好化：突出最后一行错误本身 */
        var msg = String(e);
        var lines = msg.split('\n').filter(function (l) { return l.trim(); });
        var last = lines.length ? lines[lines.length - 1] : msg;
        printOut('\n运行出错（这是学习的一部分——读报错，改代码，再跑）：\n', 'sys');
        printOut(last + '\n', 'err');
        printOut('\n完整 traceback：\n' + msg + '\n');
        setStatus('运行出错。');
      }
      $('run').disabled = false;
    }, 30);
  }

  $('toggle').addEventListener('click', function () {
    $('wrap').classList.add('open');
    $('toggle').style.display = 'none';
  });
  $('collapse').addEventListener('click', function () {
    $('wrap').classList.remove('open');
    $('toggle').style.display = '';
  });
  $('run').addEventListener('click', run);
  $('restore').addEventListener('click', function () {
    $('code').value = DEFAULT_CODE;
    setStatus(failed ? '已还原示例代码（当前为离线演示模式）。' : '已还原示例代码。');
  });
};
