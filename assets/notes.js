/* notes.js —— 微信读书式阅读笔记：划线 / 写想法 / 收藏 / 笔记面板
 * 纯前端，localStorage 持久化（key: aap-notes-v1），无外部依赖。
 * 锚点策略：相对 .content 的 childNodes 路径 + 偏移，失效时按原文片段模糊回锚。
 */
(function () {
  'use strict';

  var STORE_KEY = 'aap-notes-v1';
  var contentEl = document.querySelector('.content');
  if (!contentEl) return;

  var PAGE = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
  var PAGE_TITLE = (document.querySelector('.content h1') || {}).textContent || document.title;

  /* ---------------- 存储 ---------------- */

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { var d = JSON.parse(raw); if (d && Array.isArray(d.items)) return d; }
    } catch (e) {}
    return { v: 1, items: [] };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) {}
  }
  var db = load();

  function marks(page) {
    return db.items.filter(function (i) { return i.type === 'mark' && (!page || i.page === page); });
  }
  function favs() {
    return db.items.filter(function (i) { return i.type === 'fav'; });
  }
  function isFav(page) {
    return db.items.some(function (i) { return i.type === 'fav' && i.page === page; });
  }
  function uid() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------------- 样式 ---------------- */

  var css = ''
    + '.aap-mark{cursor:pointer;border-radius:2px;transition:background .2s;}'
    + '.aap-line{background:linear-gradient(transparent 55%, rgba(250,204,21,.45) 55%);}'
    + '.aap-note{background:rgba(15,118,110,.14);border-bottom:1px dashed #0f766e;}'
    + '.aap-note::after{content:"✎";font-size:.72em;color:#0f766e;margin-left:1px;vertical-align:super;}'
    + '.aap-mark:hover{filter:brightness(.95);}'
    + '@keyframes aapFlash{0%,100%{background:rgba(250,204,21,.45);}50%{background:rgba(250,204,21,.85);}}'
    + '.aap-flash{animation:aapFlash 1.2s ease 2;}'
    /* 选区浮动工具条 */
    + '.aap-seltool{position:absolute;z-index:90;display:flex;gap:2px;background:#292524;border-radius:8px;padding:4px;box-shadow:0 6px 24px rgba(0,0,0,.22);}'
    + '.aap-seltool::after{content:"";position:absolute;left:50%;bottom:-5px;margin-left:-5px;border:5px solid transparent;border-top-color:#292524;border-bottom:0;}'
    + '.aap-seltool button{border:0;background:transparent;color:#e7e5e4;font:inherit;font-size:12.5px;padding:5px 10px;border-radius:5px;cursor:pointer;white-space:nowrap;}'
    + '.aap-seltool button:hover{background:#44403c;color:#fff;}'
    /* 想法输入 / 详情弹层 */
    + '.aap-pop{position:absolute;z-index:91;width:300px;background:#fffdf9;border:1px solid #e5e1d8;border-radius:10px;box-shadow:0 10px 34px rgba(60,50,30,.18);padding:12px;font-size:13px;color:#3f3a32;}'
    + '.aap-pop .q{font-size:12px;color:#8a8578;border-left:3px solid #e7d9a8;padding-left:8px;margin-bottom:8px;max-height:60px;overflow:hidden;line-height:1.5;}'
    + '.aap-pop textarea{width:100%;box-sizing:border-box;height:74px;resize:vertical;border:1px solid #e5e1d8;border-radius:6px;padding:7px 9px;font:inherit;font-size:13px;color:#333;outline:none;background:#fff;}'
    + '.aap-pop textarea:focus{border-color:#0f766e;}'
    + '.aap-pop .acts{display:flex;gap:8px;margin-top:8px;justify-content:flex-end;}'
    + '.aap-pop .acts button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:5px 13px;font:inherit;font-size:12.5px;cursor:pointer;}'
    + '.aap-pop .acts button.ghost{background:#fff;color:#0f766e;}'
    + '.aap-pop .acts button.danger{background:#fff;color:#dc2626;border-color:#dc2626;margin-right:auto;}'
    + '.aap-pop .nt{line-height:1.7;white-space:pre-wrap;}'
    + '.aap-pop .meta{font-size:11px;color:#b0aa9c;margin-top:8px;}'
    /* 右下角浮动按钮 */
    + '.aap-fab{position:fixed;right:22px;bottom:26px;z-index:80;display:flex;flex-direction:column;gap:10px;}'
    + '.aap-fab button{width:46px;height:46px;border-radius:50%;border:1px solid #e5e1d8;background:#fffdf9;box-shadow:0 4px 16px rgba(60,50,30,.16);cursor:pointer;font-size:18px;color:#0f766e;position:relative;transition:transform .15s;}'
    + '.aap-fab button:hover{transform:translateY(-2px);}'
    + '.aap-fab button.faved{color:#eab308;}'
    + '.aap-fab .badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:#0f766e;color:#fff;font-size:10.5px;line-height:18px;text-align:center;padding:0 4px;}'
    /* 笔记抽屉 */
    + '.aap-drawer{position:fixed;top:0;right:0;bottom:0;width:min(380px,92vw);background:#fffdf9;border-left:1px solid #e5e1d8;box-shadow:-12px 0 40px rgba(60,50,30,.14);z-index:85;display:flex;flex-direction:column;transform:translateX(102%);transition:transform .25s ease;}'
    + '.aap-drawer.open{transform:translateX(0);}'
    + '.aap-drawer header{padding:14px 16px 0;border-bottom:1px solid #efece4;}'
    + '.aap-drawer h3{margin:0 0 10px;font-size:15px;color:#292524;display:flex;align-items:center;}'
    + '.aap-drawer h3 .x{margin-left:auto;border:0;background:none;font-size:18px;cursor:pointer;color:#8a8578;}'
    + '.aap-tabs{display:flex;gap:0;}'
    + '.aap-tabs button{flex:1;border:0;background:none;font:inherit;font-size:13px;color:#8a8578;padding:9px 0 10px;cursor:pointer;border-bottom:2px solid transparent;}'
    + '.aap-tabs button.on{color:#0f766e;border-bottom-color:#0f766e;font-weight:600;}'
    + '.aap-list{flex:1;overflow-y:auto;padding:10px 14px;}'
    + '.aap-group{font-size:11.5px;color:#b0aa9c;margin:12px 0 6px;font-weight:600;}'
    + '.aap-item{border:1px solid #efece4;border-radius:8px;padding:9px 11px;margin-bottom:8px;background:#fff;cursor:pointer;transition:border-color .15s;}'
    + '.aap-item:hover{border-color:#0f766e;}'
    + '.aap-item .aq{font-size:12.5px;color:#57534e;line-height:1.55;border-left:3px solid #e7d9a8;padding-left:8px;max-height:57px;overflow:hidden;}'
    + '.aap-item .an{font-size:12.5px;color:#0f766e;margin-top:6px;line-height:1.55;white-space:pre-wrap;}'
    + '.aap-item .af{font-size:13px;color:#292524;font-weight:600;}'
    + '.aap-item .am{display:flex;align-items:center;margin-top:6px;font-size:11px;color:#b0aa9c;}'
    + '.aap-item .am .del{margin-left:auto;border:0;background:none;color:#c7c2b6;cursor:pointer;font-size:11.5px;}'
    + '.aap-item .am .del:hover{color:#dc2626;}'
    + '.aap-empty{text-align:center;color:#b0aa9c;font-size:12.5px;padding:42px 20px;line-height:2;}'
    + '.aap-drawer footer{padding:10px 14px;border-top:1px solid #efece4;display:flex;gap:8px;}'
    + '.aap-drawer footer button{flex:1;border:1px solid #e5e1d8;background:#fff;border-radius:7px;padding:8px;font:inherit;font-size:12.5px;color:#57534e;cursor:pointer;}'
    + '.aap-drawer footer button:hover{border-color:#0f766e;color:#0f766e;}'
    + '@media (max-width:900px){.aap-fab{right:14px;bottom:18px;}.aap-pop{width:min(300px,86vw);}}';

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ---------------- 锚点 ---------------- */

  function nodePath(node) {
    var parts = [];
    while (node && node !== contentEl) {
      var idx = 0;
      for (var s = node.previousSibling; s; s = s.previousSibling) idx++;
      parts.unshift(idx);
      node = node.parentNode;
    }
    return parts.join('/');
  }
  function nodeFromPath(path) {
    var node = contentEl;
    var parts = String(path).split('/');
    for (var i = 0; i < parts.length; i++) {
      var idx = +parts[i];
      if (!node.childNodes || idx >= node.childNodes.length) return null;
      node = node.childNodes[idx];
    }
    return node;
  }
  /* 路径比较：文档顺序 */
  function cmpAnchor(a, b) {
    var pa = a.sPath.split('/').map(Number), pb = b.sPath.split('/').map(Number);
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x - y;
    }
    return a.sOff - b.sOff;
  }

  function wrapTextNode(n, start, end, cls, id) {
    if (start > 0) n = n.splitText(start);
    if (end - start < n.nodeValue.length) n.splitText(end - start);
    var span = document.createElement('span');
    span.className = cls;
    span.setAttribute('data-nid', id);
    n.parentNode.replaceChild(span, n);
    span.appendChild(n);
  }

  function paintMark(item) {
    var cls = 'aap-mark ' + (item.kind === 'note' ? 'aap-note' : 'aap-line');
    var s = nodeFromPath(item.sPath), e = nodeFromPath(item.ePath);
    if (s && e && s.nodeType === 3 && e.nodeType === 3) {
      var range = document.createRange();
      try {
        range.setStart(s, Math.min(item.sOff, s.nodeValue.length));
        range.setEnd(e, Math.min(item.eOff, e.nodeValue.length));
      } catch (err) { return fuzzyPaint(item, cls); }
      var walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (!n.nodeValue.replace(/\s/g, '')) return NodeFilter.FILTER_REJECT;
          try { return range.intersectsNode(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
          catch (err) { return NodeFilter.FILTER_REJECT; }
        }
      });
      var nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(function (n) {
        var st = (n === s) ? Math.min(item.sOff, n.nodeValue.length) : 0;
        var en = (n === e) ? Math.min(item.eOff, n.nodeValue.length) : n.nodeValue.length;
        if (st < en) wrapTextNode(n, st, en, cls, item.id);
      });
      return;
    }
    fuzzyPaint(item, cls);
  }

  /* 锚点失效：按原文前 24 字在正文里找首个匹配文本节点，包裹该处片段 */
  function fuzzyPaint(item, cls) {
    var needle = (item.text || '').replace(/\s+/g, '').slice(0, 24);
    if (!needle) return;
    var walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return n.nodeValue.replace(/\s+/g, '').indexOf(needle) >= 0
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var n = walker.nextNode();
    if (!n) return;
    var compact = n.nodeValue.replace(/\s+/g, '');
    var hit = compact.indexOf(needle);
    var count = 0, start = 0;
    for (var i = 0; i < n.nodeValue.length && count < hit; i++) {
      if (!/\s/.test(n.nodeValue[i])) count++;
      start = i + 1;
    }
    wrapTextNode(n, start, Math.min(start + needle.length, n.nodeValue.length), cls, item.id);
  }

  function unpaint(id) {
    contentEl.querySelectorAll('.aap-mark[data-nid="' + id + '"]').forEach(function (span) {
      var parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    });
  }

  /* 按文档倒序上漆，避免前面的包裹改变后面的锚点 */
  function paintAll() {
    marks(PAGE).sort(function (a, b) { return cmpAnchor(b, a); }).forEach(paintMark);
  }

  /* ---------------- 浮动层工具 ---------------- */

  var floating = [];
  function closeFloating() {
    floating.forEach(function (el) { el.parentNode && el.parentNode.removeChild(el); });
    floating = [];
  }
  function showFloating(el, rect, above) {
    document.body.appendChild(el);
    floating.push(el);
    var top = rect.top + window.scrollY + (above ? -el.offsetHeight - 10 : rect.height + 10);
    var left = rect.left + window.scrollX + rect.width / 2 - el.offsetWidth / 2;
    left = Math.max(8, Math.min(left, window.scrollX + document.documentElement.clientWidth - el.offsetWidth - 8));
    el.style.top = top + 'px';
    el.style.left = left + 'px';
  }
  document.addEventListener('mousedown', function (e) {
    if (!e.target.closest('.aap-seltool') && !e.target.closest('.aap-pop')) closeFloating();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeFloating(); closeDrawer(); }
  });

  /* ---------------- 选区工具条 ---------------- */

  var selTool = null;
  document.addEventListener('mouseup', function () {
    setTimeout(function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      var range = sel.getRangeAt(0);
      if (!contentEl.contains(range.commonAncestorContainer)) return;
      var text = sel.toString().trim();
      if (text.length < 2) return;
      closeFloating();
      selTool = document.createElement('div');
      selTool.className = 'aap-seltool';
      selTool.innerHTML = ''
        + '<button data-act="line">划线</button>'
        + '<button data-act="note">✎ 写想法</button>'
        + '<button data-act="copy">复制</button>';
      selTool.addEventListener('mousedown', function (e) { e.preventDefault(); });
      selTool.addEventListener('click', function (e) {
        var act = e.target.getAttribute('data-act');
        if (!act) return;
        if (act === 'copy') {
          try { navigator.clipboard.writeText(text); } catch (err) {}
          closeFloating();
          return;
        }
        createMark(range, text, act);
      });
      showFloating(selTool, range.getBoundingClientRect(), true);
    }, 10);
  });

  function createMark(range, text, act) {
    var item = {
      id: uid(), type: 'mark', kind: act === 'note' ? 'note' : 'line',
      page: PAGE, title: PAGE_TITLE,
      sPath: nodePath(range.startContainer), sOff: range.startOffset,
      ePath: nodePath(range.endContainer), eOff: range.endOffset,
      text: text.slice(0, 200), note: '', ts: Date.now()
    };
    if (act === 'note') {
      openNoteEditor(item, range, text);
      return;
    }
    db.items.push(item); save();
    paintMark(item);
    window.getSelection().removeAllRanges();
    closeFloating();
    refreshBadge();
  }

  function openNoteEditor(item, range, text, existing) {
    closeFloating();
    var pop = document.createElement('div');
    pop.className = 'aap-pop';
    pop.innerHTML = ''
      + '<div class="q">' + escapeHtml(text.slice(0, 80)) + (text.length > 80 ? '…' : '') + '</div>'
      + '<textarea placeholder="写下你的想法……（仅保存在本机浏览器）"></textarea>'
      + '<div class="acts">'
      + (existing ? '<button class="danger" data-a="del">删除</button>' : '')
      + '<button class="ghost" data-a="cancel">取消</button>'
      + '<button data-a="save">保存</button>'
      + '</div>';
    var ta = pop.querySelector('textarea');
    if (existing) ta.value = existing.note || '';
    pop.addEventListener('click', function (e) {
      var a = e.target.getAttribute('data-a');
      if (a === 'cancel') closeFloating();
      if (a === 'del' && existing) { removeItem(existing.id); closeFloating(); }
      if (a === 'save') {
        item.note = ta.value.trim();
        if (existing) {
          existing.note = item.note;
          if (!existing.note) existing.kind = 'line';
          save();
          unpaint(existing.id); paintMark(existing);
        } else {
          db.items.push(item); save();
          paintMark(item);
        }
        window.getSelection().removeAllRanges();
        closeFloating();
        refreshBadge();
      }
    });
    showFloating(pop, range.getBoundingClientRect ? range.getBoundingClientRect() : range, false);
    ta.focus();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------------- 点击标记 → 详情 ---------------- */

  contentEl.addEventListener('click', function (e) {
    var span = e.target.closest('.aap-mark');
    if (!span) return;
    var id = span.getAttribute('data-nid');
    var item = db.items.filter(function (i) { return i.id === id; })[0];
    if (!item) return;
    closeFloating();
    var pop = document.createElement('div');
    pop.className = 'aap-pop';
    pop.innerHTML = ''
      + '<div class="q">' + escapeHtml(item.text.slice(0, 80)) + (item.text.length > 80 ? '…' : '') + '</div>'
      + (item.note
        ? '<div class="nt">' + escapeHtml(item.note) + '</div>'
        : '<div class="nt" style="color:#b0aa9c">（只有划线，还没写想法）</div>')
      + '<div class="meta">' + new Date(item.ts).toLocaleString('zh-CN') + '</div>'
      + '<div class="acts">'
      + '<button class="danger" data-a="del">删除</button>'
      + '<button class="ghost" data-a="edit">' + (item.note ? '编辑想法' : '写想法') + '</button>'
      + '<button data-a="close">关闭</button>'
      + '</div>';
    pop.addEventListener('click', function (ev) {
      var a = ev.target.getAttribute('data-a');
      if (a === 'close') closeFloating();
      if (a === 'del') { removeItem(item.id); closeFloating(); }
      if (a === 'edit') {
        item.kind = 'note';
        openNoteEditor(item, span, item.text, item);
      }
    });
    showFloating(pop, span.getBoundingClientRect(), false);
  });

  function removeItem(id) {
    db.items = db.items.filter(function (i) { return i.id !== id; });
    save();
    unpaint(id);
    refreshBadge();
    renderList();
  }

  /* ---------------- 收藏 ---------------- */

  function toggleFav() {
    if (isFav(PAGE)) {
      db.items = db.items.filter(function (i) { return !(i.type === 'fav' && i.page === PAGE); });
    } else {
      db.items.push({ id: uid(), type: 'fav', page: PAGE, title: PAGE_TITLE, ts: Date.now() });
    }
    save();
    paintFav();
    renderList();
  }

  /* ---------------- 右下角按钮 + 抽屉 ---------------- */

  var fab = document.createElement('div');
  fab.className = 'aap-fab';
  fab.innerHTML = ''
    + '<button id="aapFavBtn" title="收藏本页">☆</button>'
    + '<button id="aapNoteBtn" title="我的笔记">✎<span class="badge" id="aapBadge" style="display:none"></span></button>';
  document.body.appendChild(fab);

  function paintFav() {
    var b = fab.querySelector('#aapFavBtn');
    var on = isFav(PAGE);
    b.textContent = on ? '★' : '☆';
    b.className = on ? 'faved' : '';
    b.title = on ? '已收藏，点击取消' : '收藏本页';
  }
  function refreshBadge() {
    var n = marks().length;
    var badge = fab.querySelector('#aapBadge');
    badge.style.display = n ? '' : 'none';
    badge.textContent = n > 99 ? '99+' : n;
  }
  fab.querySelector('#aapFavBtn').addEventListener('click', toggleFav);

  var drawer = document.createElement('div');
  drawer.className = 'aap-drawer';
  drawer.innerHTML = ''
    + '<header><h3>我的笔记与收藏<button class="x" title="关闭">×</button></h3>'
    + '<div class="aap-tabs">'
    + '<button data-tab="notes" class="on">划线与想法</button>'
    + '<button data-tab="favs">收藏</button>'
    + '</div></header>'
    + '<div class="aap-list" id="aapList"></div>'
    + '<footer><button id="aapExport">导出 Markdown</button></footer>';
  document.body.appendChild(drawer);

  var curTab = 'notes';
  drawer.querySelector('.x').addEventListener('click', closeDrawer);
  drawer.querySelectorAll('.aap-tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      curTab = b.getAttribute('data-tab');
      drawer.querySelectorAll('.aap-tabs button').forEach(function (x) {
        x.className = x === b ? 'on' : '';
      });
      renderList();
    });
  });
  fab.querySelector('#aapNoteBtn').addEventListener('click', function () {
    drawer.classList.toggle('open');
    renderList();
  });
  function closeDrawer() { drawer.classList.remove('open'); }

  function fmtTs(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function renderList() {
    var list = drawer.querySelector('#aapList');
    if (!drawer.classList.contains('open')) return;
    if (curTab === 'favs') {
      var fs = favs().sort(function (a, b) { return b.ts - a.ts; });
      list.innerHTML = fs.length ? '' : '<div class="aap-empty">还没有收藏<br>点右下角 ☆ 收藏当前章节</div>';
      fs.forEach(function (f) {
        var div = document.createElement('div');
        div.className = 'aap-item';
        div.innerHTML = '<div class="af">★ ' + escapeHtml(f.title) + '</div>'
          + '<div class="am">' + fmtTs(f.ts) + '<button class="del">删除</button></div>';
        div.addEventListener('click', function (e) {
          if (e.target.className === 'del') { removeItem(f.id); paintFav(); return; }
          location.href = f.page + '.html';
        });
        list.appendChild(div);
      });
      return;
    }
    var ms = marks().sort(function (a, b) { return b.ts - a.ts; });
    list.innerHTML = ms.length ? '' : '<div class="aap-empty">还没有笔记<br>选中正文任意文字<br>即可「划线」或「写想法」</div>';
    var lastPage = null;
    ms.forEach(function (m) {
      if (m.page !== lastPage) {
        lastPage = m.page;
        var g = document.createElement('div');
        g.className = 'aap-group';
        g.textContent = (m.page === PAGE ? '本篇 · ' : '') + m.title;
        list.appendChild(g);
      }
      var div = document.createElement('div');
      div.className = 'aap-item';
      div.innerHTML = '<div class="aq">' + escapeHtml(m.text) + '</div>'
        + (m.note ? '<div class="an">✎ ' + escapeHtml(m.note) + '</div>' : '')
        + '<div class="am">' + fmtTs(m.ts) + (m.kind === 'note' ? ' · 想法' : ' · 划线')
        + '<button class="del">删除</button></div>';
      div.addEventListener('click', function (e) {
        if (e.target.className === 'del') { removeItem(m.id); return; }
        if (m.page === PAGE) {
          closeDrawer();
          scrollToMark(m.id);
        } else {
          location.href = m.page + '.html#nid-' + m.id;
        }
      });
      list.appendChild(div);
    });
  }

  function scrollToMark(id) {
    var span = contentEl.querySelector('.aap-mark[data-nid="' + id + '"]');
    if (!span) return;
    span.scrollIntoView({ behavior: 'smooth', block: 'center' });
    span.classList.add('aap-flash');
    setTimeout(function () { span.classList.remove('aap-flash'); }, 2600);
  }

  /* ---------------- 导出 ---------------- */

  drawer.querySelector('#aapExport').addEventListener('click', function () {
    var lines = ['# AI 全栈架构师之路 · 阅读笔记', '', '> 导出于 ' + new Date().toLocaleString('zh-CN') + '（数据保存在浏览器本地）', ''];
    var byPage = {};
    marks().forEach(function (m) { (byPage[m.page] = byPage[m.page] || []).push(m); });
    Object.keys(byPage).forEach(function (p) {
      var arr = byPage[p].sort(cmpAnchor);
      lines.push('## ' + arr[0].title, '');
      arr.forEach(function (m) {
        lines.push('> ' + m.text.replace(/\n/g, ' '), '');
        if (m.note) lines.push('✎ ' + m.note, '');
      });
    });
    var fs = favs();
    if (fs.length) {
      lines.push('## 收藏的章节', '');
      fs.forEach(function (f) { lines.push('- ★ ' + f.title + '（' + f.page + '.html）'); });
    }
    var blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '阅读笔记-' + new Date().toISOString().slice(0, 10) + '.md';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  });

  /* ---------------- 启动 ---------------- */

  paintAll();
  paintFav();
  refreshBadge();
  if (location.hash.indexOf('#nid-') === 0) {
    setTimeout(function () { scrollToMark(location.hash.slice(5)); }, 300);
  }
})();
