import test from 'node:test';
import assert from 'node:assert/strict';
import { demoTrip,defaultProfile,reconstruct,resolveTime,validateTrip,haversine } from '../src/engine.js';

const clone=x=>structuredClone(x);
function fixture(points,profile={}) {
  const trip={timeMode:'single',timezone:'Europe/Moscow',points:points.map((p,i)=>({id:`p${i}`,lat:p[0],lon:p[1],localTime:p[2],event:p[3]||'pass',source:'user'})),profile:{...defaultProfile,...profile}};
  const route={source:'yandex',legs:trip.points.slice(1).map((p,i)=>({points:[[trip.points[i].lat,trip.points[i].lon],[p.lat,p.lon]],distanceM:haversine([trip.points[i].lat,trip.points[i].lon],[p.lat,p.lon])}))};
  return {trip,route};
}

test('five-point reconstruction is deterministic, preserves exact facts and shows night assumptions',()=>{
  const a=reconstruct(demoTrip,demoTrip.route),b=reconstruct(demoTrip,demoTrip.route);
  assert.equal(a.status,'completed');assert.deepEqual(a,b);assert(a.stops.some(s=>s.type==='assumed-night'));
  for(const p of demoTrip.points) {const row=a.track.find(r=>r.pointId===p.id);assert(row);assert.equal(row.timestampUtc,resolveTime(p,demoTrip).timestampUtc);assert.equal(row.lat,p.lat);assert.equal(row.lon,p.lon);assert.equal(row.source,'checkpoint');}
  assert(a.checks.some(c=>c.code==='DEMO'));assert(a.summary.stopSeconds>20*3600);
  assert(Math.abs(a.summary.driveSeconds+a.summary.stopSeconds-a.summary.durationSeconds)<1e-6);
  assert(Math.abs(a.track.at(-1).distanceM-a.summary.distanceM)<0.00001);
  for(let i=1;i<a.track.length;i++) {assert(a.track[i].timestampUtc>a.track[i-1].timestampUtc);assert(a.track[i].distanceM>=a.track[i-1].distanceM-0.001);assert(a.track[i].speedKph<=80.00001);}
});

test('confirmed overnight remains stationary across midnight and has exact elapsed duration',()=>{
  const {trip,route}=fixture([[55,37,'2026-10-20T22:00','overnight'],[55,37,'2026-10-21T07:00','departure'],[55.1,37.1,'2026-10-21T08:00','arrival']]);
  const r=reconstruct(trip,route);assert.equal(r.status,'completed');assert.equal(r.stops[0].type,'confirmed');assert.equal(r.stops[0].durationSeconds,9*3600);
  const overnight=r.track.filter(x=>x.timestampUtc>=r.stops[0].startUtc&&x.timestampUtc<=r.stops[0].endUtc);assert(overnight.length>500);
  for(const x of overnight){assert.equal(x.lat,55);assert.equal(x.lon,37);assert.equal(x.distanceM,0);assert.equal(x.speedKph,0);}
});

test('impossible schedule returns concrete conflict without altering facts',()=>{
  const {trip,route}=fixture([[55,37,'2026-10-20T08:00'],[55,40,'2026-10-20T08:05']]);const before=clone(trip);
  const r=reconstruct(trip,route);assert.equal(r.status,'conflict');assert.equal(r.track.length,0);assert(r.checks.some(c=>c.code==='IMPOSSIBLE'&&c.details.necessarySeconds>c.details.availableSeconds));assert.deepEqual(trip,before);
});

test('DST nonexistent time rejected; repeated time requires explicit valid offset',()=>{
  const trip={timeMode:'single',timezone:'Europe/Berlin'};
  assert.throws(()=>resolveTime({localTime:'2026-03-29T02:30'},trip),{code:'TIME_NONEXISTENT'});
  assert.throws(()=>resolveTime({localTime:'2026-10-25T02:30'},trip),{code:'TIME_AMBIGUOUS'});
  const early=resolveTime({localTime:'2026-10-25T02:30',utcOffsetMinutes:120},trip),late=resolveTime({localTime:'2026-10-25T02:30',utcOffsetMinutes:60},trip);
  assert.equal(late.utcMillis-early.utcMillis,3600000);assert.throws(()=>resolveTime({localTime:'2026-10-25T02:30',utcOffsetMinutes:180},trip),{code:'TIME_OFFSET'});
});

test('crossing zones east and west uses UTC order and original local clocks',()=>{
  const trip={timeMode:'local'};
  const m=resolveTime({lat:55.75,lon:37.6,localTime:'2026-10-20T10:00',timezone:'Europe/Moscow'},trip);
  const e=resolveTime({lat:56.8,lon:60.6,localTime:'2026-10-20T15:00',timezone:'Asia/Yekaterinburg'},trip);
  const w=resolveTime({lat:55.75,lon:37.6,localTime:'2026-10-20T18:00',timezone:'Europe/Moscow'},trip);
  assert.equal(e.utcMillis-m.utcMillis,3*3600000);assert.equal(w.utcMillis-e.utcMillis,5*3600000);assert.equal(e.originalLocalTime,'2026-10-20T15:00');
});

test('events off regular sampling grid appear once, including co-located simultaneous events',()=>{
  const {trip,route}=fixture([[55,37,'2026-10-20T08:00:03','departure'],[55,37.01,'2026-10-20T08:03:07','arrival'],[55,37.01,'2026-10-20T08:03:07','departure'],[55,37.02,'2026-10-20T08:06:13','arrival']]);
  const r=reconstruct(trip,route);assert.equal(r.status,'completed');const rows=r.track.filter(p=>p.timestampUtc==='2026-10-20T05:03:07.000Z');assert.equal(rows.length,1);assert.deepEqual(rows[0].events,['arrival','departure']);assert.deepEqual(rows[0].pointIds,['p1','p2']);
});

test('instantaneous co-located events create one message with all source references',()=>{
  const {trip,route}=fixture([[55,37,'2026-10-20T08:00:03','arrival'],[55,37,'2026-10-20T08:00:03','departure']]);
  const r=reconstruct(trip,route);assert.equal(r.status,'completed');assert.equal(r.track.length,1);assert.deepEqual(r.track[0].pointIds,['p0','p1']);assert.deepEqual(r.track[0].events,['arrival','departure']);
});

test('acceleration, speed and integrated distance agree within sampling tolerance',()=>{
  const {trip,route}=fixture([[55,37,'2026-10-20T08:00','departure'],[55,37.1,'2026-10-20T08:10','arrival']],{stepSeconds:1,stopStepSeconds:1});const r=reconstruct(trip,route);assert.equal(r.status,'completed');
  for(let i=1;i<r.track.length;i++){const p=r.track[i-1],q=r.track[i],dt=(Date.parse(q.timestampUtc)-Date.parse(p.timestampUtc))/1000;if(dt===0)continue;assert(Math.abs(q.speedKph-p.speedKph)/3.6/dt<=trip.profile.accelerationMps2+0.002);const distance=q.distanceM-p.distanceM;const integral=(q.speedKph+p.speedKph)/7.2*dt;assert(Math.abs(distance-integral)<0.1);}
});

test('passing checkpoint does not reset accumulated continuous driving',()=>{
  const {trip,route}=fixture([[55,37,'2026-10-20T08:00'],[55,37.1,'2026-10-20T08:08'],[55,37.2,'2026-10-20T08:16']],{continuousDriveHours:0.15,breakMinutes:1,stepSeconds:5});
  const r=reconstruct(trip,route);assert.equal(r.status,'completed');assert(r.stops.some(s=>s.legIndex===1));
  const tooTight=clone(trip);tooTight.points[2].localTime='2026-10-20T08:13';const bad=reconstruct(tooTight,route);assert.equal(bad.status,'conflict');
});

test('missing geometry and snapping cannot silently fabricate a route',()=>{
  const {trip,route}=fixture([[55,37,'2026-10-20T08:00'],[55,37.1,'2026-10-20T09:00']]);assert.equal(reconstruct(trip,null).status,'conflict');
  route.legs[0].points[0]=[55.001,37];const r=reconstruct(trip,route);assert.equal(r.status,'conflict');assert(r.checks.some(c=>c.code==='ROAD_SNAP'&&c.details.startSnapM>100));
  const d=clone(demoTrip);d.points[0].lat+=0.01;assert(reconstruct(d,d.route).checks.some(c=>c.code==='DEMO_POINTS'));
});

test('coordinate, chronology, telemetry and offset conflicts remain explicit',()=>{
  const {trip}=fixture([[55,37,'2026-10-20T08:00'],[55,37.1,'2026-10-20T07:00']]);assert(validateTrip(trip).some(c=>c.code==='ORDER'));
  trip.points[1].lat=100;assert(validateTrip(trip).some(c=>c.code==='COORDINATES'));
  trip.telemetry=[{timestampUtc:'2026-10-20T04:00:00Z',lat:55,lon:37}];const original=clone(trip.telemetry);validateTrip(trip);assert.deepEqual(trip.telemetry,original);assert(validateTrip(trip).some(c=>c.code==='TELEMETRY_GAPS'));
});

test('locked pause conflict is explicit and unchanged baseline is accepted',()=>{
  const trip=clone(demoTrip),r=reconstruct(trip,trip.route);trip.stopOverrides=[{...r.stops[0],locked:true}];assert.equal(reconstruct(trip,trip.route).status,'completed');
  trip.stopOverrides[0].durationSeconds+=60;assert.equal(reconstruct(trip,trip.route).status,'completed');
  trip.stopOverrides[0].durationSeconds+=7200;const bad=reconstruct(trip,trip.route);assert.equal(bad.status,'conflict');assert(bad.checks.some(c=>c.code==='LOCKED_STOP_CONFLICT'));
});

test('ordinary pause can be moved, resized, deleted, and pinned across profile recalculation',()=>{
  const {trip,route}=fixture([[55,37,'2026-10-20T08:00'],[55,37.1,'2026-10-20T08:20']]);
  const base=reconstruct(trip,route);assert.equal(base.stops.length,1);const s=base.stops[0];
  trip.stopOverrides=[{id:s.id,startUtc:new Date(Date.parse(s.startUtc)+10000).toISOString(),durationSeconds:s.durationSeconds-60,fraction:0.55,locked:true}];
  const edited=reconstruct(trip,route);assert.equal(edited.status,'completed');assert.equal(edited.stops[0].locked,true);assert.equal(edited.stops[0].durationSeconds,s.durationSeconds-60);assert(Math.abs(edited.stops[0].distanceM/base.summary.distanceM-0.55)<1e-6);
  const pinned=clone(edited.stops[0]);trip.stopOverrides=[pinned];trip.profile.cruiseSpeedKph=60;
  const recalculated=reconstruct(trip,route);assert.equal(recalculated.status,'completed');assert.equal(recalculated.stops[0].startUtc,pinned.startUtc);assert.equal(recalculated.stops[0].lat,pinned.lat);assert(Math.abs(recalculated.summary.driveSeconds+recalculated.summary.stopSeconds-1200)<0.001);
  trip.stopOverrides=[{id:s.id,deleted:true}];const deleted=reconstruct(trip,route);assert.equal(deleted.status,'completed');assert.equal(deleted.stops.length,0);assert.equal(deleted.summary.stopSeconds,0);
});

test('arrival and departure at a shared place form a factual rest interval',()=>{
  const {trip,route}=fixture([[55,37,'2026-10-20T08:00','departure'],[55,37.1,'2026-10-20T09:00','arrival'],[55,37.1,'2026-10-20T10:00','departure'],[55,37.2,'2026-10-20T11:00','arrival']]);
  const r=reconstruct(trip,route);assert.equal(r.status,'completed');const s=r.stops.find(x=>x.type==='confirmed');assert(s);assert.equal(s.durationSeconds,3600);
  trip.stopOverrides=[{id:s.id,deleted:true}];const bad=reconstruct(trip,route);assert.equal(bad.status,'conflict');assert(bad.checks.some(c=>c.code==='CONFIRMED_STOP'));
});
