// Infinite Chess — static server + WebSocket relay for LAN rooms (no extra packages needed)
// Run:  node server.js   (change port: PORT=8080 node server.js)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const PORT = +process.env.PORT || 3000, ROOT = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : __dirname;
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.wasm':'application/wasm','.png':'image/png','.mp3':'audio/mpeg','.json':'application/json'};

// COOP/COEP headers enable cross-origin isolation => multi-threaded Stockfish works on http://localhost
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

// ---- Minimal WebSocket (RFC 6455) ----
const rooms = new Map();
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
  if (m.t === 'create') {
    let code; do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(code));
    rooms.set(code, {h: c, g: null}); c.room = code; return send(c, {t: 'created', room: code});
  }
  if (m.t === 'join') {
    const r = rooms.get(String(m.room));
    if (!r) return send(c, {t: 'err', m: 'Room not found. Check the code and try again.'});
    if (r.g) return send(c, {t: 'err', m: 'This room is already full.'});
    r.g = c; c.room = String(m.room); send(c, {t: 'joined'}); return send(r.h, {t: 'peer'});
  }
  const r = rooms.get(c.room); if (!r) return;
  const o = r.h === c ? r.g : r.h; if (o) send(o, m);   // everything else is forwarded to the opponent
}
srv.on('upgrade', (req, sock) => {
  if (req.url !== '/ws' || !req.headers['sec-websocket-key']) return sock.destroy();
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
    crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
  const c = {sock, room: null, buf: Buffer.alloc(0)};
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
