'use strict';

/*
  Accounts and names, shared by server.js (Node) and worker.js (Cloudflare).

  - Google sign-in: the browser gets a Google ID token, the server verifies it
    (signature + audience) with Google's tokeninfo endpoint.
  - A Google account can create ONE username. Usernames are unique
    (case-insensitive) and saved permanently through the `store` below.
  - Guests can still type a name, but it must be unique too: it can't match a
    registered username or a name that is online right now.
  - Only connections verified with Google (c.verified) are allowed to chat.

  store = {
    get(key)      -> Promise<value | undefined>
    put(entries)  -> Promise<void>        // entries is a plain object {key: value}
  }
  Keys: 'u:<google sub>' -> { name }   and   'n:<lowercase name>' -> '<google sub>'
*/

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,12}[\p{L}\p{N}]$/u;   // 3-14 chars
const RESERVED = new Set(['bot', 'system', 'admin', 'server', 'moderator', 'red', 'blue', 'yellow', 'green', 'white', 'black', 'player', 'guest', 'host', 'you']);
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

const normalize = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
const keyOf = name => name.toLowerCase();

/* returns an error message, or '' when the name is acceptable */
function checkFormat(name) {
  if (!NAME_RE.test(name)) return 'Name must be 3-14 characters: letters, numbers, spaces, "_", "." or "-".';
  if (RESERVED.has(keyOf(name)) || /^guest\d*$/i.test(name)) return 'This name is reserved. Please pick another one.';
  return '';
}

function createAuth(store, clientId) {
  const online = new Map();      // lowercase name -> connection currently using it
  const tokens = new Map();      // id token -> { sub, exp } (verified already)

  /* Run async jobs one after another so "check name, then save it" can't interleave. */
  let chain = Promise.resolve();
  const exclusive = job => {
    const run = chain.then(job);
    chain = run.catch(() => {});
    return run;
  };

  /* ---------- Google ID token ---------- */
  async function verifyToken(token) {
    token = String(token || '');
    if (!clientId) return { err: 'Google sign-in is not set up on this server.', code: 'config' };
    if (token.length < 20 || token.length > 4096) return { err: 'Invalid Google session. Please sign in again.', code: 'auth' };
    const hit = tokens.get(token);
    if (hit) {
      if (hit.exp * 1000 > Date.now()) return hit;
      tokens.delete(token);
      return { err: 'Your Google session expired. Please sign in again.', code: 'auth' };
    }
    try {
      const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token));
      if (!res.ok) return { err: 'Google sign-in failed. Please sign in again.', code: 'auth' };
      const j = await res.json();
      const exp = +j.exp || 0;
      if (j.aud !== clientId || !ISSUERS.has(j.iss) || !j.sub || exp * 1000 <= Date.now()) {
        return { err: 'Google sign-in failed. Please sign in again.', code: 'auth' };
      }
      if (tokens.size > 500) tokens.clear();
      const id = { sub: String(j.sub), exp };
      tokens.set(token, id);
      return id;
    } catch (e) {
      return { err: 'Could not reach Google to verify your sign-in. Try again.', code: 'auth' };
    }
  }

  /* ---------- names ---------- */
  function release(c) {
    if (c.nameKey && online.get(c.nameKey) === c) online.delete(c.nameKey);
    c.nameKey = null;
  }

  /* is this name free for connection c? Returns '' or an error message. */
  async function nameTaken(name, c, ownerSub) {
    const k = keyOf(name);
    const holder = online.get(k);
    if (holder && holder !== c) return 'This name is already in use right now. Please pick another one.';
    const owner = await store.get('n:' + k);
    if (owner && owner !== ownerSub) return 'This name belongs to a Google account. Please pick another one.';
    return '';
  }

  /*
    Work out who connection c is for create / create4 / join.
    Sets c.name and c.verified and reserves the name while the connection is open.
    Resolves { ok:true, name, verified } or { ok:false, m, code }.
  */
  function claim(c, m) {
    return exclusive(async () => {
      if (m.token) {                                              // signed in with Google
        const id = await verifyToken(m.token);
        if (id.err) return { ok: false, m: id.err, code: id.code };
        const acc = await store.get('u:' + id.sub);
        if (!acc || !acc.name) return { ok: false, m: 'Create your username first.', code: 'needname' };
        const k = keyOf(acc.name), holder = online.get(k);
        if (holder && holder !== c) return { ok: false, m: 'This account is already online in another tab or device.', code: 'busy' };
        release(c);
        online.set(k, c); c.nameKey = k;
        c.name = acc.name; c.verified = true; c.sub = id.sub;
        return { ok: true, name: acc.name, verified: true };
      }
      let name = normalize(m.name);                               // guest
      if (!name) {
        let n; do { n = 'Guest' + Math.floor(1000 + Math.random() * 9000); } while (online.has(keyOf(n)));
        name = n;
      } else {
        if (c.nameKey === keyOf(name) && !c.verified) return { ok: true, name: c.name, verified: false };
        const bad = checkFormat(name) || await nameTaken(name, c, null);
        if (bad) return { ok: false, m: bad, code: 'name' };
      }
      release(c);
      online.set(keyOf(name), c); c.nameKey = keyOf(name);
      c.name = name; c.verified = false; c.sub = null;
      return { ok: true, name, verified: false };
    });
  }

  /*
    { t:'acct', token }            -> who am I? (does this Google account have a username yet)
    { t:'acct', token, name }      -> create the username (only once per account)
    Answers { t:'acct', ok, name, m?, code? }.
  */
  async function handle(c, m, send) {
    if (m.t !== 'acct') return false;
    const reply = o => send(c, Object.assign({ t: 'acct' }, o));
    await exclusive(async () => {
      const id = await verifyToken(m.token);
      if (id.err) return reply({ ok: false, m: id.err, code: id.code });
      const acc = await store.get('u:' + id.sub);
      if (m.name === undefined) return reply({ ok: true, name: acc ? acc.name : null });
      if (acc && acc.name) return reply({ ok: false, m: 'This account already has the username "' + acc.name + '".', code: 'has', name: acc.name });
      const name = normalize(m.name);
      const bad = checkFormat(name) || await nameTaken(name, c, null);
      if (bad) return reply({ ok: false, m: bad, code: 'name' });
      await store.put({ ['u:' + id.sub]: { name }, ['n:' + keyOf(name)]: id.sub });
      reply({ ok: true, name });
    });
    return true;
  }

  return { handle, claim, release, clientId: clientId || '' };
}

module.exports = { createAuth, checkFormat, normalize };
