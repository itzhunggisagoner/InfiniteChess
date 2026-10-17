const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const PORT = +process.env.PORT || 3000, ROOT = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : __dirname;
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.wasm':'application/wasm','.png':'image/png','.mp3':'audio/mpeg','.json':'application/json'};

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, path.normalize(p));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type': MIME[path.extname(f)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-cache'});
    res.end(d);
  });
});

const rooms = new Map();
// room settings the host announces (shown in the room list); never trust the client's shape
const cleanInfo = m => ({vr: String(m.vr || 'std').slice(0, 10), tc: Math.max(0, Math.min(10800, +m.tc | 0)), hc: m.hc === 'b' ? 'b' : 'w', lay: Number.isInteger(m.lay) && m.lay >= 0 && m.lay < 960 ? m.lay : 0});
const cleanName = s => [...String(s || '').replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim()].slice(0, 16).join('') || 'Guest';
const taken = (n, c) => n !== 'Guest' && [...rooms.values()].some(r => [r.h, r.g].some(x => x && x !== c && x.name && x.name.toLowerCase() === n.toLowerCase()));
const TAKEN_MSG = 'That username is already in use online. Change it in the main menu.';
const listRooms = () => [...rooms].filter(([k, r]) => !r.g && r.pub).slice(-40).reverse().map(([k, r]) => ({room: k, lock: !!r.pw, ...r.info}));
const send = (c, o) => { const d = Buffer.from(JSON.stringify(o));
  const h = d.length < 126 ? Buffer.from([0x81, d.length]) : Buffer.from([0x81, 126, d.length >> 8, d.length & 255]);
  try { c.sock.write(Buffer.concat([h, d])); } catch (e) {} };
function parse(c) {
  const b = c.buf; if (b.length < 2) return null;
  let len = b[1] & 127, off = 2;
  if (len === 126) { if (b.length < 4) return null; len = b.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (b.length < 10) return null; len = Number(b.readBigUInt64BE(2)); off = 10; }
  const masked = b[1] & 128; if (masked) off += 4;
  if (b.length < off + len) return null;
  let pl = b.subarray(off, off + len);
  if (masked) { const m = b.subarray(off - 4, off); pl = Buffer.from(pl.map((v, i) => v ^ m[i & 3])); }
  c.buf = b.subarray(off + len); return {op: b[0] & 15, pl};
}
function leave(c) {
  if (c.gone) return; c.gone = true;
  const r = rooms.get(c.room); if (!r) return;
  const o = r.h === c ? r.g : r.h; if (o) send(o, {t: 'left'});
  rooms.delete(c.room);
}
function handle(c, m) {
  if (m.t === 'ping') return send(c, {t: 'pong'});
  if (m.t === 'chk') return send(c, {t: taken(cleanName(m.n), c) ? 'nametaken' : 'nameok'});
  if (m.t === 'list') return send(c, {t: 'rooms', rooms: listRooms()});
  if (m.t === 'create') {
    if (c.room) return;
    let code; do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(code));
    const nn = cleanName(m.n); if (taken(nn, c)) return send(c, {t: 'err', m: TAKEN_MSG}); c.name = nn; const i = {...cleanInfo(m), hn: c.name}; rooms.set(code, {h: c, g: null, pw: String(m.pw || '').slice(0, 16), pub: m.pub !== 0 && m.pub !== false, info: i});
    c.room = code; return send(c, {t: 'created', room: code, info: i});
  }
  if (m.t === 'join') {
    if (c.room) return;
    const code = String(m.room || '').trim(), r = rooms.get(code);
    if (!r) return send(c, {t: 'err', m: 'Room not found. Check the code and try again.'});
    if (r.g) return send(c, {t: 'err', m: 'This room is already full.'});
    if (r.pw && String(m.pw || '') !== r.pw) {
      if (++c.fails > 8) return send(c, {t: 'err', m: 'Too many wrong attempts. Reconnect and try again.'});
      return send(c, {t: 'err', m: m.pw ? 'Wrong password.' : 'This room needs a password.'});
    }
    const nn = cleanName(m.n); if (taken(nn, c)) return send(c, {t: 'err', m: TAKEN_MSG});
    r.g = c; c.room = code; c.name = nn; send(c, {t: 'joined', info: r.info}); return send(r.h, {t: 'peer', n: c.name});
  }
  const r = rooms.get(c.room); if (!r) return;
  const o = r.h === c ? r.g : r.h; if (o) send(o, m.t === 'start' ? {...m, n: c.name} : m);   // everything else is forwarded to the opponent
}
srv.on('upgrade', (req, sock) => {
  if (req.url !== '/ws' || !req.headers['sec-websocket-key']) return sock.destroy();
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
    crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
  const c = {sock, room: null, fails: 0, buf: Buffer.alloc(0)};
  sock.on('data', d => {
    c.buf = Buffer.concat([c.buf, d]); let f;
    while ((f = parse(c))) {
      if (f.op === 8) return sock.end();
      if (f.op === 9) { sock.write(Buffer.from([0x8A, 0])); continue; }
      if (f.op === 1) { try { handle(c, JSON.parse(f.pl.toString())); } catch (e) {} }
    }
  });
  sock.on('close', () => leave(c)); sock.on('error', () => leave(c));
});

srv.listen(PORT, '0.0.0.0', () => {
  console.log('\nInfinite Chess is running:\n  This computer (with Stockfish):  http://localhost:' + PORT);
  for (const l of Object.values(os.networkInterfaces()).flat()) if (l && l.family === 'IPv4' && !l.internal) console.log('  Other devices on your LAN:       http://' + l.address + ':' + PORT);
  console.log('');
});
