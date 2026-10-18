/* Zynora voor Android: vervangt de pc-onderdelen door versies die in de app zelf draaien */
(function () {
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  window.ZA = 1;
  const P = C.Plugins || {}, CH = P.CapacitorHttp, A = P.App, MS = P.MediaSession;
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
  const LSget = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const LSset = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const H = (url, o) => CH.request(Object.assign({ url, method: 'GET', headers: { 'User-Agent': UA } }, o || {}));
  const parse = d => (typeof d === 'string' ? (d ? JSON.parse(d) : null) : d);
  const GJ = async u => { const r = await H(u); if (r.status >= 400) throw new Error('status ' + r.status); return parse(r.data); };
  const nn = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const EXT = /\.(mp3|m4a|aac|flac|ogg|opus|wav|webm)$/i;
  const toast = m => { try { window.toast(m); } catch (e) {} };

  /* ---------- opslag in de app (OPFS) ---------- */
  const opfs = async (name, create) => (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: !!create });
  const urlName = new Map(), rmName = new Map(); let urls = [];
  const K = k => (String(k).startsWith('blob:') ? 'f:' + (urlName.get(k) || k) : k);

  async function id3(file) {
    try {
      const b = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
      if (b[0] !== 73 || b[1] !== 68 || b[2] !== 51) return {};
      const ver = b[3], sz = ((b[6] & 127) << 21) | ((b[7] & 127) << 14) | ((b[8] & 127) << 7) | (b[9] & 127);
      let p = 10; const end = Math.min(10 + sz, b.length), o = {};
      while (p + 10 < end) {
        const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
        const fs = ver === 4 ? ((b[p + 4] & 127) << 21) | ((b[p + 5] & 127) << 14) | ((b[p + 6] & 127) << 7) | (b[p + 7] & 127) : ((b[p + 4] << 24) | (b[p + 5] << 16) | (b[p + 6] << 8) | b[p + 7]);
        if (!(fs > 0) || id.charCodeAt(0) === 0) break;
        if (id === 'TIT2' || id === 'TPE1' || id === 'TALB') {
          const enc = b[p + 10]; let s = '';
          try { s = new TextDecoder(enc === 1 ? 'utf-16' : enc === 2 ? 'utf-16be' : enc === 3 ? 'utf-8' : 'iso-8859-1').decode(b.subarray(p + 11, p + 10 + fs)); } catch (e) {}
          o[id] = s.replace(/\0/g, '').trim();
        }
        p += 10 + fs;
      }
      return { t: o.TIT2 || '', a: o.TPE1 || '', b: o.TALB || '' };
    } catch (e) { return {}; }
  }
  async function importFiles(files) {
    const d = await opfs('music', true), meta = JSON.parse(LSget('zmeta') || '{}'); let n = 0, ok = 0;
    for (const f of files) {
      n++; toast('Importeren ' + n + ' van ' + files.length + '…');
      try {
        if (/\.mp3$/i.test(f.name)) { const t = await id3(f); if (t.t || t.a) meta[f.name] = t; }
        const fh = await d.getFileHandle(f.name, { create: true }), w = await fh.createWritable();
        await f.stream().pipeTo(w); ok++;
      } catch (e) { toast('Importeren mislukt voor ' + f.name); }
    }
    LSset('zmeta', JSON.stringify(meta));
    toast(ok + ' nummer(s) toegevoegd aan Zynora.');
  }
  async function scanLib() {
    urls.forEach(u => URL.revokeObjectURL(u)); urls = []; urlName.clear();
    let d; try { d = await opfs('music'); } catch (e) { return { dir: 'Op deze telefoon', files: [] }; }
    const out = [];
    for await (const [name, h] of d.entries()) {
      if (h.kind !== 'file' || !EXT.test(name)) continue;
      const u = URL.createObjectURL(await h.getFile()); urls.push(u); urlName.set(u, name); out.push({ n: name, u });
    }
    return { dir: 'Op deze telefoon', files: out };
  }

  /* ---------- Spotify-account (PKCE) ---------- */
  const SPR = 'zynora://callback'; let spRes = null;
  const spTok = () => { try { return JSON.parse(LSget('zsptok')); } catch (e) { return null; } };
  const b64u = buf => btoa(String.fromCharCode.apply(null, new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
  async function spToken() {
    const t = spTok(); if (!t) return null;
    if (Date.now() < t.exp - 60000) return t.access;
    const r = await H('https://accounts.spotify.com/api/token', { method: 'POST', headers: FORM, data: { grant_type: 'refresh_token', refresh_token: t.refresh, client_id: t.cid } });
    if (r.status >= 400) return null; const j = parse(r.data);
    LSset('zsptok', JSON.stringify({ cid: t.cid, access: j.access_token, refresh: j.refresh_token || t.refresh, exp: Date.now() + j.expires_in * 1000 }));
    return j.access_token;
  }
  if (A) A.addListener('appUrlOpen', async ev => {
    try {
      const u = new URL(ev.url); if (u.host !== 'callback') return;
      const s = JSON.parse(LSget('zspkce') || '{}'), code = u.searchParams.get('code');
      if (!code || u.searchParams.get('state') !== s.st) { if (spRes) spRes({ error: 'Inloggen geannuleerd.' }); spRes = null; return; }
      const r = await H('https://accounts.spotify.com/api/token', { method: 'POST', headers: FORM, data: { grant_type: 'authorization_code', code, redirect_uri: SPR, client_id: s.cid, code_verifier: s.ver } });
      const j = parse(r.data); if (r.status >= 400) throw new Error((j && (j.error_description || j.error)) || r.status);
      LSset('zsptok', JSON.stringify({ cid: s.cid, access: j.access_token, refresh: j.refresh_token, exp: Date.now() + j.expires_in * 1000 }));
      if (spRes) spRes({ ok: true });
    } catch (e) { if (spRes) spRes({ error: 'Koppelen mislukt: ' + e.message }); }
    spRes = null;
  });
  if (A) A.addListener('backButton', () => {
    const q = id => document.getElementById(id), dlg = document.querySelector('dialog[open]');
    if (dlg) dlg.close();
    else if (q('set').classList.contains('open')) q('sx').click();
    else if (q('lyr').classList.contains('open')) q('lx').click();
    else if (q('drawer').classList.contains('open')) q('dim').click();
    else if (document.body.classList.contains('rmx-on')) q('rh').click();
    else A.minimizeApp();
  });

  /* ---------- mediasessie (meldingen en vergrendelscherm) ---------- */
  if (MS) {
    window.MediaMetadata = function (o) { Object.assign(this, o); };
    const ms = {
      set metadata(m) { try { MS.setMetadata({ title: m.title || '', artist: m.artist || '', album: m.album || '', artwork: m.artwork || [] }).catch(() => {}); } catch (e) {} },
      set playbackState(v) { try { MS.setPlaybackState({ playbackState: v }).catch(() => {}); } catch (e) {} },
      setActionHandler(a, f) { try { MS.setActionHandler({ action: a }, f).catch(() => {}); } catch (e) {} },
      setPositionState(p) { try { MS.setPositionState(p).catch(() => {}); } catch (e) {} }
    };
    try { Object.defineProperty(navigator, 'mediaSession', { value: ms, configurable: true }); } catch (e) {}
  }

  /* ---------- de zy-koppeling die de interface verwacht ---------- */
  window.zy = {
    api: 5,
    pick: () => new Promise(res => {
      const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = 'audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav';
      i.onchange = async () => { const fs = [...i.files]; if (!fs.length) return res(null); await importFiles(fs); res(await scanLib()); };
      i.oncancel = () => res(null); i.click();
    }),
    scan: () => scanLib(),
    tags: async list => { const meta = JSON.parse(LSget('zmeta') || '{}'); return list.map(x => { const m = meta[urlName.get(x.u)] || {}; return { u: x.u, t: m.t || '', a: m.a || '', b: m.b || '', d: 0 }; }); },
    delFile: async u => { try { const n = urlName.get(u); if (n) { await (await opfs('music')).removeEntry(n); const meta = JSON.parse(LSget('zmeta') || '{}'); delete meta[n]; LSset('zmeta', JSON.stringify(meta)); } } catch (e) {} return true; },
    cover: async o => {
      if (!o || !o.online || !o.t) return null;
      try { const j = await GJ('https://itunes.apple.com/search?' + new URLSearchParams({ term: (o.a || '') + ' ' + o.t, media: 'music', entity: 'song', limit: '1' })); const x = j.results && j.results[0]; return x && x.artworkUrl100 ? x.artworkUrl100.replace('100x100bb', '600x600bb') : null; } catch (e) { return null; }
    },
    lget: async o => { try { return JSON.parse(LSget('ly:' + K(o.key))); } catch (e) { return null; } },
    lset: async o => { LSset('ly:' + K(o.key), JSON.stringify(o.data)); return true; },
    clearcache: async () => { Object.keys(localStorage).filter(k => k.startsWith('ly:')).forEach(k => localStorage.removeItem(k)); return true; },
    pickbg: async () => null,
    update: async () => ({ error: 'Een nieuwe versie installeer je als nieuwe apk.' }),
    updateReset: async () => true,
    audius: async () => ({ list: [] }),
    blobUrl: async url => {
      try {
        const r = await CH.request({ url, method: 'GET', responseType: 'blob', headers: { 'User-Agent': UA } });
        if (r.status >= 400) return null;
        const b = atob(r.data), u8 = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
        const ct = (r.headers && (r.headers['Content-Type'] || r.headers['content-type'])) || 'audio/mpeg';
        return URL.createObjectURL(new Blob([u8], { type: ct.split(';')[0] }));
      } catch (e) { return null; }
    },
    spotify: async input => {
      const m = String(input).match(/playlist[\/:]([A-Za-z0-9]{22})/);
      if (!m) return { error: 'Dit is geen geldige Spotify-playlistlink.' };
      try {
        const r = await H('https://open.spotify.com/embed/playlist/' + m[1], { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
        if (r.status >= 400) return { error: 'Spotify gaf status ' + r.status + '. Is de playlist openbaar?' };
        const html = typeof r.data === 'string' ? r.data : JSON.stringify(r.data), j = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (!j) return { error: 'Kon de playlistgegevens niet lezen.' };
        let list = null, name = '';
        (function w(o) { if (!o || typeof o !== 'object' || list) return; if (Array.isArray(o.trackList)) { list = o.trackList; name = o.name || o.title || ''; return; } for (const k in o) w(o[k]); })(JSON.parse(j[1]));
        if (!list || !list.length) return { error: 'Geen nummers gevonden. Is de playlist openbaar?' };
        return { name: name || 'Spotify ' + m[1].slice(0, 6), tracks: list.filter(x => x && x.title).map(x => ({ t: x.title, a: String(x.subtitle || '').replace(/\u00a0/g, ' '), b: '', d: x.duration || 0, s: x.uri || '' })) };
      } catch (e) { return { error: 'Geen verbinding met Spotify. Controleer je internet.' }; }
    },
    free: async o => {
      const { src, q, t, a, jid, free } = o;
      try {
        if (src === 'audius') {
          const j = await GJ('https://api.audius.co/v1/tracks/search?' + new URLSearchParams({ query: q, app_name: 'Zynora', limit: '10' }));
          return { list: (j.data || []).filter(x => x.is_streamable !== false).map(x => ({ t: x.title || '', a: (x.user && x.user.name) || '', d: Math.round((x.duration || 0) * 1000), art: (x.artwork && (x.artwork['480x480'] || x.artwork['150x150'])) || '', url: 'https://api.audius.co/v1/tracks/' + x.id + '/stream?app_name=Zynora' })) };
        }
        if (src === 'jamendo') {
          if (!jid) return { list: [] };
          const j = await GJ('https://api.jamendo.com/v3.0/tracks/?' + new URLSearchParams({ client_id: jid, format: 'json', limit: '10', search: q, audioformat: 'mp32' }));
          return { list: (j.results || []).filter(x => x.audio).map(x => ({ t: x.name || '', a: x.artist_name || '', d: (x.duration || 0) * 1000, art: x.image || '', url: x.audio })) };
        }
        if (src === 'deezer') {
          const j = await GJ('https://api.deezer.com/search?' + new URLSearchParams({ q, limit: '10' }));
          return { list: (j.data || []).filter(x => x.preview).map(x => ({ t: x.title || '', a: (x.artist && x.artist.name) || '', d: (x.duration || 0) * 1000, art: (x.album && (x.album.cover_medium || x.album.cover)) || '', url: x.preview, preview: true })) };
        }
        if (src === 'itunes') {
          const j = await GJ('https://itunes.apple.com/search?' + new URLSearchParams({ term: q, media: 'music', entity: 'song', limit: '10' }));
          return { list: (j.results || []).filter(x => x.previewUrl).map(x => ({ t: x.trackName || '', a: x.artistName || '', d: x.trackTimeMillis || 0, art: (x.artworkUrl100 || '').replace('100x100bb', '300x300bb'), url: x.previewUrl, preview: true })) };
        }
        if (src === 'archive') {
          const esc = s => String(s).replace(/["\\]/g, ' ');
          const qq = free ? '("' + esc(q) + '") AND mediatype:audio' : 'title:("' + esc(t) + '") AND mediatype:audio' + (a ? ' AND creator:("' + esc(a) + '")' : '');
          const j = await GJ('https://archive.org/advancedsearch.php?' + new URLSearchParams({ q: qq, rows: '3', output: 'json' }) + '&fl[]=identifier&fl[]=title&fl[]=creator');
          const out = [];
          for (const d of ((j.response && j.response.docs) || [])) {
            const mt = await GJ('https://archive.org/metadata/' + d.identifier), fl = (mt.files || []).filter(x => /\.mp3$/i.test(x.name));
            for (const f of fl) {
              const ft = f.title || f.name.replace(/\.mp3$/i, '');
              if (fl.length === 1 || free || nn(ft).includes(nn(t))) out.push({ t: fl.length === 1 ? (d.title || ft) : ft, a: Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || ''), d: Math.round((+f.length || 0) * 1000), art: '', url: 'https://archive.org/download/' + d.identifier + '/' + encodeURIComponent(f.name) });
            }
          }
          return { list: out };
        }
        return { list: [] };
      } catch (e) { return { error: src + ': geen verbinding of onverwacht antwoord.' }; }
    },
    spStatus: async () => ({ linked: !!spTok() }),
    spLogout: async () => { try { localStorage.removeItem('zsptok'); } catch (e) {} return true; },
    spLogin: cid => new Promise(async res => {
      cid = String(cid || '').trim();
      if (!/^[a-f0-9]{32}$/i.test(cid)) return res({ error: 'Dit is geen geldig Client ID (32 tekens).' });
      const ver = b64u(crypto.getRandomValues(new Uint8Array(48))), ch = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ver))), st = b64u(crypto.getRandomValues(new Uint8Array(8)));
      LSset('zspkce', JSON.stringify({ cid, ver, st })); spRes = res;
      window.open('https://accounts.spotify.com/authorize?' + new URLSearchParams({ client_id: cid, response_type: 'code', redirect_uri: SPR, code_challenge_method: 'S256', code_challenge: ch, state: st, scope: 'user-read-playback-state user-modify-playback-state' }), '_system');
      setTimeout(() => { if (spRes === res) { spRes = null; res({ error: 'Time-out: niet ingelogd binnen 3 minuten.' }); } }, 180000);
    }),
    spCall: async o => {
      try {
        const tk = await spToken(); if (!tk) return { status: 401 };
        const r = await H('https://api.spotify.com/v1' + o.path, { method: o.method, headers: Object.assign({ Authorization: 'Bearer ' + tk }, o.body ? { 'Content-Type': 'application/json' } : {}), data: o.body || undefined });
        return { status: r.status, json: r.status === 204 ? null : parse(r.data) };
      } catch (e) { return { status: 0 }; }
    },
    remixSave: async o => { const d = await opfs('remixes', true), fh = await d.getFileHandle(o.name + '.webm', { create: true }), w = await fh.createWritable(); await w.write(o.buf); await w.close(); return {}; },
    remixList: async () => {
      try {
        const d = await opfs('remixes'), out = [];
        for await (const [n, h] of d.entries()) { if (h.kind !== 'file') continue; const f = await h.getFile(), u = URL.createObjectURL(f); rmName.set(u, n); out.push({ n: n.replace(/\.webm$/i, ''), u, t: f.lastModified, sz: f.size }); }
        return out.sort((a, b) => b.t - a.t);
      } catch (e) { return []; }
    },
    remixDel: async u => { try { const n = rmName.get(u); if (n) await (await opfs('remixes')).removeEntry(n); URL.revokeObjectURL(u); } catch (e) {} return true; },
    remixShow: async () => { toast('Je remixes staan in Zynora. Speel ze hier af.'); return true; }
  };
})();
