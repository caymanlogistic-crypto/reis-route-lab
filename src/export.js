import { Zip, ZipDeflate, strToU8 } from 'fflate';
import { DateTime } from 'luxon';

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const workbookMime = MIME;
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const col = n => { let s=''; for(n++;n;n=Math.floor((n-1)/26)) s=String.fromCharCode(65+(n-1)%26)+s; return s; };
const safeNumber = n => typeof n === 'number' && Number.isFinite(n) ? n : null;
const dt = (value,zone) => { const d=DateTime.fromISO(String(value||''),{setZone:true}); return d.isValid ? (zone?d.setZone(zone):d) : null; };
const serial = d => (d.toUTC().toMillis()/86400000)+25569;
const wallSerial = d => Date.UTC(d.year,d.month-1,d.day,d.hour,d.minute,d.second,d.millisecond)/86400000+25569;
const sourceLabel = x => ({checkpoint:'Контрольная отметка',reconstruction:'Реконструкция',telemetry:'Исходная телеметрия',user:'Пользовательская отметка',gps:'GPS-запись',document:'Документ',driver:'Сообщение водителя'}[x]||x||'Неизвестно');
function cell(value,r,c,style=0) {
  const ref=`${col(c)}${r}`;
  if(value===null||value===undefined||value==='') return `<c r="${ref}" s="${style}"/>`;
  if(typeof value==='number'&&Number.isFinite(value))return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  if(typeof value==='boolean')return `<c r="${ref}" s="${style}" t="b"><v>${+value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(typeof value==='object'?JSON.stringify(value):value).slice(0,32767)}</t></is></c>`;
}

/** Immutable export adapter. No inferred telemetry fields are manufactured. */
export async function buildWorkbook(trip, version, profile={}) {
  if(version?.snapshot?.points)trip=version.snapshot;
  const result=version?.result;
  if(!result||!Array.isArray(result.track))throw new Error('У версии отсутствует готовый трек');
  if(result.track.length>150000)throw new Error('Выгрузка ограничена 150 000 сообщениями');
  const zone=profile.timezone||trip.timezone||'Europe/Moscow';
  if(!DateTime.now().setZone(zone).isValid)throw new Error('Недопустимый часовой пояс экспорта');
  const distanceFactor=profile.distanceUnit==='m'?1:0.001;
  const distanceTitle=profile.distanceUnit==='m'?'Расстояние, м':'Расстояние, км';
  const speedFactor=profile.speedUnit==='m/s'?1/3.6:1;
  const dateFormat=profile.dateFormat||'yyyy-mm-dd hh:mm:ss';
  const sum=result.summary||{};
  const meta=[['Рейс ID',trip.id],['Название',trip.title],['Клиент',trip.client],['Машина',trip.vehicle],['Версия расчёта',version.id],['Редакция исходников',version.revision],['Версия профиля экспорта',profile.version||1],['Профиль экспорта',profile.id||'universal'],['Алгоритм',result.algorithmVersion||'не указан'],['Источник геометрии',version.snapshot?.route?.source||trip.route?.source||'не указан'],['Дистанция по геометрии, км',safeNumber(sum.distanceM)===null?null:sum.distanceM/1000],['Дистанция маршрутизатора, км',safeNumber(sum.routerDistanceM)===null?null:sum.routerDistanceM/1000],['Время движения, с',sum.driveSeconds],['Время остановок, с',sum.stopSeconds],['Начало UTC',sum.startUtc],['Окончание UTC',sum.endUtc],['Опор',sum.checkpointCount??trip.points?.length],['Сообщений',result.track.length],['Пояс просмотра экспорта',zone],['Фактическое GPS-покрытие','Недостаточно исходных данных для метрики'],['Спутники, HDOP, высота, топливо','Неизвестны; расчёт не создаёт измерений'],['Назначение','Расчётный сценарий не подтверждает фактический путь или отдых'],['Лицензия геометрии','Условия хранения и экспорта проверяются по договору поставщика']];
  meta.push(['Режим дорожной маршрутизации',version.snapshot?.route?.mode||trip.route?.mode||(trip.demo?'Синтетический демопример':'Не указан')]);
  for(const a of result.assumptions||[])meta.push(['Допущение',typeof a==='string'?a:JSON.stringify(a)]);
  const defs=[
    {key:'seq',title:'№',get:p=>p.seq},
    {key:'timestampUtc',title:'UTC дата и время',style:3,get:p=>{const d=dt(p.timestampUtc);return d?serial(d):null;}},
    {key:'isoUtc',title:'ISO UTC',get:p=>p.timestampUtc},
    {key:'unix',title:'Unix timestamp, с',get:p=>{const d=dt(p.timestampUtc);return d?d.toMillis()/1000:null;}},
    {key:'localTime',title:'Местное время места',style:3,get:p=>{const d=dt(p.timestampUtc,p.timezone);return d?wallSerial(d):null;}},
    {key:'timezone',title:'IANA-пояс места',get:p=>p.timezone},
    {key:'utcOffsetMinutes',title:'Смещение места UTC, мин',get:p=>p.utcOffsetMinutes},
    {key:'displayTime',title:`Время просмотра (${zone})`,style:3,get:p=>{const d=dt(p.timestampUtc,zone);return d?wallSerial(d):null;}},
    {key:'displayTimezone',title:'Пояс просмотра',get:()=>zone},
    {key:'lat',title:'Широта WGS84',style:4,get:p=>p.lat},
    {key:'lon',title:'Долгота WGS84',style:4,get:p=>p.lon},
    {key:'speedKph',title:profile.speedUnit==='m/s'?'Скорость, м/с':'Скорость, км/ч',style:5,get:p=>typeof p.speedKph==='number'?p.speedKph*speedFactor:null},
    {key:'course',title:'Курс, градусы',style:5,get:p=>p.course},
    {key:'distanceM',title:distanceTitle,style:5,get:p=>typeof p.distanceM==='number'?p.distanceM*distanceFactor:null},
    {key:'state',title:'Состояние',get:p=>p.state==='stopped'?'Стоянка':p.state==='moving'?'Движение':p.state},
    {key:'source',title:'Происхождение данных',get:p=>sourceLabel(p.source)},
    {key:'pointId',title:'ID исходной опоры',get:p=>p.pointId},
    {key:'legIndex',title:'Участок',get:p=>p.legIndex===undefined?null:p.legIndex+1},
    {key:'events',title:'События',get:p=>Array.isArray(p.events)?p.events.join('; '):p.events},
    {key:'tripId',title:'ID рейса',get:()=>trip.id},
    {key:'versionId',title:'ID версии',get:()=>version.id},
    {key:'satellites',title:'Спутники (неизвестно)',get:()=>null},
    {key:'hdop',title:'HDOP (неизвестно)',get:()=>null},
    {key:'altitude',title:'Высота (неизвестно)',get:()=>null},
  ];
  const mandatory=new Set(['seq','timestampUtc','isoUtc','timezone','utcOffsetMinutes','lat','lon','source','tripId','versionId']);
  const selected=defs.filter(d=>!Array.isArray(profile.columns)||profile.columns.includes(d.key)||mandatory.has(d.key));
  const sheets=[
    {name:'Рейс',headers:['Параметр','Значение'],rows:meta},
    {name:'Контрольные точки',headers:['Порядок','ID','Название','Широта WGS84','Долгота WGS84','Исходное местное время','IANA-пояс','Явное смещение UTC, мин','Событие','Происхождение данных','Радиус посещения, м','Точность координат','Точность времени','Комментарий','Оригинальная запись'],rows:(trip.points||[]).map((p,i)=>[i+1,p.id,p.name,p.lat,p.lon,p.localTime,p.timezone||trip.timezone,p.utcOffsetMinutes,p.event,sourceLabel(p.source),p.radiusM,p.coordinateAccuracy,p.timeAccuracy,p.comment,p.original?JSON.stringify(p.original):null])},
    {name:'Трек',headers:selected.map(d=>String(profile.columnNames?.[d.key]||d.title)),data:result.track,defs:selected},
    {name:'Стоянки',headers:['ID','Тип','Происхождение данных','Начало ISO UTC','Окончание ISO UTC','Длительность, с','Широта WGS84','Долгота WGS84','Расстояние по пути, м','Место/область','Причина предложения','Радиус неопределённости, м','Закреплено','Участок'],rows:(result.stops||[]).map(s=>[s.id,s.type,sourceLabel(s.source),s.startUtc,s.endUtc,s.durationSeconds,s.lat,s.lon,s.distanceM,s.name,s.reason,s.uncertaintyRadiusM,!!s.locked,typeof s.legIndex==='number'?s.legIndex+1:null])},
    {name:'Проверки',headers:['Уровень','Код','Сообщение','Участок','ID опоры','Подробности'],rows:[...(result.checks||[]).map(c=>[c.severity,c.code,c.message,typeof c.legIndex==='number'?c.legIndex+1:null,c.pointId,c.details?JSON.stringify(c.details):null]),['info','PROVENANCE','Расчётное восстановление маршрута. Принятие сценария не превращает предположения в факты.'],['info','DISTANCE','Пробег вычислен вдоль геометрии; дистанция маршрутизатора указывается отдельно.'],['info','TIME_DATA',`IANA: ${result.timeDataVersion||'правила Intl среды выполнения'}; географические границы: tz-lookup 6.1.25`],['info','MODEL_PARAMETERS',JSON.stringify(trip.profile||{})]]},
  ];
  const chunks=[];let total=0;let zipError;
  const zip=new Zip((err,data)=>{if(err)zipError=err;else{chunks.push(data);total+=data.length;}});
  const add=(path,content)=>{const f=new ZipDeflate(path,{level:5});zip.add(f);f.push(strToU8(content),true);};
  add('[Content_Types].xml',`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  add('_rels/.rels',`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  add('xl/workbook.xml',`${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s,i)=>`<sheet name="${s.name}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets><calcPr calcId="191029"/></workbook>`);
  add('xl/_rels/workbook.xml.rels',`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  add('xl/styles.xml',`${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="${escapeXml(dateFormat)}"/><numFmt numFmtId="165" formatCode="0.000000"/><numFmt numFmtId="166" formatCode="0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/><color rgb="FF253444"/></font><font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="17"/><name val="Calibri"/><color rgb="FF163641"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF126F70"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  sheets.forEach((s,idx)=>{
    const f=new ZipDeflate(`xl/worksheets/sheet${idx+1}.xml`,{level:5});zip.add(f);
    const count=(s.data||s.rows).length,last=count+4,endCol=col(s.headers.length-1);
    f.push(strToU8(`${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${endCol}${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${s.headers.map((h,i)=>`<col min="${i+1}" max="${i+1}" width="${Math.min(46,Math.max(15,h.length+3))}" customWidth="1"/>`).join('')}</cols><sheetData><row r="1" ht="28" customHeight="1">${cell('Расчётное восстановление маршрута',1,0,2)}</row><row r="2">${cell(`${trip.title||'Рейс'} · ${s.name} · версия ${version.id}`,2,0)}</row><row r="3">${cell('Исходные факты и расчётные предположения различаются столбцом происхождения.',3,0)}</row><row r="4" ht="32" customHeight="1">${s.headers.map((h,i)=>cell(h,4,i,1)).join('')}</row>`));
    let buffer='';
    for(let i=0;i<count;i++){
      const row=i+5;const values=s.defs?s.defs.map(d=>d.get(s.data[i])):s.rows[i];
      buffer+=`<row r="${row}">${values.map((v,c)=>cell(v,row,c,s.defs?.[c]?.style||0)).join('')}</row>`;
      if(i%128===127){f.push(strToU8(buffer));buffer='';}
    }
    f.push(strToU8(buffer+`</sheetData><autoFilter ref="A4:${endCol}${Math.max(4,last)}"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`),true);
  });
  zip.end();if(zipError)throw zipError;
  const out=new Uint8Array(total);let offset=0;for(const a of chunks){out.set(a,offset);offset+=a.length;}return out;
}
