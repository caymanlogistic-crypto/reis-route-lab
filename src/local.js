import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {homedir} from 'node:os';
import {api} from './service.js';
import {localEnvironment} from './local-adapters.js';
import {Store} from './store.js';
const dataDir=process.env.REIS_DATA_DIR||join(process.env.LOCALAPPDATA||join(homedir(),'.local','share'),'ReisRouteLab');
const env={...localEnvironment(dataDir),YANDEX_ROUTER_KEY:process.env.YANDEX_ROUTER_KEY,YANDEX_MAP_KEY:process.env.YANDEX_MAP_KEY};
const store=new Store(env);for(const j of await store.list('job'))if(['queued','running'].includes(j.status))await store.put('job',{...j,status:'interrupted',error:'Локальный сервис был остановлен. Повторите расчёт в новой редакции.'},j.tripId);
const pending=new Set();const ctx={waitUntil(p){pending.add(p);p.catch(()=>{}).finally(()=>pending.delete(p));}};
const server=createServer(async(req,res)=>{try{
 const host=req.headers.host||'';if(!/^127\.0\.0\.1:\d+$/.test(host)&&!/^localhost:\d+$/.test(host)){res.writeHead(403);res.end('Invalid host');return;}
 const url=new URL(req.url,'http://'+host);let response;
 if(url.pathname.startsWith('/api/')){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>12*1024*1024){res.writeHead(413);res.end('Запрос слишком большой');return;}chunks.push(c);}const init={method:req.method,headers:req.headers};if(!['GET','HEAD'].includes(req.method))init.body=Buffer.concat(chunks);response=await api(new Request(url,init),env,ctx);}
 else{const assets={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css'};const asset=assets[url.pathname];if(!asset){response=new Response('Not found',{status:404});}else{const data=await readFile(new URL('./ui/'+asset,import.meta.url));response=new Response(data,{headers:{'content-type':asset.endsWith('.html')?'text/html; charset=utf-8':asset.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff'}});}}
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'Ошибка локального сервиса.'}));}});
const port=+(process.env.PORT||4317);server.listen(port,'127.0.0.1',()=>console.log(`Рейс: http://127.0.0.1:${port}\nДанные: ${dataDir}`));
async function shutdown(){server.close();await Promise.allSettled([...pending]);env.close();process.exit(0);}process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
