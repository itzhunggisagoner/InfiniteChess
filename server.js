const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const R4 = require('./room4.js');
const Auth = require('./auth.js');

const PORT = +process.env.PORT || 3000;
const ROOT = fs.existsSync(path.join(__dirname, 'public')) ? path.join(__dirname, 'public') : __dirname;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ACCOUNTS_FILE = process.env.ACCOUNTS_FILE || path.join(__dirname, 'accounts.json');
const RELAY = new Set(['start', 'move', 'resign']);   // messages forwarded straight to the opponent

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json'
};

/* ---------- accounts: a small JSON file next to server.js ---------- */
let accounts = {};
try { accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); } catch (e) {}

const auth = Auth.createAuth({
  get: async key => accounts[key],
  put: async entries => {
    Object.assign(accounts, entries);
    const tmp = ACCOUNTS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(accounts, null, 2));
    fs.renameSync(tmp, ACCOUNTS_FILE);                            // write to a temp file first so a crash can't corrupt it
  }
}, GOOGLE_CLIENT_ID);

/* ---------- static files ---------- */
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';

  if (p === '/config.json') {                                     // tells the page which Google client to use
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ googleClientId: GOOGLE_CLIENT_ID }));
  }

  const f = path.join(ROOT, path.normalize(p));
  if (!f.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(f, (e, d) => {
    if (e) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(f)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': 'no-cache'
    });
    res.end(d);
  });
});

/* ---------- minimal WebSocket ---------- */
const rooms = new Map();

const send = (c, o) => {
  const d = Buffer.from(JSON.stringify(o));
  const h = d.length < 126
    ? Buffer.from([0x81, d.length])
    : Buffer.from([0x81, 126, d.length >> 8, d.length & 255]);
  try { c.sock.write(Buffer.concat([h, d])); } catch (e) {}
};

function parse(c) {
  const b = c.buf;
  if (b.length < 2) return null;
  let len = b[1] & 127, off = 2;
  if (len === 126) {
    if (b.length < 4) return null;
    len = b.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (b.length < 10) return null;
    len = Number(b.readBigUInt64BE(2));
    off = 10;
  }
  const masked = b[1] & 128;
  if (masked) off += 4;
  if (b.length < off + len) return null;
  let pl = b.subarray(off, off + len);
  if (masked) {
    const m = b.subarray(off - 4, off);
    pl = Buffer.from(pl.map((v, i) => v ^ m[i & 3]));
  }
  c.buf = b.subarray(off + len);
  return { op: b[0] & 15, pl };
}

function leave(c) {
  if (c.gone) return;
  c.gone = true;
  auth.release(c);                                                // free the name
  if (R4.leave(rooms, c, send)) return;
  const r = rooms.get(c.room);
  if (!r) return;
  const o = r.h === c ? r.g : r.h;
  if (o) send(o, { t: 'left' });
  rooms.delete(c.room);
}

async function handle(c, m) {
  if (m.t === 'ping') return send(c, { t: 'pong' });
  if (await auth.handle(c, m, send)) return;                      // Google account / username requests

  // create / join: first work out the player's name (Google username, or a checked guest name)
  if (m.t === 'create' || m.t === 'create4' || m.t === 'join') {
    if (c.room) return;                                           // already in a room
    const id = await auth.claim(c, m);
    if (c.gone) { auth.release(c); return; }
    if (!id.ok) return send(c, { t: 'err', m: id.m, code: id.code });
    m.name = id.name;
  }

  if (R4.handle(rooms, c, m, send)) return;                       // four-player rooms

  if (m.t === 'create') {
    let code;
    do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(code));
    rooms.set(code, { h: c, g: null, pub: m.vis !== 'private', hname: c.name, tc: +m.tc || 0 });
    c.room = code;
    return send(c, { t: 'created', room: code, v: c.verified ? 1 : 0 });
  }

  if (m.t === 'join') {
    const code = String(m.room || '').trim(), r = rooms.get(code);
    if (!r) return send(c, { t: 'err', m: 'Room not found. Check the code and try again.' });
    if (r.g) return send(c, { t: 'err', m: 'This room is already full.' });
    r.g = c;
    c.room = code;
    send(c, { t: 'joined', v: c.verified ? 1 : 0 });
    return send(r.h, { t: 'peer' });
  }

  const r = rooms.get(c.room);
  if (!r) return;
  const o = r.h === c ? r.g : r.h;

  if (m.t === 'chat') {                                           // two-player room chat: Google users only
    if (!c.verified) return send(c, { t: 'chatlock' });
    const text = String(m.text || '').slice(0, 300);
    if (text.trim() && o && o.verified) send(o, { t: 'chat', name: c.name, seat: null, text });
    return;
  }

  if (!RELAY.has(m.t)) return;
  if (o) send(o, m);
}

srv.on('upgrade', (req, sock) => {
  if (req.url !== '/ws' || !req.headers['sec-websocket-key']) return sock.destroy();
  const accept = crypto.createHash('sha1')
    .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');

  const c = { sock, room: null, buf: Buffer.alloc(0), name: '', verified: false, sub: null, nameKey: null };
  sock.on('data', d => {
    c.buf = Buffer.concat([c.buf, d]);
    let f;
    while ((f = parse(c))) {
      if (f.op === 8) return sock.end();
      if (f.op === 9) {
        sock.write(Buffer.from([0x8A, 0]));
        continue;
      }
      if (f.op === 1) {
        let m;
        try { m = JSON.parse(f.pl.toString()); } catch (e) { continue; }
        if (m && typeof m === 'object') handle(c, m).catch(() => {});
      }
    }
  });
  sock.on('close', () => leave(c));
  sock.on('error', () => leave(c));
});

srv.listen(PORT, '0.0.0.0', () => {
  console.log('\nInfinite Chess is running:\n  This computer (with Stockfish):  http://localhost:' + PORT);
  for (const l of Object.values(os.networkInterfaces()).flat()) {
    if (l && l.family === 'IPv4' && !l.internal) console.log('  Other devices on your LAN:       http://' + l.address + ':' + PORT);
  }
  console.log(GOOGLE_CLIENT_ID ? '  Google sign-in: on' : '  Google sign-in: off (set GOOGLE_CLIENT_ID to turn it on)');
  console.log('');
});
