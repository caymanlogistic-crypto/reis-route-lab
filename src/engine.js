import { DateTime, IANAZone } from 'luxon';
import tzlookup from 'tz-lookup';

export const algorithmVersion = '1.0.0';
export const defaultProfile = Object.freeze({name:'Фура · модельные допущения',maxSpeedKph:80,cruiseSpeedKph:65,accelerationMps2:0.3,continuousDriveHours:4.5,breakMinutes:45,nightRestHours:9,drivers:1,stepSeconds:10,stopStepSeconds:60,weight:20,maxWeight:40,axleWeight:10,height:4,width:2.55,length:16.5,hasTrailer:true});
export class EngineError extends Error { constructor(code,message,details={}) { super(message); this.name='EngineError'; this.code=code; this.details=details; } }
const fail=(code,message,details)=>{throw new EngineError(code,message,details)};
const check=(severity,code,message,extra={})=>({severity,code,message,...extra});
const iso=t=>new Date(Math.round(t)).toISOString();
const rad=x=>x*Math.PI/180;
export function haversine(a,b) { const q=Math.sin(rad(b[0]-a[0])/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(rad(b[1]-a[1])/2)**2; return 6371008.8*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q))); }
function zoneAt(lat,lon,fallback='Etc/UTC') { try{return tzlookup(lat,lon)}catch{return fallback} }

export function resolveTime(point,trip={}) {
  const zone=trip.timeMode==='local'?(point.timezone||zoneAt(Number(point.lat),Number(point.lon))):(trip.timezone||'');
  if(!IANAZone.isValidZone(zone)) fail('TIMEZONE','Укажите действующий IANA-пояс времени.',{pointId:point.id});
  const original=point.localTime;
  if(typeof original!=='string'||!/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(original)) fail('TIME_FORMAT','Нужны полная дата и время без неявного пояса.',{pointId:point.id});
  const input=original.replace(' ','T');
  let dt=DateTime.fromISO(input,{zone,setZone:true});
  const components=DateTime.fromISO(input,{zone:'UTC'});
  if(!dt.isValid||!components.isValid) fail('TIME_FORMAT','Некорректная дата или время.',{pointId:point.id});
  if(['year','month','day','hour','minute','second','millisecond'].some(k=>dt[k]!==components[k])) fail('TIME_NONEXISTENT','Такого местного времени нет при переходе UTC-смещения.',{pointId:point.id,timezone:zone});
  const candidates=dt.getPossibleOffsets();
  if(candidates.length>1) {
    if(point.utcOffsetMinutes===undefined||point.utcOffsetMinutes===null||point.utcOffsetMinutes==='') fail('TIME_AMBIGUOUS','Местное время повторяется. Выберите UTC-смещение явно.',{pointId:point.id,offsets:candidates.map(d=>d.offset)});
    dt=candidates.find(x=>x.offset===Number(point.utcOffsetMinutes));
    if(!dt) fail('TIME_OFFSET','Указанное UTC-смещение не подходит для этой даты и пояса.',{pointId:point.id});
  } else if(point.utcOffsetMinutes!==undefined&&point.utcOffsetMinutes!==null&&point.utcOffsetMinutes!==''&&Number(point.utcOffsetMinutes)!==dt.offset) fail('TIME_OFFSET','UTC-смещение не соответствует правилам пояса на эту дату.',{pointId:point.id});
  return {timestampUtc:dt.toUTC().toISO(),utcMillis:dt.toMillis(),timezone:zone,utcOffsetMinutes:dt.offset,originalLocalTime:original};
}

export function validateTrip(trip) {
  const checks=[], pts=trip.points||[],profile={...defaultProfile,...trip.profile};
  if(!['single','local'].includes(trip.timeMode)) checks.push(check('error','TIME_MODE','Выберите единый пояс или местное время каждой точки.'));
  if(pts.length<2||pts.length>50) checks.push(check('error','POINT_COUNT','Нужно от 2 до 50 контрольных точек.'));
  const ids=new Set(), times=[];
  for(let i=0;i<pts.length;i++) {
    const p=pts[i],extra={pointId:p.id,legIndex:Math.max(0,i-1)};
    if(!p.id||ids.has(p.id)) checks.push(check('error','POINT_ID','У каждой точки должен быть уникальный идентификатор.',extra)); ids.add(p.id);
    if(p.lat===''||p.lon===''||p.lat===null||p.lon===null||!Number.isFinite(Number(p.lat))||!Number.isFinite(Number(p.lon))||Math.abs(Number(p.lat))>90||Math.abs(Number(p.lon))>180) checks.push(check('error','COORDINATES','Некорректные координаты WGS84. Проверьте широту и долготу.',extra));
    try { times.push(resolveTime(p,trip).utcMillis); } catch(e) { checks.push(check('error',e.code||'TIME',e.message,extra)); times.push(null); }
    if(i&&times[i]!==null&&times[i-1]!==null) {
      if(times[i]<times[i-1]) checks.push(check('error','ORDER','Время UTC убывает; порядок посещения сохранён. Исправьте исходные отметки.',extra));
      else if(times[i]===times[i-1]&&haversine([+p.lat,+p.lon],[+pts[i-1].lat,+pts[i-1].lon])>0.1) checks.push(check('error','SIMULTANEOUS','В один момент указаны разные координаты.',extra));
    }
    if(p.timeAccuracy==='approximate'||p.timeFrom||p.timeTo) checks.push(check('error','APPROXIMATE_TIME','В этой версии расчёт требует выбранного точного времени внутри указанного интервала.',extra));
  }
  for(const key of ['maxSpeedKph','cruiseSpeedKph','accelerationMps2','continuousDriveHours','breakMinutes','nightRestHours','drivers']) if(!Number.isFinite(Number(profile[key]))||Number(profile[key])<=0) checks.push(check('error','PROFILE',`Параметр ${key} должен быть положительным.`));
  if(profile.maxSpeedKph>150||profile.cruiseSpeedKph>profile.maxSpeedKph||profile.accelerationMps2>3||profile.continuousDriveHours>24||profile.breakMinutes>1440||profile.drivers>4) checks.push(check('error','PROFILE_LIMITS','Параметры модели вне допустимого диапазона; крейсерская скорость не должна превышать предел.'));
  if(![1,5,10,30,60].includes(Number(profile.stepSeconds))||!Number.isFinite(+profile.stopStepSeconds)||profile.stopStepSeconds<1||profile.stopStepSeconds>3600) checks.push(check('error','STEP','Шаг движения: 1, 5, 10, 30 или 60 секунд; шаг стоянки — от 1 до 3600 секунд.'));
  if(times.length>1&&times[0]!==null&&times.at(-1)!==null&&(times.at(-1)-times[0])>31*86400000) checks.push(check('error','DURATION_LIMIT','Один расчёт ограничен 31 сутками. Разделите длинный рейс.'));
  if(trip.telemetry?.length) checks.push(check('error','TELEMETRY_GAPS','Исходная телеметрия сохранена, но для реконструкции её пропусков требуется отдельный выбор интервалов. Существующие сообщения не изменены.'));
  return checks;
}

function geometry(raw) {
  const pts=raw.points||[];
  if(pts.length<2||pts.some(p=>!Array.isArray(p)||p.length<2||!Number.isFinite(+p[0])||!Number.isFinite(+p[1])||Math.abs(+p[0])>90||Math.abs(+p[1])>180)) fail('GEOMETRY','Нет непрерывной дорожной геометрии участка.');
  const points=pts.map(p=>[+p[0],+p[1]]), cumulative=[0];
  for(let i=1;i<points.length;i++) cumulative.push(cumulative[i-1]+haversine(points[i-1],points[i]));
  return {points,cumulative,length:cumulative.at(-1),routerDistanceM:Number(raw.distanceM)||0};
}
function position(g,d) {
  d=Math.max(0,Math.min(g.length,d));
  let lo=0,hi=g.cumulative.length-1;
  while(lo+1<hi) {const m=(lo+hi)>>1;if(g.cumulative[m]<=d)lo=m;else hi=m;}
  const a=g.points[lo],b=g.points[hi],span=g.cumulative[hi]-g.cumulative[lo],f=span?(d-g.cumulative[lo])/span:0;
  const lat=a[0]+(b[0]-a[0])*f,lon=a[1]+(b[1]-a[1])*f;
  const y=Math.sin(rad(b[1]-a[1]))*Math.cos(rad(b[0])); const x=Math.cos(rad(a[0]))*Math.sin(rad(b[0]))-Math.sin(rad(a[0]))*Math.cos(rad(b[0]))*Math.cos(rad(b[1]-a[1]));
  return {lat,lon,course:(Math.atan2(y,x)*180/Math.PI+360)%360};
}
function capacity(t,v,a) {return t>=2*v/a?v*(t-v/a):a*t*t/4;}
function chunksFor(t,used,limit,split=false) {
  const chunks=[]; let remaining=t,allow=limit-used;
  if(allow<1e-6) allow=limit;
  while(remaining>1e-6) {const d=Math.min(remaining,allow);chunks.push(d);remaining-=d;allow=limit;if(chunks.length>1000)fail('RESOURCE_LIMIT','Слишком много остановок.');}
  if(split&&chunks.length===1&&chunks[0]>2) return [chunks[0]/2,chunks[0]/2];
  return chunks;
}
function driveTime(distance,v,a,used,limit,split=false) {
  if(distance<0.0001)return 0;
  let lo=0,hi=Math.max(distance/v*2+2*v/a,60);
  const cap=t=>chunksFor(t,used,limit,split).reduce((s,c)=>s+capacity(c,v,a),0);
  while(cap(hi)<distance) {hi*=2;if(hi>31*86400)fail('RESOURCE_LIMIT','Слишком длинный участок.');}
  for(let i=0;i<70;i++) {const m=(lo+hi)/2;if(cap(m)<distance)lo=m;else hi=m;}
  return hi;
}
function peakFor(distance,t,a,maxV) {let lo=0,hi=maxV;for(let i=0;i<60;i++){const m=(lo+hi)/2;if(capacity(t,m,a)<distance)lo=m;else hi=m;}return (lo+hi)/2;}
function motion(t,duration,peak,a) {
  t=Math.max(0,Math.min(duration,t));const ramp=Math.min(peak/a,duration/2),cruise=duration-2*ramp;
  if(t<=ramp) return {distance:0.5*a*t*t,speed:a*t};
  if(t<=ramp+cruise) return {distance:0.5*a*ramp*ramp+peak*(t-ramp),speed:peak};
  const q=t-ramp-cruise;return {distance:0.5*a*ramp*ramp+peak*cruise+peak*q-0.5*a*q*q,speed:Math.max(0,peak-a*q)};
}

function projectOnGeometry(g,lat,lon) {
  let best={error:Infinity,distance:0,lat:g.points[0][0],lon:g.points[0][1]};
  for(let i=1;i<g.points.length;i++) {
    const a=g.points[i-1],b=g.points[i],scale=Math.cos(rad(lat));
    const dx=(b[1]-a[1])*scale,dy=b[0]-a[0],den=dx*dx+dy*dy;
    const f=den?Math.max(0,Math.min(1,((lon-a[1])*scale*dx+(lat-a[0])*dy)/den)):0;
    const candidate=[a[0]+dy*f,a[1]+(b[1]-a[1])*f],error=haversine([lat,lon],candidate);
    if(error<best.error)best={error,distance:g.cumulative[i-1]+(g.cumulative[i]-g.cumulative[i-1])*f,lat:candidate[0],lon:candidate[1]};
  }
  return best;
}

function applyStopOverrides(baselineSegments,baselineStops,trip,times,geoms,profile,checks) {
  const overrides=trip.stopOverrides||[],known=new Set(baselineStops.map(s=>s.id));
  for(const o of overrides)if(!known.has(o.id))checks.push(check('error','STOP_UNKNOWN','Изменённая остановка отсутствует в этом сценарии. Пересмотрите закреплённые предположения.',{legIndex:o.legIndex}));
  if(checks.some(c=>c.severity==='error'))return null;
  const segments=[],stops=[];let used=0,distanceStart=0,driveSeconds=0,stopSeconds=0;
  const limit=profile.continuousDriveHours*3600,a=profile.accelerationMps2,maxV=profile.maxSpeedKph/3.6;
  for(let i=0;i<geoms.length;i++) {
    const g=geoms[i],begin=times[i].utcMillis,end=times[i+1].utcMillis;
    const selected=[];
    for(const old of baselineStops.filter(s=>s.legIndex===i)) {
      const o=overrides.find(s=>s.id===old.id),stop={...old};
      if(o?.deleted) {
        if(old.type==='confirmed')checks.push(check('error','CONFIRMED_STOP','Подтверждённая остановка задана исходными событиями и не может быть удалена как предположение.',{legIndex:i}));
        continue;
      }
      if(o) {
        if(o.startUtc!==undefined)stop.startUtc=o.startUtc;
        if(o.durationSeconds!==undefined)stop.durationSeconds=Number(o.durationSeconds);
        else if(o.endUtc!==undefined)stop.durationSeconds=(Date.parse(o.endUtc)-Date.parse(stop.startUtc))/1000;
        const start=Date.parse(stop.startUtc),finish=start+stop.durationSeconds*1000;
        if(!Number.isFinite(start)||!Number.isFinite(finish)||stop.durationSeconds<0) {checks.push(check('error','STOP_TIME','Неверное время или длительность изменённой остановки.',{legIndex:i}));continue;}
        stop.startUtc=iso(start);stop.endUtc=iso(finish);stop.locked=!!o.locked;
        if(o.fraction!==undefined) {
          if(!Number.isFinite(+o.fraction)||o.fraction<0||o.fraction>1) {checks.push(check('error','STOP_POSITION','Положение остановки должно находиться внутри участка.',{legIndex:i}));continue;}
          const pos=position(g,g.length*Number(o.fraction));stop.lat=pos.lat;stop.lon=pos.lon;stop.distanceM=distanceStart+g.length*Number(o.fraction);
        } else if(o.lat!==undefined||o.lon!==undefined) {
          if(!Number.isFinite(+o.lat)||!Number.isFinite(+o.lon)) {checks.push(check('error','STOP_POSITION','Для перемещения остановки нужны обе координаты.',{legIndex:i}));continue;}
          const projection=projectOnGeometry(g,+o.lat,+o.lon);
          if(projection.error>1) {checks.push(check('error','STOP_ACCESS','Новое место остановки находится вне выбранной геометрии; грузовой подъезд не подтверждён.',{legIndex:i,details:{offsetM:projection.error}}));continue;}
          stop.lat=projection.lat;stop.lon=projection.lon;stop.distanceM=distanceStart+projection.distance;
        }
        if(old.type==='confirmed'&&(Math.abs(Date.parse(stop.startUtc)-Date.parse(old.startUtc))>1||Math.abs(stop.durationSeconds-old.durationSeconds)>0.001||haversine([stop.lat,stop.lon],[old.lat,old.lon])>0.1))checks.push(check('error','CONFIRMED_STOP','Нельзя изменить подтверждённую стоянку без изменения её исходных событий.',{legIndex:i}));
        if(old.type!=='confirmed'){stop.type=stop.durationSeconds>=profile.nightRestHours*3600?'assumed-night':'assumed-stop';stop.reason='Пользовательское изменение расчётного предположения; факт стоянки не подтверждён.';}
      }
      selected.push(stop);
    }
    selected.sort((a,b)=>Date.parse(a.startUtc)-Date.parse(b.startUtc));
    let cursor=begin,localDistance=0;
    const addDrive=(finish,finishDistance)=>{
      const duration=(finish-cursor)/1000,distance=finishDistance-localDistance;
      if(duration<-0.001||distance<-0.1||finish>end+1) {checks.push(check('error','LOCKED_STOP_CONFLICT','Остановки перекрываются, выходят за времена опор или меняют порядок движения.',{legIndex:i}));return;}
      if(distance<0.0001&&duration>0.001) {
        const pos=position(g,localDistance),s={id:`wait-${i}-${stops.length}`,legIndex:i,startUtc:iso(cursor),endUtc:iso(finish),durationSeconds:duration,lat:pos.lat,lon:pos.lon,distanceM:distanceStart+localDistance,type:'assumed-stop',source:'reconstruction',name:'Место остановки не установлено',reason:'Ожидание при согласовании изменённой стоянки.',locked:false,uncertaintyRadiusM:1000};
        stops.push(s);segments.push({kind:'stop',start:cursor,end:finish,legIndex:i,localDistance,distanceStart,stop:s,g});stopSeconds+=duration;if(duration>=profile.breakMinutes*60)used=0;cursor=finish;return;
      }
      if(distance<0.0001){cursor=finish;return;}
      if(duration<=0||capacity(duration,maxV,a)+0.1<distance) {checks.push(check('error','LOCKED_STOP_CONFLICT','После изменения стоянки недостаточно времени для движения с заданными скоростью и ускорением.',{legIndex:i,details:{availableSeconds:duration,distanceM:distance}}));return;}
      if(used+duration>limit+0.01) {checks.push(check('error','CONTINUOUS_DRIVE','Изменённая стоянка нарушает выбранный предел непрерывного движения. Увеличьте паузу или измените профиль.',{legIndex:i,details:{driveSeconds:used+duration,limitSeconds:limit}}));return;}
      const peak=peakFor(distance,duration,a,maxV);
      if(distance/duration*3.6<15&&duration>3600) {checks.push(check('error','UNEXPLAINED_SLOW','После удаления или сокращения паузы возникает многочасовое движение со средней скоростью ниже 15 км/ч. Сохраните видимое ожидание или измените времена.',{legIndex:i}));return;}
      segments.push({kind:'drive',start:cursor,end:finish,legIndex:i,localDistance,distanceStart,distance,duration,peak,a,g});driveSeconds+=duration;used+=duration;cursor=finish;localDistance=finishDistance;
    };
    for(const stop of selected) {
      const start=Date.parse(stop.startUtc),finish=Date.parse(stop.endUtc),d=stop.distanceM-distanceStart;
      addDrive(start,d);
      if(checks.some(c=>c.severity==='error'))break;
      if(finish>end+1) {checks.push(check('error','LOCKED_STOP_CONFLICT','Изменённая стоянка заканчивается после следующей фиксированной отметки.',{legIndex:i}));break;}
      stops.push(stop);segments.push({kind:'stop',start,end:finish,legIndex:i,localDistance:d,distanceStart,stop,g});stopSeconds+=stop.durationSeconds;if(stop.durationSeconds>=profile.breakMinutes*60)used=0;cursor=finish;localDistance=d;
    }
    if(!checks.some(c=>c.severity==='error'))addDrive(end,g.length);
    distanceStart+=g.length;
  }
  if(checks.some(c=>c.severity==='error'))return null;
  return {segments,stops,driveSeconds,stopSeconds};
}

export function reconstruct(trip,route) {
  const profile={...defaultProfile,...trip.profile},checks=validateTrip(trip), assumptions=[
    'Это расчётное восстановление; оно не подтверждает фактическое движение или отдых.',
    'Скорость, ускорение, паузы и ночной отдых — пользовательские модельные допущения, не юридическая проверка режима труда.',
    'Пробки прошлой даты не восстановлены; конкретные дорожные ограничения скорости неизвестны.',
    'Пробег измеряется по предоставленной геометрии методом большого круга; длина маршрутизатора хранится отдельно.',
    'Границы временных зон: tz-lookup 6.1.25, приблизительная географическая сетка; правила IANA предоставляет Intl среды выполнения.',
    'Модель плавно снижает скорость до нуля на временных опорах; проезд опоры не обнуляет накопленное движение.'
  ];
  const result={status:'conflict',track:[],stops:[],checks,assumptions,summary:{},algorithmVersion};
  assumptions.push(...(route?.notes||[]));
  if(checks.some(c=>c.severity==='error'))return result;
  const pts=trip.points,times=pts.map(p=>resolveTime(p,trip));
  if(!route||!Array.isArray(route.legs)||route.legs.length!==pts.length-1) { checks.push(check('error','ROUTE_MISSING','Постройте автомобильный маршрут для всех участков. Прямые линии не используются.'));return result; }
  if(route.source==='demo') {
    if(!pts.every((p,i)=>demoTrip.points[i]&&+p.lat===demoTrip.points[i].lat&&+p.lon===demoTrip.points[i].lon)||pts.length!==demoTrip.points.length) {checks.push(check('error','DEMO_POINTS','Демонстрационная геометрия применима только к исходным демонстрационным координатам.'));return result;}
    checks.push(check('warning','DEMO','Собственная синтетическая геометрия: не реальный дорожный маршрут.'));assumptions.push('Демонстрационная геометрия создана для проверки алгоритма и не подтверждает существование дорог.');
  }
  if(route.source!=='yandex'&&route.source!=='demo') {checks.push(check('error','ROUTE_SOURCE','Неизвестный источник маршрута.'));return result;}
  const stops=[], segments=[], geoms=[];let totalDistance=0,driveSeconds=0,stopSeconds=0,used=0;
  const limit=+profile.continuousDriveHours*3600,a=+profile.accelerationMps2,maxV=+profile.maxSpeedKph/3.6,cruiseV=+profile.cruiseSpeedKph/3.6;
  for(let i=0;i<route.legs.length;i++) {
    let g; try{g=geometry(route.legs[i]);}catch(e){checks.push(check('error',e.code,e.message,{legIndex:i}));continue;}geoms.push(g);
    const p=pts[i],q=pts[i+1],begin=times[i].utcMillis,end=times[i+1].utcMillis,available=(end-begin)/1000;
    const startSnap=haversine([+p.lat,+p.lon],g.points[0]),endSnap=haversine([+q.lat,+q.lon],g.points.at(-1));
    if(startSnap>0.25||endSnap>0.25) {checks.push(check('error','ROAD_SNAP','Дорожная геометрия не достигает фиксированной опоры. Подъезд не подтверждён; координата не перенесена.',{legIndex:i,details:{startSnapM:startSnap,endSnapM:endSnap}}));continue;}
    if(available===0) { if(g.length>0.1)checks.push(check('error','ZERO_TIME','Ненулевой путь невозможно пройти за нулевое время.',{legIndex:i}));continue; }
    const samePlace=haversine([+p.lat,+p.lon],[+q.lat,+q.lon])<0.1;
    const confirmed=samePlace&&(['arrival','rest','overnight','loading','unloading'].includes(p.event)||q.event==='departure');
    if(g.length<0.1) {
      const s={id:`stop-${i}-0`,legIndex:i,startUtc:iso(begin),endUtc:iso(end),durationSeconds:available,lat:+p.lat,lon:+p.lon,distanceM:totalDistance,type:confirmed?'confirmed':'assumed-stop',source:confirmed?(p.source||'user'):'reconstruction',name:confirmed?(p.name||'Подтверждённая остановка'):'Место остановки не установлено',reason:confirmed?'Начало и окончание стоянки заданы исходными событиями.':'Координаты опор совпадают; модель ожидания.',locked:confirmed,uncertaintyRadiusM:confirmed?Number(p.radiusM)||0:1000};
      stops.push(s);segments.push({kind:'stop',start:begin,end,legIndex:i,localDistance:0,distanceStart:totalDistance,stop:s,g});stopSeconds+=available;if(available>=+profile.breakMinutes*60)used=0;continue;
    }
    let minTime=driveTime(g.length,maxV,a,used,limit),preferred=driveTime(g.length,cruiseV,a,used,limit),split=false;
    const prefixBreak=used>=limit-1e-5?1:0;
    let minChunks=chunksFor(minTime,used,limit),minBreaks=minChunks.length-1+prefixBreak;
    if(minTime+minBreaks*profile.breakMinutes*60>available+1e-6) {checks.push(check('error','IMPOSSIBLE','Недостаточно времени для участка при заданных скорости, ускорении и отдыхе.',{legIndex:i,details:{availableSeconds:available,necessarySeconds:minTime+minBreaks*profile.breakMinutes*60,distanceM:g.length,requiredAverageKph:g.length/available*3.6}}));continue;}
    let tDrive=preferred,chunks=chunksFor(tDrive,used,limit),breaks=chunks.length-1+prefixBreak;
    if(tDrive+breaks*profile.breakMinutes*60>available) {
      // Choose the slowest feasible duration between the physical minimum and preferred.
      let lo=minTime,hi=preferred;for(let n=0;n<60;n++){const mid=(lo+hi)/2,c=chunksFor(mid,used,limit),needed=mid+(c.length-1+prefixBreak)*profile.breakMinutes*60;if(needed<=available)lo=mid;else hi=mid;}tDrive=lo;chunks=chunksFor(tDrive,used,limit);breaks=chunks.length-1+prefixBreak;
    }
    let idle=available-tDrive;
    if(idle>300&&chunks.length===1) {
      const splitPreferred=driveTime(g.length,cruiseV,a,used,limit,true);
      if(splitPreferred+300<=available) {split=true;tDrive=splitPreferred;chunks=chunksFor(tDrive,used,limit,true);breaks=chunks.length-1+prefixBreak;idle=available-tDrive;}
    }
    // A small slack remains movement, while material slack is always a visible pause.
    if(breaks===0&&idle>1e-5) {tDrive=available;chunks=chunksFor(tDrive,used,limit);idle=0;}
    const slots=[];if(prefixBreak)slots.push(-1);for(let n=0;n<chunks.length-1;n++)slots.push(n);
    const pauseDurations=slots.map(()=>split?0:+profile.breakMinutes*60);
    if(slots.length) pauseDurations[Math.floor((slots.length-1)/2)]+=Math.max(0,idle-pauseDurations.reduce((s,n)=>s+n,0));
    let cursor=begin,dLocal=0;
    const capSum=chunks.reduce((s,t)=>s+capacity(t,maxV,a),0);
    const addStop=(slotIndex)=>{
      let duration=pauseDurations[slotIndex];if(duration<=0)return;
      const pos=position(g,dLocal),id=`stop-${i}-${slotIndex}`,override=(trip.stopOverrides||[]).find(s=>s.id===id&&!s.deleted);
      const night=duration>=+profile.nightRestHours*3600;
      const s={id,legIndex:i,startUtc:iso(cursor),endUtc:iso(cursor+duration*1000),durationSeconds:duration,lat:pos.lat,lon:pos.lon,distanceM:totalDistance+dLocal,type:night?'assumed-night':'assumed-stop',source:'reconstruction',name:'Место остановки не установлено',reason:night?'Достаточный запас времени для предполагаемого ночного отдыха.':slots[slotIndex]===-1||(!split&&duration>=profile.breakMinutes*60)?'Пауза по выбранному предпочтению непрерывного движения и запасу времени.':'Распределение временного запаса между опорами.',locked:!!override?.locked,uncertaintyRadiusM:1000};
      stops.push(s);segments.push({kind:'stop',start:cursor,end:cursor+duration*1000,legIndex:i,localDistance:dLocal,distanceStart:totalDistance,stop:s,g});cursor+=duration*1000;stopSeconds+=duration;if(duration>=profile.breakMinutes*60)used=0;
    };
    if(prefixBreak)addStop(0);
    for(let n=0;n<chunks.length;n++) {
      const duration=chunks[n],distance=g.length*capacity(duration,maxV,a)/capSum,peak=peakFor(distance,duration,a,maxV);
      segments.push({kind:'drive',start:cursor,end:cursor+duration*1000,legIndex:i,localDistance:dLocal,distanceStart:totalDistance,distance,duration,peak,a,g});cursor+=duration*1000;dLocal+=distance;driveSeconds+=duration;used+=duration;
      if(n<chunks.length-1)addStop(n+prefixBreak);
    }
    totalDistance+=g.length;
    if(Math.abs(cursor-end)>2) checks.push(check('error','SCHEDULE_INTEGRITY','Внутренняя проверка временного баланса не пройдена.',{legIndex:i}));
    checks.push(check('info','LEG_FEASIBLE',`Участок ${i+1}: ${(g.length/1000).toFixed(1)} км; движение ${(tDrive/3600).toFixed(2)} ч; паузы ${(idle/3600).toFixed(2)} ч.`,{legIndex:i,details:{distanceM:g.length,availableSeconds:available,driveSeconds:tDrive,stopSeconds:idle,minimumSeconds:minTime,requiredAverageKph:g.length/tDrive*3.6}}));
  }
  if(checks.some(c=>c.severity==='error'))return result;
  if(trip.stopOverrides?.length) {
    const edited=applyStopOverrides(segments,stops,trip,times,geoms,profile,checks);
    if(!edited)return result;
    segments.splice(0,segments.length,...edited.segments);stops.splice(0,stops.length,...edited.stops);driveSeconds=edited.driveSeconds;stopSeconds=edited.stopSeconds;
    for(const c of checks.filter(c=>c.code==='LEG_FEASIBLE')) {
      const legDrive=segments.filter(s=>s.legIndex===c.legIndex&&s.kind==='drive').reduce((sum,s)=>sum+s.duration,0),legStops=stops.filter(s=>s.legIndex===c.legIndex).reduce((sum,s)=>sum+s.durationSeconds,0);
      c.details.driveSeconds=legDrive;c.details.stopSeconds=legStops;c.details.requiredAverageKph=legDrive?c.details.distanceM/legDrive*3.6:0;
      c.message=`Участок ${c.legIndex+1}: ${(c.details.distanceM/1000).toFixed(1)} км; движение ${(legDrive/3600).toFixed(2)} ч; паузы ${(legStops/3600).toFixed(2)} ч.`;
    }
    checks.push(check('info','STOP_OVERRIDES','Изменения расчётных остановок проверены с сохранением времён опор.'));
  }
  if(!segments.length&&geoms.length)segments.push({kind:'stop',start:times[0].utcMillis,end:times.at(-1).utcMillis,legIndex:0,localDistance:0,distanceStart:0,g:geoms[0]});
  if(stops.some(s=>s.source==='reconstruction'))checks.push(check('warning','STOP_LOCATION_UNKNOWN','Места предполагаемых остановок не установлены. Модельная позиция на маршруте не подтверждает парковку и разрешённый подъезд.'));
  const sampleTimes=new Set(times.map(t=>Math.round(t.utcMillis)));
  for(const s of segments) {
    sampleTimes.add(Math.round(s.start));sampleTimes.add(Math.round(s.end));
    const step=(s.kind==='stop'?profile.stopStepSeconds:profile.stepSeconds)*1000;
    for(let t=s.start+step;t<s.end;t+=step) {sampleTimes.add(Math.round(t));if(sampleTimes.size>150000){checks.push(check('error','MESSAGE_LIMIT','Более 150 000 сообщений. Увеличьте шаг или разделите рейс.'));return result;}}
  }
  const sorted=[...sampleTimes].sort((a,b)=>a-b),track=[];let segIndex=0,maxSpeed=0;
  for(const t of sorted) {
    while(segIndex<segments.length-1&&t>segments[segIndex].end+0.001)segIndex++;
    const s=segments.find(x=>x.kind==='stop'&&t>=Math.round(x.start)&&t<=Math.round(x.end))||segments[segIndex];if(!s)continue;
    let distance=s.localDistance,speed=0;
    if(s.kind==='drive') {const m=motion((t-s.start)/1000,s.duration,s.peak,s.a);distance+=m.distance;speed=m.speed*3.6;}
    const pos=position(s.g,distance),anchors=pts.filter((p,i)=>Math.abs(times[i].utcMillis-t)<0.001);
    if(anchors.length) {pos.lat=+anchors[0].lat;pos.lon=+anchors[0].lon;}
    const zone=zoneAt(pos.lat,pos.lon,trip.timezone||'Etc/UTC'),dt=DateTime.fromMillis(t,{zone});
    maxSpeed=Math.max(maxSpeed,speed);
    track.push({seq:track.length+1,timestampUtc:iso(t),localTime:dt.toISO({includeOffset:false}),timezone:zone,utcOffsetMinutes:dt.offset,lat:pos.lat,lon:pos.lon,speedKph:speed,course:speed>0.001?pos.course:0,distanceM:s.distanceStart+distance,state:speed>0.001?'moving':'stopped',source:anchors.length?'checkpoint':'reconstruction',pointId:anchors[0]?.id||null,pointIds:anchors.map(p=>p.id),legIndex:s.legIndex,events:anchors.map(p=>p.event||'pass'),assumptions:anchors.length?[]:['modeled-motion'],satellites:null,hdop:null,altitude:null,ignition:null});
  }
  result.status='completed';result.track=track;result.stops=stops;result.summary={distanceM:totalDistance,routerDistanceM:geoms.reduce((s,g)=>s+g.routerDistanceM,0),driveSeconds,stopSeconds,durationSeconds:(times.at(-1).utcMillis-times[0].utcMillis)/1000,messageCount:track.length,checkpointCount:pts.length,startUtc:times[0].timestampUtc,endUtc:times.at(-1).timestampUtc,maxSpeedKph:maxSpeed};
  result.dataVersions={algorithm:algorithmVersion,luxon:'3.7.2',timezoneBoundaries:'tz-lookup 6.1.25 (approximate grid)',ianaRules:globalThis.process?.versions?.tz||'runtime Intl (version not exposed by runtime)',seed:null};
  return result;
}

// Own deliberately synthetic geometry. It is not a road survey or a Yandex route.
const demoPoints=[
  {id:'demo-p1',name:'Демо · отправление',lat:55.75,lon:37.61,localTime:'2026-10-20T08:00',event:'departure'},
  {id:'demo-p2',name:'Демо · опора 2',lat:55.83,lon:37.93,localTime:'2026-10-20T10:00',event:'pass'},
  {id:'demo-p3',name:'Демо · опора 3',lat:55.9,lon:38.3,localTime:'2026-10-20T13:00',event:'pass'},
  {id:'demo-p4',name:'Демо · опора 4',lat:56.01,lon:38.65,localTime:'2026-10-21T07:00',event:'pass'},
  {id:'demo-p5',name:'Демо · прибытие',lat:56.12,lon:39.02,localTime:'2026-10-21T09:00',event:'arrival'}
].map(p=>({...p,timezone:'Europe/Moscow',source:'user',radiusM:100,coordinateAccuracyM:100,timeAccuracy:'exact',fixedCoordinates:true,fixedTime:true,comment:'Собственные демонстрационные данные; не реальный рейс.'}));
const demoLegs=demoPoints.slice(1).map((q,i)=>{const p=demoPoints[i],points=[[p.lat,p.lon],[p.lat,p.lon+(q.lon-p.lon)*0.25],[p.lat+(q.lat-p.lat)*0.5,p.lon+(q.lon-p.lon)*0.25],[p.lat+(q.lat-p.lat)*0.5,q.lon],[q.lat,q.lon]];return {points,distanceM:points.slice(1).reduce((s,v,j)=>s+haversine(points[j],v),0),durationS:1800};});
export const demoTrip={title:'Демонстрация · пять контрольных точек',client:'Учебный пример',vehicle:'ДЕМО · фура',timeMode:'single',timezone:'Europe/Moscow',points:demoPoints,profile:{...defaultProfile},stopOverrides:[],notes:'Синтетическая геометрия. Только демонстрация расчёта, не дорожный маршрут.',route:{source:'demo',legs:demoLegs,disclaimer:'Собственная синтетическая геометрия; не подтверждает существование дорог.'}};

