'use strict';

/*
  Four-player room logic shared by server.js (Node) and worker.js (Cloudflare).
  Connections only need to work with the supplied send(conn, obj).

  Rooms: { four:true, seats:{color:conn|null}, bots:Set, hostSeat, started, tc }
  Move validation stays on the clients; the server enforces seat identity, host-only controls
  (bots, kick, start) and that bot moves can only come from the host.

  Names are claimed by auth.js before create4 / join reach this file (c.name, c.verified).
  Chat is only sent by, and delivered to, connections verified with Google (c.verified).
*/

const COL = ['red', 'blue', 'yellow', 'green'];
const clean = s => String(s || '').replace(/[\u0000-\u001f<>&"']/g, '').trim().slice(0, 14);
const cap = c => c[0].toUpperCase() + c.slice(1);
const num = v => Math.max(-99, Math.min(99, Math.trunc(+v) || 0));

function snap(r, code, t) {
  const seats = {};
  for (const c of COL) {
    const s = r.seats[c];
    seats[c] = s ? { n: s.name, b: 0, v: s.verified ? 1 : 0 } : r.bots.has(c) ? { n: 'Bot', b: 1 } : null;
  }
  return { t: t || 'lobby', room: code, host: r.hostSeat, started: r.started, tc: r.tc, vis: r.vis, seats };
}

/* send to every human in the room (optionally skipping one connection / filtering by predicate) */
function all(r, send, o, except, only) {
  for (const c of COL) {
    const s = r.seats[c];
    if (s && s !== except && (!only || only(s))) send(s, o);
  }
}

function lobby(r, code, send, t) {
  all(r, send, snap(r, code, t));
}

/* public rooms that can still be joined (four-player rooms and two-player rooms) */
function list(rooms) {
  const out = [];
  for (const [code, r] of rooms) {
    if (r.four) {
      if (r.vis !== 'public' || r.started) continue;
      const n = COL.filter(x => r.seats[x] || r.bots.has(x)).length;
      if (n < 4) out.push({ room: code, kind: 4, host: r.seats[r.hostSeat].name, n, tc: r.tc });
    } else if (r.pub && r.h && !r.g) {
      out.push({ room: code, kind: 2, host: r.hname || 'Player', n: 1, tc: r.tc || 0 });
    }
  }
  return out.slice(0, 30);
}

function handle(rooms, c, m, send) {
  if (m.t === 'list') {
    send(c, { t: 'rooms', list: list(rooms) });
    return true;
  }

  if (m.t === 'create4') {
    if (c.room) return true;
    let code;
    do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(code));
    const r = {
      four: true,
      seats: { red: c, blue: null, yellow: null, green: null },
      bots: new Set(),
      hostSeat: 'red',
      started: false,
      vis: m.vis === 'private' ? 'private' : 'public',
      tc: Math.max(0, Math.min(10800, +m.tc || 0))
    };
    rooms.set(code, r);
    c.room = code;
    c.seat = 'red';
    c.name = c.name || clean(m.name) || 'Red';
    send(c, { t: 'created4', room: code, seat: 'red', v: c.verified ? 1 : 0 });
    lobby(r, code, send);
    return true;
  }

  if (m.t === 'join') {
    if (c.room) return false;
    const code = String(m.room || '').trim(), r = rooms.get(code);
    if (!r || !r.four) return false;                              // normal two-player room (or unknown code)
    if (r.started) {
      send(c, { t: 'err', m: 'This game has already started.' });
      return true;
    }
    const seat = COL.find(x => !r.seats[x] && !r.bots.has(x));
    if (!seat) {
      send(c, { t: 'err', m: 'This room is full.' });
      return true;
    }
    r.seats[seat] = c;
    c.room = code;
    c.seat = seat;
    c.name = c.name || clean(m.name) || cap(seat);
    send(c, { t: 'joined4', room: code, seat, v: c.verified ? 1 : 0 });
    lobby(r, code, send);
    return true;
  }

  const r = c.room && rooms.get(c.room);
  if (!r || !r.four) return false;
  const host = c.seat === r.hostSeat;

  switch (m.t) {
    case 'chat': {
      if (!c.verified) {                                          // chat needs a Google-verified name
        send(c, { t: 'chatlock' });
        break;
      }
      const text = String(m.text || '').slice(0, 300);
      if (!text.trim()) break;
      all(r, send, { t: 'chat', name: c.name, seat: c.seat, text }, c, s => s.verified);
      break;
    }

    case 'cfg':   // host: room settings, synced to everyone in the lobby
      if (!host || r.started) break;
      if (m.tc !== undefined) r.tc = Math.max(0, Math.min(10800, +m.tc || 0));
      if (m.vis === 'public' || m.vis === 'private') r.vis = m.vis;
      lobby(r, c.room, send);
      break;

    case 'rematch':   // host: everyone back to the lobby
      if (!host || !r.started) break;
      r.started = false;
      lobby(r, c.room, send, 'rematch');
      break;

    case 'bot':   // host: add / remove a bot in an empty seat (lobby only)
      if (!host || r.started || !COL.includes(m.color) || r.seats[m.color]) break;
      m.on ? r.bots.add(m.color) : r.bots.delete(m.color);
      lobby(r, c.room, send);
      break;

    case 'kick': {
      if (!host || r.started || !COL.includes(m.color) || m.color === c.seat) break;
      const t = r.seats[m.color];
      if (!t) break;
      r.seats[m.color] = null;
      t.room = null;
      t.seat = null;
      send(t, { t: 'kicked' });
      lobby(r, c.room, send);
      break;
    }

    case 'start4':
      if (!host || r.started || !COL.every(x => r.seats[x] || r.bots.has(x))) break;
      r.started = true;
      lobby(r, c.room, send, 'start4');
      break;

    case 'move4': {
      if (!r.started) break;
      const col = host && m.bot && r.bots.has(m.bot) ? m.bot : c.seat;
      all(r, send, { t: 'move4', c: col, fx: num(m.fx), fy: num(m.fy), tx: num(m.tx), ty: num(m.ty) }, c);
      break;
    }

    case 'resign4': {
      if (!r.started) break;
      const col = host && COL.includes(m.color) ? m.color : c.seat;       // host also reports time-outs / bot resignations
      all(r, send, { t: 'resign4', c: col }, c);
      break;
    }
  }
  return true;
}

/* returns true when the connection belonged to a four-player room */
function leave(rooms, c, send) {
  const r = c.room && rooms.get(c.room);
  if (!r || !r.four) return false;

  if (c.seat === r.hostSeat) {                                    // host left: room closes
    all(r, send, { t: 'left' }, c);
    for (const s of COL) {
      if (r.seats[s]) {
        r.seats[s].room = null;
        r.seats[s].seat = null;
      }
    }
    rooms.delete(c.room);
    return true;
  }

  r.seats[c.seat] = null;
  if (r.started) {                                                // a bot takes over the empty seat
    r.bots.add(c.seat);
    all(r, send, { t: 'bot4', c: c.seat });
  }
  lobby(r, c.room, send);
  return true;
}

module.exports = { handle, leave, clean };
