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
function qs(P,c,a,b,d){if(TO||performance.now()>DL){TO=1;return 0}const st=(c==='w'?1:-1)*ev(P);if(st>=b||d<=0)return st;if(st>a)a=st;
 for(const m of order(gen(P,c,0,true))){const u=make(P,m),v=-qs(P,opp(c),-b,-a,d-1);unmake(P,u);if(v>=b)return b;if(v>a)a=v}return a}
function ab(P,c,dp,a,b,ply){if(performance.now()>DL){TO=1;return 0}if(dp<=0)return qs(P,c,a,b,3);
 const L=order(gen(P,c,3));if(!L.length)return inCheck(P,c)?-99000+ply:0;
 for(const m of L){const u=make(P,m),v=-ab(P,opp(c),dp-1,-b,-a,ply+1);unmake(P,u);if(TO)return 0;if(v>=b)return b;if(v>a)a=v}return a}
function think(P,c,lv){const D=[1,2,3][lv]+(lv===2?1:0);DL=performance.now()+[200,900,2300][lv];TO=0;let L=order(gen(P,c,6)),best=L[0];
 for(let d=1;d<=D;d++){let bm=null,bs=-1e9,a=-1e9;
  for(const m of L){const u=make(P,m);let v=-ab(P,opp(c),d-1,-1e9,-a,1);unmake(P,u);if(TO)break;v+=Math.random()*(lv===0?120:4);if(v>bs){bs=v;bm=m}if(v>a)a=v}
  if(TO||!bm)break;best=bm;L=[bm,...L.filter(x=>x!==bm)]}return best}
/* ---- worker entry: the built-in bot runs off the main thread so the UI never freezes ---- */
if(typeof document==='undefined'){onmessage=e=>{const d=e.data,P=new Pos();
 for(const q of d.pcs){const p={t:q.t,c:q.c,x:q.x,y:q.y,moved:q.mv};P.put(p);if(p.t==='k')P.k[p.c]=p}
 P.turn=d.turn;P.ep=d.ep;P.hm=d.hm;let m=null;try{m=think(P,d.turn,d.lv)}catch(x){}
 postMessage({id:d.id,m:m?{fx:m.fx,fy:m.fy,tx:m.tx,ty:m.ty}:null})}}
