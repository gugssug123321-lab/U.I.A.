'use strict';
// U.I.A. Pro server — sem dependências (Node 18+). Pagamento via Stripe, ativação administrativa por código no servidor.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const E=process.env,PORT=+E.PORT||8787,DBF=E.DB_FILE||path.join(__dirname,'data.json');
const STRIPE=E.STRIPE_SECRET_KEY||'',ADMIN=(E.ADMIN_CODE||'').trim().toUpperCase(),LIMIT=+E.PRO_DAILY_TOKENS||500000;
const UP={base:(E.UPSTREAM_BASE||'').replace(/\/$/,''),key:E.UPSTREAM_KEY||'',models:(E.PRO_MODELS||'').split(',').map(s=>s.trim()).filter(Boolean)};
const APP_FILE=E.APP_FILE||path.join(__dirname,'public','index.html');
let db={subs:{},claimed:{},audit:[]};try{db=Object.assign(db,JSON.parse(fs.readFileSync(DBF,'utf8')))}catch(e){}
const save=()=>{const t=DBF+'.tmp';fs.writeFileSync(t,JSON.stringify(db));fs.renameSync(t,DBF)};
const sha=t=>crypto.createHash('sha256').update(String(t)).digest('hex');
const cors={'Access-Control-Allow-Origin':E.ALLOW_ORIGIN||'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const json=(res,c,o)=>{res.writeHead(c,{'content-type':'application/json',...cors});res.end(JSON.stringify(o))};
const body=(req,max)=>new Promise((ok,no)=>{let b='',n=0;req.on('data',d=>{n+=d.length;if(n>(max||1e6)){no(Error('corpo grande demais'));req.destroy()}else b+=d});req.on('end',()=>ok(b));req.on('error',no)});
async function stripe(m,p,f){if(!STRIPE)throw Object.assign(Error('pagamentos não configurados no servidor (STRIPE_SECRET_KEY)'),{code:503});
 const r=await fetch('https://api.stripe.com/v1'+p,{method:m,headers:{Authorization:'Bearer '+STRIPE,'content-type':'application/x-www-form-urlencoded'},body:f?new URLSearchParams(f).toString():undefined});
 const j=await r.json();if(!r.ok)throw Error((j.error&&j.error.message)||'Stripe '+r.status);return j}
const endOf=x=>((x.items&&x.items.data&&x.items.data[0]&&x.items.data[0].current_period_end)||x.current_period_end||0)*1000;
async function lookup(req){const t=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!t)return null;const h=sha(t),s=db.subs[h];if(!s)return null;
 if(s.method==='payment'&&STRIPE&&s.subscription&&Date.now()-(s.chk||0)>30000){try{const x=await stripe('GET','/subscriptions/'+s.subscription);s.status=x.status;s.cancel=!!x.cancel_at_period_end;s.end=endOf(x);s.chk=Date.now();save()}catch(e){}}
 return{s,pro:s.method==='admin_code'||['active','trialing'].includes(s.status)}}
const quota=s=>{const d=new Date().toISOString().slice(0,10);if(!s.u||s.u.d!==d)s.u={d,t:0};return s.u};
const newTok=()=>'uia_'+crypto.randomBytes(24).toString('hex');
const tries=new Map();
function limited(ip){const n=Date.now(),a=(tries.get(ip)||[]).filter(t=>n-t<9e5);a.push(n);tries.set(ip,a);return a.length>5}
const ipOf=req=>(E.TRUST_PROXY?String(req.headers['x-forwarded-for']||'').split(',')[0].trim():'')||req.socket.remoteAddress||'?';
const eq=(a,b)=>{const x=crypto.createHash('sha256').update(a).digest(),y=crypto.createHash('sha256').update(b).digest();return crypto.timingSafeEqual(x,y)};
http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://x'),p=u.pathname,m=req.method;
 if(m==='OPTIONS'){res.writeHead(204,cors);return res.end()}
 if(p==='/health')return json(res,200,{ok:true,stripe:!!STRIPE,admin:!!ADMIN,premium:!!UP.base});
 if(m==='GET'&&(p==='/'||p==='/index.html')){let h=fs.readFileSync(APP_FILE,'utf8');const o=E.APP_URL||('http://'+req.headers.host);res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(h.replace('/*ULA_CFG*/','window.ULA_API='+JSON.stringify(o)+';'))}
 if(p==='/api/me'&&m==='GET'){const a=await lookup(req);if(!a)return json(res,401,{error:'código de acesso inválido'});const s=a.s,q=quota(s);let inv=[];
  if(s.method==='payment'&&STRIPE&&s.customer)try{inv=(await stripe('GET','/invoices?limit=12&customer='+s.customer)).data.map(i=>({date:i.created*1000,amount:i.amount_paid/100,currency:i.currency,status:i.status,url:i.hosted_invoice_url}))}catch(e){}
  return json(res,200,{plan:a.pro?'pro':'free',status:s.method==='admin_code'?'active':s.status,method:s.method,since:s.activated,end:s.method==='admin_code'?null:s.end,cancel:!!s.cancel,models:UP.models,quota:{used:q.t,limit:LIMIT},invoices:inv})}
 if(p==='/api/checkout'&&m==='POST'){const b=JSON.parse(await body(req)||'{}'),ru=String(b.return_url||'');if(!/^https?:\/\//.test(ru)||(E.APP_URL&&!ru.startsWith(E.APP_URL)))return json(res,400,{error:'endereço de retorno inválido'});
  const s=await stripe('POST','/checkout/sessions',{mode:'subscription','line_items[0][quantity]':'1','line_items[0][price_data][currency]':'brl','line_items[0][price_data][unit_amount]':'2500','line_items[0][price_data][recurring][interval]':'month','line_items[0][price_data][product_data][name]':'U.I.A. Pro',locale:'pt-BR',success_url:ru+'?pro_session={CHECKOUT_SESSION_ID}',cancel_url:ru});
  return json(res,200,{url:s.url})}
 if(p==='/api/claim'&&m==='POST'){const b=JSON.parse(await body(req)||'{}'),id=String(b.session_id||'');if(!/^cs_[\w]+$/.test(id))return json(res,400,{error:'sessão inválida'});
  if(db.claimed[id])return json(res,409,{error:'assinatura já resgatada'});
  const s=await stripe('GET','/checkout/sessions/'+id+'?expand[]=subscription');
  if(s.mode!=='subscription'||s.status!=='complete'||s.payment_status!=='paid')return json(res,402,{error:'pagamento ainda não confirmado pela Stripe'});
  const sub=s.subscription,t=newTok(),h=sha(t);db.subs[h]={method:'payment',activated:Date.now(),session:id,customer:s.customer,subscription:sub.id,status:sub.status,cancel:!!sub.cancel_at_period_end,end:endOf(sub),chk:Date.now()};db.claimed[id]=h;db.audit.push({ts:Date.now(),ev:'claim_payment',session:id});save();return json(res,200,{token:t})}
 if((p==='/api/cancel'||p==='/api/resume')&&m==='POST'){const a=await lookup(req);if(!a)return json(res,401,{error:'não autorizado'});if(a.s.method!=='payment')return json(res,400,{error:'esta ativação não tem cobrança para cancelar'});
  const x=await stripe('POST','/subscriptions/'+a.s.subscription,{cancel_at_period_end:p==='/api/cancel'?'true':'false'});a.s.cancel=!!x.cancel_at_period_end;a.s.end=endOf(x);save();return json(res,200,{ok:true})}
 if(p==='/api/admin-code'&&m==='POST'){const ip=ipOf(req);if(limited(ip))return json(res,429,{error:'muitas tentativas'});if(!ADMIN)return json(res,503,{error:'código administrativo não configurado'});
  const b=JSON.parse(await body(req)||'{}'),c=String(b.code||'').trim().toUpperCase();
  if(!c||!eq(c,ADMIN)){db.audit.push({ts:Date.now(),ev:'admin_code_fail',ip:sha(ip).slice(0,10)});save();return json(res,403,{error:'código inválido'})}
  const t=newTok();db.subs[sha(t)]={method:'admin_code',activated:Date.now(),status:'active'};db.audit.push({ts:Date.now(),ev:'activate_admin_code',ip:sha(ip).slice(0,10)});save();return json(res,200,{token:t})}
 if(p==='/v1/models'&&m==='GET'){const a=await lookup(req);if(!a||!a.pro)return json(res,402,{error:'plano Pro necessário'});return json(res,200,{data:UP.models.map(id=>({id}))})}
 if(p==='/v1/chat/completions'&&m==='POST'){const a=await lookup(req);if(!a||!a.pro)return json(res,402,{error:'plano Pro necessário'});if(!UP.base||!UP.key)return json(res,503,{error:'modelos premium não configurados no servidor'});
  const raw=await body(req,4e6),b=JSON.parse(raw),q=quota(a.s);if(q.t>=LIMIT)return json(res,429,{error:'cota diária do Pro atingida'});
  if(UP.models.length&&!UP.models.includes(b.model))b.model=UP.models[0];q.t+=Math.ceil(raw.length/4);
  const r=await fetch(UP.base+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+UP.key},body:JSON.stringify(b)});
  res.writeHead(r.status,{'content-type':r.headers.get('content-type')||'application/json',...cors});const rd=r.body.getReader();for(;;){const{done,value}=await rd.read();if(done)break;q.t+=Math.ceil(value.length/4);res.write(value)}res.end();save();return}
 json(res,404,{error:'não encontrado'})
}catch(e){if(!res.headersSent)json(res,e.code===503?503:500,{error:e.code===503?e.message:(e instanceof SyntaxError?'requisição inválida':'erro: '+e.message)});else res.end()}}).listen(PORT,()=>console.log('U.I.A. Pro server na porta '+PORT));
