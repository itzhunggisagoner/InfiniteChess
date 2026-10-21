import R4 from './room4.js';
import Auth from './auth.js';

const RELAY = new Set(['start', 'move', 'resign']);   // messages forwarded straight to the opponent

export class Hub {
  constructor(state, env) {
    this.rooms = new Map();
    // usernames are saved in the Durable Object's storage so they survive restarts
    this.auth = Auth.createAuth({
      get: key => state.storage.get(key),
      put: entries => state.storage.put(entries)
    }, env.GOOGLE_CLIENT_ID);
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const c = { ws: server, room: null, gone: false, name: '', verified: false, sub: null, nameKey: null };
    server.addEventListener('message', e => {
      let m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m && typeof m === 'object') this.handle(c, m).catch(() => {});
    });
    const leave = () => this.leave(c);
    server.addEventListener('close', leave);
    server.addEventListener('error', leave);
    return new Response(null, { status: 101, webSocket: client });
  }

  send(c, o) {
    try { c.ws.send(JSON.stringify(o)); } catch (e) {}
  }

  leave(c) {
    if (c.gone) return;
    c.gone = true;
    this.auth.release(c);                                         // free the name
    if (R4.leave(this.rooms, c, (x, o) => this.send(x, o))) {
      try { c.ws.close(1000, 'bye'); } catch (e) {}
      return;
    }
    const r = this.rooms.get(c.room);
    if (!r) return;
    const o = r.h === c ? r.g : r.h;
    if (o) this.send(o, { t: 'left' });
    this.rooms.delete(c.room);
    try { c.ws.close(1000, 'bye'); } catch (e) {}
  }

  async handle(c, m) {
    const send = (x, o) => this.send(x, o);
    if (m.t === 'ping') return send(c, { t: 'pong' });             // keep-alive from the browser
    if (await this.auth.handle(c, m, send)) return;                // Google account / username requests

    // create / join: first work out the player's name (Google username, or a checked guest name)
    if (m.t === 'create' || m.t === 'create4' || m.t === 'join') {
      if (c.room) return;                                          // already in a room
      const id = await this.auth.claim(c, m);
      if (c.gone) { this.auth.release(c); return; }
      if (!id.ok) return send(c, { t: 'err', m: id.m, code: id.code });
      m.name = id.name;
    }

    if (R4.handle(this.rooms, c, m, send)) return;                 // four-player rooms

    if (m.t === 'create') {
      let code;
      do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (this.rooms.has(code));
      this.rooms.set(code, { h: c, g: null, pub: m.vis !== 'private', hname: c.name, tc: +m.tc || 0 });
      c.room = code;
      return send(c, { t: 'created', room: code, v: c.verified ? 1 : 0 });
    }

    if (m.t === 'join') {
      const code = String(m.room || '').trim(), r = this.rooms.get(code);
      if (!r) return send(c, { t: 'err', m: 'Room not found. Check the code and try again.' });
      if (r.g) return send(c, { t: 'err', m: 'This room is already full.' });
      r.g = c;
      c.room = code;
      send(c, { t: 'joined', v: c.verified ? 1 : 0 });
      return send(r.h, { t: 'peer' });
    }

    const r = this.rooms.get(c.room);
    if (!r) return;
    const o = r.h === c ? r.g : r.h;

    if (m.t === 'chat') {                                          // two-player room chat: Google users only
      if (!c.verified) return send(c, { t: 'chatlock' });
      const text = String(m.text || '').slice(0, 300);
      if (text.trim() && o && o.verified) send(o, { t: 'chat', name: c.name, seat: null, text });
      return;
    }

    if (!RELAY.has(m.t)) return;
    if (o) send(o, m);
  }
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);

    if (u.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      return env.HUB.get(env.HUB.idFromName('hub')).fetch(req);
    }

    if (u.pathname === '/config.json') {                           // tells the page which Google client to use
      return new Response(JSON.stringify({ googleClientId: env.GOOGLE_CLIENT_ID || '' }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    const r = await env.ASSETS.fetch(req);
    const h = new Headers(r.headers);
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    h.set('Cross-Origin-Embedder-Policy', 'require-corp');
    return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
  }
};
