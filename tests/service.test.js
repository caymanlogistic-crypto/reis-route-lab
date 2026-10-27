import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
import {api} from '../src/service.js';
import {localEnvironment} from '../src/local-adapters.js';

async function workspace(t){
 const dir=await mkdtemp(path.join(tmpdir(),'reis-service-'));let env=localEnvironment(dir);const tasks=[];
 const ctx={waitUntil(p){tasks.push(p);}};
 const drain=async()=>{while(tasks.length)await Promise.all(tasks.splice(0));};
 const call=async(method,url,body,headers={})=>api(new Request('http://localhost:4317'+url,{method,headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);
 const get=async(url)=>{const r=await call('GET',url);assert.equal(r.status,200,await errorText(r));return r.json();};
 const send=async(method,url,body,expected=200,headers={})=>{const r=await call(method,url,body,headers);assert.equal(r.status,expected,await errorText(r));return r.json();};
 t.after(async()=>{await drain();env.close();await rm(dir,{recursive:true,force:true});});
 await send('PUT','/api/settings',{backupIntervalHours:0,backupRetention:3});
 return {call,get,send,drain,ctx,dir,get env(){return env;},async reopen(){await drain();env.close();env=localEnvironment(dir);},async calculate(trip){const j=await send('POST',`/api/trips/${trip.id}/calculate`,{revision:trip.revision},202);await drain();const done=await get('/api/jobs/'+j.id);assert.equal(done.status,'completed',JSON.stringify(done));return get('/api/versions/'+done.versionId);}};
}
async function errorText(r){if(r.ok)return '';try{return await r.clone().text();}catch{return 'Unreadable response';}}

test('registry filters before pagination and export preferences preserve unrelated settings',async t=>{
 const w=await workspace(t);await w.send('PUT','/api/settings',{licenseConfirmed:true,backupIntervalHours:12,backupRetention:4});await w.send('PUT','/api/settings',{exportProfile:{name:'Клиентский',timezone:'UTC'}});const settings=await w.get('/api/settings');assert.equal(settings.licenseConfirmed,true);assert.equal(settings.backupIntervalHours,12);assert.equal(settings.backupRetention,4);assert.equal(settings.exportProfile.timezone,'UTC');
 await w.send('PUT','/api/settings',{backupIntervalHours:0});
 const ready=await w.send('POST','/api/demo',{},201);await w.calculate(ready);
 for(let n=0;n<4;n++)await w.send('POST','/api/trips',{title:'Черновик '+n},201);
 const page=await w.get('/api/trips?status=completed&limit=1');assert.equal(page.total,1);assert.equal(page.items[0].id,ready.id);
 const drafts=await w.get('/api/trips?status=draft&limit=2&offset=2');assert.equal(drafts.total,4);assert.equal(drafts.items.length,2);
});

test('durable SQLite create, edit, close/reopen; optimistic conflict cannot overwrite saved text',async t=>{
 const w=await workspace(t);const a=await w.send('POST','/api/trips',{title:'Рейс A',client:'Клиент',vehicle:'А123ВС',timeMode:'single',timezone:'Europe/Moscow'},201);
 const b=await w.send('POST','/api/trips',{title:'Рейс B'},201);
 const saved=await w.send('PUT','/api/trips/'+a.id,{...a,note:'Сохранённая заметка',points:[{id:'draft',name:'Незавершённая строка',lat:'',lon:'',localTime:''}]});
 assert.equal(saved.revision,2);
 await w.send('PUT','/api/trips/'+a.id,{...a,note:'Старая вкладка'},409);
 const blocked=await w.send('POST',`/api/trips/${a.id}/calculate`,{},422);assert.ok(blocked.checks.some(c=>c.code==='POINT_COUNT'));
 await w.reopen();const reopened=await w.get('/api/trips/'+a.id);assert.equal(reopened.note,'Сохранённая заметка');assert.equal(reopened.points[0].lat,'');assert.equal((await w.get('/api/trips/'+b.id)).title,'Рейс B');
 const list=await w.get('/api/trips?search=Рейс&limit=1');assert.equal(list.items.length,1);assert.equal(list.total,2);
});

test('one-command demo calculation, duplicate jobs, exact checkpoints, export and identical saved redownload',async t=>{
 const w=await workspace(t);const trip=await w.send('POST','/api/demo',{},201);
 const j1=await w.send('POST',`/api/trips/${trip.id}/calculate`,{revision:trip.revision},202);
 const j2=await w.send('POST',`/api/trips/${trip.id}/calculate`,{revision:trip.revision},202);
 assert.equal(j1.id,j2.id);await w.drain();const job=await w.get('/api/jobs/'+j1.id);assert.equal(job.status,'completed',JSON.stringify(job));
 const versions=await w.get(`/api/trips/${trip.id}/versions`);assert.equal(versions.items.length,1);
 const version=await w.get('/api/versions/'+job.versionId);assert.equal(version.snapshot.id,trip.id);assert.equal(version.revision,trip.revision);assert.equal(version.result.status,'completed');assert.ok(version.result.stops.length);
 for(const p of trip.points){const row=version.result.track.find(x=>x.pointId===p.id);assert.equal(row.lat,p.lat);assert.equal(row.lon,p.lon);assert.equal(row.source,'checkpoint');}
 const page=await w.get(`/api/versions/${version.id}/track?offset=1&limit=2`);assert.equal(page.items.length,2);assert.equal(page.total,version.result.track.length);
 const e=await w.send('POST',`/api/versions/${version.id}/exports`,{profile:{timezone:'Europe/Moscow'}},201);
 const first=Buffer.from(await(await w.call('GET',e.url)).arrayBuffer());assert.equal(first[0],80);assert.equal(first[1],75);
 await w.reopen();assert.deepEqual(Buffer.from(await(await w.call('GET',e.url)).arrayBuffer()),first);assert.equal((await w.get(`/api/trips/${trip.id}/exports`)).items[0].versionId,version.id);
});

test('changed impossible schedule preserves successful version and its snapshot while marking current trip stale',async t=>{
 const w=await workspace(t);const trip=await w.send('POST','/api/demo',{},201);const original=await w.calculate(trip);
 const changed=structuredClone(trip);changed.points[1].localTime=changed.points[0].localTime.slice(0,11)+'08:01';
 // Keep chronology valid while making the first road interval physically impossible.
 const start=new Date(changed.points[0].localTime+'Z');changed.points[1].localTime=new Date(start.getTime()+60000).toISOString().slice(0,19);
 const edited=await w.send('PUT','/api/trips/'+trip.id,changed);const list=await w.get('/api/trips');assert.equal(list.items.find(x=>x.id===trip.id).status,'stale');
 const j=await w.send('POST',`/api/trips/${trip.id}/calculate`,{revision:edited.revision},202);await w.drain();const done=await w.get('/api/jobs/'+j.id);assert.equal(done.status,'conflict',JSON.stringify(done));
 const bad=await w.get('/api/versions/'+done.versionId);assert.ok(bad.result.checks.some(x=>x.code==='IMPOSSIBLE'));assert.equal(bad.result.track.length,0);
 const previous=await w.get('/api/versions/'+original.id);assert.deepEqual(previous,original);assert.equal((await w.get(`/api/trips/${trip.id}/versions`)).items.length,2);
 await w.send('POST',`/api/versions/${bad.id}/exports`,{},422);
});

test('calculation continues against frozen snapshot when another trip is opened and source revision changes',async t=>{
 const w=await workspace(t);const trip=await w.send('POST','/api/demo',{},201);const other=await w.send('POST','/api/trips',{title:'Другой рейс'},201);
 const put=w.env.BUCKET.put;let release;const gate=new Promise(resolve=>{release=resolve;});let reached;const waiting=new Promise(resolve=>{reached=resolve;});
 w.env.BUCKET.put=async function(key,...args){if(key.startsWith('results/')){reached();await gate;}return put.call(this,key,...args);};
 const j=await w.send('POST',`/api/trips/${trip.id}/calculate`,{revision:trip.revision},202);await waiting;
 assert.equal((await w.get('/api/trips/'+other.id)).id,other.id);
 const newer=await w.send('PUT','/api/trips/'+trip.id,{...trip,note:'Изменено во время расчёта'});release();await w.drain();
 const job=await w.get('/api/jobs/'+j.id);assert.equal(job.status,'completed');const version=await w.get('/api/versions/'+job.versionId);assert.equal(version.tripId,trip.id);assert.equal(version.revision,trip.revision);assert.equal(version.snapshot.note,trip.note);assert.equal((await w.get('/api/trips/'+trip.id)).revision,newer.revision);assert.equal((await w.get(`/api/trips/${other.id}/versions`)).items.length,0);assert.equal((await w.get('/api/trips')).items.find(x=>x.id===trip.id).status,'stale');
});

test('backup restores into clean workspace with trip, result and byte-identical saved Excel; environment secrets excluded',async t=>{
 const source=await workspace(t);source.env.YANDEX_ROUTER_KEY='TEST-SECRET-DO-NOT-EXPORT';
 const trip=await source.send('POST','/api/demo',{},201);const version=await source.calculate(trip);const e=await source.send('POST',`/api/versions/${version.id}/exports`,{},201);const saved=Buffer.from(await(await source.call('GET',e.url)).arrayBuffer());
 const backup=await(await source.call('GET','/api/backup')).json();assert.equal(backup.format,'reis-backup');assert.ok(!JSON.stringify(backup).includes('TEST-SECRET-DO-NOT-EXPORT'));
 const dest=await workspace(t);const stage=await dest.send('POST','/api/restore/validate',{backup});assert.equal(stage.summary.trips,1);assert.equal(stage.summary.versions,1);assert.equal(stage.summary.exports,1);await dest.send('POST','/api/restore',{token:stage.token});await dest.reopen();
 assert.deepEqual(await dest.get('/api/trips/'+trip.id),await source.get('/api/trips/'+trip.id));assert.deepEqual(await dest.get('/api/versions/'+version.id),version);assert.deepEqual(Buffer.from(await(await dest.call('GET',e.url)).arrayBuffer()),saved);
 const broken=structuredClone(backup);broken.files=[];await dest.send('POST','/api/restore/validate',{backup:broken},422);
 const brokenResult=structuredClone(backup);brokenResult.files.find(f=>f.key.startsWith('results/')).base64=Buffer.from('{broken JSON').toString('base64');await dest.send('POST','/api/restore/validate',{backup:brokenResult},422);
 const brokenExcel=structuredClone(backup);brokenExcel.files.find(f=>f.key.startsWith('exports/')).base64=Buffer.from('not-an-xlsx').toString('base64');await dest.send('POST','/api/restore/validate',{backup:brokenExcel},422);
 // Recompute hashes to prove structure validation is independent of checksums.
 for(const [prefix,bytes]of [
  ['results/',Buffer.from('{broken JSON')],
  ['results/',Buffer.from(JSON.stringify({track:[],checks:'not-an-array',summary:{}}))],
  ['exports/',Buffer.from('not-an-xlsx')],
  ['exports/',zipSync({'unrelated.txt':strToU8('A valid ZIP is not an XLSX')})],
 ]){
  const forged=structuredClone(backup),file=forged.files.find(f=>f.key.startsWith(prefix));
  file.base64=Buffer.from(bytes).toString('base64');file.sha256=createHash('sha256').update(bytes).digest('hex');
  await dest.send('POST','/api/restore/validate',{backup:forged},422);
 }
});

test('real trip cannot fall back to a fabricated line; cross-origin mutation rejected',async t=>{
 const w=await workspace(t);const demo=await w.send('POST','/api/demo',{},201);const real=await w.send('POST','/api/trips',{title:'Реальный рейс'},201);const edited=await w.send('PUT','/api/trips/'+real.id,{...real,points:demo.points});
 const denied=await w.send('POST',`/api/trips/${real.id}/route`,{revision:edited.revision},422);assert.match(denied.error,/договор|право/);
 await w.send('PUT','/api/settings',{licenseConfirmed:true,backupIntervalHours:0});const missing=await w.send('POST',`/api/trips/${real.id}/calculate`,{revision:edited.revision},422);assert.match(missing.error,/ключ/);assert.equal((await w.get(`/api/trips/${real.id}/versions`)).items.length,0);assert.equal((await w.get('/api/trips/'+real.id)).route,null);
 await w.send('POST','/api/trips',{title:'CSRF'},403,{origin:'https://evil.example'});
 const tampered=await w.send('PUT','/api/trips/'+demo.id,{...demo,points:demo.points.map((p,i)=>i? p:{...p,lat:p.lat+0.01})});await w.send('POST',`/api/trips/${demo.id}/route`,{revision:tampered.revision},422);
});

test('different export profile/timezone creates another saved file without mutating the immutable result',async t=>{
 const w=await workspace(t);const trip=await w.send('POST','/api/demo',{},201);const version=await w.calculate(trip);const before=JSON.stringify(version.result);
 const a=await w.send('POST',`/api/versions/${version.id}/exports`,{profile:{id:'moscow',timezone:'Europe/Moscow'}},201);
 const b=await w.send('POST',`/api/versions/${version.id}/exports`,{profile:{id:'yekaterinburg',timezone:'Asia/Yekaterinburg',columns:['speedKph','distanceM'],distanceUnit:'m'}},201);
 assert.notEqual(a.id,b.id);assert.equal(a.versionId,b.versionId);assert.equal(JSON.stringify((await w.get('/api/versions/'+version.id)).result),before);assert.equal((await w.get(`/api/trips/${trip.id}/exports`)).items.length,2);
});

test('copy/archive/restore retain independent permanent trip identities and saved profile settings',async t=>{
 const w=await workspace(t);const trip=await w.send('POST','/api/demo',{},201);const copy=await w.send('POST',`/api/trips/${trip.id}/copy`,{},201);assert.notEqual(copy.id,trip.id);assert.equal(copy.parentTripId,trip.id);
 await w.send('POST',`/api/trips/${copy.id}/archive`,{archived:true});assert.equal((await w.get('/api/trips')).items.length,1);assert.equal((await w.get('/api/trips?archive=1')).items[0].id,copy.id);await w.send('POST',`/api/trips/${copy.id}/archive`,{archived:false});
 await w.send('PUT','/api/profiles',{id:'test-profile',name:'Тестовый',maxSpeedKph:70});await w.reopen();assert.equal((await w.get('/api/profiles')).items[0].maxSpeedKph,70);assert.equal((await w.get('/api/trips')).items.length,2);
});
