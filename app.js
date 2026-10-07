(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const isHost = params.has('host');
  const room = ((params.get('room') || CFG.defaultRoom || 'lecture').replace(/[^\w-]/g, '').slice(0, 40)) || 'lecture';

  // ---------- 保存 ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('rt.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('rt.' + k, JSON.stringify(v)); } catch { /* ignore */ } }
  };
  let clientId = store.get('clientId', null);
  if (!clientId) { clientId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); store.set('clientId', clientId); }

  const settings = {
    name: store.get('hostName', 'Speaker'),
    translate: store.get('translate', true),
    apiKey: store.get('apiKey', ''),
    model: store.get('model', 'claude-sonnet-5-5'),
    context: store.get('context', ''),
    scale: store.get('scale', 1),
    theme: store.get('theme', 'light'),
    showQR: store.get('showQR', true)
  };

  document.body.classList.add(isHost ? 'host' : 'guest');
  // 参加者のスマホは英語のみ（config.js の guestDisplay で切替）
  const enOnly = !isHost && CFG.guestDisplay !== 'both';
  const T = (ja, en) => (enOnly ? en : ja);
  if (enOnly) {
    document.body.classList.add('en-only');
    document.documentElement.lang = 'en';
    document.querySelectorAll('[data-en]').forEach((el) => { el.textContent = el.dataset.en; });
    document.querySelectorAll('[data-en-html]').forEach((el) => { el.innerHTML = el.dataset.enHtml; });
    document.querySelectorAll('[data-en-ph]').forEach((el) => { el.placeholder = el.dataset.enPh; });
  }
  const title = CFG.title || 'Q&A';
  $('#title').textContent = title;
  $('#joinTitle').textContent = title;

  function fatal(msg) { const f = $('#fatal'); f.textContent = msg; f.hidden = false; }

  // ---------- Firebase ----------
  const fbConf = CFG.firebase || {};
  if (!window.firebase) { fatal('Firebase を読み込めませんでした。ネット接続を確認してください。'); return; }
  if (!fbConf.databaseURL) { fatal('config.js に Firebase の設定（databaseURL を含む）を入れてください。'); return; }
  firebase.initializeApp(fbConf);
  const db = firebase.database();
  const base = db.ref('rooms/' + room);
  const msgsRef = base.child('messages');
  const liveRef = base.child('live');
  const presRef = base.child('presence');

  let myName = '';
  const log = $('#log');
  const status = $('#status');

  // ---------- 開始 ----------
  if (isHost) {
    applyHostView();
    myName = settings.name;
    start();
  } else {
    $('#join').hidden = false;
    const ni = $('#nameInput');
    ni.value = store.get('name', '');
    const go = () => {
      const n = ni.value.trim();
      if (!n) { ni.focus(); return; }
      store.set('name', n); myName = n;
      $('#join').hidden = true;
      start();
    };
    $('#joinBtn').onclick = go;
    ni.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  function start() {
    $('#app').hidden = false;
    db.ref('.info/connected').on('value', (s) => {
      status.textContent = s.val() ? '' : T('接続中… / Connecting…', 'Connecting…');
      if (s.val()) {
        const me = presRef.child(clientId);
        me.onDisconnect().remove();
        me.set({ name: myName, host: isHost });
        liveRef.child(clientId).onDisconnect().remove();
      }
    });
    msgsRef.limitToLast(300).on('child_added', (s) => onMessage(s.key, s.val(), true));
    msgsRef.limitToLast(300).on('child_changed', (s) => onMessage(s.key, s.val(), false));
    msgsRef.on('child_removed', (s) => { const el = els.get(s.key); if (el) el.remove(); els.delete(s.key); cache.delete(s.key); updateEmpty(); });
    liveRef.on('value', (s) => renderLive(s.val() || {}));
    if (isHost) presRef.on('value', (s) => {
      const n = Object.values(s.val() || {}).filter((p) => !p.host).length;
      $('#people').textContent = n + '人参加';
    });
  }

  // ---------- 表示 ----------
  const els = new Map();
  const cache = new Map();
  const fmt = (ts) => { if (!ts) return ''; const d = new Date(ts); return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0'); };
  const other = (l) => (l === 'ja' ? 'en' : 'ja');

  function nearBottom() { return log.scrollHeight - log.scrollTop - log.clientHeight < 160; }
  function updateEmpty() { $('#empty').hidden = els.size > 0; }

  function onMessage(key, m, isNew) {
    if (!m) return;
    cache.set(key, m);
    const stick = isHost || nearBottom() || m.clientId === clientId;
    renderMsg(key, m);
    updateEmpty();
    if (stick) log.scrollTop = log.scrollHeight;
    if (isHost && settings.translate && !m.translation && !m.error) enqueue(key, m);
  }

  function renderMsg(key, m) {
    let el = els.get(key);
    if (!el) {
      el = document.createElement('article');
      el.className = 'msg';
      el.innerHTML = '<header class="who"><span class="name"></span><time></time></header><p class="orig"></p><p class="trans"></p>';
      els.set(key, el);
      log.appendChild(el);
    }
    el.classList.toggle('mine', m.clientId === clientId);
    el.dataset.lang = m.lang;
    el.querySelector('.name').textContent = m.name || '—';
    el.querySelector('time').textContent = fmt(m.ts);
    const o = el.querySelector('.orig');
    o.textContent = m.text; o.lang = m.lang;
    const t = el.querySelector('.trans');
    const tl = other(m.lang);
    t.lang = tl;
    if (m.translation) { t.textContent = m.translation; t.classList.remove('pending'); }
    else {
      t.textContent = m.error ? (tl === 'ja' ? '翻訳できませんでした' : 'Translation failed') : (tl === 'ja' ? '翻訳中…' : 'Translating…');
      t.classList.add('pending');
    }
  }

  function renderLive(all) {
    const box = $('#live');
    box.innerHTML = '';
    const now = Date.now();
    Object.entries(all).forEach(([id, x]) => {
      if (id === clientId || !x || !x.text || now - (x.t || 0) > 30000) return;
      const p = document.createElement('p');
      p.className = 'live-item';
      const b = document.createElement('b'); b.textContent = (x.name || '') + ' 🎙';
      const s = document.createElement('span');
      if (enOnly && x.lang === 'ja') { s.textContent = '(speaking in Japanese…)'; s.lang = 'en'; }
      else { s.textContent = x.text; s.lang = x.lang; }
      p.append(b, s);
      box.appendChild(p);
    });
  }

  // ---------- 送信 ----------
  function send(text, lang) {
    text = (text || '').trim();
    if (!text) return;
    msgsRef.push({
      clientId, name: myName, lang, text,
      ts: firebase.database.ServerValue.TIMESTAMP
    });
  }
  const detectLang = (t) => (/[\u3040-\u30ff\u3400-\u9fff]/.test(t) ? 'ja' : 'en');

  $('#textForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#textInput');
    const t = inp.value.trim();
    if (!t) return;
    send(t, detectLang(t));
    inp.value = '';
  });

  // ---------- 音声認識 ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, recLang = 'ja', want = false, cancelled = false;
  let committed = '', sessionFinal = '', interim = '';
  const sep = () => (recLang === 'ja' ? '' : ' ');
  const join2 = (a, b) => (a && b ? a + sep() + b : a || b);
  // Android Chrome は確定結果を累積して重複させることがあるので、前方一致なら置き換える
  function mergeFinal(acc, t) {
    const a = acc.trim(), x = t.trim();
    if (!a) return x;
    if (x.startsWith(a)) return x;
    if (a.endsWith(x)) return a;
    return a + sep() + x;
  }
  const currentText = () => join2(join2(committed, sessionFinal), interim).trim();

  let liveTimer = null, lastLive = 0;
  function pushLive() {
    const run = () => { lastLive = Date.now(); liveTimer = null; liveRef.child(clientId).set({ name: myName, lang: recLang, text: currentText(), t: Date.now() }); };
    if (liveTimer) return;
    const wait = Math.max(0, 350 - (Date.now() - lastLive));
    liveTimer = setTimeout(run, wait);
  }
  function clearLive() { if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; } liveRef.child(clientId).remove(); }

  function showRecording(on) {
    $('#idle').hidden = on;
    $('#textForm').hidden = on;
    $('#recording').hidden = !on;
    $('#recording').dataset.lang = recLang;
  }
  function updatePreview() { $('#recPreview').textContent = currentText(); pushLive(); }

  function startRec(lang) {
    if (!SR) {
      alert(T('このブラウザは音声認識に対応していません。iPhone は Safari、Android は Chrome をお使いください。下の欄に文字で入力することもできます。\n\nSpeech recognition is not available in this browser. Please type instead.',
        'Speech recognition is not available in this browser. Please use Safari on iPhone or Chrome on Android, or type your message below.'));
      return;
    }
    recLang = lang; want = true; cancelled = false;
    committed = ''; sessionFinal = ''; interim = '';
    showRecording(true);
    updatePreview();
    rec = new SR();
    rec.lang = lang === 'ja' ? 'ja-JP' : 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let f = '', i = '';
      for (let k = 0; k < e.results.length; k++) {
        const r = e.results[k];
        if (r.isFinal) f = mergeFinal(f, r[0].transcript);
        else i += r[0].transcript;
      }
      sessionFinal = f; interim = i.trim();
      updatePreview();
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        want = false;
        alert(T('マイクが使えません。ブラウザの設定でマイクを許可してください。\nMicrophone access was blocked. Please allow it in your browser settings.',
          'Microphone access was blocked. Please allow it in your browser settings.'));
      }
    };
    rec.onend = () => {
      committed = mergeFinal(committed, sessionFinal);
      sessionFinal = '';
      if (want) {            // 無音などで勝手に止まったら再開
        try { rec.start(); return; } catch { /* fallthrough */ }
      }
      const text = join2(committed, interim).trim();
      interim = '';
      showRecording(false);
      clearLive();
      if (!cancelled) send(text, recLang);
      rec = null;
    };
    try { rec.start(); } catch (err) { want = false; showRecording(false); }
  }

  document.querySelectorAll('.mic').forEach((b) => (b.onclick = () => startRec(b.dataset.lang)));
  $('#stopBtn').onclick = () => { want = false; if (rec) rec.stop(); };
  $('#cancelBtn').onclick = () => { want = false; cancelled = true; if (rec) rec.abort(); else { showRecording(false); clearLive(); } };

  // ---------- 翻訳（スクリーン用PCだけが実行） ----------
  const inflight = new Set();
  let chain = Promise.resolve();
  function enqueue(key, m) {
    if (inflight.has(key)) return;
    inflight.add(key);
    // 順番を保ち、直前の訳を文脈として使えるように1件ずつ処理
    chain = chain.then(() => translateOne(key, m)).catch(() => {});
  }

  async function translateOne(key, m) {
    const src = m.lang, tgt = other(m.lang);
    let translation = '', engine = '';
    if (settings.apiKey) {
      try { translation = await viaClaude(m, key); engine = 'claude'; }
      catch (err) { console.warn('Claude failed, fallback:', err); status.textContent = 'Claude翻訳エラー：' + err.message + '（Google翻訳に切替）'; }
    }
    if (!translation) {
      try { translation = await viaGoogle(m.text, src, tgt); engine = 'google'; }
      catch (err) { console.warn(err); }
    }
    if (translation) await msgsRef.child(key).update({ translation, engine });
    else await msgsRef.child(key).update({ error: true });
  }

  function historyFor(key) {
    const out = [];
    for (const [k, v] of cache) {
      if (k === key) break;
      if (v.translation) out.push(`[${v.name}] ${v.text}\n  → ${v.translation}`);
    }
    return out.slice(-6).join('\n');
  }

  async function viaClaude(m, key) {
    const tgtName = m.lang === 'ja' ? 'English' : 'Japanese';
    const srcName = m.lang === 'ja' ? 'Japanese' : 'English';
    const system = [
      'You are a professional interpreter for the Q&A session of a university lecture on contemporary music composition. The lecturer is a composer and musicologist presenting his own works in English in Japan; the audience is mixed Japanese and English speakers (students and faculty).',
      'The input is automatic speech recognition output. It may contain misrecognized words, missing punctuation and filler words. Silently correct obvious recognition errors using the context and glossary, drop disfluencies, and translate into natural, precise ' + tgtName + '.',
      'Preserve philosophical and aesthetic nuance; do not simplify the argument. Keep proper names of composers, works and philosophers in their standard form. Keep questions as questions.',
      'When translating into Japanese, use a polite academic register (です・ます).',
      'Output only the translation: no notes, no quotation marks, no original text.',
      settings.context ? '\nLecture context and glossary:\n' + settings.context : ''
    ].join('\n');
    const hist = historyFor(key);
    const user = (hist ? 'Recent conversation (context only, do not translate):\n' + hist + '\n\n' : '') +
      'Translate this ' + srcName + ' utterance by ' + (m.name || 'a participant') + ' into ' + tgtName + ':\n<utterance>\n' + m.text + '\n</utterance>';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: settings.model, max_tokens: 1500, system, messages: [{ role: 'user', content: user }] })
    });
    if (!res.ok) {
      let detail = res.status;
      try { const j = await res.json(); detail = (j.error && j.error.message) || detail; } catch { /* ignore */ }
      throw new Error(String(detail));
    }
    const data = await res.json();
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
    if (!text) throw new Error('empty response');
    return text;
  }

  async function viaGoogle(text, src, tgt) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=' + src + '&tl=' + tgt + '&q=' + encodeURIComponent(text);
    const res = await fetch(url);
    if (!res.ok) throw new Error('google ' + res.status);
    const data = await res.json();
    return (data[0] || []).map((x) => x[0]).join('').trim();
  }

  // ---------- スクリーン用の表示と設定 ----------
  function applyHostView() {
    const rootEl = document.documentElement;
    const applyTheme = () => rootEl.setAttribute('data-theme', settings.theme);
    const applyScale = () => rootEl.style.setProperty('--scale', settings.scale);
    const applyQR = () => { $('#qrPanel').hidden = !settings.showQR; };
    applyTheme(); applyScale(); applyQR();

    const joinUrl = location.origin + location.pathname + '?room=' + encodeURIComponent(room);
    $('#joinUrl').textContent = joinUrl;
    if (window.QRCode) new QRCode($('#qr'), { text: joinUrl, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });

    document.querySelector('.tools').addEventListener('click', (e) => {
      const act = e.target.closest('button') && e.target.closest('button').dataset.act;
      if (!act) return;
      if (act === 'bigger') { settings.scale = Math.min(2.5, +(settings.scale + 0.1).toFixed(2)); store.set('scale', settings.scale); applyScale(); }
      if (act === 'smaller') { settings.scale = Math.max(0.6, +(settings.scale - 0.1).toFixed(2)); store.set('scale', settings.scale); applyScale(); }
      if (act === 'theme') { settings.theme = settings.theme === 'dark' ? 'light' : 'dark'; store.set('theme', settings.theme); applyTheme(); }
      if (act === 'qr') { settings.showQR = !settings.showQR; store.set('showQR', settings.showQR); applyQR(); }
      if (act === 'full') {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
        else document.exitFullscreen();
      }
      if (act === 'settings') openSettings();
    });

    // 画面スリープ防止（対応ブラウザのみ）
    const wake = async () => { try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch { /* ignore */ } };
    wake();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });

    // キー操作：h で入力欄の表示切替
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea')) return;
      if (e.key === 'h') document.body.classList.toggle('hide-composer');
    });

    const dlg = $('#settings');
    function openSettings() {
      $('#sName').value = settings.name;
      $('#sTranslate').checked = settings.translate;
      $('#sKey').value = settings.apiKey;
      $('#sModel').value = settings.model;
      $('#sContext').value = settings.context;
      $('#testOut').textContent = '';
      dlg.showModal();
    }
    function readSettings() {
      settings.name = $('#sName').value.trim() || 'Speaker';
      settings.translate = $('#sTranslate').checked;
      settings.apiKey = $('#sKey').value.trim();
      settings.model = $('#sModel').value;
      settings.context = $('#sContext').value;
      ['name', 'translate', 'apiKey', 'model', 'context'].forEach((k) => store.set(k === 'name' ? 'hostName' : k, settings[k]));
      myName = settings.name;
    }
    dlg.addEventListener('close', () => {
      readSettings();
      presRef.child(clientId).update({ name: myName });
      // 未翻訳のものがあれば処理
      if (settings.translate) for (const [k, v] of cache) if (!v.translation && !v.error) enqueue(k, v);
    });
    $('#testBtn').onclick = async () => {
      readSettings();
      const out = $('#testOut');
      out.textContent = 'テスト中…';
      const sample = { name: 'Test', lang: 'ja', text: '既成の聴取を批判するということは、聴くこと自体の条件を問い直すことだと思うのですが、どうでしょうか。' };
      try {
        const r = settings.apiKey ? await viaClaude(sample, '__test__') : await viaGoogle(sample.text, 'ja', 'en');
        out.textContent = (settings.apiKey ? 'Claude: ' : 'Google: ') + r;
      } catch (err) { out.textContent = 'エラー：' + err.message; }
    };
    $('#clearBtn').onclick = () => {
      if (confirm('この部屋の会話をすべて消去します。よろしいですか？')) { msgsRef.remove(); liveRef.remove(); }
    };
  }
})();
