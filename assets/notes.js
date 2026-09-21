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

  /* ================= 云端配置 =================
   * AI 助教开箱即用：未做任何配置时走内置的免费公共推理端点（匿名额度），
   * 所有读者零配置直接问答。
   * Supabase（界面「⚙ 云端设置」或作者内置常量）用于可选增强：
   * 笔记/收藏跨设备同步、每页评论区；配了 Supabase 后 AI 改走其 Edge Function。 */
  var SUPABASE_URL = '';        // 例如 'https://abcdefgh.supabase.co'
  var SUPABASE_ANON_KEY = '';   // Supabase Settings → API → anon public key
  var ASK_ENDPOINT = '';        // 可选：自定义 OpenAI 兼容答疑网关
  var ASK_API_KEY = '';         // 可选：自定义网关密钥
  var DEFAULT_ASK = 'https://text.pollinations.ai/openai';  // 免登录公共端点（兜底默认）

  function cfg() {
    var c = {};
    try { c = JSON.parse(localStorage.getItem('aap-config') || '{}'); } catch (e) {}
    return {
      url: String(c.url || SUPABASE_URL || '').replace(/\/+$/, ''),
      key: c.key || SUPABASE_ANON_KEY || '',
      ask: c.ask || ASK_ENDPOINT || '',
      askKey: c.askKey || ASK_API_KEY || ''
    };
  }
  function isCloud() { var c = cfg(); return !!(c.url && c.key); }
  function askEndpoint() {
    var c = cfg();
    if (c.ask) return c.ask;
    if (c.url) return c.url + '/functions/v1/ask';
    return DEFAULT_ASK;
  }
  function isAiReady() { return true; }   // 始终可用：兜底走公共端点
  /* 是否走本站 Supabase Edge Function（{answer} 格式）；其余一律按 OpenAI 兼容处理 */
  function useEdgeFn() { var c = cfg(); return !c.ask && !!c.url; }

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
  function doubts(page) {
    return db.items.filter(function (i) { return i.type === 'doubt' && (!page || i.page === page); });
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
    var c = cfg();
    opts = opts || {};
    opts.headers = Object.assign({
      'apikey': c.key,
      'Authorization': 'Bearer ' + c.key,
      'Content-Type': 'application/json'
    }, opts.headers || {});
    return fetch(c.url + '/rest/v1/' + path, opts);
  }

  function cloudUpsert(item) {
    if (!isCloud()) return;
    enqueue({ op: 'upsert', item: item });
    flushQueue();
  }
  function cloudDelete(id) {
    if (!isCloud()) return;
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
    if (!isCloud() || flushing) return;
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
    if (!isCloud()) return Promise.resolve(false);
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
      local: ['本地模式 · 同步码可换设备', '#b0aa9c']
    };
    var m = map[state] || map.local;
    syncBadgeEl.textContent = m[0];
    syncBadgeEl.style.color = m[1];
  }

  /* 换设备：同步码即数据本体（base64 编码的全部笔记），不依赖任何服务器 */
  var SYNC_PREFIX = 'AAP1.';
  function exportSyncCode() {
    var json = JSON.stringify(db.items);
    return SYNC_PREFIX + btoa(unescape(encodeURIComponent(json)));
  }
  function importSyncCode(code) {
    code = String(code || '').trim();
    if (code.indexOf(SYNC_PREFIX) !== 0) return { ok: false, msg: '同步码格式不对（应以 ' + SYNC_PREFIX + ' 开头）' };
    var items;
    try {
      items = JSON.parse(decodeURIComponent(escape(atob(code.slice(SYNC_PREFIX.length)))));
      if (!Array.isArray(items)) throw new Error('bad');
    } catch (e) { return { ok: false, msg: '同步码无法解析，请确认完整复制' }; }
    var byId = {};
    db.items.forEach(function (i) { byId[i.id] = i; });
    var added = 0, updated = 0;
    items.forEach(function (r) {
      if (!r || !r.id || !r.type) return;
      var local = byId[r.id];
      if (!local) { db.items.push(r); added++; }
      else if ((r.ts || 0) > (local.ts || 0)) { db.items[db.items.indexOf(local)] = r; updated++; }
    });
    save();
    unpaintAll(); paintAll(); paintFav(); refreshBadge(); renderList();
    return { ok: true, msg: '导入完成：新增 ' + added + ' 条，更新 ' + updated + ' 条' };
  }

  /* ================= 样式 ================= */

  var css = ''
    + '.aap-mark{cursor:pointer;border-radius:2px;transition:background .2s;}'
    + '.aap-line{background:linear-gradient(transparent 55%, rgba(250,204,21,.45) 55%);}'
    + '.aap-note{background:rgba(15,118,110,.14);border-bottom:1px dashed #0f766e;}'
    + '.aap-note::after{content:"✎";font-size:.72em;color:#0f766e;margin-left:1px;vertical-align:super;}'
    + '.aap-doubtmk{background:rgba(234,88,12,.10);border-bottom:1px dashed #ea580c;}'
    + '.aap-doubtmk::after{content:"?";font-size:.72em;font-weight:700;color:#ea580c;margin-left:1px;vertical-align:super;}'
    + '.aap-doubtmk.resolved{opacity:.75;border-bottom-color:#b0aa9c;}'
    + '.aap-doubtmk.resolved::after{content:"✓";color:#0f766e;}'
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
    + '.aap-pop .ans{margin-top:8px;padding:8px 10px;background:#f0faf8;border-radius:6px;line-height:1.7;white-space:pre-wrap;font-size:12.5px;color:#115e59;max-height:220px;overflow-y:auto;}'
    + '.aap-pop .ans .who{font-size:11px;color:#0f766e;font-weight:600;display:block;margin-bottom:4px;}'
    + '.aap-pop .st{display:inline-block;font-size:11px;padding:1px 8px;border-radius:9px;margin-left:6px;}'
    + '.aap-pop .st.open{background:#fff7ed;color:#ea580c;}'
    + '.aap-pop .st.done{background:#f0faf8;color:#0f766e;}'
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
    + '.aap-item .dq{font-size:12.5px;color:#c2410c;margin-top:6px;line-height:1.55;white-space:pre-wrap;}'
    + '.aap-item .da{font-size:12px;color:#115e59;margin-top:6px;line-height:1.6;background:#f0faf8;border-radius:6px;padding:6px 9px;max-height:100px;overflow:hidden;white-space:pre-wrap;}'
    + '.aap-item .st{display:inline-block;font-size:10.5px;padding:0 7px;border-radius:8px;margin-left:6px;}'
    + '.aap-item .st.open{background:#fff7ed;color:#ea580c;}'
    + '.aap-item .st.done{background:#f0faf8;color:#0f766e;}'
    + '.aap-item .mini{border:0;background:none;color:#c7c2b6;cursor:pointer;font-size:11.5px;margin-left:8px;padding:0;}'
    + '.aap-item .mini:hover{color:#0f766e;}'
    + '.aap-item .mini.thinking{color:#b45309;pointer-events:none;}'
    + '.aap-empty{text-align:center;color:#b0aa9c;font-size:12.5px;padding:42px 20px;line-height:2;}'
    + '.aap-drawer footer{padding:10px 14px;border-top:1px solid #efece4;}'
    + '.aap-drawer footer .syncrow{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11.5px;}'
    + '.aap-drawer footer .syncrow .sp{flex:1;}'
    + '.aap-drawer footer .syncrow button{border:1px solid #e5e1d8;background:#fff;border-radius:6px;padding:3px 9px;font:inherit;font-size:11.5px;color:#57534e;cursor:pointer;}'
    + '.aap-drawer footer .syncrow button:hover{border-color:#0f766e;color:#0f766e;}'
    + '.aap-drawer footer .btnrow{display:flex;gap:8px;}'
    + '.aap-drawer footer .btnrow button{flex:1;border:1px solid #e5e1d8;background:#fff;border-radius:7px;padding:8px;font:inherit;font-size:12.5px;color:#57534e;cursor:pointer;}'
    + '.aap-drawer footer .btnrow button:hover{border-color:#0f766e;color:#0f766e;}'
    /* 对话面板 */
    + '.aap-chat{position:fixed;top:0;right:0;bottom:0;width:min(400px,94vw);background:#fffdf9;border-left:1px solid #e5e1d8;box-shadow:-12px 0 40px rgba(60,50,30,.14);z-index:88;display:flex;flex-direction:column;transform:translateX(103%);transition:transform .25s ease;}'
    + '.aap-chat.open{transform:translateX(0);}'
    + '.aap-chat header{padding:12px 14px;border-bottom:1px solid #efece4;}'
    + '.aap-chat .ct{font-size:13.5px;font-weight:600;color:#292524;display:flex;align-items:center;margin-bottom:6px;}'
    + '.aap-chat .ct .x{margin-left:auto;border:0;background:none;font-size:18px;cursor:pointer;color:#8a8578;}'
    + '.aap-chat .cq{font-size:12px;color:#8a8578;border-left:3px solid #e7d9a8;padding-left:8px;max-height:54px;overflow:hidden;line-height:1.5;}'
    + '.aap-chat .hacts{margin-top:6px;display:flex;gap:6px;}'
    + '.aap-chat .hacts button{border:1px solid #e5e1d8;background:#fff;border-radius:6px;padding:2px 10px;font:inherit;font-size:11.5px;color:#57534e;cursor:pointer;}'
    + '.aap-chat .hacts button:hover{border-color:#0f766e;color:#0f766e;}'
    + '.aap-chatlog{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;}'
    + '.aap-msg{max-width:86%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.7;white-space:pre-wrap;word-break:break-word;}'
    + '.aap-msg.user{align-self:flex-end;background:#0f766e;color:#fff;border-bottom-right-radius:4px;}'
    + '.aap-msg.ai{align-self:flex-start;background:#f5f3ee;color:#3f3a32;border-bottom-left-radius:4px;}'
    + '.aap-msg.typing{color:#b0aa9c;}'
    + '.aap-msg.err{background:#fef2f2;color:#991b1b;}'
    + '.aap-chatform{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #efece4;}'
    + '.aap-chatform textarea{flex:1;height:44px;resize:none;border:1px solid #e5e1d8;border-radius:8px;padding:9px 10px;font:inherit;font-size:13px;color:#333;outline:none;background:#fff;}'
    + '.aap-chatform textarea:focus{border-color:#0f766e;}'
    + '.aap-chatform button{border:1px solid #0f766e;background:#0f766e;color:#fff;border-radius:8px;padding:0 16px;font:inherit;font-size:13px;cursor:pointer;}'
    + '.aap-chatform button:disabled{opacity:.5;cursor:not-allowed;}'
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
    + '.aap-wall{display:flex;gap:10px;flex-wrap:wrap;}'
    + '.aap-wall .wbtn{display:inline-block;border:1px solid #e5e1d8;background:#fff;border-radius:8px;padding:9px 16px;font-size:13px;color:#57534e;text-decoration:none;cursor:pointer;}'
    + '.aap-wall .wbtn:hover{border-color:#0f766e;color:#0f766e;}'
    + '.aap-wall .wbtn.primary{background:#0f766e;border-color:#0f766e;color:#fff;}'
    + '@media (max-width:900px){.aap-fab{right:14px;bottom:18px;}.aap-pop{width:min(300px,86vw);}}'
    /* 云端设置弹窗 */
    + '.aap-settings{position:fixed;inset:0;z-index:95;background:rgba(41,37,36,.45);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;}'
    + '.aap-settings .card{background:#fffdf9;border:1px solid #e5e1d8;border-radius:12px;box-shadow:0 18px 60px rgba(60,50,30,.3);width:min(460px,100%);max-height:88vh;overflow-y:auto;padding:22px 24px;}'
    + '.aap-settings h3{margin:0 0 4px;font-size:16px;color:#292524;display:flex;align-items:center;}'
    + '.aap-settings h3 .x{margin-left:auto;border:0;background:none;font-size:20px;cursor:pointer;color:#8a8578;}'
    + '.aap-settings .sub{font-size:12px;color:#8a8578;line-height:1.7;margin-bottom:16px;}'
    + '.aap-settings label{display:block;font-size:12.5px;color:#57534e;margin:12px 0 5px;font-weight:600;}'
    + '.aap-settings input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #e5e1d8;border-radius:7px;font:inherit;font-size:13px;color:#333;outline:none;background:#fff;}'
    + '.aap-settings input:focus{border-color:#0f766e;}'
    + '.aap-settings .adv{font-size:11.5px;color:#b0aa9c;margin-top:18px;border-top:1px dashed #efece4;padding-top:12px;}'
    + '.aap-settings .srow{display:flex;gap:8px;margin-top:18px;flex-wrap:wrap;}'
    + '.aap-settings .srow button{border:1px solid #e5e1d8;background:#fff;border-radius:7px;padding:8px 14px;font:inherit;font-size:12.5px;color:#57534e;cursor:pointer;}'
    + '.aap-settings .srow button:hover{border-color:#0f766e;color:#0f766e;}'
    + '.aap-settings .srow button.primary{background:#0f766e;border-color:#0f766e;color:#fff;}'
    + '.aap-settings .srow button.danger{color:#dc2626;}'
    + '.aap-settings .smsg{font-size:12px;margin-top:10px;min-height:16px;}'
    + '.aap-settings .smsg.ok{color:#0f766e;}'
    + '.aap-settings .smsg.bad{color:#dc2626;}';

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
    var cls = 'aap-mark ' + (item.kind === 'note' ? 'aap-note' : (item.type === 'doubt' ? 'aap-doubtmk' + (item.status === 'done' ? ' resolved' : '') : 'aap-line'));
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
    marks(PAGE).concat(doubts(PAGE)).sort(function (a, b) { return cmpAnchor(b, a); }).forEach(paintMark);
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
    if (e.key === 'Escape') { closeFloating(); closeDrawer(); if (typeof closeChat === 'function') closeChat(); if (typeof closeSettings === 'function') closeSettings(); }
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
        + '<button data-act="doubt">? 不懂</button>'
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
        if (act === 'doubt') {
          createDoubt(range, text);
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

  /* ================= 疑问对话（不懂 → 与 AI 助教多轮讨论） ================= */

  function createDoubt(range, text) {
    var pending = {
      text: text.slice(0, 200),
      sPath: nodePath(range.startContainer), sOff: range.startOffset,
      ePath: nodePath(range.endContainer), eOff: range.endOffset
    };
    window.getSelection().removeAllRanges();
    closeFloating();
    openChat(null, pending);
  }

  /* ---------- 对话面板 ---------- */
  var chatPanel = null;
  var chatItem = null;      // 当前对话挂的疑问卡（全局助教模式为 null）
  var chatPending = null;   // 尚未保存的新疑问锚点
  var chatLog = [];         // 当前对话消息 [{role, content, ts}]
  var chatSending = false;

  function ensureChatPanel() {
    if (chatPanel) return;
    chatPanel = document.createElement('div');
    chatPanel.className = 'aap-chat';
    chatPanel.innerHTML = ''
      + '<header>'
      + '<div class="ct">AI 助教<button class="x" title="关闭">×</button></div>'
      + '<div class="cq"></div>'
      + '<div class="hacts"></div>'
      + '</header>'
      + '<div class="aap-chatlog"></div>'
      + '<div class="aap-chatform">'
      + '<textarea placeholder="哪里不懂？直接问，可以来回讨论……"></textarea>'
      + '<button>发送</button>'
      + '</div>';
    document.body.appendChild(chatPanel);
    chatPanel.querySelector('.x').addEventListener('click', closeChat);
    chatPanel.querySelector('.hacts').addEventListener('click', function (e) {
      var a = e.target.getAttribute('data-h');
      if (a === 'settings') { openSettings(); return; }
      if (!chatItem) return;
      if (a === 'toggle') {
        chatItem.status = chatItem.status === 'done' ? 'open' : 'done';
        chatItem.ts = Date.now();
        save(); cloudUpsert(chatItem);
        unpaint(chatItem.id); paintMark(chatItem);
        renderList();
        paintChatHeader();
      }
      if (a === 'del') { removeItem(chatItem.id); closeChat(); }
    });
    var ta = chatPanel.querySelector('textarea');
    var btn = chatPanel.querySelector('.aap-chatform button');
    function submit() {
      var text = ta.value.trim();
      if (!text || chatSending) return;
      ta.value = '';
      sendChat(text);
    }
    btn.addEventListener('click', submit);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    });
  }

  function paintChatHeader() {
    var q = chatPanel.querySelector('.cq');
    var acts = chatPanel.querySelector('.hacts');
    var quote = chatItem ? chatItem.text : (chatPending ? chatPending.text : '');
    q.textContent = quote ? '原文：' + quote : '当前章节：《' + PAGE_TITLE + '》——随便问';
    acts.innerHTML = (chatItem
      ? '<button data-h="toggle">' + (chatItem.status === 'done' ? '标回未懂' : '已搞懂 ✓') + '</button>'
        + '<button data-h="del">删除此疑问</button>'
      : '')
      + '<button data-h="settings">⚙ 设置</button>';
  }

  function renderChatMessages() {
    var log = chatPanel.querySelector('.aap-chatlog');
    log.innerHTML = '';
    if (!chatLog.length) {
      var tip = document.createElement('div');
      tip.className = 'aap-msg ai';
      tip.textContent = chatItem || chatPending
        ? '我是本教程的 AI 助教。你划的这段哪里不懂？直接问，我会结合原文讲，可以追问。'
        : '我是本教程的 AI 助教。关于《' + PAGE_TITLE + '》这章有什么想讨论的？';
      log.appendChild(tip);
      return;
    }
    chatLog.forEach(function (m) {
      var div = document.createElement('div');
      div.className = 'aap-msg ' + (m.role === 'user' ? 'user' : 'ai');
      div.textContent = m.content;
      log.appendChild(div);
    });
    log.scrollTop = log.scrollHeight;
  }

  /* 打开对话：item=已有疑问卡；pending=刚划选的新疑问；都为空=本章自由问答 */
  function openChat(item, pending) {
    ensureChatPanel();
    chatItem = item || null;
    chatPending = pending || null;
    if (chatItem) {
      if (!chatItem.chat) {
        chatItem.chat = [];
        if (chatItem.question) chatItem.chat.push({ role: 'user', content: chatItem.question });
        if (chatItem.answer) chatItem.chat.push({ role: 'assistant', content: chatItem.answer });
      }
      chatLog = chatItem.chat;
    } else if (chatPending) {
      chatLog = [];
    } else {
      try { chatLog = JSON.parse(localStorage.getItem('aap-chat:' + PAGE) || '[]'); } catch (e) { chatLog = []; }
    }
    paintChatHeader();
    renderChatMessages();
    chatPanel.classList.add('open');
    chatPanel.querySelector('textarea').focus();
  }
  function closeChat() { if (chatPanel) chatPanel.classList.remove('open'); }

  function persistChat() {
    if (chatItem) {
      save(); cloudUpsert(chatItem);
    } else {
      try { localStorage.setItem('aap-chat:' + PAGE, JSON.stringify(chatLog.slice(-50))); } catch (e) {}
    }
  }

  function sendChat(text) {
    if (chatSending) return;
    /* 首个问题落地成疑问卡（划线锚点 + 橙色标记） */
    if (chatPending && !chatItem) {
      chatItem = {
        id: uid(), type: 'doubt', page: PAGE, title: PAGE_TITLE,
        sPath: chatPending.sPath, sOff: chatPending.sOff,
        ePath: chatPending.ePath, eOff: chatPending.eOff,
        text: chatPending.text, question: text, answer: '', status: 'open', ts: Date.now(), chat: []
      };
      chatLog = chatItem.chat;
      db.items.push(chatItem);
      paintMark(chatItem);
      chatPending = null;
      refreshBadge();
      paintChatHeader();
    }
    chatSending = true;
    var btn = chatPanel.querySelector('.aap-chatform button');
    btn.disabled = true;
    chatLog.push({ role: 'user', content: text, ts: Date.now() });
    renderChatMessages();
    var log = chatPanel.querySelector('.aap-chatlog');
    var typing = document.createElement('div');
    typing.className = 'aap-msg ai typing';
    typing.textContent = '思考中…';
    log.appendChild(typing);
    log.scrollTop = log.scrollHeight;

    var ac = cfg();
    var headers = { 'Content-Type': 'application/json' };
    var body;
    if (useEdgeFn()) {
      /* 本站 Supabase Edge Function：服务端组装提示词，返回 {answer} */
      if (ac.askKey) headers['Authorization'] = 'Bearer ' + ac.askKey;
      else if (ac.key) {
        headers['apikey'] = ac.key;
        headers['Authorization'] = 'Bearer ' + ac.key;
      }
      body = {
        messages: chatLog.slice(-12).map(function (m) { return { role: m.role, content: m.content }; }),
        quote: chatItem ? chatItem.text : '',
        page: PAGE,
        title: chatItem ? chatItem.title : PAGE_TITLE
      };
    } else {
      /* OpenAI 兼容端点（含内置公共默认端点）：客户端组装 system 提示词 */
      if (ac.askKey) headers['Authorization'] = 'Bearer ' + ac.askKey;
      var quote = chatItem ? chatItem.text : (chatPending ? chatPending.text : '');
      var sys = '你是中文自学教程《AI 全栈架构师之路》的 AI 助教，读者是零基础到进阶的学习者。'
        + '当前章节：《' + (chatItem ? chatItem.title : PAGE_TITLE) + '》。'
        + (quote ? '读者划选了原文：「' + quote.slice(0, 300) + '」。' : '')
        + '请用通俗的中文讲解，结合原文与章节上下文，多用类比和小例子；回答控制在 300 字以内；读者可以追问，保持连贯。';
      body = {
        model: 'openai',
        messages: [{ role: 'system', content: sys }]
          .concat(chatLog.slice(-12).map(function (m) { return { role: m.role, content: m.content }; }))
      };
    }
    fetch(askEndpoint(), {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (d) {
      var ans = (d && d.answer)
        || (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content)
        || '';
      ans = String(ans).trim();
      if (!ans) throw new Error('empty');
      typing.remove();
      chatLog.push({ role: 'assistant', content: ans, ts: Date.now() });
      if (chatItem) {
        chatItem.answer = ans;
        chatItem.ts = Date.now();
      }
      persistChat();
      renderChatMessages();
      renderList();
    }).catch(function () {
      typing.className = 'aap-msg ai err';
      typing.textContent = 'AI 助教暂时不可用（公共端点可能拥挤），请稍后再发一次；你的疑问已保存在「疑问清单」。';
    }).then(function () {
      chatSending = false;
      btn.disabled = false;
      chatPanel.querySelector('textarea').focus();
    });
  }



  /* ================= 点击标记 → 详情 ================= */

  contentEl.addEventListener('click', function (e) {
    var span = e.target.closest('.aap-mark');
    if (!span) return;
    var id = span.getAttribute('data-nid');
    var item = db.items.filter(function (i) { return i.id === id; })[0];
    if (!item) return;
    if (item.type === 'doubt') { openChat(item); return; }
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
    + '<button id="aapNoteBtn" title="我的笔记">✎<span class="badge" id="aapBadge" style="display:none"></span></button>'
    + '<button id="aapChatBtn" title="AI 助教：关于本章随便问">💬</button>';
  document.body.appendChild(fab);

  function paintFav() {
    var b = fab.querySelector('#aapFavBtn');
    var on = isFav(PAGE);
    b.textContent = on ? '★' : '☆';
    b.className = on ? 'faved' : '';
    b.title = on ? '已收藏，点击取消' : '收藏本页';
  }
  function refreshBadge() {
    var n = marks().length + doubts().length;
    var badge = fab.querySelector('#aapBadge');
    badge.style.display = n ? '' : 'none';
    badge.textContent = n > 99 ? '99+' : n;
  }
  fab.querySelector('#aapFavBtn').addEventListener('click', toggleFav);
  fab.querySelector('#aapChatBtn').addEventListener('click', function () {
    openChat(null, null);
  });

  var drawer = document.createElement('div');
  drawer.className = 'aap-drawer';
  drawer.innerHTML = ''
    + '<header><h3>我的笔记与收藏<button class="x" title="关闭">×</button></h3>'
    + '<div class="aap-tabs">'
    + '<button data-tab="notes" class="on">划线与想法</button>'
    + '<button data-tab="doubts">疑问</button>'
    + '<button data-tab="favs">收藏</button>'
    + '</div></header>'
    + '<div class="aap-list" id="aapList"></div>'
    + '<footer>'
    + '<div class="syncrow"><span class="sp" id="aapSyncState"></span>'
    + '<button id="aapCopyKey">导出同步码</button>'
    + '<button id="aapUseKey">导入同步码</button>'
    + '<button id="aapSettingsBtn">⚙ 云端</button></div>'
    + '<div class="btnrow"><button id="aapExport">导出 Markdown</button></div>'
    + '</footer>';
  document.body.appendChild(drawer);
  syncBadgeEl = drawer.querySelector('#aapSyncState');
  setSyncBadge(isCloud() ? 'syncing' : 'local');

  drawer.querySelector('#aapSettingsBtn').addEventListener('click', openSettings);

  drawer.querySelector('#aapCopyKey').addEventListener('click', function () {
    var k = exportSyncCode();
    function done() {
      var b = drawer.querySelector('#aapCopyKey');
      b.textContent = '已复制 ✓';
      setTimeout(function () { b.textContent = '导出同步码'; }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(k).then(done, done);
    } else {
      window.prompt('长按复制你的同步码（换设备时粘贴导入）：', k);
    }
  });
  drawer.querySelector('#aapUseKey').addEventListener('click', function () {
    var code = window.prompt('粘贴另一台设备上「导出同步码」得到的同步码，笔记会合并进本机：');
    if (!code || !code.trim()) return;
    var r = importSyncCode(code);
    window.alert(r.msg);
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
    if (curTab === 'doubts') { renderDoubts(list); return; }
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

  /* 疑问清单：未搞懂优先，按章节分组 */
  function renderDoubts(list) {
    var ds = doubts().sort(function (a, b) {
      if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1;
      return b.ts - a.ts;
    });
    list.innerHTML = ds.length ? '' : '<div class="aap-empty">还没有疑问<br>读不懂的地方选中文字<br>点「? 不懂」收集起来，AI 帮你讲透</div>';
    if (ds.length) {
      var openN = ds.filter(function (d) { return d.status !== 'done'; }).length;
      var stat = document.createElement('div');
      stat.className = 'aap-group';
      stat.textContent = '共 ' + ds.length + ' 个疑问 · ' + openN + ' 个待搞懂';
      list.appendChild(stat);
    }
    var lastPage = null;
    ds.forEach(function (d) {
      if (d.page !== lastPage) {
        lastPage = d.page;
        var g = document.createElement('div');
        g.className = 'aap-group';
        g.textContent = (d.page === PAGE ? '本篇 · ' : '') + d.title;
        list.appendChild(g);
      }
      var div = document.createElement('div');
      div.className = 'aap-item';
      div.innerHTML = '<div class="aq">' + escapeHtml(d.text) + '</div>'
        + '<div class="dq">？' + escapeHtml(d.question || '这段没看懂')
        + '<span class="st ' + (d.status === 'done' ? 'done' : 'open') + '">' + (d.status === 'done' ? '已搞懂' : '未搞懂') + '</span></div>'
        + (d.answer ? '<div class="da">' + escapeHtml(d.answer) + '</div>' : '')
        + '<div class="am">' + fmtTs(d.ts)
        + '<button class="mini" data-x="ask">对话 💬</button>'
        + '<button class="mini" data-x="toggle">' + (d.status === 'done' ? '标回未懂' : '已懂 ✓') + '</button>'
        + '<button class="del">删除</button></div>';
      div.addEventListener('click', function (e) {
        var x = e.target.getAttribute && e.target.getAttribute('data-x');
        if (e.target.className === 'del') { removeItem(d.id); return; }
        if (x === 'ask') { openChat(d); return; }
        if (x === 'toggle') {
          d.status = d.status === 'done' ? 'open' : 'done';
          d.ts = Date.now();
          save(); cloudUpsert(d);
          unpaint(d.id); paintMark(d);
          renderList();
          return;
        }
        if (d.page === PAGE) {
          closeDrawer();
          scrollToMark(d.id);
        } else {
          location.href = d.page + '.html#nid-' + d.id;
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
    var dts = doubts();
    if (dts.length) {
      lines.push('## 疑问清单', '');
      dts.sort(function (a, b) { return b.ts - a.ts; }).forEach(function (d) {
        lines.push('### ' + (d.status === 'done' ? '[已搞懂] ' : '[待搞懂] ') + d.title, '');
        lines.push('> ' + d.text.replace(/\n/g, ' '), '');
        lines.push('？' + (d.question || '这段没看懂'), '');
        if (d.answer) lines.push('AI 助教：' + d.answer, '');
      });
    }
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

  /* ================= 评论区 =================
   * 默认（零配置）：飞书评论墙——站长统一开通，读者免登录填写，全站可见。
   * 自托管 Supabase（⚙ 云端里配置）时升级为页内实时评论区。 */
  var COMMENT_FORM_URL = '';   // 飞书表单公开填写链接（站长配置）
  var COMMENT_VIEW_URL = '';   // 飞书表格公开查看链接（站长配置）

  var commentsBox = null;
  function buildComments() {
    if (isCloud()) { buildCloudComments(); return; }
    if (!COMMENT_FORM_URL) return;
    commentsBox = document.createElement('section');
    commentsBox.className = 'aap-comments';
    commentsBox.innerHTML = ''
      + '<h2>评论墙</h2>'
      + '<div class="c-sub">站长统一开通 · 免登录留言，全站读者可见</div>'
      + '<div class="aap-wall">'
      + '<a class="wbtn primary" target="_blank" rel="noopener" href="' + COMMENT_FORM_URL + '">✍️ 写评论（《' + escapeHtml(PAGE_TITLE.slice(0, 20)) + '》）</a>'
      + '<a class="wbtn" target="_blank" rel="noopener" href="' + COMMENT_VIEW_URL + '">📋 查看全部评论</a>'
      + '</div>'
      + '<div class="c-sub" style="margin-top:8px">留言时注明当前章节，方便大家定位讨论。</div>';
    var pn = contentEl.querySelector('.prevnext');
    contentEl.insertBefore(commentsBox, pn || null);
  }

  function buildCloudComments() {
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

  /* ================= 云端设置弹窗 ================= */

  var settingsEl = null;
  function openSettings() {
    if (settingsEl) return;
    var c = cfg();
    settingsEl = document.createElement('div');
    settingsEl.className = 'aap-settings';
    settingsEl.innerHTML = ''
      + '<div class="card">'
      + '<h3>⚙ 云端与同步<button class="x" title="关闭">×</button></h3>'
      + '<div class="sub">开箱即用，无需任何配置：<br>'
      + '✅ AI 助教：内置免费公共模型，划词即问<br>'
      + '✅ 评论墙：站长统一开通（章节底部「写评论」，免登录）<br>'
      + '✅ 笔记换设备：笔记抽屉底部「导出/导入同步码」，同步码即数据，不经过任何服务器</div>'
      + '<div class="sub" style="color:#57534e;font-weight:600">高级：自托管 Supabase（一般不用配）</div>'
      + '<div class="sub">想让笔记自动实时上云、评论区变成页内实时讨论，才需要填下面两项。到 supabase.com 免费建项目 → SQL Editor 执行本教程附带的 supabase-setup.sql → Settings → API 复制。</div>'
      + '<label>Supabase Project URL</label>'
      + '<input id="aapSUrl" placeholder="https://abcdefgh.supabase.co" value="' + escapeHtml(c.url) + '"/>'
      + '<label>anon public key</label>'
      + '<input id="aapSKey" placeholder="eyJhbGciOi…" value="' + escapeHtml(c.key) + '"/>'
      + '<div class="adv">高级选项（一般不用填）：自带答疑网关时填写，留空则默认用 Supabase Edge Function ask</div>'
      + '<label>自定义答疑网关 endpoint（可选）</label>'
      + '<input id="aapSAsk" placeholder="https://…/ask" value="' + escapeHtml(c.ask) + '"/>'
      + '<label>网关 Key（可选）</label>'
      + '<input id="aapSAskKey" placeholder="留空则复用 anon key" value="' + escapeHtml(c.askKey) + '"/>'
      + '<div class="srow">'
      + '<button id="aapSTest">测试连接</button>'
      + '<button class="primary" id="aapSSave">保存并刷新</button>'
      + '<button class="danger" id="aapSClear">清除自定义配置</button>'
      + '</div>'
      + '<div class="smsg" id="aapSMsg"></div>'
      + '</div>';
    document.body.appendChild(settingsEl);
    function msg(text, ok) {
      var m = settingsEl.querySelector('#aapSMsg');
      m.textContent = text;
      m.className = 'smsg ' + (ok ? 'ok' : 'bad');
    }
    function collect() {
      return {
        url: settingsEl.querySelector('#aapSUrl').value.trim().replace(/\/+$/, ''),
        key: settingsEl.querySelector('#aapSKey').value.trim(),
        ask: settingsEl.querySelector('#aapSAsk').value.trim(),
        askKey: settingsEl.querySelector('#aapSAskKey').value.trim()
      };
    }
    settingsEl.querySelector('.x').addEventListener('click', closeSettings);
    settingsEl.addEventListener('mousedown', function (e) {
      if (e.target === settingsEl) closeSettings();
    });
    settingsEl.querySelector('#aapSTest').addEventListener('click', function () {
      var v = collect();
      if (!v.url || !v.key) { msg('先填 Project URL 和 anon key', false); return; }
      msg('连接中…', true);
      fetch(v.url + '/rest/v1/reading_notes?limit=1', {
        headers: { 'apikey': v.key, 'Authorization': 'Bearer ' + v.key }
      }).then(function (r) {
        if (r.ok) msg('✓ 连接成功，点「保存并刷新」生效', true);
        else msg('✗ 连接失败（HTTP ' + r.status + '）——检查 URL/key 是否正确、数据表是否已创建', false);
      }).catch(function () {
        msg('✗ 网络不通——检查 URL 是否拼对、项目是否在运行', false);
      });
    });
    settingsEl.querySelector('#aapSSave').addEventListener('click', function () {
      var v = collect();
      if (!v.url && !v.key && !v.ask) { msg('啥都没填：要保存请至少填 URL + key，或点「清除自定义配置」', false); return; }
      try { localStorage.setItem('aap-config', JSON.stringify(v)); } catch (e) {}
      location.reload();
    });
    settingsEl.querySelector('#aapSClear').addEventListener('click', function () {
      try { localStorage.removeItem('aap-config'); } catch (e) {}
      location.reload();
    });
  }
  function closeSettings() {
    if (settingsEl) { settingsEl.remove(); settingsEl = null; }
  }

  /* ================= 启动 ================= */

  paintAll();
  paintFav();
  refreshBadge();
  buildComments();
  if (isCloud()) {
    syncFromCloud().then(function (changed) {
      if (changed) { unpaintAll(); paintAll(); paintFav(); refreshBadge(); }
    });
    setInterval(flushQueue, 30000);
  }
  if (location.hash.indexOf('#nid-') === 0) {
    setTimeout(function () { scrollToMark(location.hash.slice(5)); }, 300);
  }
})();
