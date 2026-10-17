/* Infinite Chess — script.js
   1) config + sound   2) rules engine & built-in bot   3) Stockfish   4) game, clock, online rooms   5) UI   6) board rendering */
const $=s=>document.querySelector(s),cv=$('#cv'),g=cv.getContext('2d');
const R='resources/',PN={k:'king',q:'queen',r:'rook',b:'bishop',n:'knight',p:'pawn'};

/* ======================= CONFIG & SOUND ======================= */
const CFG={th:0,snd:true,vol:.8,coords:true,anim:true};
try{Object.assign(CFG,JSON.parse(localStorage.getItem('icfg')||'{}'))}catch(e){}
const save=()=>{try{localStorage.setItem('icfg',JSON.stringify(CFG))}catch(e){}};
const IM={};for(const c of'wb')for(const t of'kqrbnp'){const im=new Image();im.onload=()=>req();im.src=`${R}pieces/${c==='w'?'white':'black'}_${PN[t]}.png`;IM[c+t]=im}
// 7 effects: capture, castle, illegal, move-check, move-opponent, move-self, tensecondsremain
const SN=['capture','castle','illegal','move-check','move-opponent','move-self','tensecondsremain'];
let AC=null,ai=0;const AB={},AE={};
function audioInit(){if(ai)return;ai=1;try{AC=new(window.AudioContext||window.webkitAudioContext)()}catch(e){AC=null}
 for(const k of SN){const u=`${R}sounds/${k}.mp3`,a=new Audio(u);a.preload='auto';AE[k]=a;if(AC)fetch(u).then(r=>r.arrayBuffer()).then(b=>AC.decodeAudioData(b)).then(b=>AB[k]=b).catch(()=>{})}}
addEventListener('pointerdown',audioInit,true);addEventListener('keydown',audioInit,true);
function play(n){if(!CFG.snd)return;audioInit();if(AC&&AC.state==='suspended')AC.resume();
 if(AC&&AB[n]){const s2=AC.createBufferSource(),g2=AC.createGain();s2.buffer=AB[n];g2.gain.value=CFG.vol;s2.connect(g2).connect(AC.destination);s2.start()}
 else if(AE[n]){const a=AE[n].cloneNode();a.volume=CFG.vol;a.play().catch(()=>{})}}

/* ======================= ENGINE (infinite-board rules + built-in bot) ======================= */
const KY=(x,y)=>x*4194304+y,opp=c=>c==='w'?'b':'w',V0={p:100,n:300,b:320,r:500,q:900,k:0};
const ND=[[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]],OR=[[1,0],[-1,0],[0,1],[0,-1]],DG=[[1,1],[1,-1],[-1,1],[-1,-1]],DIRS={r:OR,b:DG,q:[...OR,...DG]};
class Pos{constructor(){this.m=new Map();this.turn='w';this.ep=null;this.k={};this.hm=0}get(x,y){return this.m.get(KY(x,y))}put(p){this.m.set(KY(p.x,p.y),p)}del(p){this.m.delete(KY(p.x,p.y))}}
function setup(){const P=new Pos(),B='rnbqkbnr';for(let x=0;x<8;x++)for(const[c,y,t]of[['w',0,B[x]],['w',1,'p'],['b',7,B[x]],['b',6,'p']]){const p={t,c,x,y,moved:false};P.put(p);if(t==='k')P.k[c]=p}return P}
function firstBlock(P,x,y,dx,dy){let k=Infinity,pc=null;for(const q of P.m.values()){const a=q.x-x,b=q.y-y,n=dx?a/dx:b/dy;if(n>0&&n<k&&a===n*dx&&b===n*dy){k=n;pc=q}}return[k,pc]}
function atk(P,q,x,y){const a=x-q.x,b=y-q.y,A_=Math.abs(a),B_=Math.abs(b);if(!a&&!b)return false;
 if(q.t==='n')return a*a+b*b===5;if(q.t==='k')return A_<2&&B_<2;if(q.t==='p')return A_===1&&b===(q.c==='w'?1:-1);
 const d=q.t==='b'?A_===B_:q.t==='r'?(!a||!b):(!a||!b||A_===B_);if(!d)return false;
 return firstBlock(P,q.x,q.y,Math.sign(a),Math.sign(b))[0]>=Math.max(A_,B_)}
const attackedBy=(P,x,y,c)=>{for(const q of P.m.values())if(q.c===c&&atk(P,q,x,y))return true;return false};
const inCheck=(P,c)=>attackedBy(P,P.k[c].x,P.k[c].y,opp(c));
function pm(P,p,tx,ty){const a=tx-p.x,b=ty-p.y,q=P.get(tx,ty);if(!a&&!b||q&&q.c===p.c)return null;const mv={p,fx:p.x,fy:p.y,tx,ty,cap:q||null};
 if(p.t==='p'){const d=p.c==='w'?1:-1;
  if(!a){if(q)return null;if(b===d)return mv;if(b===2*d&&!p.moved&&!P.get(p.x,p.y+d)){mv.dbl=1;return mv}return null}
  if(Math.abs(a)===1&&b===d){if(q)return mv;const e=P.ep;if(e&&e.x===tx&&e.y===ty){mv.cap=P.get(tx,p.y);return mv}}return null}
 if(p.t==='k'){if(Math.abs(a)<2&&Math.abs(b)<2)return mv;
  if(!p.moved&&!b&&Math.abs(a)===2){const s=Math.sign(a),r=P.get(s>0?7:0,p.y);if(!r||r.t!=='r'||r.c!==p.c||r.moved)return null;
   for(let x=p.x+s;x!==r.x;x+=s)if(P.get(x,p.y))return null;const o=opp(p.c);if(attackedBy(P,p.x,p.y,o)||attackedBy(P,p.x+s,p.y,o))return null;
   mv.rk=r;mv.rfx=r.x;mv.rx=p.x+s;return mv}return null}
 return atk(P,p,tx,ty)?mv:null}
function make(P,mv){const p=mv.p,u={mv,pm:p.moved,ep:P.ep,hm:P.hm};if(mv.cap)P.del(mv.cap);P.del(p);p.x=mv.tx;p.y=mv.ty;p.moved=true;P.put(p);
 if(mv.rk){const r=mv.rk;u.rm=r.moved;P.del(r);r.x=mv.rx;r.moved=true;P.put(r)}
 P.ep=mv.dbl?{x:mv.tx,y:(mv.fy+mv.ty)/2}:null;P.hm=(mv.cap||p.t==='p')?0:P.hm+1;P.turn=opp(P.turn);return u}
function unmake(P,u){const mv=u.mv,p=mv.p;P.del(p);p.x=mv.fx;p.y=mv.fy;p.moved=u.pm;P.put(p);if(mv.cap)P.put(mv.cap);
 if(mv.rk){const r=mv.rk;P.del(r);r.x=mv.rfx;r.moved=u.rm;P.put(r)}P.ep=u.ep;P.hm=u.hm;P.turn=opp(P.turn)}
function legal(P,mv){const c=mv.p.c,u=make(P,mv),ok=!inCheck(P,c);unmake(P,u);return ok}
function evade(P,c){const k=P.k[c],o=opp(c),L=[];
 for(const[a,b]of[...OR,...DG]){const m=pm(P,k,k.x+a,k.y+b);if(m&&legal(P,m))L.push(m)}
 const ch=[...P.m.values()].filter(q=>q.c===o&&atk(P,q,k.x,k.y));if(ch.length>1)return L;
 const q=ch[0],T=[[q.x,q.y]];if('brq'.includes(q.t)){const dx=Math.sign(k.x-q.x),dy=Math.sign(k.y-q.y),n=Math.max(Math.abs(k.x-q.x),Math.abs(k.y-q.y));for(let s=1;s<n;s++)T.push([q.x+dx*s,q.y+dy*s])}
 if(P.ep)T.push([P.ep.x,P.ep.y]);
 for(const p of[...P.m.values()])if(p.c===c&&p!==k)for(const[x,y]of T){const m=pm(P,p,x,y);if(m&&legal(P,m))L.push(m)}return L}
function gen(P,c,cap,co,only){
 if(inCheck(P,c)){const L=evade(P,c);return co?L.filter(m=>m.cap):only?L.filter(m=>m.p===only):L}
 const L=[],add=(p,x,y)=>{const m=pm(P,p,x,y);if(m&&!(co&&!m.cap))L.push(m)};
 for(const p of P.m.values()){if(p.c!==c||only&&p!==only)continue;
  if(p.t==='n')for(const[a,b]of ND)add(p,p.x+a,p.y+b);
  else if(p.t==='k'){for(const[a,b]of[...OR,...DG])add(p,p.x+a,p.y+b);if(!co&&!p.moved){add(p,p.x+2,p.y);add(p,p.x-2,p.y)}}
  else if(p.t==='p'){const d=c==='w'?1:-1;add(p,p.x,p.y+d);add(p,p.x,p.y+2*d);add(p,p.x+1,p.y+d);add(p,p.x-1,p.y+d)}
  else for(const[dx,dy]of DIRS[p.t]){const[k,q]=firstBlock(P,p.x,p.y,dx,dy);
   if(!co)for(let s=1;s<k&&s<=cap;s++)L.push({p,fx:p.x,fy:p.y,tx:p.x+dx*s,ty:p.y+dy*s,cap:null});
   if(q&&q.c!==c)L.push({p,fx:p.x,fy:p.y,tx:q.x,ty:q.y,cap:q})}}
 return L.filter(m=>legal(P,m))}
function ev(P){let s=0;for(const p of P.m.values()){const sg=p.c==='w'?1:-1,e=P.k[opp(p.c)],dk=Math.max(Math.abs(p.x-e.x),Math.abs(p.y-e.y));let v=V0[p.t];
 if(p.t==='p')v+=Math.max(-2,Math.min((p.y-(sg>0?1:6))*sg,6))*8;
 else if(p.t==='n'||p.t==='b')v+=(p.moved?12:0)+Math.max(0,10-dk)*2;
 else if(p.t==='r'||p.t==='q')v+=Math.max(0,12-dk)*1.5;
 else v-=Math.min(Math.abs(p.y-(sg>0?0:7)),6)*10-(p.moved&&(p.x===2||p.x===6)?25:0);
 s+=sg*v}return s}
let TO=0,DL=0;const mvs=m=>m.cap?V0[m.cap.t]*10-V0[m.p.t]:0,order=L=>L.sort((a,b)=>mvs(b)-mvs(a));
function qs(P,c,a,b,d){const st=(c==='w'?1:-1)*ev(P);if(st>=b||d<=0)return st;if(st>a)a=st;
 for(const m of order(gen(P,c,0,true))){const u=make(P,m),v=-qs(P,opp(c),-b,-a,d-1);unmake(P,u);if(v>=b)return b;if(v>a)a=v}return a}
function ab(P,c,dp,a,b,ply){if(performance.now()>DL){TO=1;return 0}if(dp<=0)return qs(P,c,a,b,3);
 const L=order(gen(P,c,3));if(!L.length)return inCheck(P,c)?-99000+ply:0;
 for(const m of L){const u=make(P,m),v=-ab(P,opp(c),dp-1,-b,-a,ply+1);unmake(P,u);if(TO)return 0;if(v>=b)return b;if(v>a)a=v}return a}
function think(P,c,lv){const D=[1,2,3][lv]+(lv===2?1:0);DL=performance.now()+[200,900,2300][lv];TO=0;let L=order(gen(P,c,6)),best=L[0];
 for(let d=1;d<=D;d++){let bm=null,bs=-1e9,a=-1e9;
  for(const m of L){const u=make(P,m);let v=-ab(P,opp(c),d-1,-1e9,-a,1);unmake(P,u);if(TO)break;v+=Math.random()*(lv===0?120:4);if(v>bs){bs=v;bm=m}if(v>a)a=v}
  if(TO||!bm)break;best=bm;L=[bm,...L.filter(x=>x!==bm)]}return best}
/* ======================= STOCKFISH ======================= */
const LV=[{ms:250,elo:1350},{ms:600,elo:1900},{ms:1100,elo:2500},{ms:1600,elo:0}];
const SF_URL=R+'stockfish-19-lite/stockfish-19-lite.js';
let SF=null,sfReady=false,sfFail=false,sfCb=null,sfPend=0;
const sqn=(x,y)=>'abcdefgh'[x]+(y+1);
function sfDie(){sfFail=true;sfReady=false;try{SF&&SF.terminate()}catch(e){}SF=null;stt()}
function sfInit(){
 // The multi-threaded lite build needs SharedArrayBuffer => the page must be cross-origin isolated (COOP/COEP headers)
 if(!globalThis.Worker||typeof SharedArrayBuffer==='undefined'||!globalThis.crossOriginIsolated)return sfDie();
 try{setTimeout(()=>{if(!sfReady&&!sfFail)sfDie()},20000);SF=new Worker(SF_URL);
  SF.onmessage=e=>{const l=typeof e.data==='string'?e.data:'';if(l==='uciok')SF.postMessage('isready');else if(l==='readyok'){sfReady=true;stt()}
   else if(l.startsWith('bestmove')){sfPend--;if(!sfPend&&sfCb)sfCb(l.split(' ')[1])}};
  SF.onerror=sfDie;SF.postMessage('uci')}catch(e){sfDie()}}
const fits=P=>{for(const p of P.m.values())if(p.x<0||p.x>7||p.y<0||p.y>7||p.t==='p'&&(p.y===0||p.y===7))return false;return true};
function fen(P){let s='';for(let y=7;y>=0;y--){let e=0;for(let x=0;x<8;x++){const p=P.get(x,y);if(!p)e++;else{if(e){s+=e;e=0}s+=p.c==='w'?p.t.toUpperCase():p.t}}if(e)s+=e;if(y)s+='/'}
 const ck=(c,y)=>{const k=P.k[c],a=P.get(7,y),b=P.get(0,y),o=!k.moved&&k.x===4&&k.y===y;return[o&&a&&a.t==='r'&&a.c===c&&!a.moved,o&&b&&b.t==='r'&&b.c===c&&!b.moved]},w=ck('w',0),b=ck('b',7);
 const cr=(w[0]?'K':'')+(w[1]?'Q':'')+(b[0]?'k':'')+(b[1]?'q':'')||'-',ep=P.ep&&P.ep.x>=0&&P.ep.x<8&&P.ep.y>=0&&P.ep.y<8?sqn(P.ep.x,P.ep.y):'-';
 return`${s} ${P.turn} ${cr} ${ep} ${P.hm} 1`}
function sfThink(P,c,lv){return new Promise(res=>{const mp=new Map();
 for(const m of gen(P,c,16)){if(m.tx<0||m.tx>7||m.ty<0||m.ty>7||m.p.t==='p'&&(m.ty===7||m.ty===0))continue;mp.set(sqn(m.fx,m.fy)+sqn(m.tx,m.ty),m)}
 if(!mp.size)return res(null);const L=LV[lv];let done=0;
 const fin=m=>{if(!done){done=1;clearTimeout(tm);sfCb=null;res(m)}},tm=setTimeout(()=>{SF.postMessage('stop');fin(null)},L.ms+7000);sfCb=b=>fin(mp.get(b)||null);
 SF.postMessage('setoption name UCI_LimitStrength value '+(L.elo?'true':'false'));if(L.elo)SF.postMessage('setoption name UCI_Elo value '+L.elo);
 SF.postMessage('position fen '+fen(P));sfPend++;SF.postMessage(`go movetime ${L.ms} searchmoves ${[...mp.keys()].join(' ')}`)})}
const sfAbort=()=>{if(SF&&sfCb){sfCb=null;SF.postMessage('stop')}};

/* ======================= GAME STATE ======================= */
const fl=x=>x>=0&&x<8?'abcdefgh'[x]:`(${x+1})`,sq=(x,y)=>fl(x)+(y+1),RM0=matchMedia('(prefers-reduced-motion:reduce)').matches,ez=t=>1-Math.pow(1-t,3),eb=t=>{const c=1.9;return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2)};
const TH=[['#ebecd0','#739552','Green'],['#f0d9b5','#b58863','Wood'],['#dfe5e8','#7f97a6','Slate'],['#f3e3e0','#c98a8a','Rose'],['#e9e4f1','#8672a8','Purple'],['#b8c0c8','#46525e','Night']],
 NA=()=>RM0||!CFG.anim,LVN=[['Easy','Elo 1350'],['Medium','Elo 1900'],['Hard','Elo 2500'],['Max','Strongest']],TCS=[[0,'No limit'],[3,'3 min'],[5,'5 min'],[10,'10 min']];
let P,H=[],mode='2p',me='w',lv=1,over=null,sel=null,flip=false,thinking=false,last=null,chk=[],gid=0,W,H_,ind=[],engUsed='',sfNote=false;
let selT=0,chkT=0,caps=[],rips=[],shake=null,clk=null,warned={w:0,b:0};const Vw={cx:4,cy:4,s:60};
function san(mv){const p=mv.p;if(mv.rk)return mv.tx>mv.fx?'O-O':'O-O-O';let s='';
 if(p.t!=='p'){s=p.t.toUpperCase();const am=[...P.m.values()].filter(q=>q!==p&&q.c===p.c&&q.t===p.t&&(m=>m&&legal(P,m))(pm(P,q,mv.tx,mv.ty)));
  if(am.length)s+=am.some(q=>q.x===p.x)?(am.some(q=>q.y===p.y)?sq(p.x,p.y):p.y+1):fl(p.x)}else if(mv.cap)s=fl(p.x);
 return s+(mv.cap?'x':'')+sq(mv.tx,mv.ty)}
function newGame(o){gid++;sfAbort();P=setup();H=[];over=null;sel=null;last=null;thinking=false;caps=[];mode=o.mode;lv=+o.lv||0;engUsed='';
 me=o.color==='r'?(Math.random()<.5?'w':'b'):o.color;flip=mode!=='2p'&&me==='b';Vw.cx=4;Vw.cy=4;
 clk=o.tc?{w:o.tc*60000,b:o.tc*60000,last:performance.now()}:null;warned={w:0,b:0};fit();refresh();
 if(mode==='bot'&&!sfReady&&!sfNote){sfNote=true;if(sfFail)toast('Stockfish can\'t run in this browser — using the built-in engine.')}}
function doMove(mv,anim,remote){tickClock();const now=performance.now(),d=anim&&!NA()?240:0;let s=san(mv);const mover=P.turn;
 if(mode==='lan'&&!remote&&WS)WS.send(JSON.stringify({t:'move',fx:mv.fx,fy:mv.fy,tx:mv.tx,ty:mv.ty}));
 if(mv.cap)caps.push({c:mv.cap.c,t:mv.cap.t,x:mv.cap.x,y:mv.cap.y,t0:now+d*.6});
 const u=make(P,mv);mv.p.an={fx:mv.fx,fy:mv.fy,t0:now,d};if(mv.rk)mv.rk.an={fx:mv.rfx,fy:mv.fy,t0:now,d};
 if(clk)clk.last=now;
 const ck=inCheck(P,P.turn),has=gen(P,P.turn,3).length>0;if(ck){s+=has?'+':'#';chkT=now+d}
 H.push({u,s});last=mv;sel=null;
 const opp_=(mode==='bot'||mode==='lan')&&mover!==me;
 setTimeout(()=>play(ck?'move-check':mv.rk?'castle':mv.cap?'capture':opp_?'move-opponent':'move-self'),d*.7);
 const o=[...P.m.values()].filter(p=>p.t!=='k');
 if(!has)over=ck?{w:mover,r:'Checkmate!'}:{w:null,r:'Stalemate — draw'};
 else if(P.hm>=100)over={w:null,r:'Draw (50-move rule)'};else if(!o.length||o.length===1&&'nb'.includes(o[0].t))over={w:null,r:'Draw (insufficient material)'};
 refresh(ck&&!has)}
const nm=c=>c==='w'?'White':'Black';
function stt(){const st=$('#st');if(!P)return;st.classList.toggle('ck',!!chk.length&&!over);st.classList.toggle('th',thinking);
 $('#stt').textContent=over?over.r+(over.w?' — '+nm(over.w)+' wins':''):thinking?'Engine is thinking…':(mode==='lan'?(P.turn===me?'Your move':'Opponent\'s move'):nm(P.turn)+' to move')+(chk.length?' — CHECK!':'');
 $('.tn').style.background=over?'transparent':P.turn==='w'?'#fff':'#222';
 const e=$('#eng');e.textContent=mode!=='bot'?'':engUsed==='sf'?'Stockfish 19':engUsed==='int'?'Built-in engine':sfReady?'Stockfish 19':sfFail?'Built-in engine':'Loading Stockfish…';e.style.display=mode==='bot'?'':'none';drawClock()}
function refresh(matePlayed){chk=[];if(inCheck(P,P.turn)){const k=P.k[P.turn];chk=[...P.m.values()].filter(q=>q.c!==P.turn&&atk(P,q,k.x,k.y))}
 const mv=$('#mvl');mv.innerHTML=H.length?'':'<div class=e>No moves yet.</div>';for(let i=0;i<H.length;i+=2)mv.insertAdjacentHTML('beforeend',`<div class=r><b>${i/2+1}.</b><span>${H[i].s}</span><span>${H[i+1]?H[i+1].s:''}</span></div>`);
 if(mv.lastElementChild&&mv.lastElementChild.className==='r')mv.lastElementChild.className='r n';mv.scrollTop=1e9;stt();req();const id=gid;
 if(over){if(!matePlayed)play('move-check');setTimeout(()=>id===gid&&dlg(`<h2>${over.r}</h2><p>${over.w?(mode==='2p'?nm(over.w):over.w===me?'You':mode==='lan'?'Your opponent':'The engine')+(mode==='2p'||over.w!==me?' wins':' win')+' this game.':'The game ended in a draw.'}</p><div class=sg><button class=pb data-a=new>New game</button><button data-a=x>View board</button></div>`),900);return}
 if(mode==='bot'&&P.turn!==me&&!thinking)botTurn(id)}
async function botTurn(id){thinking=true;stt();let m=null;
 if(sfReady&&fits(P)){m=await sfThink(P,P.turn,lv);if(m)engUsed='sf'}
 if(!m){await new Promise(r=>setTimeout(r,80));if(id!==gid)return;m=think(P,P.turn,Math.min(lv,2));engUsed='int'}
 if(id!==gid)return;thinking=false;if(m)doMove(m,true);else refresh()}
function tryMove(p,x,y,byDrag){if(x===p.x&&y===p.y)return;const m=pm(P,p,x,y);if(!m)return;
 if(!legal(P,m)){play('illegal');toast('That move would leave your king in check');shake={p,t0:performance.now()};req();return}doMove(m,!byDrag)}
const canPlay=p=>!over&&!thinking&&p.c===P.turn&&(mode==='2p'||p.c===me);
function undo(){if(!H.length||thinking||over&&mode==='lan')return;if(mode==='lan'||clk)return toast('Undo isn\'t available in online games or with a clock');
 const n=mode==='bot'&&P.turn===me&&H.length>=2?2:1;sfAbort();for(let i=0;i<n;i++)unmake(P,H.pop().u);
 for(const p of P.m.values())p.an=null;caps=[];last=H.length?H[H.length-1].u.mv:null;over=null;sel=null;gid++;refresh()}
function resign(){if(over)return;const c=mode==='2p'?P.turn:me;if(mode==='lan'&&WS)WS.send(JSON.stringify({t:'resign'}));over={w:opp(c),r:'Resignation'};refresh()}

/* ======================= CLOCK ======================= */
const fmt=ms=>{ms=Math.max(0,ms);return ms<10000&&ms>0?(ms/1000).toFixed(1):Math.floor(Math.ceil(ms/1000)/60)+':'+String(Math.ceil(ms/1000)%60).padStart(2,'0')};
function tickClock(){if(!clk||!P)return;const n=performance.now(),d=n-clk.last;clk.last=n;if(over||homeOn)return;
 clk[P.turn]-=d;const c=P.turn;
 if(clk[c]<=10000&&clk[c]>0&&!warned[c]&&(mode!=='bot'||c===me)){warned[c]=1;play('tensecondsremain')}
 if(clk[c]<=0){clk[c]=0;over={w:opp(c),r:'Time out'};refresh()}drawClock()}
function drawClock(){const e=$('#clk');e.hidden=!clk||homeOn;if(!clk)return;for(const c of'wb'){const b=e.querySelector('.'+c);b.querySelector('b').textContent=fmt(clk[c]);b.classList.toggle('act',!over&&P&&P.turn===c);b.classList.toggle('low',clk[c]<10000)}}
setInterval(tickClock,100);

/* ======================= ONLINE ROOMS ======================= */
let WS=null,hbT=0,lan={color:'w',tc:0};
function wsConnect(cb){let done=0;const fin=w=>{if(!done){done=1;cb(w)}};let ws;
 try{ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws')}catch(e){return fin(null)}
 const to=setTimeout(()=>{try{ws.close()}catch(e){}fin(null)},3500);
 ws.onopen=()=>{clearTimeout(to);WS=ws;fin(ws);clearInterval(hbT);hbT=setInterval(()=>{try{ws.readyState===1&&ws.send('{"t":"ping"}')}catch(e){}},20000)};ws.onerror=()=>{clearTimeout(to);fin(null)};
 ws.onmessage=e=>{try{lanMsg(JSON.parse(e.data))}catch(x){}};
 ws.onclose=()=>{clearInterval(hbT);if(WS===ws){WS=null;if(homeOn&&(hs.step==='lanw'||hs.step==='lanwj')){toast('Connection lost');renderHome('lan');return}if(mode==='lan'&&!over&&!homeOn)toast('Connection lost')}}}
function lanMsg(m){
 if(m.t==='created'){hs.code=m.room;renderHome('lanw')}
 else if(m.t==='peer'){WS.send(JSON.stringify({t:'start',color:opp(lan.color),tc:lan.tc}));startGame({mode:'lan',color:lan.color,tc:lan.tc})}
 else if(m.t==='start')startGame({mode:'lan',color:m.color,tc:m.tc})
 else if(m.t==='joined')renderHome('lanwj')
 else if(m.t==='err'){const e=$('#lerr');if(e)e.textContent=m.m}
 else if(m.t==='move'&&mode==='lan'&&!over){const p=P.get(m.fx,m.fy),mv=p&&p.c===P.turn&&p.c!==me&&pm(P,p,m.tx,m.ty);if(mv&&legal(P,mv))doMove(mv,true,true)}
 else if(m.t==='resign'&&mode==='lan'&&!over){over={w:me,r:'Opponent resigned'};refresh()}
 else if(m.t==='left'&&homeOn&&(hs.step==='lanw'||hs.step==='lanwj')){lanClose();toast(hs.step==='lanw'?'Your opponent left the room':'The host closed the room');renderHome('lan')}
 else if(m.t==='left'&&mode==='lan'&&!over&&!homeOn){over={w:me,r:'Opponent left the room'};refresh()}}
const lanClose=()=>{clearInterval(hbT);if(WS){const w=WS;WS=null;try{w.close()}catch(e){}}};

/* ======================= UI: toast, dialog, drawer ======================= */
function toast(t){const e=$('#tt');e.textContent=t;e.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('on'),2600)}
function dlg(h){$('#box').innerHTML=h;$('#dlg').classList.add('open')}const closeDlg=()=>$('#dlg').classList.remove('open');
const svg=d=>`<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const GEAR='M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z';
const ACT=[['home','Main menu','M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z',()=>openHome('main')],
 ['undo','Undo','M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',undo],
 ['flip','Flip board','M7 4v14m0 0l-3-3m3 3l3-3M17 20V6m0 0l-3 3m3-3l3 3',()=>{flip=!flip;req()}],
 ['ctr','Center view','M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3',()=>fly(4,4)],
 ['snd','Sound','M11 5L6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 010 7',()=>{CFG.snd=!CFG.snd;save();updSnd();if(CFG.snd)play('move-self')},true],
 ['set','Settings',GEAR,settings],
 ['res','Resign','M5 21V4M5 4h11l-2 4 2 4H5',()=>dlg('<h2>Resign this game?</h2><div class=sg><button class=pb data-a=res>Resign</button><button data-a=x>Cancel</button></div>')]];
$('#dg').innerHTML=ACT.map(a=>`<button class="di${a[0]==='res'?' red':''}" data-k="${a[0]}">${svg(a[2])}<span>${a[1]}</span></button>`).join('');
const updSnd=()=>{const b=$('.di[data-k=snd]');b.classList.toggle('off',!CFG.snd);b.querySelector('span').textContent=CFG.snd?'Sound: On':'Sound: Off'};updSnd();
function drawer(open){const o=open===undefined?!$('#dr').classList.contains('open'):open;$('#dr').classList.toggle('open',o);$('#hb').classList.toggle('open',o);$('#hb').setAttribute('aria-expanded',o)}
$('#hb').onclick=()=>drawer();
$('#dg').onclick=e=>{const b=e.target.closest('.di');if(!b)return;const a=ACT.find(x=>x[0]===b.dataset.k);a[3]();if(!a[4])drawer(false)};

/* ======================= UI: lobby ======================= */
let homeOn=false,saveV=null,hs={color:'w',lv:1,tc:0,code:''};
const hasGame=()=>H.length>0&&!over,pu=(c,t)=>`${R}pieces/${c==='w'?'white':'black'}_${PN[t]}.png`,pc=(c,t)=>`<img src="${pu(c,t)}" alt="">`;
const back=s=>`<button class=pill data-s="${s}">‹ Back</button>`,
 optRow=(key,arr)=>`<div class=opts>${arr.map(([v,l,x,i])=>`<button class="opt${String(hs[key])===String(v)?' on':''}" data-k="${key}" data-v="${v}">${i||''}<span>${l}</span>${x?`<small>${x}</small>`:''}</button>`).join('')}</div>`,
 colors=()=>optRow('color',[['w','White','',pc('w','k')],['b','Black','',pc('b','k')],['r','Random','',pc('w','q')]]),
 times=()=>`<div class=lb2>Time per side</div>${optRow('tc',TCS)}`,
 tile=(h,a,b,t,d)=>`<button class=tile data-s="${h}"><span class=pcs>${pc(a[0],a[1])}${pc(b[0],b[1])}</span><span class=tx><b>${t}</b><span>${d}</span></span></button>`;
function renderHome(step){const h=$('#hin');let x='';hs.step=step;
 if(step==='main')x=`<img class=hl src="${R}images/logo-white.png" alt="Infinite Chess"><p class=tag>No edges. No promotion. Just moves.</p>
  <div class=tiles>${tile('bot',['b','n'],['w','k'],'Play the engine','Stockfish 19 + built-in engine')}${tile('hum',['w','p'],['b','p'],'Play a friend','Same device')}${tile('lan',['w','r'],['b','r'],'Play online','Two players, two devices')}</div>
  <div class=sub>${hasGame()?'<button class=pill data-h=resume>Resume current game</button>':''}<button class=pill data-h=set>Settings</button></div>`;
 else if(step==='bot')x=`${back('main')}<h2>Play the engine</h2><div class=lb2>You play as</div>${colors()}<div class=lb2>Difficulty</div>${optRow('lv',LVN.map(([l,e],i)=>[i,l,e]))}${times()}<button class=go data-h=startbot>Start game</button>`;
 else if(step==='hum')x=`${back('main')}<h2>Play a friend</h2>${times()}<button class=go data-h=starthum>Start game</button>`;
 else if(step==='lan')x=`${back('main')}<h2>Play online</h2><p class=tag>Create a room and share the 4-digit code with a friend — or enter their code to join.</p>
  <div class="tiles two">${tile('lanc',['w','k'],['b','k'],'Create room','Get a 4-digit code')}${tile('lanj',['w','n'],['b','n'],'Join room','Enter a friend\'s code')}</div>`;
 else if(step==='lanc')x=`${back('lan')}<h2>Create room</h2><div class=lb2>You play as</div>${colors()}${times()}<button class=go data-h=create>Create room</button><p class=err id=lerr></p>`;
 else if(step==='lanw')x=`<h2>Your room code</h2><div class=code>${hs.code}</div><p class=tag>Your friend opens <b>${location.origin}</b>, picks Play online → Join room and enters this code.</p><p class=tag><i class=sp></i>Waiting for opponent…</p><button class=pill data-h=cancel>Cancel room</button>`;
 else if(step==='lanwj')x=`<h2>Joined the room</h2><p class=tag><i class=sp></i>Waiting for the host to start the game…</p><button class=pill data-h=cancel>Leave room</button>`;
 else if(step==='lanj')x=`${back('lan')}<h2>Join room</h2><input class=ci id=code inputmode=numeric maxlength=4 placeholder="0000" autocomplete=off><button class=go data-h=join>Join room</button><p class=err id=lerr></p>`;
 h.className='';h.innerHTML=x;void h.offsetWidth;h.className='in';$('#home').scrollTop=0}
function openHome(step){if(!homeOn)saveV={cx:Vw.cx,cy:Vw.cy,s:Vw.s};homeOn=true;document.body.classList.add('lobby');drawer(false);$('#home').classList.add('open');renderHome(step||'main');drawClock();req()}
function closeHome(restore){homeOn=false;document.body.classList.remove('lobby');$('#home').classList.remove('open');if(restore&&saveV)Object.assign(Vw,saveV);if(clk)clk.last=performance.now();drawClock();req()}
function startGame(o){closeDlg();closeHome(false);if(o.mode!=='lan')lanClose();newGame(o);play('move-self')}
function lanFail(){const e=$('#lerr');const t='Couldn\'t reach the game server. Please try again in a moment.';if(e)e.textContent=t;toast(t)}
$('#home').onclick=e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
 if(d.s){if(hs.step==='lanw'||hs.step==='lanwj')lanClose();renderHome(d.s)}
 else if(d.k){hs[d.k]=d.v;b.parentNode.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b))}
 else if(d.h==='startbot')startGame({mode:'bot',color:hs.color,lv:hs.lv,tc:+hs.tc});
 else if(d.h==='starthum')startGame({mode:'2p',color:'w',tc:+hs.tc});
 else if(d.h==='set')settings();else if(d.h==='resume')closeHome(true);
 else if(d.h==='create'){lan={color:hs.color==='r'?(Math.random()<.5?'w':'b'):hs.color,tc:+hs.tc};lanClose();wsConnect(w=>w?w.send(JSON.stringify({t:'create'})):lanFail())}
 else if(d.h==='join'){const c=($('#code').value||'').trim();if(c.length<4)return($('#lerr').textContent='Enter the full 4-digit code.');lanClose();wsConnect(w=>w?w.send(JSON.stringify({t:'join',room:c})):lanFail())}
 else if(d.h==='cancel'){lanClose();renderHome('lan')}};
$('#home').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='code')$('#home [data-h=join]').click()});

/* ======================= UI: settings ======================= */
function settings(){const tg=(k,l)=>`<div class=row><span>${l}</span><label class=tg><input type=checkbox data-c=${k} ${CFG[k]?'checked':''}><i></i></label></div>`;
 dlg(`<h2>Settings</h2><div class=lb>Board colors</div><div class=sw>${TH.map((t,i)=>`<button data-th=${i} class="${i==CFG.th?'on':''}" style="--a:${t[0]};--b:${t[1]}"><i></i>${t[2]}</button>`).join('')}</div>
 ${tg('snd','Sound')}<div class=row><span>Volume</span><input type=range min=0 max=100 value=${Math.round(CFG.vol*100)} data-c=vol></div>${tg('anim','Motion effects')}${tg('coords','Show coordinates')}
 <div class=sg><button class=pb data-a=x>Done</button></div>`)}
$('#box').onclick=e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
 if(d.th!==undefined){CFG.th=+d.th;save();b.parentNode.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));req()}
 else if(d.a==='new'){closeDlg();openHome('main')}else if(d.a==='x')closeDlg();else if(d.a==='res'){closeDlg();resign()}};
$('#box').oninput=e=>{const c=e.target.dataset.c;if(!c)return;if(c==='vol')CFG.vol=e.target.value/100;else CFG[c]=e.target.checked;if(c==='snd')updSnd();save();req()};
$('#box').onchange=e=>{if(e.target.dataset.c==='vol')play('move-self')};

/* ======================= VIEW & INPUT ======================= */
const w2s=(x,y)=>{const f=flip?-1:1;return[W/2+f*(x-Vw.cx)*Vw.s,H_/2-f*(y-Vw.cy)*Vw.s]},s2w=(px,py)=>{const f=flip?-1:1;return[Vw.cx+f*(px-W/2)/Vw.s,Vw.cy-f*(py-H_/2)/Vw.s]};
const rect=(x,y)=>{const a=w2s(x,y),b=w2s(x+1,y+1);return[Math.min(a[0],b[0]),Math.min(a[1],b[1])]};
let rq=0;const req=()=>{if(!rq)rq=requestAnimationFrame(t=>{rq=0;if(draw(t))req()})};
function fit(){const d=devicePixelRatio||1;W=innerWidth;H_=innerHeight;cv.width=W*d;cv.height=H_*d;g.setTransform(d,0,0,d,0,0);Vw.s=Math.max(30,Math.min(84,Math.min(W-16,H_-150)/8.6));draw(performance.now())}
addEventListener('resize',fit);
function fly(x,y){const sx=Vw.cx,sy=Vw.cy,t0=performance.now();(function st(t){const e=ez(Math.min(1,(t-t0)/450));Vw.cx=sx+(x-sx)*e;Vw.cy=sy+(y-sy)*e;req();if(e<1)requestAnimationFrame(st)})(t0)}
let drag=null,pan=null,pinch=null,down=null,moved=0,wasSel=false;const ptr=new Map();
const select=p=>{sel=p;selT=performance.now()};
cv.onpointerdown=e=>{drawer(false);cv.setPointerCapture(e.pointerId);ptr.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(ptr.size===2){drag=pan=null;const[a,b]=[...ptr.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y),s:Vw.s};return}
 for(const k of ind)if(Math.hypot(e.clientX-k.x,e.clientY-k.y)<22){fly(k.p.x+.5,k.p.y+.5);return}
 const[wx,wy]=s2w(e.clientX,e.clientY),x=Math.floor(wx),y=Math.floor(wy),p=P.get(x,y);moved=0;down={x:e.clientX,y:e.clientY};wasSel=false;
 if(!NA())rips.push({x,y,t0:performance.now()});
 if(p&&canPlay(p)){wasSel=sel===p;if(!wasSel)select(p);drag={p,px:e.clientX,py:e.clientY};cv.style.cursor='grabbing'}else pan={x:e.clientX,y:e.clientY,cx:Vw.cx,cy:Vw.cy};req()};
cv.onpointermove=e=>{if(ptr.has(e.pointerId))ptr.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(pinch&&ptr.size===2){const[a,b]=[...ptr.values()];Vw.s=Math.max(14,Math.min(140,pinch.s*Math.hypot(a.x-b.x,a.y-b.y)/pinch.d));req();return}
 if(!down)return;moved=Math.max(moved,Math.hypot(e.clientX-down.x,e.clientY-down.y));
 if(drag){drag.px=e.clientX;drag.py=e.clientY}else if(pan&&moved>3){const f=flip?-1:1;Vw.cx=pan.cx-f*(e.clientX-pan.x)/Vw.s;Vw.cy=pan.cy+f*(e.clientY-pan.y)/Vw.s}req()};
cv.onpointerup=cv.onpointercancel=e=>{ptr.delete(e.pointerId);if(pinch){if(ptr.size<2)pinch=null;down=null;return}if(!down)return;cv.style.cursor='grab';
 const[wx,wy]=s2w(e.clientX,e.clientY),x=Math.floor(wx),y=Math.floor(wy);
 if(drag){const p=drag.p;drag=null;if(moved>8)tryMove(p,x,y,true);else if(wasSel)sel=null}
 else if(pan){if(moved<6){if(sel)tryMove(sel,x,y,false);sel=null}pan=null}
 down=null;req()};
cv.onwheel=e=>{e.preventDefault();const b=s2w(e.clientX,e.clientY);Vw.s=Math.max(14,Math.min(140,Vw.s*Math.exp(-e.deltaY*.0015)));const a=s2w(e.clientX,e.clientY);Vw.cx+=b[0]-a[0];Vw.cy+=b[1]-a[1];req()};
addEventListener('keydown',e=>{if(e.key==='Escape'){if($('#dlg').classList.contains('open'))closeDlg();else if($('#dr').classList.contains('open'))drawer(false);else if(homeOn&&hasGame())closeHome(true);else sel=null;req()}});
function draw(now){if(!P)return false;if(homeOn&&saveV){const t=now/1000;Vw.s=Math.max(saveV.s,60)*1.1;Vw.cx=saveV.cx+Math.sin(t*.13)*2.6;Vw.cy=saveV.cy+Math.cos(t*.1)*1.8}
 const s=Vw.s;let busy=homeOn;const[LT,DK]=TH[CFG.th];
 const c1=s2w(0,0),c2=s2w(W,H_),x0=Math.floor(Math.min(c1[0],c2[0])),x1=Math.ceil(Math.max(c1[0],c2[0])),y0=Math.floor(Math.min(c1[1],c2[1])),y1=Math.ceil(Math.max(c1[1],c2[1]));
 g.fillStyle='#11171a';g.fillRect(0,0,W,H_);
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const[rx,ry]=rect(x,y);g.fillStyle=(x+y)&1?LT:DK;g.fillRect(rx,ry,s+.7,s+.7)}
 const hl=(x,y,col)=>{const[rx,ry]=rect(x,y);g.fillStyle=col;g.fillRect(rx,ry,s,s)};
 if(last){hl(last.fx,last.fy,'rgba(255,214,64,.42)');hl(last.tx,last.ty,'rgba(255,214,64,.5)')}
 if(sel){const e=Math.min(1,(now-selT)/160);if(e<1)busy=true;hl(sel.x,sel.y,`rgba(255,214,64,${.62*ez(e)})`)}
 if(s>=30&&CFG.coords){g.font='700 11px "Bricolage Grotesque",system-ui';const yb=Math.floor(s2w(0,H_-1)[1]),xl=Math.floor(s2w(1,0)[0]);g.textAlign='right';
  for(let x=x0;x<=x1;x++){const[rx,ry]=rect(x,yb);g.fillStyle=(x+yb)&1?DK:LT;g.fillText(fl(x),rx+s-4,ry+s-5)}g.textAlign='left';
  for(let y=y0;y<=y1;y++){const[rx,ry]=rect(xl,y);g.fillStyle=(xl+y)&1?DK:LT;g.fillText(y+1,rx+4,ry+13)}}
 if(chk.length&&!over){const k=P.k[P.turn],[rx,ry]=rect(k.x,k.y),cx=rx+s/2,cy=ry+s/2,e=Math.min(1,Math.max(0,(now-chkT)/300));if(e<1)busy=true;
  g.fillStyle=`rgba(229,57,64,${.88*ez(e)})`;g.fillRect(rx,ry,s,s);const gr=g.createRadialGradient(cx,cy,0,cx,cy,s*.7);gr.addColorStop(0,'rgba(255,40,40,.95)');gr.addColorStop(1,'rgba(200,0,0,0)');g.fillStyle=gr;g.fillRect(rx,ry,s,s);
  const t=(now-chkT)/900;if(t>=0&&t<1){busy=true;g.strokeStyle=`rgba(255,70,70,${.85*(1-t)})`;g.lineWidth=3;g.beginPath();g.arc(cx,cy,s*(.5+t*1.3),0,7);g.stroke()}
  g.strokeStyle='rgba(229,57,64,.75)';g.lineWidth=3;g.setLineDash([8,6]);for(const q of chk){const[qx,qy]=w2s(q.x+.5,q.y+.5);g.beginPath();g.moveTo(qx,qy);g.lineTo(cx,cy);g.stroke()}g.setLineDash([])}
 if(sel&&!over){const cap=Math.ceil(Math.max(W,H_)/s*1.5)+Math.max(Math.abs(sel.x-Vw.cx),Math.abs(sel.y-Vw.cy))+4;
  for(const m of gen(P,sel.c,cap,false,sel)){const[rx,ry]=rect(m.tx,m.ty),cx=rx+s/2,cy=ry+s/2;if(cx<-s||cy<-s||cx>W+s||cy>H_+s)continue;
   const dl=Math.min(140,Math.max(Math.abs(m.tx-sel.x),Math.abs(m.ty-sel.y))*14),t=Math.max(0,Math.min(1,(now-selT-dl)/180));if(t<1)busy=true;const k=NA()?1:eb(t);
   g.beginPath();if(m.cap){g.strokeStyle='rgba(0,0,0,.28)';g.lineWidth=s*.09;g.arc(cx,cy,s*.46*k,0,7);g.stroke()}else{g.fillStyle='rgba(0,0,0,.22)';g.arc(cx,cy,s*.17*k,0,7);g.fill()}}}
 const dp=(c,t,wx,wy,k,al)=>{const[rx,ry]=rect(wx,wy);g.globalAlpha=al;g.drawImage(IM[c+t],rx-s*(k-1)/2,ry-s*(k-1)/2,s*k,s*k);g.globalAlpha=1};
 for(const q of caps){const t=(now-q.t0)/260;if(t<0){dp(q.c,q.t,q.x,q.y,1,1);busy=true}else if(t<1){busy=true;dp(q.c,q.t,q.x,q.y,1-.5*ez(t),1-ez(t))}}caps=caps.filter(q=>now-q.t0<260);
 const mv=[];for(const p of P.m.values()){if(p.x<x0-1||p.x>x1||p.y<y0-1||p.y>y1)continue;
  if(p.an&&now-p.an.t0<p.an.d){mv.push(p);busy=true;continue}p.an=null;
  let k=1,wx=p.x,wy=p.y;if(p===sel){const e=Math.min(1,(now-selT)/180);k=1+.1*eb(e)}
  if(shake&&shake.p===p){const t=(now-shake.t0)/350;if(t<1){wx+=Math.sin(t*Math.PI*7)*.09*(1-t);busy=true}else shake=null}
  dp(p.c,p.t,wx,wy,k,drag&&drag.p===p&&moved>8?.3:1)}
 for(const p of mv){const e=ez((now-p.an.t0)/p.an.d);dp(p.c,p.t,p.an.fx+(p.x-p.an.fx)*e,p.an.fy+(p.y-p.an.fy)*e,1.06,1)}
 for(const r of rips){const t=(now-r.t0)/480;if(t<1){busy=true;const[rx,ry]=rect(r.x,r.y);g.strokeStyle=`rgba(255,255,255,${.55*(1-t)})`;g.lineWidth=2.5;g.beginPath();g.arc(rx+s/2,ry+s/2,s*(.15+.45*ez(t)),0,7);g.stroke()}}rips=rips.filter(r=>now-r.t0<480);
 if(drag&&moved>8){const z=s*1.18;g.drawImage(IM[drag.p.c+drag.p.t],drag.px-z/2,drag.py-z/2-s*.1,z,z)}
 {const vg=g.createRadialGradient(W/2,H_/2,Math.min(W,H_)*.35,W/2,H_/2,Math.hypot(W,H_)*.6);vg.addColorStop(0,'rgba(8,14,18,0)');vg.addColorStop(1,'rgba(8,14,18,.36)');g.fillStyle=vg;g.fillRect(0,0,W,H_)}
 ind=[];if(!homeOn)for(const c of'wb'){const k=P.k[c],[kx,ky]=w2s(k.x+.5,k.y+.5);if(kx>-s&&kx<W+s&&ky>-s&&ky<H_+s)continue;
  const dx=kx-W/2,dy=ky-H_/2,t=Math.min((W/2-34)/Math.abs(dx||1e-9),(H_/2-34)/Math.abs(dy||1e-9)),ex=W/2+dx*t,ey=H_/2+dy*t,ic=chk.length&&P.turn===c&&!over;
  g.beginPath();g.arc(ex,ey,21,0,7);g.fillStyle=ic?'#e5393f':'rgba(20,27,31,.9)';g.fill();g.strokeStyle='rgba(255,255,255,.85)';g.lineWidth=2;g.stroke();g.drawImage(IM[c+'k'],ex-16,ey-16,32,32);ind.push({x:ex,y:ey,p:k})}
 return busy||!!drag}
sfInit();newGame({mode:'2p',color:'w',lv:1});openHome('main');
