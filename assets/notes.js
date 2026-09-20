/* notes.js —— 微信读书式阅读笔记：划线 / 写想法 / 收藏 / 笔记面板 / 评论
 * 本地优先：localStorage（key: aap-notes-v1）即时读写；
 * 云端同步：配置 SUPABASE_URL / SUPABASE_ANON_KEY 后自动开启——
 *   · 划线/想法/收藏写入即上云，跨设备用「同步码」恢复；
 *   · 每页底部开放公开评论区（昵称即可留言）；
 *   · 断网时写入进入待同步队列，恢复后自动补传。
 * 未配置云端时自动保持纯本地模式，功能不受影响。
 */
(function () {
  'use strict';

  /* ================= 云端配置 ================= */
  var SUPABASE_URL = '';        // 例如 'https://abcdefgh.supabase.co'
  var SUPABASE_ANON_KEY = '';   // Supabase Settings → API → anon public key
  var CLOUD = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

  /* ================= 基础 ================= */
  var STORE_KEY = 'aap-notes-v1';
  var KEY_KEY = 'aap-user-key';
  var QUEUE_KEY = 'aap-sync-queue';
  var contentEl = document.querySelector('.content');
  if (!contentEl) return;

  var PAGE = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
  var PAGE_TITLE = (document.querySelector('.content h1') || {}).textContent || document.title;

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

  function userKey() {
    var k = null;
    try { k = localStorage.getItem(KEY_KEY); } catch (e) {}
    if (!k) {
      k = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
      try { localStorage.setItem(KEY_KEY, k); } catch (e) {}
    }
    return k;
  }

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
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ================= 云端（Supabase PostgREST） ================= */

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    }, opts.headers || {});
    return fetch(SUPABASE_URL + '/rest/v1/' + path, opts);
  }

  function cloudUpsert(item) {
    if (!CLOUD) return;
    enqueue({ op: 'upsert', item: item });
    flushQueue();
  }
  function cloudDelete(id) {
    if (!CLOUD) return;
    enqueue({ op: 'delete', id: id });
    flushQueue();
  }

  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { return []; }
  }
  function setQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-80))); } catch (e) {}
  }
  function enqueue(op) {
    var q = getQueue();
    if (op.op === 'upsert') {
      q = q.filter(function (o) { return !(o.op === 'upsert' && o.item.id === op.item.id) && !(o.op === 'delete' && o.id === op.item.id); });
    } else {
      q = q.filter(function (o) { return !(o.op === 'upsert' && o.item.id === op.id) && !(o.op === 'delete' && o.id === op.id); });
    }
    q.push(op);
    setQueue(q);
  }

  var flushing = false;
  function flushQueue() {
    if (!CLOUD || flushing) return;
    var q = getQueue();
    if (!q.length) { setSyncBadge('synced'); return; }
    flushing = true;
    setSyncBadge('syncing');
    var op = q[0];
    var req;
    if (op.op === 'upsert') {
      req = api('reading_notes', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          id: op.item.id, user_key: userKey(), page: op.item.page,
          payload: op.item, updated_at: new Date().toISOString()
        })
      });
    } else {
      req = api('reading_notes?user_key=eq.' + encodeURIComponent(userKey()) + '&id=eq.' + encodeURIComponent(op.id), { method: 'DELETE' });
    }
    req.then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      var rest = getQueue();
      rest.shift();
      setQueue(rest);
      flushing = false;
      if (rest.length) flushQueue(); else setSyncBadge('synced');
    }).catch(function () {
      flushing = false;
      setSyncBadge('offline');
    });
  }

  /* 启动时：推本地队列 → 拉云端 → 合并（同 id 取 ts 新者）→ 重绘 */
  function syncFromCloud() {
    if (!CLOUD) return Promise.resolve(false);
    setSyncBadge('syncing');
    return api('reading_notes?user_key=eq.' + encodeURIComponent(userKey()) + '&select=id,payload')
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .then(function (rows) {
        var changed = false;
        var localById = {};
        db.items.forEach(function (i) { localById[i.id] = i; });
        rows.forEach(function (row) {
          var remote = row.payload;
          if (!remote || !remote.id) return;
          var local = localById[row.id];
          if (!local) { db.items.push(remote); changed = true; }
          else if ((remote.ts || 0) > (local.ts || 0)) {
            var idx = db.items.indexOf(local);
            db.items[idx] = remote; changed = true;
          } else if ((local.ts || 0) > (remote.ts || 0)) {
            enqueue({ op: 'upsert', item: local });
          }
        });
        /* 本地有、云端没有的 → 推上去（新设备首次反向同步） */
        var remoteIds = {};
        rows.forEach(function (row) { remoteIds[row.id] = 1; });
        db.items.forEach(function (i) {
          if (!remoteIds[i.id]) enqueue({ op: 'upsert', item: i });
        });
        if (changed) save();
        flushQueue();
        setSyncBadge('synced');
        return changed;
      })
      .catch(function () { setSyncBadge('offline'); return false; });
  }

  var syncBadgeEl = null;
  function setSyncBadge(state) {
    if (!syncBadgeEl) return;
    var map = {
      syncing: ['⟳ 同步中…', '#8a8578'],
      synced: ['☁ 已上云', '#0f766e'],
      offline: ['☁ 离线，稍后自动补传', '#b45309'],
      local: ['本地模式（云端未配置）', '#b0aa9c']
    };
    var m = map[state] || map.local;
    syncBadgeEl.textContent = m[0];
    syncBadgeEl.style.color = m[1];
  }

  /* 换设备：输入同步码 → 拉取该码的云上数据合并 */
  function adoptSyncKey(code) {
    try { localStorage.setItem(KEY_KEY, code.trim()); } catch (e) {}
    syncFromCloud().then(function (changed) {
      if (changed) { unpaintAll(); paintAll(); paintFav(); refreshBadge(); renderList(); }
    });
  }

  /* ================= 样式 ================= */

  var css = ''
    + '.aap-mark{cursor:pointer;border-radius:2px;transition:background .2s;}'
    + '.aap-line{background:linear-gradient(transparent 55%, rgba(250,204,21,.45) 55%);}'
    + '.aap-note{background:rgba(15,118,110,.14);border-bottom:1px dashed #0f766e;}'
    + '.aap-note::after{content:"✎";font-size:.72em;color:#0f766e;margin-left:1px;vertical-align:super;}'
    + '.aap-mark:hover{filter:brightness(.95);}'
    + '@keyframes aapFlash{0%,100%{background:rgba(250,204,21,.45);}50%{background:rgba(250,204,21,.85);}}'
    + '.aap-flash{animation:aapFlash 1.2s ease 2;}'
    + '.aap-seltool{position:absolute;z-index:90;display:flex;gap:2px;background:#292524;border-radius:8px;padding:4px;box-shadow:0 6px 24px rgba(0,0,0,.22);}'
    + '.aap-seltool::after{content:"";position:absolute;left:50%;bottom:-5px;margin-left:-5px;border:5px solid transparent;border-top-color:#292524;border-bottom:0;}'
    + '.aap-seltool button{border:0;background:transparent;color:#e7e5e4;font:inherit;font-size:12.5px;padding:5px 10px;border-radius:5px;cursor:pointer;white-space:nowrap;}'
    + '.aap-seltool button:hover{background:#44403c;color:#fff;}'
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
    + '.aap-fab{position:fixed;right:22px;bottom:26px;z-index:80;display:flex;flex-direction:column;gap:10px;}'
    + '.aap-fab button{width:46px;height:46px;border-radius:50%;border:1px solid #e5e1d8;background:#fffdf9;box-shadow:0 4px 16px rgba(60,50,30,.16);cursor:pointer;font-size:18px;color:#0f766e;position:relative;transition:transform .15s;}'
    + '.aap-fab button:hover{transform:translateY(-2px);}'
    + '.aap-fab button.faved{color:#eab308;}'
    + '.aap-fab .badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;background:#0f766e;color:#fff;font-size:10.5px;line-height:18px;text-align:center;padding:0 4px;}'
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
    + '.aap-drawer footer{padding:10px 14px;border-top:1px solid #efece4;}'
    + '.aap-drawer footer .syncrow{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11.5px;}'
    + '.aap-drawer footer .syncrow .sp{flex:1;}'
    + '.aap-drawer footer .syncrow button{border:1px solid #e5e1d8;background:#fff;border-radius:6px;padding:3px 9px;font:inherit;font-size:11.5px;color:#57534e;cursor:pointer;}'
    + '.aap-drawer footer .syncrow button:hover{border-color:#0f766e;color:#0f766e;}'
    + '.aap-drawer footer .btnrow{display:flex;gap:8px;}'
    + '.aap-drawer footer .btnrow button{flex:1;border:1px solid #e5e1d8;background:#fff;border-radius:7px;padding:8px;font:inherit;font-size:12.5px;color:#57534e;cursor:pointer;}'
    + '.aap-drawer footer .btnrow button:hover{border-color:#0f766e;color:#0f766e;}'
    /* 评论区 */
    + '.aap-comments{margin-top:44px;border-top:1px solid #e5e1d8;padding-top:20px;}'
    + '.aap-comments h2{font-size:19px;margin:0 0 4px;color:#292524;}'
    + '.aap-comments .c-sub{font-size:12px;color:#b0aa9c;margin-bottom:14px;}'
    + '.aap-cform{display:flex;flex-direction:column;gap:8px;margin-bottom:18px;}'
    + '.aap-cform input{width:180px;padding:7px 10px;border:1px solid #e5e1d8;border-radius:6px;font:inherit;font-size:13px;color:#333;outline:none;background:#fff;}'
    + '.aap-cform textarea{width:100%;box-sizing:border-box;height:70px;resize:vertical;padding:8px 10px;border:1px solid #e5e1d8;border-radius:6px;font:inherit;font-size:13px;color:#333;outline:none;background:#fff;}'
    + '.aap-cform input:focus,.aap-cform textarea:focus{border-color:#0f766e;}'
    + '.aap-cform .row{display:flex;gap:8px;align-items:center;}'
    + '.aap-cform button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:6px;padding:7px 18px;font:inherit;font-size:13px;cursor:pointer;}'
    + '.aap-cform button:disabled{opacity:.5;cursor:not-allowed;}'
    + '.aap-cform .hint{font-size:11.5px;color:#b0aa9c;}'
    + '.aap-citem{padding:10px 0;border-bottom:1px dashed #efece4;}'
    + '.aap-citem .ch{display:flex;align-items:baseline;gap:8px;}'
    + '.aap-citem .cn{font-size:13px;font-weight:600;color:#0f766e;}'
    + '.aap-citem .ct{font-size:11px;color:#b0aa9c;}'
    + '.aap-citem .cb{font-size:13.5px;color:#3f3a32;line-height:1.7;margin-top:4px;white-space:pre-wrap;}'
    + '.aap-cempty{font-size:12.5px;color:#b0aa9c;padding:14px 0;}'
    + '@media (max-width:900px){.aap-fab{right:14px;bottom:18px;}.aap-pop{width:min(300px,86vw);}}';

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ================= 锚点与上漆 ================= */

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
  function unpaintAll() {
    contentEl.querySelectorAll('.aap-mark').forEach(function (span) {
      var parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
    });
    contentEl.normalize();
  }
  function paintAll() {
    marks(PAGE).sort(function (a, b) { return cmpAnchor(b, a); }).forEach(paintMark);
  }

  /* ================= 浮动层 ================= */

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

  /* ================= 选区工具条 ================= */

  var selTool = null;
  document.addEventListener('mouseup', function () {
    setTimeout(function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      var range = sel.getRangeAt(0);
      if (!contentEl.contains(range.commonAncestorContainer)) return;
      var anc = range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
      if (anc && anc.closest && anc.closest('.aap-comments')) return;
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
    db.items.push(item); save(); cloudUpsert(item);
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
      + '<textarea placeholder="写下你的想法……"></textarea>'
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
        item.ts = Date.now();
        if (existing) {
          existing.note = item.note;
          existing.ts = item.ts;
          if (!existing.note) existing.kind = 'line';
          save(); cloudUpsert(existing);
          unpaint(existing.id); paintMark(existing);
        } else {
          db.items.push(item); save(); cloudUpsert(item);
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

  /* ================= 点击标记 → 详情 ================= */

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
    save(); cloudDelete(id);
    unpaint(id);
    refreshBadge();
    renderList();
  }

  /* ================= 收藏 ================= */

  function toggleFav() {
    if (isFav(PAGE)) {
      var old = db.items.filter(function (i) { return i.type === 'fav' && i.page === PAGE; })[0];
      db.items = db.items.filter(function (i) { return !(i.type === 'fav' && i.page === PAGE); });
      if (old) cloudDelete(old.id);
    } else {
      var item = { id: 'fav-' + PAGE, type: 'fav', page: PAGE, title: PAGE_TITLE, ts: Date.now() };
      db.items.push(item);
      cloudUpsert(item);
    }
    save();
    paintFav();
    renderList();
  }

  /* ================= FAB + 抽屉 ================= */

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
    + '<footer>'
    + '<div class="syncrow"><span class="sp" id="aapSyncState"></span>'
    + '<button id="aapCopyKey" style="display:none">复制同步码</button>'
    + '<button id="aapUseKey" style="display:none">输入同步码</button></div>'
    + '<div class="btnrow"><button id="aapExport">导出 Markdown</button></div>'
    + '</footer>';
  document.body.appendChild(drawer);
  syncBadgeEl = drawer.querySelector('#aapSyncState');
  setSyncBadge(CLOUD ? 'syncing' : 'local');

  drawer.querySelector('#aapCopyKey').addEventListener('click', function () {
    var k = userKey();
    function done() {
      var b = drawer.querySelector('#aapCopyKey');
      b.textContent = '已复制 ✓';
      setTimeout(function () { b.textContent = '复制同步码'; }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(k).then(done, done);
    } else {
      window.prompt('长按复制你的同步码：', k);
    }
  });
  drawer.querySelector('#aapUseKey').addEventListener('click', function () {
    var code = window.prompt('粘贴另一台设备上的同步码，拉取云端的笔记与收藏：');
    if (code && code.trim().length >= 8) adoptSyncKey(code);
  });

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
    if (CLOUD) {
      drawer.querySelector('#aapCopyKey').style.display = '';
      drawer.querySelector('#aapUseKey').style.display = '';
    }
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

  /* ================= 导出 ================= */

  drawer.querySelector('#aapExport').addEventListener('click', function () {
    var lines = ['# AI 全栈架构师之路 · 阅读笔记', '', '> 导出于 ' + new Date().toLocaleString('zh-CN'), ''];
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

  /* ================= 评论区 ================= */

  var commentsBox = null;
  function buildComments() {
    if (!CLOUD) return;
    commentsBox = document.createElement('section');
    commentsBox.className = 'aap-comments';
    commentsBox.innerHTML = ''
      + '<h2>评论</h2>'
      + '<div class="c-sub">公开讨论 · 留个昵称即可发言，全站读者可见</div>'
      + '<div class="aap-cform">'
      + '<div class="row"><input id="aapCNick" maxlength="20" placeholder="昵称"/>'
      + '<span class="hint" id="aapCHint"></span></div>'
      + '<textarea id="aapCBody" maxlength="500" placeholder="写下你的问题或心得……（500 字以内）"></textarea>'
      + '<div class="row"><button id="aapCSend">发布评论</button></div>'
      + '</div>'
      + '<div id="aapCList"><div class="aap-cempty">评论加载中……</div></div>';
    var pn = contentEl.querySelector('.prevnext');
    contentEl.insertBefore(commentsBox, pn || null);
    try {
      var nick = localStorage.getItem('aap-nick');
      if (nick) commentsBox.querySelector('#aapCNick').value = nick;
    } catch (e) {}
    commentsBox.querySelector('#aapCSend').addEventListener('click', postComment);
    loadComments();
  }

  function loadComments() {
    api('page_comments?page=eq.' + encodeURIComponent(PAGE) + '&order=created_at.desc&limit=100&select=nickname,content,created_at')
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (rows) {
        var list = commentsBox.querySelector('#aapCList');
        if (!rows.length) {
          list.innerHTML = '<div class="aap-cempty">还没有评论，来抢沙发～</div>';
          return;
        }
        list.innerHTML = '';
        rows.forEach(function (c) {
          var div = document.createElement('div');
          div.className = 'aap-citem';
          var d = new Date(c.created_at);
          div.innerHTML = '<div class="ch"><span class="cn">' + escapeHtml(c.nickname) + '</span>'
            + '<span class="ct">' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + '</span></div>'
            + '<div class="cb">' + escapeHtml(c.content) + '</div>';
          list.appendChild(div);
        });
      })
      .catch(function () {
        commentsBox.querySelector('#aapCList').innerHTML = '<div class="aap-cempty">评论加载失败，刷新重试</div>';
      });
  }

  function postComment() {
    var nickEl = commentsBox.querySelector('#aapCNick');
    var bodyEl = commentsBox.querySelector('#aapCBody');
    var hint = commentsBox.querySelector('#aapCHint');
    var btn = commentsBox.querySelector('#aapCSend');
    var nick = nickEl.value.trim() || '匿名学友';
    var body = bodyEl.value.trim();
    if (body.length < 2) { hint.textContent = '再多写两个字吧'; return; }
    btn.disabled = true;
    hint.textContent = '发布中…';
    api('page_comments', {
      method: 'POST',
      body: JSON.stringify({ page: PAGE, nickname: nick, content: body })
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      try { localStorage.setItem('aap-nick', nick); } catch (e) {}
      bodyEl.value = '';
      hint.textContent = '已发布 ✓';
      setTimeout(function () { hint.textContent = ''; }, 2000);
      loadComments();
    }).catch(function () {
      hint.textContent = '发布失败，请重试';
    }).then(function () {
      btn.disabled = false;
    });
  }

  /* ================= 启动 ================= */

  paintAll();
  paintFav();
  refreshBadge();
  buildComments();
  if (CLOUD) {
    syncFromCloud().then(function (changed) {
      if (changed) { unpaintAll(); paintAll(); paintFav(); refreshBadge(); }
    });
    setInterval(flushQueue, 30000);
  }
  if (location.hash.indexOf('#nid-') === 0) {
    setTimeout(function () { scrollToMark(location.hash.slice(5)); }, 300);
  }
})();
