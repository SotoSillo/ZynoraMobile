const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, shell, safeStorage, protocol } = require('electron');
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');
const mm = require('music-metadata');
const os = require('os');
const HANDLERS = {}; { const h0 = ipcMain.handle.bind(ipcMain); ipcMain.handle = (n, f) => { HANDLERS[n] = f; h0(n, f); }; }
let libDir = '';

app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128');
protocol.registerSchemesAsPrivileged([{ scheme: 'zm', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } }]);
const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range,Content-Length,Accept-Ranges' };
const dec = s => Buffer.from(s, 'base64url').toString();
async function zmHandler(req) {
  try {
    const u = new URL(req.url), raw = dec(u.pathname.slice(1)), rg = req.headers.get('range');
    if (u.hostname === 'f') {
      const p = fileURLToPath(raw); let st; try { st = fs.statSync(p); } catch (e) { return new Response('niet gevonden', { status: 404, headers: CORS }); }
      const size = st.size; let start = 0, end = size - 1, status = 200;
      const mm2 = rg && /bytes=(\d*)-(\d*)/.exec(rg);
      if (mm2) { status = 206; if (mm2[1] !== '') start = +mm2[1]; if (mm2[2] !== '') end = Math.min(+mm2[2], size - 1); if (mm2[1] === '' && mm2[2] !== '') { start = Math.max(0, size - +mm2[2]); end = size - 1; } }
      if (start > end || start >= size) return new Response('bereik', { status: 416, headers: Object.assign({ 'Content-Range': 'bytes */' + size }, CORS) });
      const h = Object.assign({ 'Content-Type': MIME[path.extname(p).slice(1).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) }, CORS);
      if (status === 206) h['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
      return new Response(Readable.toWeb(fs.createReadStream(p, { start, end })), { status, headers: h });
    }
    if (u.hostname === 'r') {
      if (!/^https:\/\//.test(raw)) return new Response('ongeldig', { status: 400, headers: CORS });
      const hd = { 'User-Agent': 'Zynora/2.3' }; if (rg) hd.Range = rg;
      const r = await fetch(raw, { headers: hd }); const h = Object.assign({}, CORS);
      for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (r.headers.get(k)) h[k] = r.headers.get(k);
      return new Response(r.body, { status: r.status, headers: h });
    }
  } catch (e) { return new Response('fout', { status: 500, headers: CORS }); }
  return new Response('onbekend', { status: 404, headers: CORS });
}
const UD = () => app.getPath('userData');
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
const EXT = /\.(mp3|m4a|aac|flac|ogg|opus|wav|webm)$/i;

/* ---------- bestanden ---------- */
function scan(dir, out = []) {
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scan(p, out); else if (EXT.test(e.name)) out.push({ n: e.name, u: pathToFileURL(p).href });
  }
  return out;
}
ipcMain.handle('pick', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  libDir = r.filePaths[0]; return { dir: r.filePaths[0], files: scan(r.filePaths[0]) };
});
ipcMain.handle('scan', (_e, dir) => { if (dir) libDir = dir; return { dir: libDir, files: libDir ? scan(libDir) : [] }; });
ipcMain.handle('tags', async (_e, list) => {
  const out = []; let i = 0;
  async function worker() {
    while (i < list.length) {
      const f = list[i++];
      try {
        const md = await mm.parseFile(fileURLToPath(f.u), { duration: false, skipCovers: true, skipPostHeaders: true });
        const c = md.common;
        out.push({ u: f.u, t: c.title || '', a: (c.artists && c.artists.join(', ')) || c.artist || '', b: c.album || '', d: Math.round((md.format.duration || 0) * 1000) });
      } catch (e) { out.push({ u: f.u, t: '', a: '', b: '', d: 0 }); }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
});

/* ---------- Spotify-playlist via link ---------- */
ipcMain.handle('spotify', async (_e, input) => {
  const m = String(input).match(/playlist[\/:]([A-Za-z0-9]{22})/);
  if (!m) return { error: 'Dit is geen geldige Spotify-playlistlink.' };
  try {
    const res = await fetch('https://open.spotify.com/embed/playlist/' + m[1], { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'Accept-Language': 'en' } });
    if (!res.ok) return { error: 'Spotify gaf status ' + res.status + '. Is de playlist openbaar?' };
    const html = await res.text();
    const j = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!j) return { error: 'Kon de playlistgegevens niet lezen. Gebruik de CSV-import.' };
    let list = null, name = '';
    (function walk(o) {
      if (!o || typeof o !== 'object' || list) return;
      if (Array.isArray(o.trackList)) { list = o.trackList; name = o.name || o.title || ''; return; }
      for (const k in o) walk(o[k]);
    })(JSON.parse(j[1]));
    if (!list || !list.length) return { error: 'Geen nummers gevonden. Is de playlist openbaar? Anders: gebruik CSV.' };
    const tracks = list.filter(x => x && x.title).map(x => ({ t: x.title, a: String(x.subtitle || '').replace(/\u00a0/g, ' '), b: '', d: x.duration || 0, s: x.uri || '' }));
    return { name: name || 'Spotify ' + m[1].slice(0, 6), tracks };
  } catch (err) { return { error: 'Geen verbinding met Spotify. Controleer je internet.' }; }
});

/* ---------- Audius ---------- */
ipcMain.handle('audius', async (_e, { t, a }) => {
  try {
    const q = new URLSearchParams({ query: (a ? a + ' ' : '') + t, app_name: 'Zynora', limit: '10' });
    const r = await fetch('https://api.audius.co/v1/tracks/search?' + q);
    if (!r.ok) return { error: 'Audius gaf status ' + r.status + '.' };
    const j = await r.json();
    return { list: (j.data || []).filter(x => x.is_streamable !== false).map(x => ({ id: x.id, t: x.title || '', a: (x.user && x.user.name) || '', art: (x.artwork && (x.artwork['480x480'] || x.artwork['150x150'])) || '', d: Math.round((x.duration || 0) * 1000) })) };
  } catch (e) { return { error: 'Geen verbinding met Audius.' }; }
});

/* ---------- gratis bronnen: Audius, Jamendo, Internet Archive, Deezer/Apple-voorbeelden ---------- */
const nn = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const jf = async u => { const r = await fetch(u, { headers: { 'User-Agent': 'Zynora/2.1' } }); if (!r.ok) throw new Error('status ' + r.status); return r.json(); };
ipcMain.handle('free', async (_e, { src, q, t, a, jid, free }) => {
  try {
    if (src === 'audius') {
      const j = await jf('https://api.audius.co/v1/tracks/search?' + new URLSearchParams({ query: q, app_name: 'Zynora', limit: '10' }));
      return { list: (j.data || []).filter(x => x.is_streamable !== false).map(x => ({ t: x.title || '', a: (x.user && x.user.name) || '', d: Math.round((x.duration || 0) * 1000), art: (x.artwork && (x.artwork['480x480'] || x.artwork['150x150'])) || '', url: 'https://api.audius.co/v1/tracks/' + x.id + '/stream?app_name=Zynora' })) };
    }
    if (src === 'jamendo') {
      if (!jid) return { list: [] };
      const j = await jf('https://api.jamendo.com/v3.0/tracks/?' + new URLSearchParams({ client_id: jid, format: 'json', limit: '10', search: q, audioformat: 'mp32' }));
      return { list: (j.results || []).filter(x => x.audio).map(x => ({ t: x.name || '', a: x.artist_name || '', d: (x.duration || 0) * 1000, art: x.image || '', url: x.audio })) };
    }
    if (src === 'deezer') {
      const j = await jf('https://api.deezer.com/search?' + new URLSearchParams({ q, limit: '10' }));
      return { list: (j.data || []).filter(x => x.preview).map(x => ({ t: x.title || '', a: (x.artist && x.artist.name) || '', d: (x.duration || 0) * 1000, art: (x.album && (x.album.cover_medium || x.album.cover)) || '', url: x.preview, preview: true })) };
    }
    if (src === 'itunes') {
      const j = await jf('https://itunes.apple.com/search?' + new URLSearchParams({ term: q, media: 'music', entity: 'song', limit: '10' }));
      return { list: (j.results || []).filter(x => x.previewUrl).map(x => ({ t: x.trackName || '', a: x.artistName || '', d: x.trackTimeMillis || 0, art: (x.artworkUrl100 || '').replace('100x100bb', '300x300bb'), url: x.previewUrl, preview: true })) };
    }
    if (src === 'archive') {
      const esc = s => String(s).replace(/["\\]/g, ' ');
      const qq = free ? '("' + esc(q) + '") AND mediatype:audio' : 'title:("' + esc(t) + '") AND mediatype:audio' + (a ? ' AND creator:("' + esc(a) + '")' : '');
      const j = await jf('https://archive.org/advancedsearch.php?' + new URLSearchParams({ q: qq, rows: '3', output: 'json' }) + '&fl[]=identifier&fl[]=title&fl[]=creator');
      const out = [];
      for (const d of ((j.response && j.response.docs) || [])) {
        const mt = await jf('https://archive.org/metadata/' + d.identifier);
        const fl = (mt.files || []).filter(x => /\.mp3$/i.test(x.name));
        for (const f of fl) {
          const ft = f.title || f.name.replace(/\.mp3$/i, '');
          if (fl.length === 1 || free || nn(ft).includes(nn(t))) out.push({ t: fl.length === 1 ? (d.title || ft) : ft, a: Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || ''), d: Math.round((+f.length || 0) * 1000), art: '', url: 'https://archive.org/download/' + d.identifier + '/' + encodeURIComponent(f.name) });
        }
      }
      return { list: out };
    }
    return { list: [] };
  } catch (e) { return { error: src + ': geen verbinding of onverwacht antwoord.' }; }
});

/* ---------- hoesjes ---------- */
const coverDir = path.join(UD(), 'covers');
let active = 0; const waiting = [];
const slot = () => new Promise(r => { if (active < 3) { active++; r(); } else waiting.push(r); });
const free = () => { const n = waiting.shift(); if (n) n(); else active--; };
function saveCover(buf, file) {
  const img = nativeImage.createFromBuffer(buf); if (img.isEmpty()) return false;
  fs.writeFileSync(file, (img.getSize().width > 300 ? img.resize({ width: 300, quality: 'good' }) : img).toJPEG(85)); return true;
}
ipcMain.handle('cover', async (_e, { u, t, a, online, data }) => {
  await slot();
  try {
    fs.mkdirSync(coverDir, { recursive: true });
    const f = path.join(coverDir, md5(u || (a + '|' + t)) + '.jpg');
    const ret = () => data ? 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64') : pathToFileURL(f).href;
    if (fs.existsSync(f)) return ret();
    if (u) { try { const md = await mm.parseFile(fileURLToPath(u), { duration: false, skipPostHeaders: true }); const pic = mm.selectCover(md.common.picture); if (pic && saveCover(Buffer.from(pic.data), f)) return ret(); } catch (e) {} }
    if (online && t) {
      try {
        const q = new URLSearchParams({ term: (a || '') + ' ' + t, media: 'music', entity: 'song', limit: '1' });
        const j = await (await fetch('https://itunes.apple.com/search?' + q)).json();
        const art = j.results && j.results[0] && j.results[0].artworkUrl100;
        if (art) { const im = await fetch(art.replace('100x100bb', '600x600bb')); if (im.ok && saveCover(Buffer.from(await im.arrayBuffer()), f)) return ret(); }
      } catch (e) {}
    }
    return null;
  } finally { free(); }
});

/* ---------- songtekst-cache, .lrc naast bestand ---------- */
const lyrDir = () => path.join(UD(), 'lyrics');
ipcMain.handle('lget', (_e, { key, u }) => {
  try {
    if (u) {
      const base = fileURLToPath(u).replace(/\.[^.\\/]+$/, '');
      for (const ext of ['.lrc', '.LRC', '.txt']) {
        const p = base + ext;
        if (fs.existsSync(p)) { const s = fs.readFileSync(p, 'utf8'); return /\[\d+:\d+/.test(s) ? { synced: s, plain: '', src: 'bestand' } : { synced: '', plain: s, src: 'bestand' }; }
      }
    }
    const p = path.join(lyrDir(), md5(key) + '.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {}
  return null;
});
ipcMain.handle('lset', (_e, { key, data }) => { try { fs.mkdirSync(lyrDir(), { recursive: true }); fs.writeFileSync(path.join(lyrDir(), md5(key) + '.json'), JSON.stringify(data)); } catch (e) {} return true; });
ipcMain.handle('clearcache', () => { for (const d of ['lyrics', 'covers']) fs.rmSync(path.join(UD(), d), { recursive: true, force: true }); return true; });

/* ---------- opgeslagen remixes ---------- */
const remDir = () => path.join(UD(), 'remixes');
ipcMain.handle('remix-save', (_e, { name, buf }) => { fs.mkdirSync(remDir(), { recursive: true }); const f = path.join(remDir(), String(name).replace(/[^\w .-]/g, '_') + '.webm'); fs.writeFileSync(f, Buffer.from(buf)); return { u: pathToFileURL(f).href }; });
ipcMain.handle('remix-list', () => { try { return fs.readdirSync(remDir()).filter(n => /\.webm$/i.test(n)).map(n => { const p = path.join(remDir(), n), s = fs.statSync(p); return { n: n.replace(/\.webm$/i, ''), u: pathToFileURL(p).href, t: s.mtimeMs, sz: s.size }; }).sort((a, b) => b.t - a.t); } catch (e) { return []; } });
ipcMain.handle('remix-del', (_e, u) => { try { const p = fileURLToPath(u); if (path.dirname(p) === remDir()) fs.unlinkSync(p); } catch (e) {} return true; });
ipcMain.handle('remix-show', (_e, u) => { try { shell.showItemInFolder(fileURLToPath(u)); } catch (e) {} return true; });

/* ---------- eigen achtergrond ---------- */
ipcMain.handle('pickbg', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Afbeelding', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const img = nativeImage.createFromPath(r.filePaths[0]); if (img.isEmpty()) return null;
  const dst = path.join(UD(), 'bg.jpg');
  fs.writeFileSync(dst, (img.getSize().width > 1920 ? img.resize({ width: 1920, quality: 'good' }) : img).toJPEG(85));
  return pathToFileURL(dst).href + '?' + Date.now();
});

/* ---------- Spotify-account (PKCE, afstandsbediening) ---------- */
const REDIR = 'http://127.0.0.1:8898/callback';
const spFile = () => path.join(UD(), 'sp.bin');
let spTok = null;
function spSave(t) {
  spTok = t; const raw = Buffer.from(JSON.stringify(t)); const enc = safeStorage.isEncryptionAvailable();
  fs.writeFileSync(spFile(), Buffer.concat([Buffer.from([enc ? 1 : 0]), enc ? safeStorage.encryptString(raw.toString()) : raw]));
}
function spLoad() {
  if (spTok) return spTok;
  try { const b = fs.readFileSync(spFile()); spTok = JSON.parse(b[0] === 1 ? safeStorage.decryptString(b.subarray(1)) : b.subarray(1).toString()); } catch (e) { spTok = null; }
  return spTok;
}
async function spToken() {
  const t = spLoad(); if (!t) return null;
  if (Date.now() < t.exp - 60000) return t.access;
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: t.cid }) });
  if (!r.ok) return null;
  const j = await r.json();
  spSave({ cid: t.cid, access: j.access_token, refresh: j.refresh_token || t.refresh, exp: Date.now() + j.expires_in * 1000 });
  return spTok.access;
}
ipcMain.handle('sp-login', (_e, cid) => new Promise(resolve => {
  cid = String(cid || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(cid)) return resolve({ error: 'Dit is geen geldig Client ID (32 tekens).' });
  const ver = crypto.randomBytes(48).toString('base64url'), ch = crypto.createHash('sha256').update(ver).digest('base64url'), st = crypto.randomBytes(8).toString('hex');
  let done = false;
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, REDIR);
    if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
    const fin = (o, m) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<body style="font:18px system-ui;background:#0a1018;color:#fff;text-align:center;padding:15vh 20px">' + m + '</body>'); if (!done) { done = true; srv.close(); resolve(o); } };
    const code = u.searchParams.get('code');
    if (u.searchParams.get('state') !== st || !code) return fin({ error: 'Inloggen geannuleerd.' }, 'Inloggen geannuleerd. Je kunt dit venster sluiten.');
    try {
      const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIR, client_id: cid, code_verifier: ver }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error_description || j.error);
      spSave({ cid, access: j.access_token, refresh: j.refresh_token, exp: Date.now() + j.expires_in * 1000 });
      fin({ ok: true }, 'Zynora is gekoppeld aan Spotify. Je kunt dit venster sluiten.');
    } catch (e) { fin({ error: 'Koppelen mislukt: ' + e.message }, 'Koppelen mislukt. Sluit dit venster en probeer het opnieuw.'); }
  });
  srv.on('error', () => resolve({ error: 'Poort 8898 is bezet. Sluit andere programmas en probeer opnieuw.' }));
  srv.listen(8898, '127.0.0.1', () => {
    shell.openExternal('https://accounts.spotify.com/authorize?' + new URLSearchParams({ client_id: cid, response_type: 'code', redirect_uri: REDIR, code_challenge_method: 'S256', code_challenge: ch, state: st, scope: 'user-read-playback-state user-modify-playback-state' }));
    setTimeout(() => { if (!done) { done = true; srv.close(); resolve({ error: 'Time-out: niet ingelogd binnen 3 minuten.' }); } }, 180000);
  });
}));
ipcMain.handle('sp-status', () => ({ linked: !!spLoad() }));
ipcMain.handle('sp-logout', () => { spTok = null; try { fs.unlinkSync(spFile()); } catch (e) {} return true; });
ipcMain.handle('sp-call', async (_e, { method, path: p, body }) => {
  try {
    const tk = await spToken(); if (!tk) return { status: 401 };
    const r = await fetch('https://api.spotify.com/v1' + p, { method, headers: Object.assign({ Authorization: 'Bearer ' + tk }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    let json = null; if (r.status !== 204) { try { json = await r.json(); } catch (e) {} }
    return { status: r.status, json };
  } catch (e) { return { status: 0 }; }
});

/* ---------- bijwerken door zip-bestand ---------- */
ipcMain.handle('update', (_e, buf) => {
  try {
    const AdmZip = require('adm-zip'); const z = new AdmZip(Buffer.from(buf));
    const es = z.getEntries().filter(e => !e.isDirectory);
    const ix = es.find(e => /(^|\/)index\.html$/.test(e.entryName) && !/node_modules|\.github/.test(e.entryName));
    if (!ix) return { error: 'Dit lijkt geen Zynora-bestand (index.html ontbreekt).' };
    const root = ix.entryName.slice(0, -'index.html'.length);
    const ui = path.join(UD(), 'ui'); fs.rmSync(ui, { recursive: true, force: true });
    let ver = '0', deps = '';
    for (const e of es) {
      if (!e.entryName.startsWith(root)) continue;
      const rel = e.entryName.slice(root.length);
      if (rel === 'package.json') { const pj = JSON.parse(e.getData().toString()); ver = pj.version || '0'; deps = JSON.stringify(pj.dependencies || {}); }
      if (!(rel === 'index.html' || rel.startsWith('assets/'))) continue;
      const dest = path.join(ui, rel); if (!dest.startsWith(ui + path.sep)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, e.getData());
    }
    fs.writeFileSync(path.join(ui, 'version.txt'), ver);
    let needInstall = false;
    if (!app.isPackaged) {
      const curDeps = JSON.stringify(require('./package.json').dependencies || {});
      for (const f of ['main.js', 'preload.js', 'package.json']) { const e = es.find(x => x.entryName === root + f); if (e) fs.writeFileSync(path.join(__dirname, f), e.getData()); }
      needInstall = deps !== '' && deps !== curDeps;
    }
    if (!needInstall) { app.relaunch(); setTimeout(() => app.exit(0), 400); }
    return { ok: true, needInstall };
  } catch (e) { return { error: 'Bijwerken mislukt: ' + e.message }; }
});
ipcMain.handle('update-reset', () => { fs.rmSync(path.join(UD(), 'ui'), { recursive: true, force: true }); app.relaunch(); setTimeout(() => app.exit(0), 400); return true; });

/* ---------- mobiele toegang: de pc draait alles, de telefoon is het scherm ---------- */
const remFile = () => path.join(UD(), 'remote.json');
const remote = { on: false, port: 8787, pin: '' };
let srv = null; const sessions = new Set(), fails = new Map();
function remLoad() { try { Object.assign(remote, JSON.parse(fs.readFileSync(remFile(), 'utf8'))); } catch (e) {} if (!remote.pin) remote.pin = String(crypto.randomInt(100000, 999999)); }
const remSave = () => { try { fs.writeFileSync(remFile(), JSON.stringify(remote)); } catch (e) {} };
const lanIps = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
const remInfo = () => ({ on: remote.on, port: remote.port, pin: remote.pin, ips: lanIps(), running: !!srv });
const inLib = u => { try { if (!libDir) return false; const rel = path.relative(libDir, fileURLToPath(u)); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); } catch (e) { return false; } };
const RALLOW = new Set(['scan', 'tags', 'spotify', 'free', 'audius', 'cover', 'lget', 'lset', 'sp-status', 'sp-call', 'sync-get']);
const LOGIN = '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Zynora</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0a1018;color:#f4f7fb;font:18px system-ui"><div style="text-align:center;padding:24px;max-width:340px"><div style="font:900 italic 44px Impact,Arial Black,sans-serif;color:#ffd21f;margin-bottom:8px">ZYNORA</div><p style="color:#a9b8cb">Typ de pincode die op je pc staat (Instellingen, Mobiel).</p><input id=p type=tel inputmode=numeric maxlength=6 autofocus style="width:100%;box-sizing:border-box;font-size:28px;letter-spacing:8px;text-align:center;padding:12px;border-radius:14px;border:1px solid #345;background:#13202e;color:#fff"><button onclick="go()" style="margin-top:16px;width:100%;padding:14px;font:800 17px system-ui;border:0;border-radius:14px;background:#ffd21f;color:#14110a">Openen</button><p id=m style="color:#ff6f8f"></p></div><script>async function go(){const r=await fetch("/login",{method:"POST",body:JSON.stringify({pin:document.getElementById("p").value})});if(r.ok)location.reload();else document.getElementById("m").textContent=r.status==429?"Te veel pogingen, wacht even.":"Onjuiste pincode."}document.getElementById("p").addEventListener("keydown",function(e){if(e.key=="Enter")go()})</script></body>';
const readBody = req => new Promise(r => { let b = ''; req.on('data', d => { b += d; if (b.length > 5e6) req.destroy(); }); req.on('end', () => r(b)); });
const pipeTo = (s, res) => { res.on('close', () => s.destroy()); s.on('error', () => res.destroy()); s.pipe(res); };
function serveFile(req, res, p) {
  let st; try { st = fs.statSync(p); } catch (e) { res.writeHead(404); return res.end(); }
  const size = st.size, rg = req.headers.range; let start = 0, end = size - 1, code = 200;
  const m = rg && /bytes=(\d*)-(\d*)/.exec(rg);
  if (m) { code = 206; if (m[1] !== '') start = +m[1]; if (m[2] !== '') end = Math.min(+m[2], size - 1); if (m[1] === '' && m[2] !== '') { start = Math.max(0, size - +m[2]); end = size - 1; } }
  if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': 'bytes */' + size }); return res.end(); }
  const h = { 'Content-Type': MIME[path.extname(p).slice(1).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 };
  if (code === 206) h['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
  res.writeHead(code, h); pipeTo(fs.createReadStream(p, { start, end }), res);
}
async function webHandler(req, res) {
  const u = new URL(req.url, 'http://x'), ip = req.socket.remoteAddress;
  const send = (code, body, type, h) => { res.writeHead(code, Object.assign({ 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, h || {})); res.end(body); };
  const json = o => send(200, JSON.stringify(o === undefined ? null : o), 'application/json');
  try {
    if (u.pathname === '/login' && req.method === 'POST') {
      const f = fails.get(ip) || { n: 0, t: Date.now() }; if (Date.now() - f.t > 60000) { f.n = 0; f.t = Date.now(); }
      if (f.n >= 5) return send(429, 'wacht');
      const b = JSON.parse((await readBody(req)) || '{}');
      if (String(b.pin) === remote.pin) { const tk = crypto.randomBytes(16).toString('hex'); sessions.add(tk); return send(200, 'ok', 'text/plain', { 'Set-Cookie': 'zs=' + tk + '; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly' }); }
      f.n++; fails.set(ip, f); return send(401, 'pin');
    }
    const ck = (/(?:^|; )zs=([a-f0-9]+)/.exec(req.headers.cookie || '') || [])[1], ok = sessions.has(ck);
    if (u.pathname === '/' || u.pathname === '/index.html') return ok ? send(200, fs.readFileSync(uiIndex()), 'text/html; charset=utf-8') : send(200, LOGIN, 'text/html; charset=utf-8');
    if (u.pathname === '/manifest.webmanifest') return send(200, JSON.stringify({ name: 'Zynora', short_name: 'Zynora', start_url: '/', display: 'standalone', background_color: '#0a1018', theme_color: '#0a1018' }), 'application/manifest+json');
    if (!ok) return send(401, 'inloggen');
    if (u.pathname.startsWith('/assets/')) {
      const base = path.join(path.dirname(uiIndex()), 'assets'), p = path.join(path.dirname(uiIndex()), u.pathname);
      if (p.startsWith(base) && fs.existsSync(p)) return send(200, fs.readFileSync(p), /\.png$/i.test(p) ? 'image/png' : 'image/jpeg', { 'Cache-Control': 'max-age=86400' });
      return send(404, '');
    }
    if (u.pathname.startsWith('/cv/')) { const p = path.join(coverDir, path.basename(u.pathname)); return fs.existsSync(p) ? send(200, fs.readFileSync(p), 'image/jpeg', { 'Cache-Control': 'max-age=86400' }) : send(404, ''); }
    if (u.pathname.startsWith('/api/') && req.method === 'POST') {
      const name = decodeURIComponent(u.pathname.slice(5));
      if (!RALLOW.has(name) || !HANDLERS[name]) return send(403, JSON.stringify({ error: 'Niet beschikbaar op mobiel.' }), 'application/json');
      let arg = JSON.parse((await readBody(req)) || 'null');
      if (name === 'scan') arg = libDir;
      if (name === 'tags') arg = (arg || []).filter(x => x && inLib(x.u));
      if ((name === 'cover' || name === 'lget') && arg && arg.u && !inLib(arg.u)) arg.u = undefined;
      if (name === 'sp-call' && !/^\/me\/player/.test(String(arg && arg.path))) return json({ status: 403 });
      let out = await HANDLERS[name]({}, arg);
      if (name === 'cover' && typeof out === 'string' && out.startsWith('file:')) out = '/cv/' + path.basename(fileURLToPath(out));
      return json(out);
    }
    if (u.pathname.startsWith('/zm/')) {
      const kind = u.pathname[4], raw = Buffer.from(u.pathname.slice(6), 'base64url').toString();
      if (kind === 'f') { if (!inLib(raw) && !raw.startsWith(pathToFileURL(remDir()).href)) { res.writeHead(403); return res.end(); } return serveFile(req, res, fileURLToPath(raw)); }
      if (kind === 'r') {
        if (!/^https:\/\//.test(raw)) { res.writeHead(400); return res.end(); }
        const hd = { 'User-Agent': 'Zynora/2.6' }; if (req.headers.range) hd.Range = req.headers.range;
        const r = await fetch(raw, { headers: hd }); const h = {};
        for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (r.headers.get(k)) h[k] = r.headers.get(k);
        res.writeHead(r.status, h); if (!r.body) return res.end(); return pipeTo(Readable.fromWeb(r.body), res);
      }
    }
    return send(404, '');
  } catch (e) { try { send(500, 'fout'); } catch (e2) {} }
}
function applyRemote() {
  if (srv) { try { srv.close(); srv.closeAllConnections && srv.closeAllConnections(); } catch (e) {} srv = null; }
  if (remote.on) { srv = http.createServer(webHandler); srv.on('error', () => { srv = null; }); srv.listen(remote.port, '0.0.0.0'); }
}
ipcMain.handle('remote-get', () => remInfo());
ipcMain.handle('remote-set', (_e, o) => { o = o || {}; if (o.newPin) { remote.pin = String(crypto.randomInt(100000, 999999)); sessions.clear(); } if (o.on !== undefined) remote.on = !!o.on; remSave(); applyRemote(); return remInfo(); });
ipcMain.handle('sync-get', async () => {
  try { const w = BrowserWindow.getAllWindows()[0]; return JSON.parse(await w.webContents.executeJavaScript("JSON.stringify({zl:localStorage.getItem('zl'),zf:localStorage.getItem('zf')})")); } catch (e) { return {}; }
});

const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
function uiIndex() {
  const d = path.join(UD(), 'ui');
  try { if (cmp(fs.readFileSync(path.join(d, 'version.txt'), 'utf8').trim(), app.getVersion()) >= 0 && fs.existsSync(path.join(d, 'index.html'))) return path.join(d, 'index.html'); } catch (e) {}
  return path.join(__dirname, 'index.html');
}

app.whenReady().then(() => {
  protocol.handle('zm', zmHandler);
  remLoad(); applyRemote();
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 900, minHeight: 600, backgroundColor: '#0a1018', title: 'Zynora', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, webSecurity: false, spellcheck: false }
  });
  win.webContents.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && (i.key === 'F12' || (i.control && i.shift && String(i.key).toLowerCase() === 'i'))) win.webContents.toggleDevTools(); });
  win.loadFile(uiIndex());
});
app.on('window-all-closed', () => app.quit());
