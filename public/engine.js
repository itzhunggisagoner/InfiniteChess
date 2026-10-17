/* ======================= ENGINE (infinite-board rules + built-in bot) ======================= */
const KY=(x,y)=>x*4194304+y,opp=c=>c==='w'?'b':'w',V0={p:100,n:300,b:320,r:500,q:900,k:0};
const ND=[[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]],OR=[[1,0],[-1,0],[0,1],[0,-1]],DG=[[1,1],[1,-1],[-1,1],[-1,-1]],DIRS={r:OR,b:DG,q:[...OR,...DG]};
class Pos{constructor(){this.m=new Map();this.turn='w';this.ep=null;this.k={};this.hm=0}get(x,y){return this.m.get(KY(x,y))}put(p){this.m.set(KY(p.x,p.y),p)}del(p){this.m.delete(KY(p.x,p.y))}}
let VR='std';
const inHill=k=>k.x>=3&&k.x<=4&&k.y>=3&&k.y<=4;
/* alive king of colour c (null if none / exploded / captured) */
const kg=(P,c)=>{const k=P.k[c];return k&&P.get(k.x,k.y)===k?k:null};
const NOEV=()=>VR==='atomic'||VR==='anti'||VR==='rk',NOCASTLE=()=>VR==='anti'||VR==='rk';
/* Chess960: Scharnagl number (0-959) -> back rank, e.g. 518 = 'rnbqkbnr' */
const KT=[[0,1],[0,2],[0,3],[0,4],[1,2],[1,3],[1,4],[2,3],[2,4],[3,4]];
function b960(n){const r=Array(8).fill('');r[(n%4)*2+1]='b';n=n/4|0;r[(n%4)*2]='b';n=n/4|0;
 const fe=()=>{const e=[];r.forEach((v,i)=>{if(!v)e.push(i)});return e};
 let e=fe();r[e[n%6]]='q';n=n/6|0;e=fe();r[e[KT[n][0]]]='n';r[e[KT[n][1]]]='n';e=fe();r[e[0]]='r';r[e[1]]='k';r[e[2]]='r';return r.join('')}
function setup(vr,lay){const P=new Pos(),add=(c,x,y,t)=>{const p={t,c,x,y,moved:false};P.put(p);if(t==='k')P.k[c]=p};
 if(vr==='rk'){/* Racing Kings: no pawns, white on the right, black on the left */
  [['w',4,1,'NBRK'],['w',4,0,'NBRQ'],['b',0,1,'krbn'],['b',0,0,'qrbn']].forEach(([c,x0,y,str])=>{for(let i=0;i<4;i++)add(c,x0+i,y,str[i].toLowerCase())});return P}
 const B=vr==='tq'?'rnqqkqnr':vr==='960'?lay:'rnbqkbnr';
 for(let x=0;x<8;x++)for(const[c,y,t]of[['w',0,B[x]],['w',1,'p'],['b',7,B[x]],['b',6,'p']])add(c,x,y,t);return P}
function firstBlock(P,x,y,dx,dy){let k=Infinity,pc=null;for(const q of P.m.values()){const a=q.x-x,b=q.y-y,n=dx?a/dx:b/dy;if(n>0&&n<k&&a===n*dx&&b===n*dy){k=n;pc=q}}return[k,pc]}
function atk(P,q,x,y){const a=x-q.x,b=y-q.y,A_=Math.abs(a),B_=Math.abs(b);if(!a&&!b)return false;
 if(q.t==='n')return a*a+b*b===5;if(q.t==='k')return A_<2&&B_<2;if(q.t==='p')return A_===1&&b===(q.c==='w'?1:-1);
 const d=q.t==='b'?A_===B_:q.t==='r'?(!a||!b):(!a||!b||A_===B_);if(!d)return false;
 return firstBlock(P,q.x,q.y,Math.sign(a),Math.sign(b))[0]>=Math.max(A_,B_)}
const attackedBy=(P,x,y,c)=>{for(const q of P.m.values())if(q.c===c&&atk(P,q,x,y))return true;return false};
const inCheck=(P,c)=>{if(VR==='anti')return false;const k=kg(P,c);if(!k)return false;
 if(VR==='atomic'){const e=kg(P,opp(c));if(!e||Math.abs(e.x-k.x)<2&&Math.abs(e.y-k.y)<2)return false}/* adjacent kings are immune */
 return attackedBy(P,k.x,k.y,opp(c))};
/* Chess960 castling: king ends on g/c file, rook on f/d file. Encoded as 'king takes own rook' (tx = rook square). */
function cast960(P,k,r){if(k.moved||r.moved||r.t!=='r'||r.c!==k.c||r.y!==k.y)return null;
 const s=Math.sign(r.x-k.x),kd=s>0?6:2,rd=s>0?5:3,y=k.y,o=opp(k.c),lo=Math.min(k.x,kd,r.x,rd),hi=Math.max(k.x,kd,r.x,rd);
 for(let x=lo;x<=hi;x++){const z=P.get(x,y);if(z&&z!==k&&z!==r)return null}
 for(let x=Math.min(k.x,kd);x<=Math.max(k.x,kd);x++)if(attackedBy(P,x,y,o))return null;
 return{p:k,fx:k.x,fy:y,tx:r.x,ty:y,kx:kd,cap:null,rk:r,rfx:r.x,rx:rd}}
/* Antichess: is any capture available for colour c? */
function hasCap(P,c){for(const p of P.m.values()){if(p.c!==c)continue;
 if(p.t==='p'&&P.ep&&atk(P,p,P.ep.x,P.ep.y))return true;
 for(const q of P.m.values())if(q.c!==c&&atk(P,p,q.x,q.y))return true}return false}
function pm(P,p,tx,ty){const a=tx-p.x,b=ty-p.y,q=P.get(tx,ty);if(!a&&!b)return null;
 if(q&&q.c===p.c)return VR==='960'&&p.t==='k'&&q.t==='r'?cast960(P,p,q):null;
 if(VR==='atomic'&&p.t==='k'&&q)return null;/* a king can't capture (it would explode itself) */
 const mv={p,fx:p.x,fy:p.y,tx,ty,cap:q||null};
 if(p.t==='p'){const d=p.c==='w'?1:-1;
  if(!a){if(q)return null;if(b===d)return mv;if(b===2*d&&!p.moved&&!P.get(p.x,p.y+d)){mv.dbl=1;return mv}return null}
  if(Math.abs(a)===1&&b===d){if(q)return mv;const e=P.ep;if(e&&e.x===tx&&e.y===ty){mv.cap=P.get(tx,p.y);return mv}}return null}
 if(p.t==='k'){if(Math.abs(a)<2&&Math.abs(b)<2)return mv;
  if(NOCASTLE()||p.moved||b)return null;
  if(VR==='960'){if(Math.abs(a)<2||tx!==6&&tx!==2)return null;const s=Math.sign(a);for(const r of P.m.values())if(r.t==='r'&&r.c===p.c&&r.y===p.y&&Math.sign(r.x-p.x)===s)return cast960(P,p,r);return null}
  if(Math.abs(a)===2){const s=Math.sign(a),r=P.get(s>0?7:0,p.y);if(!r||r.t!=='r'||r.c!==p.c||r.moved)return null;
   for(let x=p.x+s;x!==r.x;x+=s)if(P.get(x,p.y))return null;const o=opp(p.c);if(attackedBy(P,p.x,p.y,o)||attackedBy(P,p.x+s,p.y,o))return null;
   mv.rk=r;mv.rfx=r.x;mv.rx=p.x+s;return mv}return null}
 return atk(P,p,tx,ty)?mv:null}
function make(P,mv){const p=mv.p,r=mv.rk,u={mv,pm:p.moved,ep:P.ep,hm:P.hm};
 if(mv.cap)P.del(mv.cap);P.del(p);if(r){u.rm=r.moved;P.del(r)}
 if(VR==='atomic'&&mv.cap){/* explosion: capturer + every non-pawn on the 8 neighbouring squares */
  const ex=[];for(let a=-1;a<2;a++)for(let b=-1;b<2;b++){const q=P.get(mv.tx+a,mv.ty+b);if(q&&q.t!=='p')ex.push(q)}for(const q of ex)P.del(q);u.ex=ex}
 p.x=mv.kx===undefined?mv.tx:mv.kx;p.y=mv.ty;p.moved=true;if(!u.ex)P.put(p);
 if(r){r.x=mv.rx;r.moved=true;P.put(r)}
 P.ep=mv.dbl?{x:mv.tx,y:(mv.fy+mv.ty)/2}:null;P.hm=(mv.cap||p.t==='p')?0:P.hm+1;P.turn=opp(P.turn);return u}
function unmake(P,u){const mv=u.mv,p=mv.p,r=mv.rk;
 if(!u.ex)P.del(p);if(r)P.del(r);if(u.ex)for(const q of u.ex)P.put(q);
 p.x=mv.fx;p.y=mv.fy;p.moved=u.pm;P.put(p);if(mv.cap)P.put(mv.cap);
 if(r){r.x=mv.rfx;r.moved=u.rm;P.put(r)}P.ep=u.ep;P.hm=u.hm;P.turn=opp(P.turn)}
function legal(P,mv){const c=mv.p.c;if(VR==='anti')return!!mv.cap||!hasCap(P,c);
 const u=make(P,mv);let ok;
 if(VR==='atomic')ok=!!kg(P,c)&&(!kg(P,opp(c))||!inCheck(P,c));/* blowing up the enemy king wins even if you're in check */
 else ok=!inCheck(P,c)&&(VR!=='rk'||!inCheck(P,opp(c)));/* Racing Kings: nobody may give check */
 unmake(P,u);return ok}
function evade(P,c){const k=P.k[c],o=opp(c),L=[];
 for(const[a,b]of[...OR,...DG]){const m=pm(P,k,k.x+a,k.y+b);if(m&&legal(P,m))L.push(m)}
 const ch=[...P.m.values()].filter(q=>q.c===o&&atk(P,q,k.x,k.y));if(ch.length>1)return L;
 const q=ch[0],T=[[q.x,q.y]];if('brq'.includes(q.t)){const dx=Math.sign(k.x-q.x),dy=Math.sign(k.y-q.y),n=Math.max(Math.abs(k.x-q.x),Math.abs(k.y-q.y));for(let s=1;s<n;s++)T.push([q.x+dx*s,q.y+dy*s])}
 if(P.ep)T.push([P.ep.x,P.ep.y]);
 for(const p of[...P.m.values()])if(p.c===c&&p!==k)for(const[x,y]of T){const m=pm(P,p,x,y);if(m&&legal(P,m))L.push(m)}return L}
function gen(P,c,cap,co,only){
 if(VR==='anti'&&only)return gen(P,c,cap,co).filter(m=>m.p===only);
 if(!NOEV()&&inCheck(P,c)){const L=evade(P,c);return co?L.filter(m=>m.cap):only?L.filter(m=>m.p===only):L}
 const L=[],add=(p,x,y)=>{const m=pm(P,p,x,y);if(m&&!(co&&!m.cap))L.push(m)};
 for(const p of P.m.values()){if(p.c!==c||only&&p!==only)continue;
  if(p.t==='n')for(const[a,b]of ND)add(p,p.x+a,p.y+b);
  else if(p.t==='k'){for(const[a,b]of[...OR,...DG])add(p,p.x+a,p.y+b);if(!co&&!p.moved&&!NOCASTLE()){if(VR==='960'){for(const r of P.m.values())if(r.t==='r'&&r.c===c&&r.y===p.y&&!r.moved){const m=cast960(P,p,r);if(m)L.push(m)}}else{add(p,p.x+2,p.y);add(p,p.x-2,p.y)}}}
  else if(p.t==='p'){const d=c==='w'?1:-1;add(p,p.x,p.y+d);add(p,p.x,p.y+2*d);add(p,p.x+1,p.y+d);add(p,p.x-1,p.y+d)}
  else for(const[dx,dy]of DIRS[p.t]){const[k,q]=firstBlock(P,p.x,p.y,dx,dy);
   if(!co)for(let s=1;s<k&&s<=cap;s++)L.push({p,fx:p.x,fy:p.y,tx:p.x+dx*s,ty:p.y+dy*s,cap:null});
   if(q&&q.c!==c)L.push({p,fx:p.x,fy:p.y,tx:q.x,ty:q.y,cap:q})}}
 if(VR==='anti'){const C=L.filter(m=>m.cap);return C.length?C:L}/* captures are mandatory */
 return L.filter(m=>legal(P,m))}
function ev(P){let s=0;
 if(VR==='anti'){for(const p of P.m.values())s+=(p.c==='w'?1:-1)*(p.t==='k'?150:V0[p.t]);return -s}/* fewer pieces = better */
 for(const p of P.m.values()){const sg=p.c==='w'?1:-1,e=kg(P,opp(p.c))||{x:3,y:p.c==='w'?7:0},dk=Math.max(Math.abs(p.x-e.x),Math.abs(p.y-e.y));let v=V0[p.t];
 if(p.t==='p')v+=Math.max(-2,Math.min((p.y-(sg>0?1:6))*sg,6))*8;
 else if(p.t==='n'||p.t==='b')v+=(p.moved?12:0)+Math.max(0,10-dk)*2;
 else if(p.t==='r'||p.t==='q')v+=Math.max(0,12-dk)*1.5;
 else if(VR==='rk')v+=p.y*70;
 else if(VR==='koth')v+=Math.max(0,5-Math.max(Math.abs(p.x-3.5),Math.abs(p.y-3.5)))*30;
 else v-=Math.min(Math.abs(p.y-(sg>0?0:7)),6)*10-(p.moved&&(p.x===2||p.x===6)?25:0);
 s+=sg*v}return s}
let TO=0,DL=0;const mvs=m=>m.cap?V0[m.cap.t]*10-V0[m.p.t]:0,order=L=>L.sort((a,b)=>mvs(b)-mvs(a));
function qs(P,c,a,b,d){if(TO||performance.now()>DL){TO=1;return 0}if(VR==='atomic'){if(!kg(P,c))return -99000;if(!kg(P,opp(c)))return 99000}
 const st=(c==='w'?1:-1)*ev(P);if(VR==='anti'||st>=b||d<=0)return st;if(st>a)a=st;
 for(const m of order(gen(P,c,0,true))){const u=make(P,m),v=-qs(P,opp(c),-b,-a,d-1);unmake(P,u);if(v>=b)return b;if(v>a)a=v}return a}
function ab(P,c,dp,a,b,ply){if(performance.now()>DL){TO=1;return 0}if(VR==='koth'&&inHill(P.k[opp(c)]))return -99000+ply;
 if(VR==='atomic'){if(!kg(P,c))return -99000+ply;if(!kg(P,opp(c)))return 99000-ply}
 if(VR==='rk'&&c==='w'){const wr=P.k.w.y===7,br=P.k.b.y===7;if(wr||br)return wr&&br?0:wr?99000-ply:-99000+ply}
 if(dp<=0)return qs(P,c,a,b,3);
 const L=order(gen(P,c,3));if(!L.length)return VR==='anti'?99000-ply:inCheck(P,c)?-99000+ply:0;
 for(const m of L){const u=make(P,m),v=-ab(P,opp(c),dp-1,-b,-a,ply+1);unmake(P,u);if(TO)return 0;if(v>=b)return b;if(v>a)a=v}return a}
function think(P,c,lv){const D=[1,2,3][lv]+(lv===2?1:0);DL=performance.now()+[200,900,2300][lv];TO=0;let L=order(gen(P,c,6)),best=L[0];
 for(let d=1;d<=D;d++){let bm=null,bs=-1e9,a=-1e9;
  for(const m of L){const u=make(P,m);let v=-ab(P,opp(c),d-1,-1e9,-a,1);unmake(P,u);if(TO)break;v+=Math.random()*(lv===0?120:4);if(v>bs){bs=v;bm=m}if(v>a)a=v}
  if(TO||!bm)break;best=bm;L=[bm,...L.filter(x=>x!==bm)]}return best}
/* ---- worker entry: the built-in bot runs off the main thread so the UI never freezes ---- */
if(typeof document==='undefined'){onmessage=e=>{const d=e.data,P=new Pos();
 for(const q of d.pcs){const p={t:q.t,c:q.c,x:q.x,y:q.y,moved:q.mv};P.put(p);if(p.t==='k')P.k[p.c]=p}
 P.turn=d.turn;P.ep=d.ep;P.hm=d.hm;VR=d.vr||'std';let m=null;try{m=think(P,d.turn,d.lv)}catch(x){}
 postMessage({id:d.id,m:m?{fx:m.fx,fy:m.fy,tx:m.tx,ty:m.ty}:null})}}
