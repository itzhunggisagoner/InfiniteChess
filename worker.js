const RELAY = new Set(['start', 'move', 'resign']);   // messages forwarded straight to the opponent

// room settings the host announces (shown in the room list); never trust the client's shape
const cleanInfo = m => ({ vr: String(m.vr || 'std').slice(0, 10), tc: Math.max(0, Math.min(10800, +m.tc | 0)), hc: m.hc === 'b' ? 'b' : 'w', lay: Number.isInteger(m.lay) && m.lay >= 0 && m.lay < 960 ? m.lay : 0 });

const cleanName = s => [...String(s || '').replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim()].slice(0, 16).join('') || 'Guest';

const TAKEN_MSG = 'That username is already in use online. Change it in the main menu.';

export class Hub {
  constructor() { this.rooms = new Map(); }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const c = { ws: server, room: null, gone: false, fails: 0 };
    server.addEventListener('message', e => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m && typeof m === 'object') { try { this.handle(c, m); } catch (x) {} }
    });
    const leave = () => this.leave(c);
    server.addEventListener('close', leave);
    server.addEventListener('error', leave);
    return new Response(null, { status: 101, webSocket: client });
  }

  taken(n, c) { return n !== 'Guest' && [...this.rooms.values()].some(r => [r.h, r.g].some(x => x && x !== c && x.name && x.name.toLowerCase() === n.toLowerCase())); }

  list() { return [...this.rooms].filter(([k, r]) => !r.g && r.pub).slice(-40).reverse().map(([k, r]) => ({ room: k, lock: !!r.pw, ...r.info })); }

  send(c, o) { try { c.ws.send(JSON.stringify(o)); } catch (e) {} }

  leave(c) {
    if (c.gone) return; c.gone = true;
    const r = this.rooms.get(c.room); if (!r) return;
    const o = r.h === c ? r.g : r.h; if (o) this.send(o, { t: 'left' });
    this.rooms.delete(c.room);
    try { c.ws.close(1000, 'bye'); } catch (e) {}
  }

  handle(c, m) {
    if (m.t === 'ping') return this.send(c, { t: 'pong' });                  // keep-alive from the browser
    if (m.t === 'chk') return this.send(c, { t: this.taken(cleanName(m.n), c) ? 'nametaken' : 'nameok' });
    if (m.t === 'list') return this.send(c, { t: 'rooms', rooms: this.list() });
    if (m.t === 'create') {
      if (c.room) return;                                                    // already in a room
      let code; do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (this.rooms.has(code));
      const nn = cleanName(m.n); if (this.taken(nn, c)) return this.send(c, { t: 'err', m: TAKEN_MSG }); c.name = nn; const info = { ...cleanInfo(m), hn: c.name };
      this.rooms.set(code, { h: c, g: null, pw: String(m.pw || '').slice(0, 16), pub: m.pub !== 0 && m.pub !== false, info }); c.room = code;
      return this.send(c, { t: 'created', room: code, info });
    }
    if (m.t === 'join') {
      if (c.room) return;
      const code = String(m.room || '').trim(), r = this.rooms.get(code);
      if (!r) return this.send(c, { t: 'err', m: 'Room not found. Check the code and try again.' });
      if (r.g) return this.send(c, { t: 'err', m: 'This room is already full.' });
      if (r.pw && String(m.pw || '') !== r.pw) {
        if (++c.fails > 8) return this.send(c, { t: 'err', m: 'Too many wrong attempts. Reconnect and try again.' });
        return this.send(c, { t: 'err', m: m.pw ? 'Wrong password.' : 'This room needs a password.' });
      }
      const nn = cleanName(m.n); if (this.taken(nn, c)) return this.send(c, { t: 'err', m: TAKEN_MSG });
      r.g = c; c.room = code; c.name = nn; this.send(c, { t: 'joined', info: r.info }); return this.send(r.h, { t: 'peer', n: c.name });
    }
    if (!RELAY.has(m.t)) return;
    const r = this.rooms.get(c.room); if (!r) return;
    const o = r.h === c ? r.g : r.h; if (o) this.send(o, m.t === 'start' ? { ...m, n: c.name } : m);
  }
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      return env.HUB.get(env.HUB.idFromName('hub')).fetch(req);
    }
    const r = await env.ASSETS.fetch(req);
    const h = new Headers(r.headers);
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    h.set('Cross-Origin-Embedder-Policy', 'require-corp');
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
  }
};
