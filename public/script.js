const $ = (s) => document.querySelector(s), cv = $("#cv"), g = cv.getContext("2d");
const R = "resources/", PN = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
/* ======================= CONFIG & SOUND ======================= */
const CFG = { th: 0, snd: true, vol: 0.8, coords: true, anim: true };
try {
  Object.assign(CFG, JSON.parse(localStorage.getItem("icfg") || "{}"));
} catch (e) {
}
const save = () => {
  try {
    localStorage.setItem("icfg", JSON.stringify(CFG));
  } catch (e) {
  }
};
const IM = {};
for (const c of "wb") for (const t of "kqrbnp") {
  const im = new Image();
  im.onload = () => req();
  im.src = `${R}pieces/${c === "w" ? "white" : "black"}_${PN[t]}.png`;
  IM[c + t] = im;
}
const SN = ["capture", "castle", "illegal", "move-check", "move-opponent", "move-self", "tensecondsremain", "game-start", "game-end"];
let AC = null, ai = 0;
const AB = {}, AE = {};
function audioInit() {
  if (ai) return;
  ai = 1;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    AC = null;
  }
  for (const k of SN) {
    const u = `${R}sounds/${k}.mp3`, a = new Audio(u);
    a.preload = "auto";
    AE[k] = a;
    if (AC) fetch(u).then((r) => r.arrayBuffer()).then((b) => AC.decodeAudioData(b)).then((b) => AB[k] = b).catch(() => {
    });
  }
}
addEventListener("pointerdown", audioInit, true);
addEventListener("keydown", audioInit, true);
function play(n) {
  if (!CFG.snd) return;
  audioInit();
  if (AC && AC.state === "suspended") AC.resume();
  if (AC && AB[n]) {
    const s2 = AC.createBufferSource(), g2 = AC.createGain();
    s2.buffer = AB[n];
    g2.gain.value = CFG.vol;
    s2.connect(g2).connect(AC.destination);
    s2.start();
  } else if (AE[n]) {
    const a = AE[n].cloneNode();
    a.volume = CFG.vol;
    a.play().catch(() => {
    });
  }
}
/* ======================= ENGINE: see engine.js (rules + built-in bot, also runs in a Web Worker) ======================= */
/* ======================= STOCKFISH ======================= */
const LV = [{ ms: 250, elo: 1350 }, { ms: 600, elo: 1900 }, { ms: 1100, elo: 2500 }, { ms: 1600, elo: 0 }];
const SF_URL = R + "stockfish-19-lite/stockfish-19-lite.js";
let SF = null, sfReady = false, sfFail = false, sfCb = null, sfPend = 0;
const sqn = (x, y) => "abcdefgh"[x] + (y + 1);
function sfDie() {
  sfFail = true;
  sfReady = false;
  try {
    SF && SF.terminate();
  } catch (e) {
  }
  SF = null;
  stt();
}
function sfInit() {
  if (!globalThis.Worker || typeof SharedArrayBuffer === "undefined" || !globalThis.crossOriginIsolated) return sfDie();
  try {
    setTimeout(() => {
      if (!sfReady && !sfFail) sfDie();
    }, 2e4);
    SF = new Worker(SF_URL);
    SF.onmessage = (e) => {
      const l = typeof e.data === "string" ? e.data : "";
      if (l === "uciok") SF.postMessage("isready");
      else if (l === "readyok") {
        if (!sfReady) {
          SF.postMessage("setoption name Threads value 1");
          SF.postMessage("setoption name Hash value 16");
        }
        sfReady = true;
        stt();
      } else if (l.startsWith("bestmove")) {
        sfPend--;
        if (!sfPend && sfCb) sfCb(l.split(" ")[1]);
      }
    };
    SF.onerror = sfDie;
    SF.postMessage("uci");
  } catch (e) {
    sfDie();
  }
}
const fits = (P2) => {
  for (const p of P2.m.values()) if (p.x < 0 || p.x > 7 || p.y < 0 || p.y > 7 || p.t === "p" && (p.y === 0 || p.y === 7)) return false;
  return true;
};
function fen(P2) {
  let s = "";
  for (let y = 7; y >= 0; y--) {
    let e = 0;
    for (let x = 0; x < 8; x++) {
      const p = P2.get(x, y);
      if (!p) e++;
      else {
        if (e) {
          s += e;
          e = 0;
        }
        s += p.c === "w" ? p.t.toUpperCase() : p.t;
      }
    }
    if (e) s += e;
    if (y) s += "/";
  }
  const ck = (c, y) => {
    const k = P2.k[c], a = P2.get(7, y), b2 = P2.get(0, y), o = !k.moved && k.x === 4 && k.y === y;
    return [o && a && a.t === "r" && a.c === c && !a.moved, o && b2 && b2.t === "r" && b2.c === c && !b2.moved];
  }, w = ck("w", 0), b = ck("b", 7);
  const cr = (w[0] ? "K" : "") + (w[1] ? "Q" : "") + (b[0] ? "k" : "") + (b[1] ? "q" : "") || "-", ep = P2.ep && P2.ep.x >= 0 && P2.ep.x < 8 && P2.ep.y >= 0 && P2.ep.y < 8 ? sqn(P2.ep.x, P2.ep.y) : "-";
  return `${s} ${P2.turn} ${cr} ${ep} ${P2.hm} 1`;
}
function sfThink(P2, c, lv2) {
  return new Promise((res) => {
    const mp = new Map();
    for (const m of gen(P2, c, 7)) {
      if (m.tx < 0 || m.tx > 7 || m.ty < 0 || m.ty > 7 || m.p.t === "p" && (m.ty === 7 || m.ty === 0)) continue;
      mp.set(sqn(m.fx, m.fy) + sqn(m.tx, m.ty), m);
    }
    if (!mp.size) return res(null);
    const L = LV[lv2];
    let done = 0;
    const fin = (m) => {
      if (!done) {
        done = 1;
        clearTimeout(tm);
        sfCb = null;
        res(m);
      }
    }, tm = setTimeout(() => {
      SF.postMessage("stop");
      fin(null);
    }, L.ms + 7e3);
    sfCb = (b) => fin(mp.get(b) || null);
    SF.postMessage("setoption name UCI_LimitStrength value " + (L.elo ? "true" : "false"));
    if (L.elo) SF.postMessage("setoption name UCI_Elo value " + L.elo);
    SF.postMessage("position fen " + fen(P2));
    sfPend++;
    SF.postMessage(`go movetime ${L.ms} searchmoves ${[...mp.keys()].join(" ")}`);
  });
}
const sfAbort = () => {
  intAbort();
  if (SF && sfCb) {
    sfCb = null;
    SF.postMessage("stop");
  }
};
let IW = null, iwId = 0;
function intAbort() {
  if (IW) {
    try {
      IW.terminate();
    } catch (e) {
    }
    IW = null;
  }
}
function intThink(P2, c, lv2) {
  let w = IW;
  if (!w && globalThis.Worker) {
    try {
      w = IW = new Worker("engine.js");
    } catch (e) {
      w = IW = null;
    }
  }
  if (!w) return new Promise((r) => setTimeout(() => r(think(P2, c, Math.min(lv2, 1))), 80));
  return new Promise((res) => {
    const id = ++iwId, ws = w;
    ws.onmessage = (e) => {
      if (e.data.id !== id) return;
      const d = e.data.m, p = d && P2.get(d.fx, d.fy), m = p && pm(P2, p, d.tx, d.ty);
      res(m && legal(P2, m) ? m : null);
    };
    ws.onerror = () => {
      if (IW === ws) intAbort();
      res(think(P2, c, Math.min(lv2, 1)));
    };
    ws.postMessage({ id, lv: lv2, vr: VR, turn: P2.turn, ep: P2.ep, hm: P2.hm, pcs: [...P2.m.values()].map((q) => ({ t: q.t, c: q.c, x: q.x, y: q.y, mv: q.moved })) });
  });
}
/* ======================= GAME STATE ======================= */
const fl = (x) => x >= 0 && x < 8 ? "abcdefgh"[x] : `(${x + 1})`, sq = (x, y) => fl(x) + (y + 1), RM0 = matchMedia("(prefers-reduced-motion:reduce)").matches, ez = (t) => 1 - Math.pow(1 - t, 3), eb = (t) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
const TH = [["#ebecd0", "#739552", "Green"], ["#f0d9b5", "#b58863", "Wood"], ["#dfe5e8", "#7f97a6", "Slate"], ["#f3e3e0", "#c98a8a", "Rose"], ["#e9e4f1", "#8672a8", "Purple"], ["#b8c0c8", "#46525e", "Night"]], NA = () => RM0 || !CFG.anim, LVN = [["Easy", "Elo 1350"], ["Medium", "Elo 1900"], ["Hard", "Elo 2500"], ["Max", "Strongest"]], TCS = [[0, "No limit"], [60, "1 min"], [180, "3 min"], [300, "5 min"], [600, "10 min"], ["c", "Custom"]], VRS = [["std", "Standard", "Classic rules"], ["koth", "King of the Hill", "King to the center"], ["chk3", "Three-check", "Give 3 checks"], ["tq", "Triple Queens", "Bishops become queens"], ["960", "Chess960", "Shuffled back rank"], ["atomic", "Atomic", "Captures explode"], ["anti", "Antichess", "Lose all your pieces"], ["rk", "Racing Kings", "Race to the 8th rank"], ["4p", "4 Player Chess", "Cross board, 4 colors"]], VN = Object.fromEntries(VRS.map((v) => [v[0], v[1]]));
let P, H = [], mode = "2p", me = "w", lv = 1, over = null, sel = null, flip = false, thinking = false, last = null, chk = [], gid = 0, W, H_, ind = [], engUsed = "", sfNote = false;
let layN = 0, booms = [], selT = 0, chkT = 0, caps = [], rips = [], bad = [], shake = null, clk = null, warned = { w: 0, b: 0 };
const Vw = { cx: 4, cy: 4, s: 60 };
function san(mv) {
  const p = mv.p;
  if (mv.rk) return mv.tx > mv.fx ? "O-O" : "O-O-O";
  let s = "";
  if (p.t !== "p") {
    s = p.t.toUpperCase();
    const am = [...P.m.values()].filter((q) => q !== p && q.c === p.c && q.t === p.t && ((m) => m && legal(P, m))(pm(P, q, mv.tx, mv.ty)));
    if (am.length) s += am.some((q) => q.x === p.x) ? am.some((q) => q.y === p.y) ? sq(p.x, p.y) : p.y + 1 : fl(p.x);
  } else if (mv.cap) s = fl(p.x);
  return s + (mv.cap ? "x" : "") + sq(mv.tx, mv.ty) + (VR === "atomic" && mv.cap ? "*" : "");
}
function newGame(o) {
  gid++;
  sfAbort();
  H = [];
  over = null;
  sel = null;
  last = null;
  thinking = false;
  caps = [];
  mode = o.mode;
  lv = +o.lv || 0;
  engUsed = "";
  VR = VN[o.vr] ? o.vr : "std";
  booms = [];
  layN = VR === "960" ? Number.isInteger(o.lay) && o.lay >= 0 && o.lay < 960 ? o.lay : Math.random() * 960 | 0 : 0;
  P = setup(VR, b960(layN));
  me = o.color === "r" ? Math.random() < 0.5 ? "w" : "b" : o.color;
  flip = mode !== "2p" && me === "b";
  Vw.cx = 4;
  Vw.cy = 4;
  const tcs = Math.max(0, Math.min(10800, +o.tc || 0));
  clk = tcs ? { w: tcs * 1e3, b: tcs * 1e3, last: performance.now() } : null;
  warned = { w: 0, b: 0 };
  fit();
  refresh();
  if (VR === "960") toast("Chess960: castle by dragging your king onto your rook");
  if (VR === "anti") toast("Antichess: captures are mandatory");
  if (mode === "bot" && !sfReady && !sfNote) {
    sfNote = true;
    if (sfFail) toast("Stockfish can't run in this browser — using the built-in engine.");
  }
}
function doMove(mv, anim, remote) {
  tickClock();
  const now = performance.now(), d = anim && !NA() ? 240 : 0;
  let s = san(mv);
  const mover = P.turn;
  if (mode === "lan" && !remote && WS) WS.send(JSON.stringify({ t: "move", fx: mv.fx, fy: mv.fy, tx: mv.tx, ty: mv.ty }));
  if (mv.cap) caps.push({ c: mv.cap.c, t: mv.cap.t, x: mv.cap.x, y: mv.cap.y, t0: now + d * 0.6 });
  const u = make(P, mv);
  if (u.ex) {
    booms.push({ x: mv.tx, y: mv.ty, t0: now + d * 0.6 });
    for (const q of u.ex) caps.push({ c: q.c, t: q.t, x: q.x, y: q.y, t0: now + d * 0.6 });
    caps.push({ c: mv.p.c, t: mv.p.t, x: mv.tx, y: mv.ty, t0: now + d * 0.6 });
  }
  mv.p.an = { fx: mv.fx, fy: mv.fy, t0: now, d };
  if (mv.rk) mv.rk.an = { fx: mv.rfx, fy: mv.fy, t0: now, d };
  if (clk) clk.last = now;
  const ck = inCheck(P, P.turn), has = gen(P, P.turn, 3).length > 0;
  if (ck) {
    s += has ? "+" : "#";
    chkT = now + d;
  }
  H.push({ u, s });
  last = mv;
  sel = null;
  const opp_ = (mode === "bot" || mode === "lan") && mover !== me;
  setTimeout(() => play(ck ? "move-check" : mv.rk ? "castle" : mv.cap ? "capture" : opp_ ? "move-opponent" : "move-self"), d * 0.7);
  over = endChk(mover, mv, ck, has);
  refresh(!!over);
}
function endChk(mover, mv, ck, has) {
  const sd = P.turn, o = [...P.m.values()].filter((p) => p.t !== "k");
  if (VR === "koth" && inHill(mv.p.t === "k" ? mv.p : P.k[mover])) return { w: mover, r: "King of the Hill!" };
  if (VR === "chk3" && ck && chks(mover) >= 3) return { w: mover, r: "Third check!" };
  if (VR === "atomic" && !kg(P, sd)) return { w: mover, r: "King exploded!" };
  if (VR === "anti" && !has) return { w: sd, r: [...P.m.values()].some((p) => p.c === sd) ? "Stalemate — a win in Antichess" : "No pieces left!" };
  if (VR === "rk") {
    const wr = P.k.w.y === 7, br = P.k.b.y === 7;
    if (mover === "b" && (wr || br)) return wr && br ? { w: null, r: "Both kings made it — draw" } : { w: wr ? "w" : "b", r: "Race won!" };
    if (mover === "w" && wr && !gen(P, "b", 2, false, P.k.b).some((m) => m.ty === 7)) return { w: "w", r: "Race won!" };
  }
  if (!has) return ck ? { w: mover, r: "Checkmate!" } : { w: null, r: "Stalemate — draw" };
  if (P.hm >= 100) return { w: null, r: "Draw (50-move rule)" };
  if (VR === "koth" || VR === "atomic" || VR === "anti" || VR === "rk" ? 0 : VR === "chk3" ? !o.length : !o.length || o.length === 1 && "nb".includes(o[0].t)) return { w: null, r: "Draw (insufficient material)" };
  return null;
}
const nm = (c) => c === "w" ? "White" : "Black", chks = (c) => H.filter((h, i) => i % 2 === (c === "w" ? 0 : 1) && /[+#]$/.test(h.s)).length;
function stt() {
  const st = $("#st");
  if (!P) return;
  st.classList.toggle("ck", !!chk.length && !over);
  st.classList.toggle("th", thinking);
  $("#stt").textContent = over ? over.r + (over.w ? " — " + nm(over.w) + " wins" : "") : thinking ? "Engine is thinking…" : (mode === "lan" ? P.turn === me ? "Your move" : "Opponent's move" : nm(P.turn) + " to move") + (chk.length ? " — CHECK!" : "");
  if (VR !== "std" && !over) $("#stt").textContent += " · " + (VR === "chk3" ? `Checks ${chks("w")}/3 – ${chks("b")}/3` : VR === "960" ? `Chess960 #${layN}` : VN[VR]);
  $(".tn").style.background = over ? "transparent" : P.turn === "w" ? "#fff" : "#222";
  const e = $("#eng");
  e.textContent = mode !== "bot" ? "" : engUsed === "sf" ? "Stockfish 19" : engUsed === "int" || VR !== "std" && VR !== "tq" ? "Built-in engine" : sfReady ? "Stockfish 19" : sfFail ? "Built-in engine" : "Loading Stockfish…";
  e.style.display = mode === "bot" ? "" : "none";
  drawClock();
}
function refresh(matePlayed) {
  chk = [];
  if (inCheck(P, P.turn)) {
    const k = P.k[P.turn];
    chk = [...P.m.values()].filter((q) => q.c !== P.turn && atk(P, q, k.x, k.y));
  }
  const mv = $("#mvl");
  mv.innerHTML = H.length ? "" : "<div class=e>No moves yet.</div>";
  for (let i = 0; i < H.length; i += 2) mv.insertAdjacentHTML("beforeend", `<div class=r><b>${i / 2 + 1}.</b><span>${H[i].s}</span><span>${H[i + 1] ? H[i + 1].s : ""}</span></div>`);
  if (mv.lastElementChild && mv.lastElementChild.className === "r") mv.lastElementChild.className = "r n";
  mv.scrollTop = 1e9;
  stt();
  req();
  const id = gid;
  if (over) {
    if (!over.s) {
      over.s = 1;
      const gi = gid;
      setTimeout(() => gi === gid && play("game-end"), matePlayed ? 650 : 0);
    }
    setTimeout(() => id === gid && dlg(`<h2>${over.r}</h2><p>${over.w ? (mode === "2p" ? nm(over.w) : over.w === me ? "You" : mode === "lan" ? "Your opponent" : "The engine") + (mode === "2p" || over.w !== me ? " wins" : " win") + " this game." : "The game ended in a draw."}</p><div class=sg><button class=pb data-a=new>New game</button><button data-a=x>View board</button></div>`), 900);
    return;
  }
  if (mode === "bot" && P.turn !== me && !thinking) botTurn(id);
}
async function botTurn(id) {
  thinking = true;
  stt();
  let m = null;
  if (sfReady && fits(P) && (VR === "std" || VR === "tq")) {
    m = await sfThink(P, P.turn, lv);
    if (m) engUsed = "sf";
  }
  if (!m) {
    m = await intThink(P, P.turn, Math.min(lv, 2));
    if (id !== gid) return;
    engUsed = "int";
  }
  if (id !== gid) return;
  thinking = false;
  if (m) doMove(m, true);
  else refresh();
}
function nope(p, x, y, msg) {
  play("illegal");
  bad.push({ x, y, t0: performance.now() });
  if (msg) {
    toast(msg);
    shake = { p, t0: performance.now() };
  }
  req();
}
function tryMove(p, x, y, byDrag) {
  if (x === p.x && y === p.y) return;
  const m = pm(P, p, x, y);
  if (!m) return nope(p, x, y);
  if (!legal(P, m)) return nope(p, x, y, VR === "anti" ? "You must capture when you can" : VR === "rk" ? "Racing Kings: no check — given or received" : VR === "atomic" ? "Illegal: your king would be in check or exploded" : "That move would leave your king in check");
  doMove(m, !byDrag);
}
const canPlay = (p) => !over && !thinking && p.c === P.turn && (mode === "2p" || p.c === me);
function undo() {
  if (F4mode) return toast("Undo isn't available in 4-player games");
  if (!H.length || thinking || over && mode === "lan") return;
  if (mode === "lan" || clk) return toast("Undo isn't available in online games or with a clock");
  const n = mode === "bot" && P.turn === me && H.length >= 2 ? 2 : 1;
  sfAbort();
  for (let i = 0; i < n; i++) unmake(P, H.pop().u);
  for (const p of P.m.values()) p.an = null;
  caps = [];
  booms = [];
  last = H.length ? H[H.length - 1].u.mv : null;
  over = null;
  sel = null;
  gid++;
  refresh();
}
function resign() {
  if (F4mode && F4) {
    f4Resign(F4.me || F4.cur);
    return;
  }
  if (over) return;
  const c = mode === "2p" ? P.turn : me;
  if (mode === "lan" && WS) WS.send(JSON.stringify({ t: "resign" }));
  over = { w: opp(c), r: "Resignation" };
  refresh();
}
/* ======================= CLOCK ======================= */
const fmt = (ms) => {
  ms = Math.max(0, ms);
  if (ms < 1e4 && ms > 0) return (ms / 1e3).toFixed(1);
  const t = Math.ceil(ms / 1e3), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sc = String(t % 60).padStart(2, "0");
  return h ? h + ":" + String(m).padStart(2, "0") + ":" + sc : Math.floor(t / 60) + ":" + sc;
};
function tcSec() {
  if (hs.tc !== "c") return +hs.tc;
  const t = Math.min(180, Math.max(0, hs.cm | 0)) * 60 + Math.min(59, Math.max(0, hs.cs | 0));
  if (t < 1) {
    toast("Enter a time greater than 0:00");
    return null;
  }
  return Math.min(t, 10800);
}
function tickClock() {
  if (!clk || !P) return;
  const n = performance.now(), d = n - clk.last;
  clk.last = n;
  if (over || homeOn) return;
  clk[P.turn] -= d;
  const c = P.turn;
  if (clk[c] <= 1e4 && clk[c] > 0 && !warned[c] && (mode !== "bot" || c === me)) {
    warned[c] = 1;
    play("tensecondsremain");
  }
  if (clk[c] <= 0) {
    clk[c] = 0;
    over = { w: opp(c), r: "Time out" };
    refresh();
  }
  drawClock();
}
function drawClock() {
  const e = $("#clk");
  e.hidden = !clk || homeOn;
  if (!clk) return;
  for (const c of "wb") {
    const b = e.querySelector("." + c);
    b.querySelector("b").textContent = fmt(clk[c]);
    b.classList.toggle("act", !over && P && P.turn === c);
    b.classList.toggle("low", clk[c] < 1e4);
  }
}
setInterval(tickClock, 100);
const esc = (t) => escChat(t);
/* ======================= FOUR PLAYER CHESS ======================= */
const F4COL = ["red", "blue", "yellow", "green"], F4CAP = { red: "Red", blue: "Blue", yellow: "Yellow", green: "Green" }, F4HEX = { red: "#ff6666", blue: "#70b7ff", yellow: "#ffe36e", green: "#70e09b" }, F4DIR = { red: [0, 1], yellow: [0, -1], blue: [1, 0], green: [-1, 0] };
const F4START = { red: (p) => p.y === 1, yellow: (p) => p.y === 12, blue: (p) => p.x === 1, green: (p) => p.x === 12 };
let F4 = null, F4mode = false, F4cell = 0, F4origin = [0, 0], F4selected = null, F4legal = [];
const F4valid = () => true, F4key = (x, y) => x + "," + y, sq4 = (x, y) => "abcdefghijklmn"[x] + (y + 1);
/* view rotation: your own colour is always drawn at the bottom of the screen */
const f4v = (x, y) => {
  const s = F4 && F4.view;
  return s === "blue" ? [13 - y, x] : s === "yellow" ? [13 - x, 13 - y] : s === "green" ? [y, 13 - x] : [x, y];
};
const f4u = (a, b) => {
  const s = F4 && F4.view;
  return s === "blue" ? [b, 13 - a] : s === "yellow" ? [13 - a, 13 - b] : s === "green" ? [13 - b, a] : [a, b];
};
function f4Init(o) {
  const S = o.seats;
  F4 = {
    board: new Map(),
    cur: "red",
    alive: [...F4COL],
    names: Object.fromEntries(F4COL.map((c) => [c, S[c] && S[c].n || F4CAP[c]])),
    bots: new Set(F4COL.filter((c) => S[c] && S[c].b)),
    me: o.me || null,
    online: !!o.online,
    host: !!o.host,
    view: o.me || "red",
    hist: [],
    score: { red: 0, blue: 0, yellow: 0, green: 0 },
    over: false,
    winner: null,
    last: null,
    id: ++gid,
    bt: 0,
    clk: o.tc ? Object.fromEntries(F4COL.map((c) => [c, o.tc * 1e3])) : null,
    tk: performance.now()
  };
  const back2 = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"];
  for (let i = 0; i < 8; i++) {
    const x = 3 + i;
    f4put(x, 0, "red", back2[i]);
    f4put(x, 1, "red", "pawn");
    f4put(x, 13, "yellow", back2[i]);
    f4put(x, 12, "yellow", "pawn");
    f4put(0, x, "blue", back2[7 - i]);
    f4put(1, x, "blue", "pawn");
    f4put(13, x, "green", back2[i]);
    f4put(12, x, "green", "pawn");
  }
  bad = [];
  rips = [];
  caps = [];
  shake = null;
  f4g = null;
  f4pinch = null;
  f4p.clear();
  flip = false;
  Vw.cx = 6.5;
  Vw.cy = 6.5;
  Vw.s = Math.max(16, Math.min(60, Math.min(W - 16, H_ - 150) / 14.5));
  F4selected = null;
  F4legal = [];
  F4mode = true;
  VR = "4p";
  mode = "4p";
  over = null;
  sel = null;
  clk = null;
  thinking = false;
  sfAbort();
  document.body.classList.add("f4");
  chatVis();
  f4Refresh();
}
function f4Exit() {
  if (F4) clearTimeout(F4.bt);
  F4mode = false;
  F4 = null;
  document.body.classList.remove("f4");
  $("#p4").hidden = true;
}
function f4put(x, y, c, t) {
  F4.board.set(F4key(x, y), { x, y, c, t, moved: false });
}
function f4At(x, y) {
  return F4.board.get(F4key(x, y));
}
function f4Pseudo(p) {
  const out = [], add = (x, y, dx, dy, slide) => {
    for (let n = 0; n < 40; n++) {
      const q = f4At(x, y);
      if (!q) out.push({ x, y, cap: false });
      else {
        if (q.c !== p.c) out.push({ x, y, cap: true });
        break;
      }
      if (!slide) break;
      x += dx;
      y += dy;
    }
  };
  const O = [[1, 0], [-1, 0], [0, 1], [0, -1]], D = [[1, 1], [1, -1], [-1, 1], [-1, -1]], dirs = p.t === "rook" ? O : p.t === "bishop" ? D : p.t === "queen" || p.t === "king" ? [...O, ...D] : [];
  for (const [dx, dy] of dirs) add(p.x + dx, p.y + dy, dx, dy, p.t !== "king");
  if (p.t === "knight") for (const [dx, dy] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
    const x = p.x + dx, y = p.y + dy, q = F4valid(x, y) && f4At(x, y);
    if (F4valid(x, y) && (!q || q.c !== p.c)) out.push({ x, y, cap: !!q });
  }
  if (p.t === "pawn") {
    const [dx, dy] = F4DIR[p.c], x = p.x + dx, y = p.y + dy;
    if (F4valid(x, y) && !f4At(x, y)) {
      out.push({ x, y, cap: false });
      const x2 = x + dx, y2 = y + dy;
      if (F4START[p.c](p) && F4valid(x2, y2) && !f4At(x2, y2)) out.push({ x: x2, y: y2, cap: false });
    }
    for (const [ax, ay] of [[dx + dy, dy - dx], [dx - dy, dy + dx]]) {
      const xx = p.x + ax, yy = p.y + ay, q = F4valid(xx, yy) && f4At(xx, yy);
      if (q && q.c !== p.c) out.push({ x: xx, y: yy, cap: true });
    }
  }
  return out;
}
/* ---- rules: you may not leave your own king capturable; castling; no legal move = out ---- */
function f4InCheck(c) {
  const k = [...F4.board.values()].find((q) => q.t === "king" && q.c === c);
  if (!k) return false;
  for (const q of F4.board.values()) if (q.c !== c && F4.alive.includes(q.c) && f4Pseudo(q).some((m) => m.cap && m.x === k.x && m.y === k.y)) return true;
  return false;
}
function f4Sim(p, m, fn) {
  const ox = p.x, oy = p.y, cap = F4.board.get(F4key(m.x, m.y)), rk = m.rook, rx0 = rk && rk.x, ry0 = rk && rk.y;
  F4.board.delete(F4key(ox, oy));
  p.x = m.x;
  p.y = m.y;
  F4.board.set(F4key(m.x, m.y), p);
  if (rk) {
    F4.board.delete(F4key(rx0, ry0));
    rk.x = m.rx;
    rk.y = m.ry;
    F4.board.set(F4key(rk.x, rk.y), rk);
  }
  let r;
  try {
    r = fn();
  } finally {
    if (rk) {
      F4.board.delete(F4key(rk.x, rk.y));
      rk.x = rx0;
      rk.y = ry0;
      F4.board.set(F4key(rx0, ry0), rk);
    }
    F4.board.delete(F4key(m.x, m.y));
    p.x = ox;
    p.y = oy;
    F4.board.set(F4key(ox, oy), p);
    if (cap) F4.board.set(F4key(m.x, m.y), cap);
  }
  return r;
}
function f4Castles(p) {
  const out = [];
  if (p.t !== "king" || p.moved || f4InCheck(p.c)) return out;
  const h = p.c === "red" || p.c === "yellow";
  for (const r of F4.board.values()) {
    if (r.t !== "rook" || r.c !== p.c || r.moved || (h ? r.y !== p.y : r.x !== p.x)) continue;
    const d = Math.sign(h ? r.x - p.x : r.y - p.y), n = Math.abs(h ? r.x - p.x : r.y - p.y);
    let ok = n >= 3;
    for (let i = 1; i < n && ok; i++) if (f4At(p.x + (h ? d * i : 0), p.y + (h ? 0 : d * i))) ok = false;
    if (!ok) continue;
    const x1 = p.x + (h ? d : 0), y1 = p.y + (h ? 0 : d);
    if (!f4Sim(p, { x: x1, y: y1 }, () => !f4InCheck(p.c))) continue;
    out.push({ x: p.x + (h ? 2 * d : 0), y: p.y + (h ? 0 : 2 * d), cap: false, castle: true, long: n > 3, rook: r, rx: x1, ry: y1 });
  }
  return out;
}
function f4Legal(p) {
  return [...f4Pseudo(p), ...f4Castles(p)].filter((m) => f4Sim(p, m, () => !f4InCheck(p.c)));
}
function f4Settle() {
  let n = 0;
  while (F4 && !F4.over && n++ < 4) {
    if ([...F4.board.values()].some((p) => p.c === F4.cur && f4Legal(p).length)) break;
    f4Elim(F4.cur, f4InCheck(F4.cur) ? "was checkmated" : "is stalemated");
  }
}
const f4Next = () => {
  let i = F4COL.indexOf(F4.cur);
  do {
    i = (i + 1) % 4;
  } while (!F4.alive.includes(F4COL[i]));
  F4.cur = F4COL[i];
};
function f4Elim(c, why) {
  if (!F4.alive.includes(c)) return;
  F4.alive = F4.alive.filter((x) => x !== c);
  toast(F4.names[c] + " " + why);
  if (F4.alive.length <= 1) {
    F4.over = true;
    F4.winner = F4.alive[0] || null;
    f4End();
  } else if (F4.cur === c) f4Next();
}
function f4End() {
  const w = F4.winner;
  setTimeout(() => {
    if (F4 && F4.over) {
      play("game-end");
      dlg(`<h2>${w ? esc(F4.names[w]) + " wins!" : "Game over"}</h2><p>${w && w === F4.me ? "You won this game." : "The game has ended."}</p><div class=sg>${F4.online ? F4.host ? "<button class=pb data-a=rematch>Play again</button>" : "" : "<button class=pb data-a=new>New game</button>"}<button data-a=${F4.online ? "new" : "x"}>${F4.online ? "Main menu" : "View board"}</button>${F4.online ? "<button data-a=x>View board</button>" : ""}</div>${F4.online && !F4.host ? "<p>Waiting for the host to start another game…</p>" : ""}`);
    }
  }, 700);
}
function f4Move(p, x, y, remote, na) {
  if (!F4 || !p || F4.over || p.c !== F4.cur) return false;
  const m = f4Legal(p).find((a) => a.x === x && a.y === y);
  if (!m) return false;
  const fx = p.x, fy = p.y, q = f4At(x, y), now = performance.now(), d = na || NA() ? 0 : 240;
  f4Tick();
  if (F4.online && !remote && WS) {
    const o = { t: "move4", fx, fy, tx: x, ty: y };
    if (F4.bots.has(p.c)) o.bot = p.c;
    WS.send(JSON.stringify(o));
  }
  if (q) caps.push({ c: q.c, t: q.t, x: q.x, y: q.y, t0: now + d * 0.6 });
  p.an = { fx, fy, t0: now, d };
  F4.board.delete(F4key(fx, fy));
  p.x = x;
  p.y = y;
  p.moved = true;
  if (m.castle) {
    const rk = m.rook;
    rk.an = { fx: rk.x, fy: rk.y, t0: now, d };
    F4.board.delete(F4key(rk.x, rk.y));
    rk.x = m.rx;
    rk.y = m.ry;
    rk.moved = true;
    F4.board.set(F4key(rk.x, rk.y), rk);
  }
  if (p.t === "pawn" && (p.c === "red" && y >= 9 || p.c === "yellow" && y <= 4 || p.c === "blue" && x >= 9 || p.c === "green" && x <= 4)) p.t = "queen";
  F4.board.set(F4key(x, y), p);
  F4.hist.push({ c: p.c, s: m.castle ? m.long ? "O-O-O" : "O-O" : sq4(fx, fy) + (q ? "x" : "-") + sq4(x, y) });
  F4.last = { fx, fy, tx: x, ty: y };
  F4selected = null;
  F4legal = [];
  if (q) F4.score[p.c] += q.t === "king" ? 0 : F4V[q.t];
  if (q && q.t === "king") f4Elim(q.c, "was eliminated");
  if (!F4.over) f4Next();
  f4Threat();
  const ck = F4.threat.length > 0 && !F4.over;
  if (ck) f4ChkT = now + d;
  setTimeout(() => play(ck ? "move-check" : q ? "capture" : remote || F4.bots.has(p.c) ? "move-opponent" : "move-self"), d * 0.7);
  f4Refresh();
  return true;
}
const F4V = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 };
function f4BotMove() {
  if (!F4 || F4.over || !F4.bots.has(F4.cur) || F4.online && !F4.host) return;
  const c = F4.cur, all = [...F4.board.values()].filter((p) => p.c === c).flatMap((p) => f4Legal(p).map((m) => ({ p, m, s: (m.cap ? F4V[f4At(m.x, m.y).t] * 10 : 0) + (m.castle ? 4 : 0) + Math.random() * 6 + (p.t === "pawn" ? 1 : 0) })));
  if (!all.length) {
    f4Elim(c, "has no moves left");
    f4Refresh();
    return;
  }
  all.sort((a, b) => b.s - a.s);
  const k = all[0];
  f4Move(k.p, k.m.x, k.m.y);
}
function f4BotKick() {
  if (!F4) return;
  clearTimeout(F4.bt);
  if (F4.over || !F4.bots.has(F4.cur) || F4.online && !F4.host) return;
  const id = F4.id;
  F4.bt = setTimeout(() => F4 && F4.id === id && f4BotMove(), 650);
}
function f4Resign(c, why, remote) {
  if (!F4 || F4.over || !F4.alive.includes(c)) return;
  if (F4.online && !remote && WS) WS.send(JSON.stringify({ t: "resign4", color: c }));
  f4Elim(c, why || "resigned");
  f4Refresh();
}
function f4Tick() {
  if (!F4 || !F4.clk || F4.over) return;
  const n = performance.now(), d = n - F4.tk;
  F4.tk = n;
  if (homeOn && !F4.online) return;
  const c = F4.cur;
  F4.clk[c] = Math.max(0, F4.clk[c] - d);
  if (F4.clk[c] <= 0 && (!F4.online || F4.host)) f4Resign(c, "ran out of time");
  f4Clocks();
}
setInterval(f4Tick, 100);
function f4Clocks() {
  if (!F4) return;
  for (const r of $("#p4").children) {
    const c = r.dataset.c, b = r.querySelector("b");
    b.textContent = F4.clk ? fmt(F4.clk[c]) : "";
    r.classList.toggle("low", !!F4.clk && F4.alive.includes(c) && F4.clk[c] < 1e4);
  }
}
function f4Refresh() {
  f4Settle();
  f4Threat();
  f4UI();
  f4BotKick();
  req();
}
function f4UI() {
  if (!F4) return;
  const c = F4.cur, st = $("#st");
  st.classList.remove("th");
  st.classList.toggle("ck", !!(F4.threat && F4.threat.length) && !F4.over);
  const t = $("#stt");
  t.textContent = F4.over ? F4.winner ? F4.names[F4.winner] + " wins" : "Game over" : (c === F4.me ? "Your turn" : F4.names[c] + "'s turn") + (F4.threat && F4.threat.length && !F4.over ? " · CHECK!" : "");
  t.style.color = F4HEX[F4.over && F4.winner ? F4.winner : c];
  $(".tn").style.background = F4.over ? "transparent" : F4HEX[c];
  $("#eng").style.display = "none";
  $("#clk").hidden = true;
  const p = $("#p4");
  p.hidden = false;
  p.innerHTML = F4COL.map((k) => `<div class="pr${k === c && !F4.over ? " act" : ""}${F4.alive.includes(k) ? "" : " out"}" data-c="${k}"><i style="background:${F4HEX[k]}"></i><span class=pn style="color:${F4HEX[k]}">${esc(F4.names[k])}${k === F4.me ? " •" : ""}</span>${F4.bots.has(k) ? "<em>bot</em>" : ""}${F4.score[k] ? `<em class=sc>+${F4.score[k]}</em>` : ""}<b></b></div>`).join("");
  f4Clocks();
  const mv = $("#mvl");
  mv.innerHTML = F4.hist.length ? F4.hist.slice(-120).map((h) => `<div class=r><b style="color:${F4HEX[h.c]}">●</b><span>${esc(F4.names[h.c])}</span><span>${h.s}</span></div>`).join("") : "<div class=e>No moves yet.</div>";
  mv.scrollTop = 1e9;
}
const F4DIRS = ["4playerschess", "4playerschess"], F4IM = {};
function f4Load(im, c, t, i) {
  fetch(`${R}pieces/${F4DIRS[i]}/${c}/${t}.svg`).then((r) => {
    if (!r.ok) throw 0;
    return r.text();
  }).then((x) => {
    im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(x.replace(/<svg\b(?![^>]*\swidth=)/, '<svg width="180" height="180"'));
  }).catch(() => {
    if (i < F4DIRS.length - 1) f4Load(im, c, t, i + 1);
  });
}
for (const c of F4COL) for (const t of ["king", "queen", "rook", "bishop", "knight", "pawn"]) {
  const im = new Image();
  im.onload = () => req();
  F4IM[c + t] = im;
  f4Load(im, c, t, 0);
}
const F4LET = { king: "K", queen: "Q", rook: "R", bishop: "B", knight: "N", pawn: "P" };
/* a king is "in check" when an enemy piece could capture it right now */
function f4Threat() {
  F4.threat = [];
  if (!F4 || F4.over) return;
  const k = [...F4.board.values()].find((p) => p.t === "king" && p.c === F4.cur);
  if (!k) return;
  for (const q of F4.board.values()) if (q.c !== F4.cur && F4.alive.includes(q.c) && f4Pseudo(q).some((m) => m.cap && m.x === k.x && m.y === k.y)) F4.threat.push(q);
}
const f4Mine = (q) => !!q && !!F4 && !F4.over && q.c === F4.cur && (F4.online ? q.c === F4.me : !F4.bots.has(q.c));
let f4ind = [], f4ChkT = 0;
function f4Nope(p, x, y) {
  play("illegal");
  bad.push({ x, y, t0: performance.now() });
  if (p) shake = { p, t0: performance.now() };
  F4selected = null;
  F4legal = [];
  req();
}
function f4Draw() {
  const now = performance.now();
  g.fillStyle = "#11171a";
  g.fillRect(0, 0, W, H_);
  if (!F4) return false;
  let busy = false;
  const s = Vw.s, L = F4.last, [LT, DK] = TH[CFG.th], c1 = s2w(0, 0), c2 = s2w(W, H_), x0 = Math.floor(Math.min(c1[0], c2[0])), x1 = Math.ceil(Math.max(c1[0], c2[0])), y0 = Math.floor(Math.min(c1[1], c2[1])), y1 = Math.ceil(Math.max(c1[1], c2[1])), hl = (x, y, col) => {
    const [a, b] = f4v(x, y), [rx, ry] = rect(a, b);
    g.fillStyle = col;
    g.fillRect(rx, ry, s, s);
  };
  for (let vy = y0; vy <= y1; vy++) for (let vx = x0; vx <= x1; vx++) {
    const [x, y] = f4u(vx, vy), [rx, ry] = rect(vx, vy);
    g.fillStyle = x + y & 1 ? LT : DK;
    g.fillRect(rx, ry, s + 0.7, s + 0.7);
  }
  if (L) {
    hl(L.fx, L.fy, "rgba(255,214,64,.42)");
    hl(L.tx, L.ty, "rgba(255,214,64,.5)");
  }
  if (F4selected) {
    const e = Math.min(1, (now - selT) / 160);
    if (e < 1) busy = true;
    hl(F4selected.x, F4selected.y, `rgba(255,214,64,${0.62 * ez(e)})`);
  }
  for (const b of bad) {
    const t = (now - b.t0) / 520;
    if (t < 1) {
      busy = true;
      const k = t < 0.5 ? 1 : 2 * (1 - t), [a, c] = f4v(b.x, b.y), [rx, ry] = rect(a, c);
      g.fillStyle = `rgba(229,57,64,${0.78 * k * (0.6 + 0.4 * Math.abs(Math.cos(t * Math.PI * 3)))})`;
      g.fillRect(rx, ry, s, s);
    }
  }
  bad = bad.filter((b) => now - b.t0 < 520);
  /* king under attack */
  const K = F4.threat && F4.threat.length && !F4.over && [...F4.board.values()].find((p) => p.t === "king" && p.c === F4.cur);
  if (K) {
    const [a, c] = f4v(K.x, K.y), [rx, ry] = rect(a, c), cx = rx + s / 2, cy = ry + s / 2, e = Math.min(1, Math.max(0, (now - f4ChkT) / 300));
    if (e < 1) busy = true;
    g.fillStyle = `rgba(229,57,64,${0.88 * ez(e)})`;
    g.fillRect(rx, ry, s, s);
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, s * 0.7);
    gr.addColorStop(0, "rgba(255,40,40,.95)");
    gr.addColorStop(1, "rgba(200,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(rx, ry, s, s);
    const t = (now - f4ChkT) / 900;
    if (t >= 0 && t < 1) {
      busy = true;
      g.strokeStyle = `rgba(255,70,70,${0.85 * (1 - t)})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, s * (0.5 + t * 1.3), 0, 7);
      g.stroke();
    }
    g.strokeStyle = "rgba(229,57,64,.75)";
    g.lineWidth = 3;
    g.setLineDash([8, 6]);
    for (const q of F4.threat) {
      const [b, d] = f4v(q.x, q.y), [qx, qy] = w2s(b + 0.5, d + 0.5);
      g.beginPath();
      g.moveTo(qx, qy);
      g.lineTo(cx, cy);
      g.stroke();
    }
    g.setLineDash([]);
  }
  /* legal moves pop in */
  if (F4selected && !F4.over) for (const m of F4legal) {
    const [a, c] = f4v(m.x, m.y), [rx, ry] = rect(a, c), cx = rx + s / 2, cy = ry + s / 2;
    if (cx < -s || cy < -s || cx > W + s || cy > H_ + s) continue;
    const dl = Math.min(140, Math.max(Math.abs(m.x - F4selected.x), Math.abs(m.y - F4selected.y)) * 14), t = Math.max(0, Math.min(1, (now - selT - dl) / 180));
    if (t < 1) busy = true;
    const k = NA() ? 1 : eb(t);
    g.beginPath();
    if (m.cap) {
      g.strokeStyle = "rgba(0,0,0,.28)";
      g.lineWidth = s * 0.09;
      g.arc(cx, cy, s * 0.46 * k, 0, 7);
      g.stroke();
    } else {
      g.fillStyle = "rgba(0,0,0,.22)";
      g.arc(cx, cy, s * 0.17 * k, 0, 7);
      g.fill();
    }
  }
  const dp = (c, t, vx, vy, k, al) => {
    const [rx, ry] = rect(vx, vy), im = F4IM[c + t];
    g.globalAlpha = al;
    if (im && im.complete && im.naturalWidth) g.drawImage(im, rx - s * (k - 1) / 2 + s * 0.05 * k, ry - s * (k - 1) / 2 + s * 0.05 * k, s * k * 0.9, s * k * 0.9);
    else {
      g.fillStyle = F4HEX[c];
      g.beginPath();
      g.arc(rx + s / 2, ry + s / 2, s * 0.38 * k, 0, 7);
      g.fill();
      g.fillStyle = "#10161a";
      g.font = `700 ${s * 0.42 * k}px system-ui`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(F4LET[t], rx + s / 2, ry + s / 2 + 1);
      g.textBaseline = "alphabetic";
    }
    g.globalAlpha = 1;
  };
  for (const q of caps) {
    const t = (now - q.t0) / 260, [a, c] = f4v(q.x, q.y);
    if (t < 0) {
      dp(q.c, q.t, a, c, 1, 1);
      busy = true;
    } else if (t < 1) {
      busy = true;
      dp(q.c, q.t, a, c, 1 - 0.5 * ez(t), 1 - ez(t));
    }
  }
  caps = caps.filter((q) => now - q.t0 < 260);
  const mv = [];
  for (const p of F4.board.values()) {
    const [a, c] = f4v(p.x, p.y);
    if (a < x0 - 1 || a > x1 + 1 || c < y0 - 1 || c > y1 + 1) continue;
    if (p.an && now - p.an.t0 < p.an.d) {
      mv.push(p);
      busy = true;
      continue;
    }
    p.an = null;
    let k = 1, wx = a;
    if (p === F4selected) {
      const e = Math.min(1, (now - selT) / 180);
      k = 1 + 0.1 * eb(e);
    }
    if (shake && shake.p === p) {
      const t = (now - shake.t0) / 350;
      if (t < 1) {
        wx += Math.sin(t * Math.PI * 7) * 0.09 * (1 - t);
        busy = true;
      } else shake = null;
    }
    dp(p.c, p.t, wx, c, k, f4g && f4g.drag && f4g.p === p ? 0.3 : 1);
  }
  for (const p of mv) {
    const e = ez((now - p.an.t0) / p.an.d), [a0, b0] = f4v(p.an.fx, p.an.fy), [a1, b1] = f4v(p.x, p.y);
    dp(p.c, p.t, a0 + (a1 - a0) * e, b0 + (b1 - b0) * e, 1.06, 1);
  }
  for (const r of rips) {
    const t = (now - r.t0) / 480;
    if (t < 1) {
      busy = true;
      const [a, c] = f4v(r.x, r.y), [rx, ry] = rect(a, c);
      g.strokeStyle = `rgba(255,255,255,${0.55 * (1 - t)})`;
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(rx + s / 2, ry + s / 2, s * (0.15 + 0.45 * ez(t)), 0, 7);
      g.stroke();
    }
  }
  rips = rips.filter((r) => now - r.t0 < 480);
  if (f4g && f4g.drag) {
    const im = F4IM[f4g.p.c + f4g.p.t], z = s * 1.18;
    if (im.naturalWidth) g.drawImage(im, f4g.px - z / 2, f4g.py - z / 2 - s * 0.1, z, z);
    busy = true;
  }
  {
    const vg = g.createRadialGradient(W / 2, H_ / 2, Math.min(W, H_) * 0.35, W / 2, H_ / 2, Math.hypot(W, H_) * 0.6);
    vg.addColorStop(0, "rgba(8,14,18,0)");
    vg.addColorStop(1, "rgba(8,14,18,.36)");
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H_);
  }
  /* arrows to kings that are off-screen */
  f4ind = [];
  if (!homeOn) for (const k of F4.board.values()) {
    if (k.t !== "king" || !F4.alive.includes(k.c)) continue;
    const [a, c] = f4v(k.x, k.y), [kx, ky] = w2s(a + 0.5, c + 0.5);
    if (kx > -s && kx < W + s && ky > -s && ky < H_ + s) continue;
    const dx = kx - W / 2, dy = ky - H_ / 2, t = Math.min((W / 2 - 34) / Math.abs(dx || 1e-9), (H_ / 2 - 34) / Math.abs(dy || 1e-9)), ex = W / 2 + dx * t, ey = H_ / 2 + dy * t;
    g.beginPath();
    g.arc(ex, ey, 21, 0, 7);
    g.fillStyle = F4.cur === k.c && K ? "#e5393f" : "rgba(20,27,31,.9)";
    g.fill();
    g.strokeStyle = F4HEX[k.c];
    g.lineWidth = 3;
    g.stroke();
    const im = F4IM[k.c + "king"];
    if (im.naturalWidth) g.drawImage(im, ex - 15, ey - 15, 30, 30);
    f4ind.push({ x: ex, y: ey, vx: a + 0.5, vy: c + 0.5 });
  }
  return busy;
}
/* input: tap / drag a piece to move, drag the board to pan, pinch / wheel to zoom */
const f4p = new Map();
let f4g = null, f4pinch = null;
function f4Down(e) {
  drawer(false);
  cv.setPointerCapture(e.pointerId);
  f4p.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (f4p.size === 2) {
    f4g = null;
    const [a, b] = [...f4p.values()];
    f4pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: Vw.s };
    return;
  }
  for (const k of f4ind) if (Math.hypot(e.clientX - k.x, e.clientY - k.y) < 22) {
    fly(k.vx, k.vy);
    return;
  }
  const now = performance.now(), [wx, wy] = s2w(e.clientX, e.clientY), [x, y] = f4u(Math.floor(wx), Math.floor(wy)), p = F4 && f4At(x, y);
  f4g = { x: e.clientX, y: e.clientY, cx: Vw.cx, cy: Vw.cy, mv: 0, p: null, was: false, drag: false, px: e.clientX, py: e.clientY };
  if (!NA()) rips.push({ x, y, t0: now });
  if (f4Mine(p)) {
    f4g.was = F4selected === p;
    if (!f4g.was) {
      F4selected = p;
      F4legal = f4Legal(p);
      selT = now;
    }
    f4g.p = p;
  } else if (p && F4.online && !F4.over && p.c === F4.me && F4.cur !== F4.me) {
    play("illegal");
    toast("Wait for your turn");
  }
  req();
}
function f4Mv(e) {
  if (f4p.has(e.pointerId)) f4p.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (f4pinch && f4p.size === 2) {
    const [a, b] = [...f4p.values()];
    Vw.s = Math.max(14, Math.min(140, f4pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / f4pinch.d));
    req();
    return;
  }
  if (!f4g) return;
  f4g.mv = Math.max(f4g.mv, Math.hypot(e.clientX - f4g.x, e.clientY - f4g.y));
  if (f4g.p) {
    f4g.px = e.clientX;
    f4g.py = e.clientY;
    if (f4g.mv > 8) f4g.drag = true;
  } else if (f4g.mv > 6) {
    Vw.cx = f4g.cx - (e.clientX - f4g.x) / Vw.s;
    Vw.cy = f4g.cy + (e.clientY - f4g.y) / Vw.s;
  }
  req();
}
function f4Up(e) {
  f4p.delete(e.pointerId);
  if (f4pinch) {
    if (f4p.size < 2) f4pinch = null;
    f4g = null;
    return;
  }
  const G = f4g;
  f4g = null;
  if (!G || !F4) return;
  const [wx, wy] = s2w(e.clientX, e.clientY), [x, y] = f4u(Math.floor(wx), Math.floor(wy));
  if (G.p) {
    if (G.drag) {
      if (!(x === G.p.x && y === G.p.y) && !f4Move(G.p, x, y, false, true)) f4Nope(G.p, x, y);
    } else if (G.was && G.mv <= 6) {
      F4selected = null;
      F4legal = [];
    }
  } else if (G.mv <= 6 && F4selected && !(x === F4selected.x && y === F4selected.y)) {
    if (!f4Move(F4selected, x, y)) f4Nope(F4selected, x, y);
  } else if (G.mv <= 6 && F4selected) {
    F4selected = null;
    F4legal = [];
  }
  req();
}
/* ======================= ONLINE ROOMS ======================= */
let WS = null, hbT = 0, lan = { color: "w", tc: 0, vr: "std", lay: 0 };
let chatLog = [], chatUnread = 0, chatOpen = false, chatOK = false, R4 = { code: "", seat: null, host: false, seats: {}, tc: 0, vis: "public" };
function chatBadge() {
  const b = $("#hb");
  if (!b) return;
  let n = b.querySelector(".chat-badge");
  if (chatUnread) {
    if (!n) {
      n = document.createElement("i");
      n.className = "chat-badge";
      b.appendChild(n);
    }
    n.textContent = chatUnread > 99 ? "99+" : chatUnread;
  } else if (n) n.remove();
}
function openChat() {
  if (!chatOK) {
    dlg(`<div class="chat-head"><h2>Room chat</h2><button data-a="chatclose" aria-label="Close">×</button></div><div class="chat-lock">${LOCK_ICON}<b>Chat is locked</b><p class="tag">Only players signed in with Google can chat. Sign in from Play online, then create or join a room again.</p></div>`);
    return;
  }
  chatUnread = 0;
  chatBadge();
  dlg(`<div class="chat-head"><h2>Room chat</h2><button data-a="chatclose" aria-label="Close">×</button></div><div id="chatlog" class="chat-log">${chatLog.map(chatHtml).join("") || '<p class="tag">No messages yet.</p>'}</div><form id="chatform" class="chat-form"><input id="chatinput" maxlength="300" placeholder="Message players…" autocomplete="off"><button class="pb" type="submit">Send</button></form>`);
  const l = $("#chatlog");
  if (l) l.scrollTop = l.scrollHeight;
  chatOpen = true;
  setTimeout(() => $("#chatinput")?.focus(), 50);
}
const chatHtml = (m) => `<div class="chat-msg ${m.self ? "self" : ""}"><b${m.seat && F4HEX[m.seat] ? ` style="color:${F4HEX[m.seat]}"` : ""}>${escChat(m.name)}${m.self ? " (you)" : ""}</b><span>${escChat(m.text)}</span></div>`;
function chatPush(m) {
  chatLog.push(m);
  if (chatLog.length > 100) chatLog.shift();
  const l = $("#chatlog");
  if (chatOpen && l) {
    const e = l.querySelector("p.tag");
    if (e) e.remove();
    l.insertAdjacentHTML("beforeend", chatHtml(m));
    l.scrollTop = l.scrollHeight;
  } else if (!m.self) {
    chatUnread++;
    chatBadge();
    if (homeOn && hs.step === "room4") renderHome("room4");
    play("move-opponent");
  }
}
const inR4 = () => !!R4.seat && !!WS && (hs.step === "room4" || F4mode && F4 && F4.online);
function chatVis() {
  document.body.classList.toggle("noch", !(WS && (mode === "lan" || F4mode && F4 && F4.online)));
  document.body.classList.toggle("chatlock", !chatOK);
}
function escChat(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function sendChat(text) {
  text = String(text || "").trim().slice(0, 300);
  if (!text) return;
  if (!WS || WS.readyState !== 1) return toast("Chat is available in an online room.");
  if (!chatOK) return toast("Sign in with Google to use chat.");
  WS.send(JSON.stringify({ t: "chat", text }));                  // the server adds your verified name
  chatPush({ text, name: AUTH.name || "You", seat: inR4() ? R4.seat : null, self: true });
}
function wsConnect(cb) {
  let done = 0;
  const fin = (w) => {
    if (!done) {
      done = 1;
      cb(w);
    }
  };
  let ws;
  try {
    ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
  } catch (e) {
    return fin(null);
  }
  const to = setTimeout(() => {
    try {
      ws.close();
    } catch (e) {
    }
    fin(null);
  }, 3500);
  ws.onopen = () => {
    clearTimeout(to);
    WS = ws;
    fin(ws);
    clearInterval(hbT);
    hbT = setInterval(() => {
      try {
        ws.readyState === 1 && ws.send('{"t":"ping"}');
      } catch (e) {
      }
    }, 2e4);
  };
  ws.onerror = () => {
    clearTimeout(to);
    fin(null);
  };
  ws.onmessage = (e) => {
    try {
      lanMsg(JSON.parse(e.data));
    } catch (x) {
    }
  };
  ws.onclose = () => {
    clearInterval(hbT);
    if (WS === ws) {
      WS = null;
      if (homeOn && (hs.step === "lanw" || hs.step === "lanwj" || hs.step === "room4")) {
        toast("Connection lost");
        renderHome("lan");
        return;
      }
      if (F4mode && F4 && F4.online && !F4.over) {
        toast("Connection lost");
        F4.over = true;
        f4UI();
      } else if (mode === "lan" && !over && !homeOn) toast("Connection lost");
      chatVis();
    }
  };
}
function lanMsg(m) {
  if (m.t === "created") {
    chatOK = !!m.v;
    chatVis();
    hs.code = m.room;
    renderHome("lanw");
  } else if (m.t === "peer") {
    WS.send(JSON.stringify({ t: "start", color: opp(lan.color), tc: lan.tc, vr: lan.vr, lay: lan.lay }));
    startGame({ mode: "lan", color: lan.color, tc: lan.tc, vr: lan.vr, lay: lan.lay });
  } else if (m.t === "start") startGame({ mode: "lan", color: m.color === "b" ? "b" : "w", tc: +m.tc || 0, vr: m.vr, lay: m.lay });
  else if (m.t === "joined") {
    chatOK = !!m.v;
    chatVis();
    renderHome("lanwj");
  }
  else if (m.t === "chat") chatPush({ seat: m.seat, name: String(m.name || "Player").slice(0, 24), text: String(m.text || "").slice(0, 300), self: false });
  else if (m.t === "created4" || m.t === "joined4") {
    chatOK = !!m.v;
    chatVis();
    R4.code = m.room;
    R4.seat = m.seat;
    R4.host = m.t === "created4";
    renderHome("room4");
  } else if (m.t === "rematch") {
    R4.seats = m.seats;
    R4.host = R4.seat === m.host;
    R4.tc = m.tc;
    R4.vis = m.vis;
    f4Exit();
    closeDlg();
    chatVis();
    openHome("room4");
  } else if (m.t === "rooms") {
    hs.rooms = m.list;
    if (homeOn && hs.step === "rooms") renderHome("rooms");
  } else if (m.t === "lobby") {
    R4.vis = m.vis;
    R4.seats = m.seats;
    R4.host = R4.seat === m.host;
    R4.tc = m.tc;
    if (homeOn && hs.step === "room4") renderHome("room4");
  } else if (m.t === "kicked") {
    lanClose();
    toast("The host removed you from the room");
    if (homeOn) renderHome("lan");
  } else if (m.t === "start4") startF4({ seats: m.seats, me: R4.seat, online: true, host: R4.host, tc: m.tc });
  else if (m.t === "move4" && F4mode && F4) {
    const p = f4At(m.fx, m.fy);
    if (p && p.c === m.c) f4Move(p, m.tx, m.ty, true);
  } else if (m.t === "resign4" && F4mode && F4) f4Resign(m.c, "is out of the game", true);
  else if (m.t === "bot4" && F4mode && F4) {
    F4.bots.add(m.c);
    F4.names[m.c] = "Bot";
    f4Refresh();
  } else if (m.t === "left" && homeOn && hs.step === "room4") {
    lanClose();
    toast("The host closed the room");
    renderHome("lan");
  } else if (m.t === "left" && F4mode && F4 && F4.online && !F4.over) {
    F4.over = true;
    F4.winner = null;
    f4UI();
    dlg("<h2>Room closed</h2><p>The host left the room.</p><div class=sg><button class=pb data-a=new>Main menu</button><button data-a=x>View board</button></div>");
  } else if (m.t === "err") {
    if (m.code === "auth") authClear(m.m);
    else if (m.code === "needname") {
      AUTH.state = "needname";
      AUTH.msg = m.m;
      refreshIdentity();
    }
    const e = $("#lerr");
    if (e) e.textContent = m.m;
  } else if (m.t === "acct") {
    const cb = AUTH.cb;
    AUTH.cb = null;
    cb && cb(m);
  } else if (m.t === "chatlock") {
    toast("Sign in with Google to use chat.");
  } else if (m.t === "move" && mode === "lan" && !over) {
    const p = P.get(m.fx, m.fy), mv = p && p.c === P.turn && p.c !== me && pm(P, p, m.tx, m.ty);
    if (mv && legal(P, mv)) doMove(mv, true, true);
  } else if (m.t === "resign" && mode === "lan" && !over) {
    over = { w: me, r: "Opponent resigned" };
    refresh();
  } else if (m.t === "left" && homeOn && (hs.step === "lanw" || hs.step === "lanwj")) {
    lanClose();
    toast(hs.step === "lanw" ? "Your opponent left the room" : "The host closed the room");
    renderHome("lan");
  } else if (m.t === "left" && mode === "lan" && !over && !homeOn) {
    over = { w: me, r: "Opponent left the room" };
    refresh();
  }
}
const lanClose = () => {
  chatOpen = false;
  chatOK = false;
  chatLog = [];
  chatUnread = 0;
  chatBadge();
  R4.seat = null;
  R4.code = "";
  R4.seats = {};
  clearInterval(hbT);
  if (WS) {
    const w = WS;
    WS = null;
    try {
      w.close();
    } catch (e) {
    }
  }
};
/* ======================= GOOGLE ACCOUNT ======================= */
/*
  Sign-in uses Google's redirect flow: the page sends the browser to Google, Google sends it back
  to this site with an ID token in the URL hash. No Google script or popup is loaded, so the
  cross-origin isolation headers (needed by Stockfish) keep working.
  The server checks the token again for every create / join, so nothing here can be faked.
*/
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,12}[\p{L}\p{N}]$/u;
const NAME_HELP = 'Name must be 3-14 characters: letters, numbers, spaces, "_", "." or "-".';
const G_ICON = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
const LOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>';

/*
  state: 'out'      not signed in (guest)
         'checking' signed in, asking the server whether the account has a username
         'needname' signed in, but no username yet
         'ok'       signed in with a username (chat unlocked)
*/
const AUTH = { cid: "", token: "", name: null, state: "out", msg: "", draft: "", cb: null, to: 0 };
try {
  AUTH.token = localStorage.getItem("icg") || "";
} catch (e) {
}

function jwtInfo(t) {
  try {
    const b64 = String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return null;
  }
}

/* the saved Google token, or "" when it is missing / about to expire */
function authToken() {
  const i = AUTH.token && jwtInfo(AUTH.token);
  return i && i.exp * 1000 > Date.now() + 30000 ? AUTH.token : "";
}

function nameErr(n) {
  return NAME_RE.test(n) ? "" : NAME_HELP;
}

/* re-draw the name / sign-in block on the screens that show it */
function refreshIdentity() {
  keepTyped();
  if (homeOn && ["lanc", "lanj", "rooms"].includes(hs.step)) renderHome(hs.step);
}

function keepTyped() {
  const i = $("#pname");
  if (!i) return;
  try {
    localStorage.setItem("icname", i.value.trim().slice(0, 14));
  } catch (e) {
  }
}

function authClear(msg) {
  AUTH.token = "";
  AUTH.name = null;
  AUTH.state = "out";
  AUTH.msg = msg || "";
  try {
    localStorage.removeItem("icg");
  } catch (e) {
  }
  refreshIdentity();
}

function identityHtml() {
  if (AUTH.state === "ok") {
    return `<div class=lb2>Signed in with Google</div><div class="acct"><span class=an>${esc(AUTH.name)}</span><button class=mini data-g=out>Sign out</button><small>✓ Verified · chat unlocked</small></div>`;
  }
  if (AUTH.state === "needname") {
    return `<div class=lb2>Create your username</div><input class=ni id=uname maxlength=14 placeholder="Username (3-14 characters)" autocomplete=off value="${esc(AUTH.draft)}"><button class=go data-g=save>Save username</button><p class=tag>Your username is permanent and tied to your Google account.</p><p class=err id=gerr>${esc(AUTH.msg)}</p><button class=pill data-g=out>Sign out</button>`;
  }
  if (AUTH.state === "checking") {
    return `<div class=lb2>Google account</div><p class=tag><i class=sp></i>Checking your account…</p>`;
  }
  return `<div class=lb2>Your name</div><input class=ni id=pname maxlength=14 placeholder="Guest name (optional)" autocomplete=off value="${esc(pname())}"><p class=tag>Guests can't use chat. Sign in with Google to create a username and unlock chat.</p>${AUTH.cid ? `<button class=gbtn data-g=in>${G_ICON}<span>Sign in with Google</span></button>` : ""}${AUTH.msg ? `<p class=err>${esc(AUTH.msg)}</p>` : ""}`;
}

/* send the browser to Google */
function authSignIn() {
  if (!AUTH.cid) return toast("Google sign-in is not set up on this server.");
  const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const ns = { nonce: rnd(), state: rnd(), ret: ["lanc", "lanj", "rooms"].includes(hs.step) ? hs.step : "lan" };
  try {
    localStorage.setItem("icg_ns", JSON.stringify(ns));
  } catch (e) {
    return toast("Please allow site storage to sign in.");
  }
  location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: AUTH.cid,
    redirect_uri: location.origin + "/",
    response_type: "id_token",
    scope: "openid profile",
    nonce: ns.nonce,
    state: ns.state,
    prompt: "select_account"
  });
}

/* back from Google: read the token out of the URL hash. Returns the lobby screen to reopen, or null. */
function authReturn() {
  const raw = location.hash.slice(1);
  if (!/(^|&)(id_token|error)=/.test(raw)) return null;
  const q = new URLSearchParams(raw);
  history.replaceState(null, "", location.pathname + location.search);
  let ns = null;
  try {
    ns = JSON.parse(localStorage.getItem("icg_ns"));
    localStorage.removeItem("icg_ns");
  } catch (e) {
  }
  const ret = ns && ns.ret || "lan";
  if (q.get("error")) {
    toast("Google sign-in was cancelled.");
    return ret;
  }
  const tok = q.get("id_token"), info = jwtInfo(tok);
  if (!ns || q.get("state") !== ns.state || !info || info.nonce !== ns.nonce) {
    toast("Google sign-in could not be verified. Please try again.");
    return ret;
  }
  AUTH.token = tok;
  AUTH.msg = "";
  AUTH.draft = String(info.name || "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 14);
  try {
    localStorage.setItem("icg", tok);
  } catch (e) {
  }
  return ret;
}

/* ask the server about the Google account (reuses the open connection, or opens a short one) */
function acctCall(msg, done) {
  const had = !!(WS && WS.readyState === 1);
  const fin = (m) => {
    clearTimeout(AUTH.to);
    AUTH.cb = null;
    if (!had && !R4.seat) lanClose();
    done(m);
  };
  const go = (w) => {
    if (!w) return fin({ ok: false, m: "Couldn't reach the game server. Please try again in a moment." });
    AUTH.cb = fin;
    clearTimeout(AUTH.to);
    AUTH.to = setTimeout(() => AUTH.cb === fin && fin({ ok: false, m: "The server did not answer. Please try again." }), 8000);
    w.send(JSON.stringify({ t: "acct", token: AUTH.token, ...msg }));
  };
  if (had) go(WS);
  else wsConnect(go);
}

/* signed in: find out whether this account already has a username */
function authSync() {
  if (!authToken()) {
    if (AUTH.token) authClear("Your Google session expired. Please sign in again.");
    return;
  }
  AUTH.state = "checking";
  refreshIdentity();
  acctCall({}, (m) => {
    if (m.ok) {
      AUTH.name = m.name;
      AUTH.state = m.name ? "ok" : "needname";
      AUTH.msg = "";
      refreshIdentity();
    } else if (m.code === "auth" || m.code === "config") authClear(m.m);
    else {
      AUTH.state = "out";
      AUTH.msg = m.m;
      refreshIdentity();
    }
  });
}

function authBoot() {
  fetch("config.json", { cache: "no-store" }).then((r) => r.json()).then((c) => {
    AUTH.cid = c.googleClientId || "";
  }).catch(() => {
  }).finally(() => {
    if (AUTH.token) authSync();
    else refreshIdentity();
  });
}

function setGerr(t) {
  const e = $("#gerr");
  if (e) e.textContent = t;
}

function authAction(a, btn) {
  if (a === "in") {
    keepTyped();
    return authSignIn();
  }
  if (a === "out") return authClear("");
  if (a === "save") {
    const name = ((($("#uname") || {}).value) || "").trim().replace(/\s+/g, " ");
    AUTH.draft = name;
    const bad = nameErr(name);
    if (bad) return setGerr(bad);
    setGerr("");
    btn.disabled = true;
    acctCall({ name }, (m) => {
      if (m.ok) {
        AUTH.name = m.name;
        AUTH.state = "ok";
        AUTH.msg = "";
        refreshIdentity();
        toast("Username created: " + m.name);
      } else if (m.code === "auth" || m.code === "config") authClear(m.m);
      else if (m.code === "has") {
        AUTH.name = m.name;
        AUTH.state = "ok";
        refreshIdentity();
      } else {
        btn.disabled = false;
        AUTH.msg = m.m;
        setGerr(m.m);
      }
    });
  }
}

/* who is creating / joining? Returns the fields to send to the server, or null to stop. */
function who() {
  if (AUTH.state === "checking") {
    toast("Checking your Google account…");
    return null;
  }
  if (AUTH.state === "needname") {
    const t = "Create your username first, or sign out to play as a guest.";
    const e = $("#lerr") || $("#gerr");
    if (e) e.textContent = t;
    toast(t);
    return null;
  }
  if (AUTH.state === "ok") {
    if (authToken()) return { token: AUTH.token };
    authClear("Your Google session expired. Please sign in again.");
    return null;
  }
  const name = savedName(), bad = name && nameErr(name);
  if (bad) {
    const e = $("#lerr");
    if (e) e.textContent = bad;
    toast(bad);
    return null;
  }
  return { name };
}

/* ======================= UI: toast, dialog, drawer ======================= */
function toast(t) {
  const e = $("#tt");
  e.textContent = t;
  e.classList.add("on");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => e.classList.remove("on"), 2600);
}
function dlg(h) {
  chatOpen = false;
  $("#box").innerHTML = h;
  $("#dlg").classList.add("open");
  document.body.classList.add("dlgopen");
}
const closeDlg = () => {
  chatOpen = false;
  $("#dlg").classList.remove("open");
  document.body.classList.remove("dlgopen");
};
const svg = (d) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const GEAR = "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z";
const ACT = [
  ["home", "Main menu", "M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z", () => openHome("main")],
  ["undo", "Undo", "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3", undo],
  ["flip", "Flip board", "M7 4v14m0 0l-3-3m3 3l3-3M17 20V6m0 0l-3 3m3-3l3 3", () => {
    flip = !flip;
    req();
  }],
  ["ctr", "Center view", "M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3", () => F4mode ? fly(6.5, 6.5) : fly(4, 4)],
  ["snd", "Sound", "M11 5L6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 010 7", () => {
    CFG.snd = !CFG.snd;
    save();
    updSnd();
    if (CFG.snd) play("move-self");
  }, true],
  ["chat", "Room chat", "M21 15a4 4 0 01-4 4H7l-4 3V7a4 4 0 014-4h10a4 4 0 014 4z", openChat],
  ["set", "Settings", GEAR, settings],
  ["res", "Resign", "M5 21V4M5 4h11l-2 4 2 4H5", () => dlg('<h2>Resign this game?</h2><div class=sg><button class="pb dn" data-a=res>Resign</button><button data-a=x>Cancel</button></div>')]
];
$("#dg").innerHTML = ACT.map((a) => `<button class="di${a[0] === "res" ? " red" : ""}" data-k="${a[0]}">${svg(a[2])}<span>${a[1]}</span></button>`).join("");
const updSnd = () => {
  const b = $(".di[data-k=snd]");
  b.classList.toggle("off", !CFG.snd);
  b.querySelector("span").textContent = CFG.snd ? "Sound: On" : "Sound: Off";
};
updSnd();
function drawer(open) {
  const o = open === void 0 ? !$("#dr").classList.contains("open") : open;
  $("#dr").classList.toggle("open", o);
  $("#hb").classList.toggle("open", o);
  $("#hb").setAttribute("aria-expanded", o);
}
$("#hb").onclick = () => drawer();
$("#dg").onclick = (e) => {
  const b = e.target.closest(".di");
  if (!b) return;
  const a = ACT.find((x) => x[0] === b.dataset.k);
  a[3]();
  if (!a[4]) drawer(false);
};
/* ======================= UI: lobby ======================= */
let homeOn = false, saveV = null, hs = { color: "w", lv: 1, tc: 0, code: "", vr: "std", cm: 5, cs: 0, vis: "public", rooms: null, s4b: { red: 0, blue: 1, yellow: 1, green: 1 }, s4h: { red: 0, blue: 0, yellow: 0, green: 0 } };
const hasGame = () => F4mode && F4 ? !F4.over : H.length > 0 && !over, pu = (c, t) => `${R}pieces/${c === "w" ? "white" : "black"}_${PN[t]}.png`, pc = (c, t) => `<img src="${pu(c, t)}" alt="">`;
const back = (s) => `<button class=pill data-s="${s}">‹ Back</button>`, optRow = (key, arr) => `<div class="opts${key === "tc" ? " w" : key === "vr" ? " w v" : ""}">${arr.map(([v, l, x, i]) => `<button class="opt${String(hs[key]) === String(v) ? " on" : ""}" data-k="${key}" data-v="${v}">${i || ""}<span>${l}</span>${x ? `<small>${x}</small>` : ""}</button>`).join("")}</div>`, colors = () => optRow("color", [["w", "White", "", pc("w", "k")], ["b", "Black", "", pc("b", "k")], ["r", "Random", "", pc("w", "q")]]), times = () => `<div class=lb2>Time per side</div>${optRow("tc", TCS)}<div class="cust${hs.tc === "c" ? " on" : ""}" id=cust><input id=cm type=number inputmode=numeric min=0 max=180 value=${hs.cm} aria-label=Minutes><b>:</b><input id=cs type=number inputmode=numeric min=0 max=59 value=${String(hs.cs).padStart(2, "0")} aria-label=Seconds><small>min : sec</small></div>`, vrs = () => `<div class=lb2>Variant</div>${optRow("vr", VRS)}`, seats4 = () => {
  const a = hs[hs.step === "bot" ? "s4b" : "s4h"];
  return `<div class=lb2>Seats</div><div class="opts w">${F4COL.map((c) => `<button class=opt data-seat=${c}><span style="color:${F4HEX[c]}">${F4CAP[c]}</span><small>${a[c] ? "Bot" : "Human"}</small></button>`).join("")}</div>`;
}, identityRow = () => identityHtml(), pname = () => {
  let v = "";
  try {
    v = localStorage.getItem("icname") || "";
  } catch (e) {
  }
  return v;
}, tile = (h, a, b, t, d) => `<button class=tile data-s="${h}"><span class=pcs>${pc(a[0], a[1])}${pc(b[0], b[1])}</span><span class=tx><b>${t}</b><span>${d}</span></span></button>`;
function renderHome(step) {
  const h = $("#hin");
  let x = "";
  hs.step = step;
  if (step === "main") x = `<img class=hl src="${R}images/logo-white.png" alt="Infinite Chess"><p class=tag>Chess on an endless board.</p>
  <div class=tiles>${tile("bot", ["b", "n"], ["w", "k"], "Play the engine", "Stockfish 19 + built-in engine")}${tile("hum", ["w", "p"], ["b", "p"], "Play 2 Players", "Same device")}${tile("lan", ["w", "r"], ["b", "r"], "Play online", "2–4 players, any device")}</div>
  <div class=sub>${hasGame() ? "<button class=pill data-h=resume>Resume current game</button>" : ""}<button class=pill data-h=set>Settings</button></div>`;
  else if (step === "bot") x = `${back("main")}<h2>Play the engine</h2>${hs.vr === "4p" ? vrs() + seats4() : `<div class=lb2>You play as</div>${colors()}<div class=lb2>Difficulty</div>${optRow("lv", LVN.map(([l, e], i) => [i, l, e]))}${vrs()}`}${times()}<button class=go data-h=startbot>Start game</button>`;
  else if (step === "hum") x = `${back("main")}<h2>Play a friend</h2>${vrs()}${hs.vr === "4p" ? seats4() : ""}${times()}<button class=go data-h=starthum>Start game</button>`;
  else if (step === "lan") x = `${back("main")}<h2>Play online</h2><p class=tag>Create a room and share the 4-digit code with a friend — or enter their code to join.</p>
  <div class=tiles>${tile("lanc", ["w", "k"], ["b", "k"], "Create room", "Public or private")}${tile("lanj", ["w", "n"], ["b", "n"], "Join room", "Enter a code")}${tile("rooms", ["w", "p"], ["b", "p"], "Room list", "Browse public rooms")}</div>`;
  else if (step === "lanc") x = `${back("lan")}<h2>Create room</h2>${identityRow()}${hs.vr === "4p" ? `${vrs()}<p class=tag>Add bots or kick players in the room, then press Start.</p>` : `<div class=lb2>You play as</div>${colors()}${vrs()}`}<div class=lb2>Room visibility</div>${optRow("vis", [["public", "Public", "Shown in room list"], ["private", "Private", "Join by code only"]])}${times()}<button class=go data-h=create>Create room</button><p class=err id=lerr></p>`;
  else if (step === "lanw") x = `<h2>Your room code</h2><div class=code>${hs.code}</div><p class=tag>Your friend opens <b>${location.origin}</b>, picks Play online → Join room and enters this code.</p><p class=tag><i class=sp></i>Waiting for opponent…</p><button class=pill data-h=cancel>Cancel room</button>`;
  else if (step === "lanwj") x = `<h2>Joined the room</h2><p class=tag><i class=sp></i>Waiting for the host to start the game…</p><button class=pill data-h=cancel>Leave room</button>`;
  else if (step === "room4") {
    const S = R4.seats, full = F4COL.every((c) => S[c]);
    x = `<h2>4-player room</h2><div class=code>${R4.code}</div><p class=tag>${R4.vis === "public" ? "Public room: shown in the room list." : "Private room: only joinable with this code."}</p>
  ${(() => {
      const tl = [[0, "No limit"], [60, "1 min"], [180, "3 min"], [300, "5 min"], [600, "10 min"]];
      if (!tl.some((a) => a[0] === R4.tc)) tl.push([R4.tc, Math.round(R4.tc / 60) + " min"]);
      const row = (k, arr) => `<div class="opts w">${arr.map(([v, l]) => `<button class="opt${String(R4[k]) === String(v) ? " on" : ""}" ${R4.host ? `data-cfg=${k} data-v=${v}` : "disabled"}><span>${l}</span></button>`).join("")}</div>`;
      return `<div class=lb2>Time per side${R4.host ? "" : " (set by host)"}</div>${row("tc", tl)}<div class=lb2>Visibility</div>${row("vis", [["public", "Public"], ["private", "Private"]])}`;
    })()}
  <div class=seats>${F4COL.map((c) => {
      const t = S[c], you = c === R4.seat, act = R4.host && !you ? t ? t.b ? `<button class=mini data-r4=bot0 data-cl=${c}>Remove</button>` : `<button class="mini dn" data-r4=kick data-cl=${c}>Kick</button>` : `<button class=mini data-r4=bot1 data-cl=${c}>+ Bot</button>` : "";
      return `<div class=seat><i style="background:${F4HEX[c]}"></i><span class=sn style="color:${F4HEX[c]}">${t ? esc(t.n) + (t.v ? " ✓" : "") : "Waiting…"}</span><small>${you ? "You" : t ? t.b ? "Bot" : c === "red" ? "Host" : "Player" : "Empty"}</small>${act}</div>`;
    }).join("")}</div>
  ${R4.host ? `<button class=go data-r4=start ${full ? "" : "disabled"}>Start game</button>${full ? "" : "<p class=tag>Fill every seat (players or bots) to start.</p>"}` : "<p class=tag><i class=sp></i>Waiting for the host to start…</p>"}
  <div class=sub><button class=pill data-r4=copy>Copy code</button><button class=pill data-r4=chat>Chat${!chatOK ? " 🔒" : chatUnread ? ` <span class=cbd>${chatUnread}</span>` : ""}</button><button class=pill data-h=cancel>Leave room</button></div>`;
  } else if (step === "rooms") {
    const tcl = (t) => t ? t >= 60 ? Math.round(t / 60) + " min" : t + "s" : "No limit";
    x = `${back("lan")}<h2>Public rooms</h2>${identityRow()}<div class=rl>${hs.rooms === null ? "<p class=tag><i class=sp></i>Loading…</p>" : hs.rooms.length ? hs.rooms.map((r) => `<button class=room data-jr=${r.room}><span class=rk>${r.kind === 4 ? "4P" : "2P"}</span><span class=rn>${esc(r.host)}</span><small>${r.n}/${r.kind === 4 ? 4 : 2} · ${tcl(r.tc)}</small><b>${r.room}</b></button>`).join("") : "<p class=tag>No public rooms right now. Create one!</p>"}</div><button class=pill data-h=refresh>↻ Refresh</button><p class=err id=lerr></p>`;
  } else if (step === "lanj") x = `${back("lan")}<h2>Join room</h2>${identityRow()}<input class=ci id=code inputmode=numeric maxlength=4 placeholder="0000" autocomplete=off><button class=go data-h=join>Join room</button><p class=err id=lerr></p>`;
  h.className = "";
  h.innerHTML = x;
  void h.offsetWidth;
  h.className = "in";
  $("#home").scrollTop = 0;
}
function openHome(step) {
  if (!homeOn) saveV = { cx: Vw.cx, cy: Vw.cy, s: Vw.s };
  homeOn = true;
  document.body.classList.add("lobby");
  drawer(false);
  $("#home").classList.add("open");
  renderHome(step || "main");
  drawClock();
  req();
}
function closeHome(restore) {
  homeOn = false;
  document.body.classList.remove("lobby");
  $("#home").classList.remove("open");
  if (restore && saveV) Object.assign(Vw, saveV);
  if (clk) clk.last = performance.now();
  drawClock();
  req();
}
function loadRooms() {
  hs.rooms = null;
  renderHome("rooms");
  const go = (w) => w ? w.send('{"t":"list"}') : lanFail();
  if (WS && WS.readyState === 1) go(WS);
  else wsConnect(go);
}
function startF4(o) {
  closeDlg();
  closeHome(false);
  if (!o.online) lanClose();
  f4Init(o);
  play("game-start");
}
function startOffline4() {
  const tc = tcSec();
  if (tc === null) return;
  const a = hs[hs.step === "bot" ? "s4b" : "s4h"], seats = Object.fromEntries(F4COL.map((c) => [c, { n: F4CAP[c], b: a[c] ? 1 : 0 }]));
  if (F4COL.every((c) => seats[c].b)) return toast("At least one seat must be human");
  startF4({ seats, me: null, online: false, tc });
}
function startGame(o) {
  f4Exit();
  closeDlg();
  closeHome(false);
  if (o.mode !== "lan") lanClose();
  newGame(o);
  chatVis();
  play("game-start");
}
function lanFail() {
  const e = $("#lerr");
  const t = "Couldn't reach the game server. Please try again in a moment.";
  if (e) e.textContent = t;
  toast(t);
}
$("#home").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  if (d.g) return authAction(d.g, b);
  if (d.s) {
    if (d.s === "rooms") return loadRooms();
    if (hs.step === "lanw" || hs.step === "lanwj") lanClose();
    renderHome(d.s);
  } else if (d.k) {
    const pv = hs[d.k];
    hs[d.k] = d.v;
    if (d.k === "vr" && d.v === "4p" !== (pv === "4p")) return renderHome(hs.step);
    b.parentNode.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    if (d.k === "tc") {
      const c = $("#cust");
      c && c.classList.toggle("on", d.v === "c");
    }
  } else if (d.cfg) {
    WS && WS.send(JSON.stringify({ t: "cfg", [d.cfg]: d.v }));
  } else if (d.jr) {
    const id = who();
    if (!id) return;
    WS && WS.readyState === 1 ? WS.send(JSON.stringify({ t: "join", room: d.jr, ...id })) : lanFail();
  } else if (d.h === "refresh") loadRooms();
  else if (d.seat) {
    const a = hs[hs.step === "bot" ? "s4b" : "s4h"];
    a[d.seat] ^= 1;
    renderHome(hs.step);
  } else if (d.r4) {
    const tx = (o) => WS && WS.send(JSON.stringify(o));
    if (d.r4 === "start") tx({ t: "start4" });
    else if (d.r4 === "kick") tx({ t: "kick", color: d.cl });
    else if (d.r4 === "bot1") tx({ t: "bot", color: d.cl, on: 1 });
    else if (d.r4 === "bot0") tx({ t: "bot", color: d.cl, on: 0 });
    else if (d.r4 === "chat") openChat();
    else if (d.r4 === "copy") {
      try {
        navigator.clipboard.writeText(R4.code).then(() => toast("Room code copied"), () => toast("Code: " + R4.code));
      } catch (e2) {
        toast("Code: " + R4.code);
      }
    }
  } else if (d.h === "startbot") {
    if (hs.vr === "4p") return startOffline4();
    const tc = tcSec();
    if (tc !== null) startGame({ mode: "bot", color: hs.color, lv: hs.lv, tc, vr: hs.vr });
  } else if (d.h === "starthum") {
    if (hs.vr === "4p") return startOffline4();
    const tc = tcSec();
    if (tc !== null) startGame({ mode: "2p", color: "w", tc, vr: hs.vr });
  } else if (d.h === "set") settings();
  else if (d.h === "resume") closeHome(true);
  else if (d.h === "create") {
    const tc = tcSec();
    if (tc === null) return;
    const id = who();
    if (!id) return;
    if (hs.vr === "4p") {
      lanClose();
      return wsConnect((w) => w ? w.send(JSON.stringify({ t: "create4", ...id, tc, vis: hs.vis })) : lanFail());
    }
    lan = { color: hs.color === "r" ? Math.random() < 0.5 ? "w" : "b" : hs.color, tc, vr: hs.vr, lay: hs.vr === "960" ? Math.random() * 960 | 0 : 0 };
    lanClose();
    wsConnect((w) => w ? w.send(JSON.stringify({ t: "create", vis: hs.vis, ...id, tc })) : lanFail());
  } else if (d.h === "join") {
    const c = ($("#code").value || "").trim();
    if (c.length < 4) return $("#lerr").textContent = "Enter the full 4-digit code.";
    const id = who();
    if (!id) return;
    lanClose();
    wsConnect((w) => w ? w.send(JSON.stringify({ t: "join", room: c, ...id })) : lanFail());
  } else if (d.h === "cancel") {
    lanClose();
    renderHome("lan");
  }
};
/* the guest name typed in the box (remembered for next time); Google users use their username */
function savedName() {
  if (AUTH.state === "ok") return AUTH.name;
  const v = (($("#pname") || {}).value || "").trim().slice(0, 14);
  try {
    localStorage.setItem("icname", v);
  } catch (e) {
  }
  return v;
}
$("#home").addEventListener("input", (e) => {
  const i = e.target.id;
  if (i === "cm") hs.cm = Math.min(180, Math.max(0, parseInt(e.target.value) || 0));
  else if (i === "cs") hs.cs = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
});
$("#home").addEventListener("focusout", (e) => {
  const i = e.target.id;
  if (i === "cm") e.target.value = hs.cm;
  else if (i === "cs") e.target.value = String(hs.cs).padStart(2, "0");
});
$("#home").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "code") $("#home [data-h=join]").click();
  if (e.key === "Enter" && e.target.id === "uname") $("#home [data-g=save]").click();
});
/* ======================= UI: settings ======================= */
function settings() {
  const tg = (k, l) => `<div class=row><span>${l}</span><label class=tg><input type=checkbox data-c=${k} ${CFG[k] ? "checked" : ""}><i></i></label></div>`;
  dlg(`<h2>Settings</h2><div class=lb>Board colors</div><div class=sw>${TH.map((t, i) => `<button data-th=${i} class="${i == CFG.th ? "on" : ""}" style="--a:${t[0]};--b:${t[1]}"><i></i>${t[2]}</button>`).join("")}</div>
 ${tg("snd", "Sound")}<div class=row><span>Volume</span><input type=range min=0 max=100 value=${Math.round(CFG.vol * 100)} data-c=vol></div>${tg("anim", "Motion effects")}${tg("coords", "Show coordinates")}
 <div class=sg><button class=pb data-a=x>Done</button></div>`);
}
$("#box").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset;
  if (d.a === "chatclose") {
    closeDlg();
    chatOpen = false;
    return;
  }
  if (d.th !== void 0) {
    CFG.th = +d.th;
    save();
    b.parentNode.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    req();
  } else if (d.a === "rematch") {
    closeDlg();
    WS && WS.send('{"t":"rematch"}');
  } else if (d.a === "new") {
    closeDlg();
    openHome("main");
  } else if (d.a === "x") closeDlg();
  else if (d.a === "res") {
    closeDlg();
    resign();
  }
};
$("#box").onsubmit = (e) => {
  if (e.target.id === "chatform") {
    e.preventDefault();
    const i = $("#chatinput");
    const t = i.value;
    sendChat(t);
    if (i) i.value = "";
  }
};
$("#box").oninput = (e) => {
  const c = e.target.dataset.c;
  if (!c) return;
  if (c === "vol") CFG.vol = e.target.value / 100;
  else CFG[c] = e.target.checked;
  if (c === "snd") updSnd();
  save();
  req();
};
$("#box").onchange = (e) => {
  if (e.target.dataset.c === "vol") play("move-self");
};
/* ======================= VIEW & INPUT ======================= */
const w2s = (x, y) => {
  const f = flip ? -1 : 1;
  return [W / 2 + f * (x - Vw.cx) * Vw.s, H_ / 2 - f * (y - Vw.cy) * Vw.s];
}, s2w = (px, py) => {
  const f = flip ? -1 : 1;
  return [Vw.cx + f * (px - W / 2) / Vw.s, Vw.cy - f * (py - H_ / 2) / Vw.s];
};
const rect = (x, y) => {
  const a = w2s(x, y), b = w2s(x + 1, y + 1);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
};
let rq = 0;
const req = () => {
  if (!rq) rq = requestAnimationFrame((t) => {
    rq = 0;
    if (draw(t)) req();
  });
};
function fit() {
  const d = devicePixelRatio || 1;
  W = innerWidth;
  H_ = innerHeight;
  cv.width = W * d;
  cv.height = H_ * d;
  g.setTransform(d, 0, 0, d, 0, 0);
  Vw.s = Math.max(30, Math.min(84, Math.min(W - 16, H_ - 150) / 8.6));
  draw(performance.now());
}
addEventListener("resize", fit);
function fly(x, y) {
  const sx = Vw.cx, sy = Vw.cy, t0 = performance.now();
  (function st(t) {
    const e = ez(Math.min(1, (t - t0) / 450));
    Vw.cx = sx + (x - sx) * e;
    Vw.cy = sy + (y - sy) * e;
    req();
    if (e < 1) requestAnimationFrame(st);
  })(t0);
}
let drag = null, pan = null, pinch = null, down = null, moved = 0, wasSel = false;
const ptr = new Map();
const select = (p) => {
  sel = p;
  selT = performance.now();
};
let mc = null;
function selMoves(cap) {
  cap = Math.ceil(cap / 16) * 16;
  if (!mc || mc.p !== sel || mc.n !== H.length || mc.g !== gid || mc.cap < cap) mc = { p: sel, n: H.length, g: gid, cap, L: gen(P, sel.c, cap, false, sel) };
  return mc.L;
}
cv.onpointerdown = (e) => {
  if (F4mode && !homeOn) {
    f4Down(e);
    return;
  }
  drawer(false);
  cv.setPointerCapture(e.pointerId);
  ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptr.size === 2) {
    drag = pan = null;
    const [a, b] = [...ptr.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: Vw.s };
    return;
  }
  for (const k of ind) if (Math.hypot(e.clientX - k.x, e.clientY - k.y) < 22) {
    fly(k.p.x + 0.5, k.p.y + 0.5);
    return;
  }
  const [wx, wy] = s2w(e.clientX, e.clientY), x = Math.floor(wx), y = Math.floor(wy), p = P.get(x, y);
  moved = 0;
  down = { x: e.clientX, y: e.clientY };
  wasSel = false;
  if (!NA()) rips.push({ x, y, t0: performance.now() });
  if (p && canPlay(p)) {
    wasSel = sel === p;
    if (!wasSel) select(p);
    drag = { p, px: e.clientX, py: e.clientY };
    cv.style.cursor = "grabbing";
  } else pan = { x: e.clientX, y: e.clientY, cx: Vw.cx, cy: Vw.cy };
  req();
};
cv.onpointermove = (e) => {
  if (F4mode && !homeOn) {
    f4Mv(e);
    return;
  }
  if (ptr.has(e.pointerId)) ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptr.size === 2) {
    const [a, b] = [...ptr.values()];
    Vw.s = Math.max(14, Math.min(140, pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
    req();
    return;
  }
  if (!down) return;
  moved = Math.max(moved, Math.hypot(e.clientX - down.x, e.clientY - down.y));
  if (drag) {
    drag.px = e.clientX;
    drag.py = e.clientY;
  } else if (pan && moved > 3) {
    const f = flip ? -1 : 1;
    Vw.cx = pan.cx - f * (e.clientX - pan.x) / Vw.s;
    Vw.cy = pan.cy + f * (e.clientY - pan.y) / Vw.s;
  }
  req();
};
cv.onpointerup = cv.onpointercancel = (e) => {
  if (F4mode && !homeOn) {
    f4Up(e);
    return;
  }
  ptr.delete(e.pointerId);
  if (pinch) {
    if (ptr.size < 2) pinch = null;
    down = null;
    return;
  }
  if (!down) return;
  cv.style.cursor = "grab";
  const [wx, wy] = s2w(e.clientX, e.clientY), x = Math.floor(wx), y = Math.floor(wy);
  if (drag) {
    const p = drag.p;
    drag = null;
    if (moved > 8) tryMove(p, x, y, true);
    else if (wasSel) sel = null;
  } else if (pan) {
    if (moved < 6) {
      if (sel) tryMove(sel, x, y, false);
      sel = null;
    }
    pan = null;
  }
  down = null;
  req();
};
cv.onwheel = (e) => {
  e.preventDefault();
  const b = s2w(e.clientX, e.clientY);
  Vw.s = Math.max(14, Math.min(140, Vw.s * Math.exp(-e.deltaY * 15e-4)));
  const a = s2w(e.clientX, e.clientY);
  Vw.cx += b[0] - a[0];
  Vw.cy += b[1] - a[1];
  req();
};
addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("#dlg").classList.contains("open")) closeDlg();
    else if ($("#dr").classList.contains("open")) drawer(false);
    else if (homeOn && hasGame()) closeHome(true);
    else sel = null;
    req();
  }
});
function draw(now) {
  if (F4mode) return f4Draw();
  if (!P) return false;
  if (homeOn && saveV) {
    const t = now / 1e3;
    Vw.s = Math.max(saveV.s, 60) * 1.1;
    Vw.cx = saveV.cx + Math.sin(t * 0.13) * 2.6;
    Vw.cy = saveV.cy + Math.cos(t * 0.1) * 1.8;
  }
  const s = Vw.s;
  let busy = homeOn;
  const [LT, DK] = TH[CFG.th];
  const c1 = s2w(0, 0), c2 = s2w(W, H_), x0 = Math.floor(Math.min(c1[0], c2[0])), x1 = Math.ceil(Math.max(c1[0], c2[0])), y0 = Math.floor(Math.min(c1[1], c2[1])), y1 = Math.ceil(Math.max(c1[1], c2[1]));
  g.fillStyle = "#11171a";
  g.fillRect(0, 0, W, H_);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const [rx, ry] = rect(x, y);
    g.fillStyle = x + y & 1 ? LT : DK;
    g.fillRect(rx, ry, s + 0.7, s + 0.7);
  }
  const hl = (x, y, col) => {
    const [rx, ry] = rect(x, y);
    g.fillStyle = col;
    g.fillRect(rx, ry, s, s);
  };
  if (VR === "rk") for (let x = x0; x <= x1; x++) hl(x, 7, "rgba(255,196,0,.2)");
  if (VR === "koth") for (const [hx, hy] of [[3, 3], [4, 3], [3, 4], [4, 4]]) hl(hx, hy, "rgba(255,196,0,.22)");
  if (last) {
    hl(last.fx, last.fy, "rgba(255,214,64,.42)");
    hl(last.tx, last.ty, "rgba(255,214,64,.5)");
  }
  if (sel) {
    const e = Math.min(1, (now - selT) / 160);
    if (e < 1) busy = true;
    hl(sel.x, sel.y, `rgba(255,214,64,${0.62 * ez(e)})`);
  }
  for (const b of bad) {
    const t = (now - b.t0) / 520;
    if (t < 1) {
      busy = true;
      const k = t < 0.5 ? 1 : 2 * (1 - t), [rx, ry] = rect(b.x, b.y);
      g.fillStyle = `rgba(229,57,64,${0.78 * k * (0.6 + 0.4 * Math.abs(Math.cos(t * Math.PI * 3)))})`;
      g.fillRect(rx, ry, s, s);
    }
  }
  bad = bad.filter((b) => now - b.t0 < 520);
  if (s >= 30 && CFG.coords) {
    g.font = '700 11px "Bricolage Grotesque",system-ui';
    const yb = Math.floor(s2w(0, H_ - 1)[1]), xl = Math.floor(s2w(1, 0)[0]);
    g.textAlign = "right";
    for (let x = x0; x <= x1; x++) {
      const [rx, ry] = rect(x, yb);
      g.fillStyle = x + yb & 1 ? DK : LT;
      g.fillText(fl(x), rx + s - 4, ry + s - 5);
    }
    g.textAlign = "left";
    for (let y = y0; y <= y1; y++) {
      const [rx, ry] = rect(xl, y);
      g.fillStyle = xl + y & 1 ? DK : LT;
      g.fillText(y + 1, rx + 4, ry + 13);
    }
  }
  if (chk.length && !over) {
    const k = P.k[P.turn], [rx, ry] = rect(k.x, k.y), cx = rx + s / 2, cy = ry + s / 2, e = Math.min(1, Math.max(0, (now - chkT) / 300));
    if (e < 1) busy = true;
    g.fillStyle = `rgba(229,57,64,${0.88 * ez(e)})`;
    g.fillRect(rx, ry, s, s);
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, s * 0.7);
    gr.addColorStop(0, "rgba(255,40,40,.95)");
    gr.addColorStop(1, "rgba(200,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(rx, ry, s, s);
    const t = (now - chkT) / 900;
    if (t >= 0 && t < 1) {
      busy = true;
      g.strokeStyle = `rgba(255,70,70,${0.85 * (1 - t)})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, s * (0.5 + t * 1.3), 0, 7);
      g.stroke();
    }
    g.strokeStyle = "rgba(229,57,64,.75)";
    g.lineWidth = 3;
    g.setLineDash([8, 6]);
    for (const q of chk) {
      const [qx, qy] = w2s(q.x + 0.5, q.y + 0.5);
      g.beginPath();
      g.moveTo(qx, qy);
      g.lineTo(cx, cy);
      g.stroke();
    }
    g.setLineDash([]);
  }
  if (sel && !over) {
    const cap = Math.ceil(Math.max(W, H_) / s * 1.5) + Math.max(Math.abs(sel.x - Vw.cx), Math.abs(sel.y - Vw.cy)) + 4;
    for (const m of selMoves(cap)) {
      const [rx, ry] = rect(m.tx, m.ty), cx = rx + s / 2, cy = ry + s / 2;
      if (cx < -s || cy < -s || cx > W + s || cy > H_ + s) continue;
      const dl = Math.min(140, Math.max(Math.abs(m.tx - sel.x), Math.abs(m.ty - sel.y)) * 14), t = Math.max(0, Math.min(1, (now - selT - dl) / 180));
      if (t < 1) busy = true;
      const k = NA() ? 1 : eb(t);
      g.beginPath();
      if (m.cap) {
        g.strokeStyle = "rgba(0,0,0,.28)";
        g.lineWidth = s * 0.09;
        g.arc(cx, cy, s * 0.46 * k, 0, 7);
        g.stroke();
      } else {
        g.fillStyle = "rgba(0,0,0,.22)";
        g.arc(cx, cy, s * 0.17 * k, 0, 7);
        g.fill();
      }
    }
  }
  const dp = (c, t, wx, wy, k, al) => {
    const im = IM[c + t];
    if (!im || !im.complete || !im.naturalWidth) return;
    const [rx, ry] = rect(wx, wy);
    g.globalAlpha = al;
    g.drawImage(im, rx - s * (k - 1) / 2, ry - s * (k - 1) / 2, s * k, s * k);
    g.globalAlpha = 1;
  };
  for (const q of caps) {
    const t = (now - q.t0) / 260;
    if (t < 0) {
      dp(q.c, q.t, q.x, q.y, 1, 1);
      busy = true;
    } else if (t < 1) {
      busy = true;
      dp(q.c, q.t, q.x, q.y, 1 - 0.5 * ez(t), 1 - ez(t));
    }
  }
  caps = caps.filter((q) => now - q.t0 < 260);
  const mv = [];
  for (const p of P.m.values()) {
    if (p.x < x0 - 1 || p.x > x1 || p.y < y0 - 1 || p.y > y1) continue;
    if (p.an && now - p.an.t0 < p.an.d) {
      mv.push(p);
      busy = true;
      continue;
    }
    p.an = null;
    let k = 1, wx = p.x, wy = p.y;
    if (p === sel) {
      const e = Math.min(1, (now - selT) / 180);
      k = 1 + 0.1 * eb(e);
    }
    if (shake && shake.p === p) {
      const t = (now - shake.t0) / 350;
      if (t < 1) {
        wx += Math.sin(t * Math.PI * 7) * 0.09 * (1 - t);
        busy = true;
      } else shake = null;
    }
    dp(p.c, p.t, wx, wy, k, drag && drag.p === p && moved > 8 ? 0.3 : 1);
  }
  for (const p of mv) {
    const e = ez((now - p.an.t0) / p.an.d);
    dp(p.c, p.t, p.an.fx + (p.x - p.an.fx) * e, p.an.fy + (p.y - p.an.fy) * e, 1.06, 1);
  }
  for (const b of booms) {
    const t = (now - b.t0) / 650;
    if (t < 0) {
      busy = true;
      continue;
    }
    if (t < 1) {
      busy = true;
      const [rx, ry] = rect(b.x, b.y), cx = rx + s / 2, cy = ry + s / 2, r = s * (0.7 + 1.5 * ez(t)), gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, `rgba(255,235,150,${0.95 * (1 - t)})`);
      gr.addColorStop(0.45, `rgba(255,120,30,${0.65 * (1 - t)})`);
      gr.addColorStop(1, "rgba(255,60,0,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.arc(cx, cy, r, 0, 7);
      g.fill();
    }
  }
  booms = booms.filter((b) => now - b.t0 < 650);
  for (const r of rips) {
    const t = (now - r.t0) / 480;
    if (t < 1) {
      busy = true;
      const [rx, ry] = rect(r.x, r.y);
      g.strokeStyle = `rgba(255,255,255,${0.55 * (1 - t)})`;
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(rx + s / 2, ry + s / 2, s * (0.15 + 0.45 * ez(t)), 0, 7);
      g.stroke();
    }
  }
  rips = rips.filter((r) => now - r.t0 < 480);
  if (drag && moved > 8) {
    const z = s * 1.18;
    if (IM[drag.p.c + drag.p.t].naturalWidth) g.drawImage(IM[drag.p.c + drag.p.t], drag.px - z / 2, drag.py - z / 2 - s * 0.1, z, z);
  }
  {
    const vg = g.createRadialGradient(W / 2, H_ / 2, Math.min(W, H_) * 0.35, W / 2, H_ / 2, Math.hypot(W, H_) * 0.6);
    vg.addColorStop(0, "rgba(8,14,18,0)");
    vg.addColorStop(1, "rgba(8,14,18,.36)");
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H_);
  }
  ind = [];
  if (!homeOn) for (const c of "wb") {
    const k = kg(P, c);
    if (!k) continue;
    const [kx, ky] = w2s(k.x + 0.5, k.y + 0.5);
    if (kx > -s && kx < W + s && ky > -s && ky < H_ + s) continue;
    const dx = kx - W / 2, dy = ky - H_ / 2, t = Math.min((W / 2 - 34) / Math.abs(dx || 1e-9), (H_ / 2 - 34) / Math.abs(dy || 1e-9)), ex = W / 2 + dx * t, ey = H_ / 2 + dy * t, ic = chk.length && P.turn === c && !over;
    g.beginPath();
    g.arc(ex, ey, 21, 0, 7);
    g.fillStyle = ic ? "#e5393f" : "rgba(20,27,31,.9)";
    g.fill();
    g.strokeStyle = "rgba(255,255,255,.85)";
    g.lineWidth = 2;
    g.stroke();
    if (IM[c + "k"].naturalWidth) g.drawImage(IM[c + "k"], ex - 16, ey - 16, 32, 32);
    ind.push({ x: ex, y: ey, p: k });
  }
  return busy || !!drag;
}
chatVis();
sfInit();
newGame({ mode: "2p", color: "w", lv: 1 });
openHome(authReturn() || "main");   // coming back from Google? reopen the screen you were on
authBoot();
