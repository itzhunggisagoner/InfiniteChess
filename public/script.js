/* Infinite Chess — script.js
   1) config + sound   2) rules engine & built-in bot   3) Stockfish   4) game, clock, online rooms   5) UI   6) board rendering */
const $=s=>document.querySelector(s),cv=$('#cv'),g=cv.getContext('2d');
const R='resources/',PN={k:'king',q:'queen',r:'rook',b:'bishop',n:'knight',p:'pawn'};

/* ======================= CONFIG & SOUND ======================= */
const CFG={th:0,snd:true,vol:.8,coords:true,anim:true};
try{Object.assign(CFG,JSON.parse(localStorage.getItem('icfg')||'{}'))}catch(e){}
const save=()=>{try{localStorage.setItem('icfg',JSON.stringify(CFG))}catch(e){}};
const IM={};for(const c of'wb')for(const t of'kqrbnp'){const im=new Image();im.onload=()=>req();im.src=`${R}pieces/${c==='w'?'white':'black'}_${PN[t]}.png`;IM[c+t]=im}
const SN=['capture','castle','illegal','move-check','move-opponent','move-self','tensecondsremain','game-start','game-end'];
let AC=null,ai=0;const AB={},AE={};
function audioInit(){if(ai)return;ai=1;try{AC=new(window.AudioContext||window.webkitAudioContext)()}catch(e){AC=null}
 for(const k of SN){const u=`${R}sounds/${k}.mp3`,a=new Audio(u);a.preload='auto';AE[k]=a;if(AC)fetch(u).then(r=>r.arrayBuffer()).then(b=>AC.decodeAudioData(b)).then(b=>AB[k]=b).catch(()=>{})}}
addEventListener('pointerdown',audioInit,true);addEventListener('keydown',audioInit,true);
function play(n){if(!CFG.snd)return;audioInit();if(AC&&AC.state==='suspended')AC.resume();
 if(AC&&AB[n]){const s2=AC.createBufferSource(),g2=AC.createGain();s2.buffer=AB[n];g2.gain.value=CFG.vol;s2.connect(g2).connect(AC.destination);s2.start()}
 else if(AE[n]){const a=AE[n].cloneNode();a.volume=CFG.vol;a.play().catch(()=>{})}}

/* ======================= ENGINE: see engine.js (rules + built-in bot, also runs in a Web Worker) ======================= */

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
  SF.onmessage=e=>{const l=typeof e.data==='string'?e.data:'';if(l==='uciok')SF.postMessage('isready');else if(l==='readyok'){if(!sfReady){SF.postMessage('setoption name Threads value 1');SF.postMessage('setoption name Hash value 16')}sfReady=true;stt()}
   else if(l.startsWith('bestmove')){sfPend--;if(!sfPend&&sfCb)sfCb(l.split(' ')[1])}};
  SF.onerror=sfDie;SF.postMessage('uci')}catch(e){sfDie()}}
const fits=P=>{for(const p of P.m.values())if(p.x<0||p.x>7||p.y<0||p.y>7||p.t==='p'&&(p.y===0||p.y===7))return false;return true};
function fen(P){let s='';for(let y=7;y>=0;y--){let e=0;for(let x=0;x<8;x++){const p=P.get(x,y);if(!p)e++;else{if(e){s+=e;e=0}s+=p.c==='w'?p.t.toUpperCase():p.t}}if(e)s+=e;if(y)s+='/'}
 const ck=(c,y)=>{const k=P.k[c],a=P.get(7,y),b=P.get(0,y),o=!k.moved&&k.x===4&&k.y===y;return[o&&a&&a.t==='r'&&a.c===c&&!a.moved,o&&b&&b.t==='r'&&b.c===c&&!b.moved]},w=ck('w',0),b=ck('b',7);
 const cr=(w[0]?'K':'')+(w[1]?'Q':'')+(b[0]?'k':'')+(b[1]?'q':'')||'-',ep=P.ep&&P.ep.x>=0&&P.ep.x<8&&P.ep.y>=0&&P.ep.y<8?sqn(P.ep.x,P.ep.y):'-';
 return`${s} ${P.turn} ${cr} ${ep} ${P.hm} 1`}
function sfThink(P,c,lv){return new Promise(res=>{const mp=new Map();
 for(const m of gen(P,c,7)){if(m.tx<0||m.tx>7||m.ty<0||m.ty>7||m.p.t==='p'&&(m.ty===7||m.ty===0))continue;mp.set(sqn(m.fx,m.fy)+sqn(m.tx,m.ty),m)}
 if(!mp.size)return res(null);const L=LV[lv];let done=0;
 const fin=m=>{if(!done){done=1;clearTimeout(tm);sfCb=null;res(m)}},tm=setTimeout(()=>{SF.postMessage('stop');fin(null)},L.ms+7000);sfCb=b=>fin(mp.get(b)||null);
 SF.postMessage('setoption name UCI_LimitStrength value '+(L.elo?'true':'false'));if(L.elo)SF.postMessage('setoption name UCI_Elo value '+L.elo);
 SF.postMessage('position fen '+fen(P));sfPend++;SF.postMessage(`go movetime ${L.ms} searchmoves ${[...mp.keys()].join(' ')}`)})}
const sfAbort=()=>{intAbort();if(SF&&sfCb){sfCb=null;SF.postMessage('stop')}};
let IW=null,iwId=0;
function intAbort(){if(IW){try{IW.terminate()}catch(e){}IW=null}}
function intThink(P,c,lv){let w=IW;if(!w&&globalThis.Worker){try{w=IW=new Worker('engine.js')}catch(e){w=IW=null}}
 if(!w)return new Promise(r=>setTimeout(()=>r(think(P,c,Math.min(lv,1))),80));
 return new Promise(res=>{const id=++iwId,ws=w;
  ws.onmessage=e=>{if(e.data.id!==id)return;const d=e.data.m,p=d&&P.get(d.fx,d.fy),m=p&&pm(P,p,d.tx,d.ty);res(m&&legal(P,m)?m:null)};
  ws.onerror=()=>{if(IW===ws)intAbort();res(think(P,c,Math.min(lv,1)))};
  ws.postMessage({id,lv,vr:VR,turn:P.turn,ep:P.ep,hm:P.hm,pcs:[...P.m.values()].map(q=>({t:q.t,c:q.c,x:q.x,y:q.y,mv:q.moved}))})})}

/* ======================= GAME STATE ======================= */
const fl=x=>x>=0&&x<8?'abcdefgh'[x]:`(${x+1})`,sq=(x,y)=>fl(x)+(y+1),RM0=matchMedia('(prefers-reduced-motion:reduce)').matches,ez=t=>1-Math.pow(1-t,3),eb=t=>{const c=1.9;return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2)};
const TH=[['#ebecd0','#739552','Green'],['#f0d9b5','#b58863','Wood'],['#dfe5e8','#7f97a6','Slate'],['#f3e3e0','#c98a8a','Rose'],['#e9e4f1','#8672a8','Purple'],['#b8c0c8','#46525e','Night']],
 NA=()=>RM0||!CFG.anim,LVN=[['Easy','Elo 1350'],['Medium','Elo 1900'],['Hard','Elo 2500'],['Max','Strongest']],TCS=[[0,'No limit'],[60,'1 min'],[180,'3 min'],[300,'5 min'],[600,'10 min'],['c','Custom']],
 VRS=[['std','Standard','Classic rules'],['koth','King of the Hill','King to the center'],['chk3','Three-check','Give 3 checks'],['tq','Triple Queens','Bishops become queens'],['960','Chess960','Shuffled back rank'],['atomic','Atomic','Captures explode'],['anti','Antichess','Lose all your pieces'],['rk','Racing Kings','Race to the 8th rank']],VN=Object.fromEntries(VRS.map(v=>[v[0],v[1]]));
let P,H=[],mode='2p',me='w',lv=1,over=null,sel=null,flip=false,thinking=false,last=null,chk=[],gid=0,W,H_,ind=[],engUsed='',sfNote=false;
let layN=0,booms=[],selT=0,chkT=0,caps=[],rips=[],bad=[],shake=null,clk=null,warned={w:0,b:0};const Vw={cx:4,cy:4,s:60};
function san(mv){const p=mv.p;if(mv.rk)return mv.tx>mv.fx?'O-O':'O-O-O';let s='';
 if(p.t!=='p'){s=p.t.toUpperCase();const am=[...P.m.values()].filter(q=>q!==p&&q.c===p.c&&q.t===p.t&&(m=>m&&legal(P,m))(pm(P,q,mv.tx,mv.ty)));
  if(am.length)s+=am.some(q=>q.x===p.x)?(am.some(q=>q.y===p.y)?sq(p.x,p.y):p.y+1):fl(p.x)}else if(mv.cap)s=fl(p.x);
 return s+(mv.cap?'x':'')+sq(mv.tx,mv.ty)+(VR==='atomic'&&mv.cap?'*':'')}
function newGame(o){gid++;sfAbort();H=[];over=null;sel=null;last=null;thinking=false;caps=[];mode=o.mode;lv=+o.lv||0;engUsed='';VR=VN[o.vr]?o.vr:'std';booms=[];layN=VR==='960'?(Number.isInteger(o.lay)&&o.lay>=0&&o.lay<960?o.lay:Math.random()*960|0):0;P=setup(VR,b960(layN));
 me=o.color==='r'?(Math.random()<.5?'w':'b'):o.color;flip=mode!=='2p'&&me==='b';Vw.cx=4;Vw.cy=4;
 const tcs=Math.max(0,Math.min(10800,+o.tc||0));clk=tcs?{w:tcs*1000,b:tcs*1000,last:performance.now()}:null;warned={w:0,b:0};fit();refresh();
 if(VR==='960')toast('Chess960: castle by dragging your king onto your rook');if(VR==='anti')toast('Antichess: captures are mandatory');
 if(mode==='bot'&&!sfReady&&!sfNote){sfNote=true;if(sfFail)toast('Stockfish can\'t run in this browser — using the built-in engine.')}}
function doMove(mv,anim,remote){tickClock();const now=performance.now(),d=anim&&!NA()?240:0;let s=san(mv);const mover=P.turn;
 if(mode==='lan'&&!remote&&WS)WS.send(JSON.stringify({t:'move',fx:mv.fx,fy:mv.fy,tx:mv.tx,ty:mv.ty}));
 if(mv.cap)caps.push({c:mv.cap.c,t:mv.cap.t,x:mv.cap.x,y:mv.cap.y,t0:now+d*.6});
 const u=make(P,mv);if(u.ex){booms.push({x:mv.tx,y:mv.ty,t0:now+d*.6});for(const q of u.ex)caps.push({c:q.c,t:q.t,x:q.x,y:q.y,t0:now+d*.6});caps.push({c:mv.p.c,t:mv.p.t,x:mv.tx,y:mv.ty,t0:now+d*.6})}
 mv.p.an={fx:mv.fx,fy:mv.fy,t0:now,d};if(mv.rk)mv.rk.an={fx:mv.rfx,fy:mv.fy,t0:now,d};
 if(clk)clk.last=now;
 const ck=inCheck(P,P.turn),has=gen(P,P.turn,3).length>0;if(ck){s+=has?'+':'#';chkT=now+d}
 H.push({u,s});last=mv;sel=null;
 const opp_=(mode==='bot'||mode==='lan')&&mover!==me;
 setTimeout(()=>play(ck?'move-check':mv.rk?'castle':mv.cap?'capture':opp_?'move-opponent':'move-self'),d*.7);
 over=endChk(mover,mv,ck,has);
 refresh(!!over)}
function endChk(mover,mv,ck,has){const sd=P.turn,o=[...P.m.values()].filter(p=>p.t!=='k');
 if(VR==='koth'&&inHill(mv.p.t==='k'?mv.p:P.k[mover]))return{w:mover,r:'King of the Hill!'};
 if(VR==='chk3'&&ck&&chks(mover)>=3)return{w:mover,r:'Third check!'};
 if(VR==='atomic'&&!kg(P,sd))return{w:mover,r:'King exploded!'};
 if(VR==='anti'&&!has)return{w:sd,r:[...P.m.values()].some(p=>p.c===sd)?'Stalemate — a win in Antichess':'No pieces left!'};
 if(VR==='rk'){const wr=P.k.w.y===7,br=P.k.b.y===7;
  if(mover==='b'&&(wr||br))return wr&&br?{w:null,r:'Both kings made it — draw'}:{w:wr?'w':'b',r:'Race won!'};
  if(mover==='w'&&wr&&!gen(P,'b',2,false,P.k.b).some(m=>m.ty===7))return{w:'w',r:'Race won!'}}
 if(!has)return ck?{w:mover,r:'Checkmate!'}:{w:null,r:'Stalemate — draw'};
 if(P.hm>=100)return{w:null,r:'Draw (50-move rule)'};
 if(VR==='koth'||VR==='atomic'||VR==='anti'||VR==='rk'?0:VR==='chk3'?!o.length:(!o.length||o.length===1&&'nb'.includes(o[0].t)))return{w:null,r:'Draw (insufficient material)'};
 return null}
const nm=c=>c==='w'?'White':'Black',chks=c=>H.filter((h,i)=>i%2===(c==='w'?0:1)&&/[+#]$/.test(h.s)).length;
function stt(){const st=$('#st');if(!P)return;st.classList.toggle('ck',!!chk.length&&!over);st.classList.toggle('th',thinking);
 $('#stt').textContent=over?over.r+(over.w?' — '+nm(over.w)+' wins':''):thinking?'Engine is thinking…':(mode==='lan'?(P.turn===me?'Your move':'Opponent\'s move'):nm(P.turn)+' to move')+(chk.length?' — CHECK!':'');
 if(VR!=='std'&&!over)$('#stt').textContent+=' · '+(VR==='chk3'?`Checks ${chks('w')}/3 – ${chks('b')}/3`:VR==='960'?`Chess960 #${layN}`:VN[VR]);
 $('.tn').style.background=over?'transparent':P.turn==='w'?'#fff':'#222';
 const e=$('#eng');e.textContent=mode!=='bot'?'':engUsed==='sf'?'Stockfish 19':engUsed==='int'||VR!=='std'&&VR!=='tq'?'Built-in engine':sfReady?'Stockfish 19':sfFail?'Built-in engine':'Loading Stockfish…';e.style.display=mode==='bot'?'':'none';drawClock()}
function refresh(matePlayed){chk=[];if(inCheck(P,P.turn)){const k=P.k[P.turn];chk=[...P.m.values()].filter(q=>q.c!==P.turn&&atk(P,q,k.x,k.y))}
 const mv=$('#mvl');mv.innerHTML=H.length?'':'<div class=e>No moves yet.</div>';for(let i=0;i<H.length;i+=2)mv.insertAdjacentHTML('beforeend',`<div class=r><b>${i/2+1}.</b><span>${H[i].s}</span><span>${H[i+1]?H[i+1].s:''}</span></div>`);
 if(mv.lastElementChild&&mv.lastElementChild.className==='r')mv.lastElementChild.className='r n';mv.scrollTop=1e9;stt();req();const id=gid;
 if(over){if(!over.s){over.s=1;const gi=gid;setTimeout(()=>gi===gid&&play('game-end'),matePlayed?650:0)}setTimeout(()=>id===gid&&dlg(`<h2>${over.r}</h2><p>${over.w?(mode==='2p'?nm(over.w):over.w===me?'You':mode==='lan'?'Your opponent':'The engine')+(mode==='2p'||over.w!==me?' wins':' win')+' this game.':'The game ended in a draw.'}</p><div class=sg><button class=pb data-a=new>New game</button><button data-a=x>View board</button></div>`),900);return}
 if(mode==='bot'&&P.turn!==me&&!thinking)botTurn(id)}
async function botTurn(id){thinking=true;stt();let m=null;
 if(sfReady&&fits(P)&&(VR==='std'||VR==='tq')){m=await sfThink(P,P.turn,lv);if(m)engUsed='sf'}
 if(!m){m=await intThink(P,P.turn,Math.min(lv,2));if(id!==gid)return;engUsed='int'}
 if(id!==gid)return;thinking=false;if(m)doMove(m,true);else refresh()}
function nope(p,x,y,msg){play('illegal');bad.push({x,y,t0:performance.now()});if(msg){toast(msg);shake={p,t0:performance.now()}}req()}
function tryMove(p,x,y,byDrag){if(x===p.x&&y===p.y)return;const m=pm(P,p,x,y);if(!m)return nope(p,x,y);
 if(!legal(P,m))return nope(p,x,y,VR==='anti'?'You must capture when you can':VR==='rk'?'Racing Kings: no check — given or received':VR==='atomic'?'Illegal: your king would be in check or exploded':'That move would leave your king in check');doMove(m,!byDrag)}
const canPlay=p=>!over&&!thinking&&p.c===P.turn&&(mode==='2p'||p.c===me);
function undo(){if(!H.length||thinking||over&&mode==='lan')return;if(mode==='lan'||clk)return toast('Undo isn\'t available in online games or with a clock');
 const n=mode==='bot'&&P.turn===me&&H.length>=2?2:1;sfAbort();for(let i=0;i<n;i++)unmake(P,H.pop().u);
 for(const p of P.m.values())p.an=null;caps=[];booms=[];last=H.length?H[H.length-1].u.mv:null;over=null;sel=null;gid++;refresh()}
function resign(){if(over)return;const c=mode==='2p'?P.turn:me;if(mode==='lan'&&WS)WS.send(JSON.stringify({t:'resign'}));over={w:opp(c),r:'Resignation'};refresh()}

/* ======================= CLOCK ======================= */
const fmt=ms=>{ms=Math.max(0,ms);if(ms<10000&&ms>0)return(ms/1000).toFixed(1);const t=Math.ceil(ms/1000),h=Math.floor(t/3600),m=Math.floor(t/60)%60,sc=String(t%60).padStart(2,'0');return h?h+':'+String(m).padStart(2,'0')+':'+sc:Math.floor(t/60)+':'+sc};
function tcSec(){if(hs.tc!=='c')return+hs.tc;const t=Math.min(180,Math.max(0,hs.cm|0))*60+Math.min(59,Math.max(0,hs.cs|0));if(t<1){toast('Enter a time greater than 0:00');return null}return Math.min(t,10800)}
function tickClock(){if(!clk||!P)return;const n=performance.now(),d=n-clk.last;clk.last=n;if(over||homeOn)return;
 clk[P.turn]-=d;const c=P.turn;
 if(clk[c]<=10000&&clk[c]>0&&!warned[c]&&(mode!=='bot'||c===me)){warned[c]=1;play('tensecondsremain')}
 if(clk[c]<=0){clk[c]=0;over={w:opp(c),r:'Time out'};refresh()}drawClock()}
function drawClock(){const e=$('#clk');e.hidden=!clk||homeOn;if(!clk)return;for(const c of'wb'){const b=e.querySelector('.'+c);b.querySelector('b').textContent=fmt(clk[c]);b.classList.toggle('act',!over&&P&&P.turn===c);b.classList.toggle('low',clk[c]<10000)}}
setInterval(tickClock,100);

/* ======================= ONLINE ROOMS ======================= */
let WS=null,hbT=0,lan={color:'w',tc:0,vr:'std',lay:0};
function wsConnect(cb){let done=0;const fin=w=>{if(!done){done=1;cb(w)}};let ws;
 try{ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws')}catch(e){return fin(null)}
 const to=setTimeout(()=>{try{ws.close()}catch(e){}fin(null)},3500);
 ws.onopen=()=>{clearTimeout(to);WS=ws;fin(ws);clearInterval(hbT);hbT=setInterval(()=>{try{ws.readyState===1&&ws.send('{"t":"ping"}')}catch(e){}},20000)};ws.onerror=()=>{clearTimeout(to);fin(null)};
 ws.onmessage=e=>{try{lanMsg(JSON.parse(e.data))}catch(x){}};
 ws.onclose=()=>{clearInterval(hbT);if(WS===ws){WS=null;if(homeOn&&(hs.step==='lanw'||hs.step==='lanwj')){toast('Connection lost');renderHome('lan');return}if(mode==='lan'&&!over&&!homeOn)toast('Connection lost')}}}
function lanMsg(m){
 if(m.t==='created'){hs.code=m.room;renderHome('lanw')}
 else if(m.t==='peer'){WS.send(JSON.stringify({t:'start',color:opp(lan.color),tc:lan.tc,vr:lan.vr,lay:lan.lay}));startGame({mode:'lan',color:lan.color,tc:lan.tc,vr:lan.vr,lay:lan.lay})}
 else if(m.t==='start')startGame({mode:'lan',color:m.color==='b'?'b':'w',tc:+m.tc||0,vr:m.vr,lay:m.lay})
 else if(m.t==='joined')renderHome('lanwj')
 else if(m.t==='err'){const e=$('#lerr');if(e)e.textContent=m.m}
 else if(m.t==='move'&&mode==='lan'&&!over){const p=P.get(m.fx,m.fy),mv=p&&p.c===P.turn&&p.c!==me&&pm(P,p,m.tx,m.ty);if(mv&&legal(P,mv))doMove(mv,true,true)}
 else if(m.t==='resign'&&mode==='lan'&&!over){over={w:me,r:'Opponent resigned'};refresh()}
 else if(m.t==='left'&&homeOn&&(hs.step==='lanw'||hs.step==='lanwj')){lanClose();toast(hs.step==='lanw'?'Your opponent left the room':'The host closed the room');renderHome('lan')}
 else if(m.t==='left'&&mode==='lan'&&!over&&!homeOn){over={w:me,r:'Opponent left the room'};refresh()}}
const lanClose=()=>{clearInterval(hbT);if(WS){const w=WS;WS=null;try{w.close()}catch(e){}}};

/* ======================= UI: toast, dialog, drawer ======================= */
function toast(t){const e=$('#tt');e.textContent=t;e.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('on'),2600)}
function dlg(h){$('#box').innerHTML=h;$('#dlg').classList.add('open');document.body.classList.add('dlgopen')}const closeDlg=()=>{$('#dlg').classList.remove('open');document.body.classList.remove('dlgopen')};
const svg=d=>`<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const GEAR='M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z';
const ACT=[['home','Main menu','M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z',()=>openHome('main')],
 ['undo','Undo','M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',undo],
 ['flip','Flip board','M7 4v14m0 0l-3-3m3 3l3-3M17 20V6m0 0l-3 3m3-3l3 3',()=>{flip=!flip;req()}],
 ['ctr','Center view','M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3',()=>fly(4,4)],
 ['snd','Sound','M11 5L6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 010 7',()=>{CFG.snd=!CFG.snd;save();updSnd();if(CFG.snd)play('move-self')},true],
 ['set','Settings',GEAR,settings],
 ['res','Resign','M5 21V4M5 4h11l-2 4 2 4H5',()=>dlg('<h2>Resign this game?</h2><div class=sg><button class="pb dn" data-a=res>Resign</button><button data-a=x>Cancel</button></div>')]];
$('#dg').innerHTML=ACT.map(a=>`<button class="di${a[0]==='res'?' red':''}" data-k="${a[0]}">${svg(a[2])}<span>${a[1]}</span></button>`).join('');
const updSnd=()=>{const b=$('.di[data-k=snd]');b.classList.toggle('off',!CFG.snd);b.querySelector('span').textContent=CFG.snd?'Sound: On':'Sound: Off'};updSnd();
function drawer(open){const o=open===undefined?!$('#dr').classList.contains('open'):open;$('#dr').classList.toggle('open',o);$('#hb').classList.toggle('open',o);$('#hb').setAttribute('aria-expanded',o)}
$('#hb').onclick=()=>drawer();
$('#dg').onclick=e=>{const b=e.target.closest('.di');if(!b)return;const a=ACT.find(x=>x[0]===b.dataset.k);a[3]();if(!a[4])drawer(false)};

/* ======================= UI: lobby ======================= */
let homeOn=false,saveV=null,hs={color:'w',lv:1,tc:0,code:'',vr:'std',cm:5,cs:0};
const hasGame=()=>H.length>0&&!over,pu=(c,t)=>`${R}pieces/${c==='w'?'white':'black'}_${PN[t]}.png`,pc=(c,t)=>`<img src="${pu(c,t)}" alt="">`;
const back=s=>`<button class=pill data-s="${s}">‹ Back</button>`,
 optRow=(key,arr)=>`<div class="opts${key==='tc'?' w':key==='vr'?' w v':''}">${arr.map(([v,l,x,i])=>`<button class="opt${String(hs[key])===String(v)?' on':''}" data-k="${key}" data-v="${v}">${i||''}<span>${l}</span>${x?`<small>${x}</small>`:''}</button>`).join('')}</div>`,
 colors=()=>optRow('color',[['w','White','',pc('w','k')],['b','Black','',pc('b','k')],['r','Random','',pc('w','q')]]),
 times=()=>`<div class=lb2>Time per side</div>${optRow('tc',TCS)}<div class="cust${hs.tc==='c'?' on':''}" id=cust><input id=cm type=number inputmode=numeric min=0 max=180 value=${hs.cm} aria-label=Minutes><b>:</b><input id=cs type=number inputmode=numeric min=0 max=59 value=${String(hs.cs).padStart(2,'0')} aria-label=Seconds><small>min : sec</small></div>`,
 vrs=()=>`<div class=lb2>Variant</div>${optRow('vr',VRS)}`,
 tile=(h,a,b,t,d)=>`<button class=tile data-s="${h}"><span class=pcs>${pc(a[0],a[1])}${pc(b[0],b[1])}</span><span class=tx><b>${t}</b><span>${d}</span></span></button>`;
function renderHome(step){const h=$('#hin');let x='';hs.step=step;
 if(step==='main')x=`<img class=hl src="${R}images/logo-white.png" alt="Infinite Chess"><p class=tag>Chess on an endless board.</p>
  <div class=tiles>${tile('bot',['b','n'],['w','k'],'Play the engine','Stockfish 19 + built-in engine')}${tile('hum',['w','p'],['b','p'],'Play 2 Players','Same device')}${tile('lan',['w','r'],['b','r'],'Play online','Two players, two devices')}</div>
  <div class=sub>${hasGame()?'<button class=pill data-h=resume>Resume current game</button>':''}<button class=pill data-h=set>Settings</button></div>`;
 else if(step==='bot')x=`${back('main')}<h2>Play the engine</h2><div class=lb2>You play as</div>${colors()}<div class=lb2>Difficulty</div>${optRow('lv',LVN.map(([l,e],i)=>[i,l,e]))}${vrs()}${times()}<button class=go data-h=startbot>Start game</button>`;
 else if(step==='hum')x=`${back('main')}<h2>Play a friend</h2>${vrs()}${times()}<button class=go data-h=starthum>Start game</button>`;
 else if(step==='lan')x=`${back('main')}<h2>Play online</h2><p class=tag>Create a room and share the 4-digit code with a friend — or enter their code to join.</p>
  <div class="tiles two">${tile('lanc',['w','k'],['b','k'],'Create room','Get a 4-digit code')}${tile('lanj',['w','n'],['b','n'],'Join room','Enter a friend\'s code')}</div>`;
 else if(step==='lanc')x=`${back('lan')}<h2>Create room</h2><div class=lb2>You play as</div>${colors()}${vrs()}${times()}<button class=go data-h=create>Create room</button><p class=err id=lerr></p>`;
 else if(step==='lanw')x=`<h2>Your room code</h2><div class=code>${hs.code}</div><p class=tag>Your friend opens <b>${location.origin}</b>, picks Play online → Join room and enters this code.</p><p class=tag><i class=sp></i>Waiting for opponent…</p><button class=pill data-h=cancel>Cancel room</button>`;
 else if(step==='lanwj')x=`<h2>Joined the room</h2><p class=tag><i class=sp></i>Waiting for the host to start the game…</p><button class=pill data-h=cancel>Leave room</button>`;
 else if(step==='lanj')x=`${back('lan')}<h2>Join room</h2><input class=ci id=code inputmode=numeric maxlength=4 placeholder="0000" autocomplete=off><button class=go data-h=join>Join room</button><p class=err id=lerr></p>`;
 h.className='';h.innerHTML=x;void h.offsetWidth;h.className='in';$('#home').scrollTop=0}
function openHome(step){if(!homeOn)saveV={cx:Vw.cx,cy:Vw.cy,s:Vw.s};homeOn=true;document.body.classList.add('lobby');drawer(false);$('#home').classList.add('open');renderHome(step||'main');drawClock();req()}
function closeHome(restore){homeOn=false;document.body.classList.remove('lobby');$('#home').classList.remove('open');if(restore&&saveV)Object.assign(Vw,saveV);if(clk)clk.last=performance.now();drawClock();req()}
function startGame(o){closeDlg();closeHome(false);if(o.mode!=='lan')lanClose();newGame(o);play('game-start')}
function lanFail(){const e=$('#lerr');const t='Couldn\'t reach the game server. Please try again in a moment.';if(e)e.textContent=t;toast(t)}
$('#home').onclick=e=>{const b=e.target.closest('button');if(!b)return;const d=b.dataset;
 if(d.s){if(hs.step==='lanw'||hs.step==='lanwj')lanClose();renderHome(d.s)}
 else if(d.k){hs[d.k]=d.v;b.parentNode.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));if(d.k==='tc'){const c=$('#cust');c&&c.classList.toggle('on',d.v==='c')}}
 else if(d.h==='startbot'){const tc=tcSec();if(tc!==null)startGame({mode:'bot',color:hs.color,lv:hs.lv,tc,vr:hs.vr})}
 else if(d.h==='starthum'){const tc=tcSec();if(tc!==null)startGame({mode:'2p',color:'w',tc,vr:hs.vr})}
 else if(d.h==='set')settings();else if(d.h==='resume')closeHome(true);
 else if(d.h==='create'){const tc=tcSec();if(tc===null)return;lan={color:hs.color==='r'?(Math.random()<.5?'w':'b'):hs.color,tc,vr:hs.vr,lay:hs.vr==='960'?Math.random()*960|0:0};lanClose();wsConnect(w=>w?w.send(JSON.stringify({t:'create'})):lanFail())}
 else if(d.h==='join'){const c=($('#code').value||'').trim();if(c.length<4)return($('#lerr').textContent='Enter the full 4-digit code.');lanClose();wsConnect(w=>w?w.send(JSON.stringify({t:'join',room:c})):lanFail())}
 else if(d.h==='cancel'){lanClose();renderHome('lan')}};
$('#home').addEventListener('input',e=>{const i=e.target.id;if(i==='cm')hs.cm=Math.min(180,Math.max(0,parseInt(e.target.value)||0));else if(i==='cs')hs.cs=Math.min(59,Math.max(0,parseInt(e.target.value)||0))});
$('#home').addEventListener('focusout',e=>{const i=e.target.id;if(i==='cm')e.target.value=hs.cm;else if(i==='cs')e.target.value=String(hs.cs).padStart(2,'0')});
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
let mc=null;function selMoves(cap){cap=Math.ceil(cap/16)*16;if(!mc||mc.p!==sel||mc.n!==H.length||mc.g!==gid||mc.cap<cap)mc={p:sel,n:H.length,g:gid,cap,L:gen(P,sel.c,cap,false,sel)};return mc.L}
cv.onpointerdown=e=>{drawer(false);cv.setPointerCapture(e.pointerId);ptr.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(ptr.size===2){drag=pan=null;const[a,b]=[...ptr.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y),s:Vw.s};return}
 for(const k of ind)if(Math.hypot(e.clientX-k.x,e.clientY-k.y)<22){fly(k.p.x+.5,k.p.y+.5);return}
 const[wx,wy]=s2w(e.clientX,e.clientY),x=Math.floor(wx),y=Math.floor(wy),p=P.get(x,y);
 moved=0;down={x:e.clientX,y:e.clientY};wasSel=false;
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
 if(VR==='rk')for(let x=x0;x<=x1;x++)hl(x,7,'rgba(255,196,0,.2)');
 if(VR==='koth')for(const[hx,hy]of[[3,3],[4,3],[3,4],[4,4]])hl(hx,hy,'rgba(255,196,0,.22)');
 if(last){hl(last.fx,last.fy,'rgba(255,214,64,.42)');hl(last.tx,last.ty,'rgba(255,214,64,.5)')}
 if(sel){const e=Math.min(1,(now-selT)/160);if(e<1)busy=true;hl(sel.x,sel.y,`rgba(255,214,64,${.62*ez(e)})`)}
 for(const b of bad){const t=(now-b.t0)/520;if(t<1){busy=true;const k=t<.5?1:2*(1-t),[rx,ry]=rect(b.x,b.y);g.fillStyle=`rgba(229,57,64,${.78*k*(.6+.4*Math.abs(Math.cos(t*Math.PI*3)))})`;g.fillRect(rx,ry,s,s)}}bad=bad.filter(b=>now-b.t0<520);
 if(s>=30&&CFG.coords){g.font='700 11px "Bricolage Grotesque",system-ui';const yb=Math.floor(s2w(0,H_-1)[1]),xl=Math.floor(s2w(1,0)[0]);g.textAlign='right';
  for(let x=x0;x<=x1;x++){const[rx,ry]=rect(x,yb);g.fillStyle=(x+yb)&1?DK:LT;g.fillText(fl(x),rx+s-4,ry+s-5)}g.textAlign='left';
  for(let y=y0;y<=y1;y++){const[rx,ry]=rect(xl,y);g.fillStyle=(xl+y)&1?DK:LT;g.fillText(y+1,rx+4,ry+13)}}
 if(chk.length&&!over){const k=P.k[P.turn],[rx,ry]=rect(k.x,k.y),cx=rx+s/2,cy=ry+s/2,e=Math.min(1,Math.max(0,(now-chkT)/300));if(e<1)busy=true;
  g.fillStyle=`rgba(229,57,64,${.88*ez(e)})`;g.fillRect(rx,ry,s,s);const gr=g.createRadialGradient(cx,cy,0,cx,cy,s*.7);gr.addColorStop(0,'rgba(255,40,40,.95)');gr.addColorStop(1,'rgba(200,0,0,0)');g.fillStyle=gr;g.fillRect(rx,ry,s,s);
  const t=(now-chkT)/900;if(t>=0&&t<1){busy=true;g.strokeStyle=`rgba(255,70,70,${.85*(1-t)})`;g.lineWidth=3;g.beginPath();g.arc(cx,cy,s*(.5+t*1.3),0,7);g.stroke()}
  g.strokeStyle='rgba(229,57,64,.75)';g.lineWidth=3;g.setLineDash([8,6]);for(const q of chk){const[qx,qy]=w2s(q.x+.5,q.y+.5);g.beginPath();g.moveTo(qx,qy);g.lineTo(cx,cy);g.stroke()}g.setLineDash([])}
 if(sel&&!over){const cap=Math.ceil(Math.max(W,H_)/s*1.5)+Math.max(Math.abs(sel.x-Vw.cx),Math.abs(sel.y-Vw.cy))+4;
  for(const m of selMoves(cap)){const[rx,ry]=rect(m.tx,m.ty),cx=rx+s/2,cy=ry+s/2;if(cx<-s||cy<-s||cx>W+s||cy>H_+s)continue;
   const dl=Math.min(140,Math.max(Math.abs(m.tx-sel.x),Math.abs(m.ty-sel.y))*14),t=Math.max(0,Math.min(1,(now-selT-dl)/180));if(t<1)busy=true;const k=NA()?1:eb(t);
   g.beginPath();if(m.cap){g.strokeStyle='rgba(0,0,0,.28)';g.lineWidth=s*.09;g.arc(cx,cy,s*.46*k,0,7);g.stroke()}else{g.fillStyle='rgba(0,0,0,.22)';g.arc(cx,cy,s*.17*k,0,7);g.fill()}}}
 const dp=(c,t,wx,wy,k,al)=>{const im=IM[c+t];if(!im||!im.complete||!im.naturalWidth)return;const[rx,ry]=rect(wx,wy);g.globalAlpha=al;g.drawImage(im,rx-s*(k-1)/2,ry-s*(k-1)/2,s*k,s*k);g.globalAlpha=1};
 for(const q of caps){const t=(now-q.t0)/260;if(t<0){dp(q.c,q.t,q.x,q.y,1,1);busy=true}else if(t<1){busy=true;dp(q.c,q.t,q.x,q.y,1-.5*ez(t),1-ez(t))}}caps=caps.filter(q=>now-q.t0<260);
 const mv=[];for(const p of P.m.values()){if(p.x<x0-1||p.x>x1||p.y<y0-1||p.y>y1)continue;
  if(p.an&&now-p.an.t0<p.an.d){mv.push(p);busy=true;continue}p.an=null;
  let k=1,wx=p.x,wy=p.y;if(p===sel){const e=Math.min(1,(now-selT)/180);k=1+.1*eb(e)}
  if(shake&&shake.p===p){const t=(now-shake.t0)/350;if(t<1){wx+=Math.sin(t*Math.PI*7)*.09*(1-t);busy=true}else shake=null}
  dp(p.c,p.t,wx,wy,k,drag&&drag.p===p&&moved>8?.3:1)}
 for(const p of mv){const e=ez((now-p.an.t0)/p.an.d);dp(p.c,p.t,p.an.fx+(p.x-p.an.fx)*e,p.an.fy+(p.y-p.an.fy)*e,1.06,1)}
 for(const b of booms){const t=(now-b.t0)/650;if(t<0){busy=true;continue}if(t<1){busy=true;const[rx,ry]=rect(b.x,b.y),cx=rx+s/2,cy=ry+s/2,r=s*(.7+1.5*ez(t)),gr=g.createRadialGradient(cx,cy,0,cx,cy,r);
  gr.addColorStop(0,`rgba(255,235,150,${.95*(1-t)})`);gr.addColorStop(.45,`rgba(255,120,30,${.65*(1-t)})`);gr.addColorStop(1,'rgba(255,60,0,0)');g.fillStyle=gr;g.beginPath();g.arc(cx,cy,r,0,7);g.fill()}}booms=booms.filter(b=>now-b.t0<650);
 for(const r of rips){const t=(now-r.t0)/480;if(t<1){busy=true;const[rx,ry]=rect(r.x,r.y);g.strokeStyle=`rgba(255,255,255,${.55*(1-t)})`;g.lineWidth=2.5;g.beginPath();g.arc(rx+s/2,ry+s/2,s*(.15+.45*ez(t)),0,7);g.stroke()}}rips=rips.filter(r=>now-r.t0<480);
 if(drag&&moved>8){const z=s*1.18;if(IM[drag.p.c+drag.p.t].naturalWidth)g.drawImage(IM[drag.p.c+drag.p.t],drag.px-z/2,drag.py-z/2-s*.1,z,z)}
 {const vg=g.createRadialGradient(W/2,H_/2,Math.min(W,H_)*.35,W/2,H_/2,Math.hypot(W,H_)*.6);vg.addColorStop(0,'rgba(8,14,18,0)');vg.addColorStop(1,'rgba(8,14,18,.36)');g.fillStyle=vg;g.fillRect(0,0,W,H_)}
 ind=[];if(!homeOn)for(const c of'wb'){const k=kg(P,c);if(!k)continue;const[kx,ky]=w2s(k.x+.5,k.y+.5);if(kx>-s&&kx<W+s&&ky>-s&&ky<H_+s)continue;
  const dx=kx-W/2,dy=ky-H_/2,t=Math.min((W/2-34)/Math.abs(dx||1e-9),(H_/2-34)/Math.abs(dy||1e-9)),ex=W/2+dx*t,ey=H_/2+dy*t,ic=chk.length&&P.turn===c&&!over;
  g.beginPath();g.arc(ex,ey,21,0,7);g.fillStyle=ic?'#e5393f':'rgba(20,27,31,.9)';g.fill();g.strokeStyle='rgba(255,255,255,.85)';g.lineWidth=2;g.stroke();if(IM[c+'k'].naturalWidth)g.drawImage(IM[c+'k'],ex-16,ey-16,32,32);ind.push({x:ex,y:ey,p:k})}
 return busy||!!drag}
sfInit();newGame({mode:'2p',color:'w',lv:1});openHome('main');
