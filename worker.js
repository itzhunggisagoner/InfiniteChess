// Infinite Chess — Cloudflare Worker
// 1) Serves the game files (with COOP/COEP headers so multi-threaded Stockfish can run)
// 2) /ws: online rooms — a Durable Object ("Hub") pairs two players by a 4-digit room code

const RELAY = new Set(['start', 'move', 'resign']);   // messages forwarded straight to the opponent

export class Hub {
  constructor() { this.rooms = new Map(); }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const c = { ws: server, room: null, gone: false };
    server.addEventListener('message', e => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m && typeof m === 'object') { try { this.handle(c, m); } catch (x) {} }
    });
    const leave = () => this.leave(c);
    server.addEventListener('close', leave);
    server.addEventListener('error', leave);
    return new Response(null, { status: 101, webSocket: client });
  }

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
    if (m.t === 'create') {
      if (c.room) return;                                                    // already in a room
      let code; do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (this.rooms.has(code));
      this.rooms.set(code, { h: c, g: null }); c.room = code;
      return this.send(c, { t: 'created', room: code });
    }
    if (m.t === 'join') {
      if (c.room) return;
      const code = String(m.room || '').trim(), r = this.rooms.get(code);
      if (!r) return this.send(c, { t: 'err', m: 'Room not found. Check the code and try again.' });
      if (r.g) return this.send(c, { t: 'err', m: 'This room is already full.' });
      r.g = c; c.room = code; this.send(c, { t: 'joined' }); return this.send(r.h, { t: 'peer' });
    }
    if (!RELAY.has(m.t)) return;
    const r = this.rooms.get(c.room); if (!r) return;
    const o = r.h === c ? r.g : r.h; if (o) this.send(o, m);
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
