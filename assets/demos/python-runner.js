/* python-runner —— 浏览器内在线运行 Python（篇00）
 * 懒加载 Pyodide（jsdelivr CDN），运行篇00 聊天机器人的纯模拟版代码；
 * CDN 加载失败时优雅降级为预计算输出展示。
 */
window.DEMOS = window.DEMOS || {};
window.DEMOS['python-runner'] = function (container) {
  var shadow = container.attachShadow({ mode: 'open' });

  var PYODIDE_VER = 'v0.26.4';
  var PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/' + PYODIDE_VER + '/full/';

  var DEFAULT_CODE = [
    '# 篇00 Demo 1 的"纯模拟版"：不需要 API key，演示 requests 流程',
    '# MockClient 假装是 DeepSeek API——真实代码只需把 client 换成',
    '# openai.OpenAI(api_key=..., base_url=...)，其余一模一样',
    '',
    'class MockResponse:',
    '    def __init__(self, content):',
    '        self.status_code = 200',
    '        self._data = {',
    '            "choices": [{"message": {"role": "assistant", "content": content}}],',
    '            "usage": {"prompt_tokens": 25, "completion_tokens": 12},',
    '        }',
    '    def json(self):',
    '        return self._data',
    '',
    'class MockClient:',
    '    """模拟 requests.post / client.chat.completions.create"""',
    '    def post(self, url, headers, json_body, timeout=30):',
    '        msgs = json_body["messages"]',
    '        print(f"-> POST {url}  (messages: {len(msgs)} 条)")',
    '        user_msg = msgs[-1]["content"]',
    '        # 模拟模型的"记忆"：它其实不记事，只是在完整 messages 里找线索',
    '        name = None',
    '        for m in msgs:',
    '            if "我叫" in m["content"]:',
    '                name = m["content"].split("我叫")[-1].strip("，。 .,")',
    '        if "名字" in user_msg and name:',
    '            reply = f"你叫{name}。"',
    '        elif "我叫" in user_msg:',
    '            reply = f"你好{name}！有什么可以帮你的？"',
    '        else:',
    '            reply = f"收到：{user_msg}"',
    '        return MockResponse(reply)',
    '',
    'client = MockClient()',
    'messages = [{"role": "system", "content": "你是一个简洁的中文助手。"}]',
    '',
    'for user_input in ["你好，我叫小明", "我叫什么名字？"]:',
    '    messages.append({"role": "user", "content": user_input})',
    '    resp = client.post(',
    '        "https://api.deepseek.com/chat/completions",',
    '        headers={"Authorization": "Bearer sk-***"},',
    '        json_body={"model": "deepseek-chat", "messages": messages},',
    '    )',
    '    data = resp.json()',
    '    reply = data["choices"][0]["message"]["content"]',
    '    messages.append({"role": "assistant", "content": reply})  # 关键：回填',
    '    print(f"你: {user_input}")',
    '    print(f"AI: {reply}")',
    '    print(f"   (status={resp.status_code}, usage={data[\'usage\']})")',
    '    print()',
    '',
    'print("要点：模型本身不记事——它"记得"名字，是因为 messages 被全量回传了")'
  ].join('\n');

  var FALLBACK_OUTPUT = [
    '-> POST https://api.deepseek.com/chat/completions  (messages: 2 条)',
    '你: 你好，我叫小明',
    'AI: 你好小明！有什么可以帮你的？',
    "   (status=200, usage={'prompt_tokens': 25, 'completion_tokens': 12})",
    '',
    '-> POST https://api.deepseek.com/chat/completions  (messages: 4 条)',
    '你: 我叫什么名字？',
    'AI: 你叫小明。',
    "   (status=200, usage={'prompt_tokens': 25, 'completion_tokens': 12})",
    '',
    '要点：模型本身不记事——它"记得"名字，是因为 messages 被全量回传了'
  ].join('\n');

  shadow.innerHTML =
    '<style>' +
    ':host{display:block;font-family:inherit;color:#1c1917;}' +
    '.wrap{background:#ffffff;border:1px solid #e5e1d8;border-radius:8px;padding:16px;}' +
    '.title{font-size:12px;color:#78716c;margin-bottom:4px;}' +
    '.subtitle{font-size:11px;color:#a8a29e;margin-bottom:12px;}' +
    'textarea{width:100%;box-sizing:border-box;height:280px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;border:1px solid #e5e1d8;border-radius:6px;padding:10px;resize:vertical;background:#fafaf9;color:#1c1917;tab-size:4;}' +
    '.bar{display:flex;align-items:center;gap:10px;margin:10px 0;flex-wrap:wrap;}' +
    'button{background:#0f766e;color:#fff;border:none;border-radius:6px;padding:7px 16px;font-size:13px;cursor:pointer;}' +
    'button:hover:not(:disabled){background:#115e59;}' +
    'button:disabled{background:#a8a29e;cursor:not-allowed;}' +
    'button.ghost{background:#fff;color:#0f766e;border:1px solid #0f766e;}' +
    '.status{font-size:12px;color:#57534e;}' +
    '.progress{flex:1;min-width:120px;height:6px;background:#e7e5e4;border-radius:3px;overflow:hidden;display:none;}' +
    '.progress>div{height:100%;width:30%;background:#0f766e;border-radius:3px;animation:slide 1.2s ease-in-out infinite;}' +
    '@keyframes slide{0%{margin-left:-30%}100%{margin-left:100%}}' +
    '.out{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;background:#1c1917;color:#e7e5e4;border-radius:6px;padding:10px 12px;min-height:120px;white-space:pre-wrap;word-break:break-all;max-height:340px;overflow-y:auto;}' +
    '.out .err{color:#fca5a5;}' +
    '.out .sys{color:#99d5cf;}' +
    '.badge{display:inline-block;font-size:10px;border-radius:4px;padding:1px 6px;margin-left:6px;vertical-align:1px;}' +
    '.b-ok{background:#f0fdfa;color:#0f766e;border:1px solid #99d5cf;}' +
    '.b-fallback{background:#fffbeb;color:#b45309;border:1px solid #fde68a;}' +
    '</style>' +
    '<div class="wrap">' +
    '  <div class="title">在线运行 Python · 篇00 聊天机器人（纯模拟版，无需 API key）<span id="badge"></span></div>' +
    '  <div class="subtitle">代码可直接编辑。首次启动需从 CDN 下载 Pyodide 运行时（约 10MB+，仅首次，之后由浏览器缓存）。</div>' +
    '  <textarea id="code" spellcheck="false"></textarea>' +
    '  <div class="bar">' +
    '    <button id="boot">▶ 启动 Python 环境</button>' +
    '    <button id="run" disabled>运行</button>' +
    '    <button id="restore" class="ghost">还原示例代码</button>' +
    '    <div class="progress" id="prog"><div></div></div>' +
    '    <span class="status" id="status">未启动。也可以直接点"运行"——会先自动启动环境。</span>' +
    '  </div>' +
    '  <div class="out" id="out"><span class="sys">输出面板：启动环境并运行后，stdout / stderr 显示在这里。</span></div>' +
    '</div>';

  var $ = function (id) { return shadow.getElementById(id); };
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

  function fallback(reason) {
    failed = true;
    $('prog').style.display = 'none';
    $('boot').disabled = true;
    $('run').disabled = true;
    setBadge('b-fallback', '离线演示模式');
    setStatus('Pyodide 加载失败：' + reason + '。已降级为预计算输出展示。');
    clearOut();
    printOut('[降级模式] 无法从 CDN 加载 Python 运行时（' + reason + '）。\n' +
      '以下是这段示例代码的预计算运行结果，与真实执行一致：\n\n', 'sys');
    printOut(FALLBACK_OUTPUT + '\n');
  }

  function boot(thenRun) {
    if (pyodide) { if (thenRun) run(); return; }
    if (failed) return;
    if (booting) return;
    booting = true;
    $('boot').disabled = true;
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
        $('boot').textContent = '✓ Python 环境已就绪';
        setBadge('b-ok', 'Python ' + py.runPython('import sys; sys.version.split()[0]') + ' (Pyodide)');
        setStatus('环境就绪（已缓存，下次秒开）。点"运行"执行代码。');
        if (thenRun) run();
      }).catch(function (e) {
        if (!settled) { settled = true; clearTimeout(timer); booting = false; fallback(String(e)); }
      });
    };
    document.head.appendChild(script);
  }

  function run() {
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
        printOut('\n' + String(e) + '\n', 'err');
        setStatus('运行出错（这是学习的一部分——读报错，改代码，再跑）。');
      }
      $('run').disabled = false;
    }, 30);
  }

  $('boot').addEventListener('click', function () { boot(false); });
  $('run').addEventListener('click', run);
  $('restore').addEventListener('click', function () {
    $('code').value = DEFAULT_CODE;
    setStatus(pyodide ? '已还原示例代码。' : '已还原示例代码。启动环境后可运行。');
  });
};
