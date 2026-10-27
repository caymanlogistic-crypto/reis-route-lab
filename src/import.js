import ExcelJS from 'exceljs/dist/exceljs.min.js';

const MAX_BYTES=8*1024*1024,MAX_ROWS=10000,MAX_COLS=80;
const normalize=s=>String(s??'').trim().toLowerCase().replace(/[\s_()\-.,]/g,'');
const aliases={name:['название','место','точка','name','location'],lat:['широта','latitude','lat','широтаwgs84'],lon:['долгота','longitude','lon','lng','долготаwgs84'],localTime:['датавремя','датавремяточки','время','localtime','timestamp','datetime','исходноеместноевремя','датаивремя'],date:['дата','date'],time:['часы','time'],timezone:['пояс','часовойпояс','timezone','ianaпояс'],event:['событие','event'],source:['источник','source','происхождениеданных'],utcOffsetMinutes:['смещениеutcмин','utcoffsetminutes','utcсмещение'],comment:['комментарий','comment'],radiusM:['радиус','радиусм','radiusm']};
const events={проезд:'pass',прибытие:'arrival',отправление:'departure',погрузка:'loading',разгрузка:'unloading',отдых:'rest',ночёвка:'overnight',ночевка:'overnight'};
function checkZipBudget(bytes){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('Повреждённый XLSX: нет оглавления ZIP');
  const entries=v.getUint16(end+10,true);let offset=v.getUint32(end+16,true),total=0;
  if(entries===65535||entries>2000)throw new Error('Слишком много частей XLSX');
  for(let i=0;i<entries;i++){
    if(offset+46>bytes.length||v.getUint32(offset,true)!==0x02014b50)throw new Error('Повреждённое оглавление XLSX');
    const size=v.getUint32(offset+24,true);total+=size;
    if(size===0xffffffff||total>32*1024*1024)throw new Error('Распакованный XLSX превышает 32 МБ');
    offset+=46+v.getUint16(offset+28,true)+v.getUint16(offset+30,true)+v.getUint16(offset+32,true);
  }
}
function delimiterOf(text){const line=text.split(/\r?\n/).find(l=>l.trim())||'';let winner='\t',max=-1;for(const d of ['\t',';',',']){let n=0,q=false;for(let i=0;i<line.length;i++){if(line[i]==='"'){if(q&&line[i+1]==='"')i++;else q=!q;}else if(!q&&line[i]===d)n++;}if(n>max){max=n;winner=d;}}return winner;}
export function parseDelimited(text,delimiter=delimiterOf(text)){
  const rows=[];let row=[],value='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else if(quoted||value==='')quoted=!quoted;else value+=c;}
    else if(!quoted&&c===delimiter){row.push(value);value='';}
    else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);if(row.some(x=>x.trim()!==''))rows.push(row);row=[];value='';}
    else value+=c;
    if(rows.length>MAX_ROWS+1)throw new Error(`Импорт ограничен ${MAX_ROWS} строками`);
    if(row.length>MAX_COLS)throw new Error(`Импорт ограничен ${MAX_COLS} столбцами`);
  }
  if(quoted)throw new Error('Незакрытые кавычки в CSV');
  row.push(value);if(row.some(x=>x.trim()!==''))rows.push(row);
  if(rows.length>MAX_ROWS+1)throw new Error(`Импорт ограничен ${MAX_ROWS} строками`);
  return rows;
}
const cleanValue=v=>v instanceof Date?v.toISOString().replace(/Z$/,''):v&&typeof v==='object'?(v.text??v.result??(v.richText?v.richText.map(t=>t.text).join(''):'')??''):v??'';
const numeric=v=>typeof v==='number'?v:String(v??'').trim()===''?NaN:Number(String(v).trim().replace(',','.'));
const localDate=value=>{
  const s=String(value??'').trim();
  const ru=s.match(/^(\d{2})[./](\d{2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  return ru?`${ru[3]}-${ru[2]}-${ru[1]}T${(ru[4]||'00').padStart(2,'0')}:${ru[5]||'00'}:${ru[6]||'00'}`:s.replace(' ','T');
};
/** Preview is returned even when required columns are not mapped yet. */
export async function parseImport({text,base64,filename='',mapping={}}={}){
  let table;
  if(typeof base64==='string'){
    if(base64.length>MAX_BYTES*1.4)throw new Error('Файл импорта превышает 8 МБ');
    const raw=atob(base64.replace(/^data:[^,]*,/,'')),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    if(bytes.length>MAX_BYTES)throw new Error('Файл импорта превышает 8 МБ');
    if(/\.xlsx$/i.test(filename)||bytes[0]===80&&bytes[1]===75){
      checkZipBudget(bytes);
      const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
      const sheet=book.worksheets[0];if(!sheet)throw new Error('В книге нет листов');
      if(sheet.rowCount>MAX_ROWS+1||sheet.columnCount>MAX_COLS)throw new Error('Слишком большая таблица импорта');
      table=[];sheet.eachRow({includeEmpty:false},row=>table.push(row.values.slice(1).map(cleanValue)));
    }else table=parseDelimited(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));
  }else{
    if(typeof text!=='string')throw new Error('Передайте текст таблицы или файл');
    if(new TextEncoder().encode(text).length>MAX_BYTES)throw new Error('Текст импорта превышает 8 МБ');
    table=parseDelimited(text.replace(/^\uFEFF/,''));
  }
  if(!table.length)throw new Error('Таблица пуста');
  const headers=table.shift().map((x,i)=>String(x||`Столбец ${i+1}`).trim());
  if(new Set(headers).size!==headers.length)throw new Error('Заголовки столбцов должны быть уникальными');
  const rows=table.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
  const chosen={};
  for(const [key,list]of Object.entries(aliases)){
    const explicit=mapping[key];
    if(typeof explicit==='number')chosen[key]=headers[explicit];
    else if(typeof explicit==='string'&&headers.includes(explicit))chosen[key]=explicit;
    else if(explicit!==null&&explicit!=='')chosen[key]=headers.find(h=>list.includes(normalize(h)));
  }
  const points=[],errors=[];
  for(const required of ['lat','lon'])if(!chosen[required])errors.push({row:1,field:required,message:`Сопоставьте столбец «${required==='lat'?'Широта':'Долгота'}»`});
  if(!chosen.localTime&&!(chosen.date&&chosen.time))errors.push({row:1,field:'localTime',message:'Сопоставьте дату и время'});
  if(errors.length)return {headers,rows,points,errors,mapping:chosen};
  rows.forEach((original,i)=>{
    const get=k=>chosen[k]?original[chosen[k]]:undefined;
    const lat=numeric(get('lat')),lon=numeric(get('lon'));
    const localTime=localDate(get('localTime')??`${get('date')||''} ${get('time')||''}`);
    const rowErrors=[];
    if(!Number.isFinite(lat)||Math.abs(lat)>90)rowErrors.push({field:'lat',message:'Широта должна быть числом от −90 до 90; проверьте порядок координат'});
    if(!Number.isFinite(lon)||Math.abs(lon)>180)rowErrors.push({field:'lon',message:'Долгота должна быть числом от −180 до 180'});
    if(!/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}/.test(localTime))rowErrors.push({field:'localTime',message:'Нужны полная дата и время (ГГГГ-ММ-ДД ЧЧ:ММ)'});
    const ev=String(get('event')||'pass').trim().toLowerCase();
    const point={id:crypto.randomUUID(),name:String(get('name')||`Точка ${i+1}`),lat:Number.isFinite(lat)?lat:null,lon:Number.isFinite(lon)?lon:null,localTime,timezone:String(get('timezone')||''),event:events[ev]||ev,source:String(get('source')||'user'),radiusM:Number.isFinite(numeric(get('radiusM')))?numeric(get('radiusM')):100,comment:String(get('comment')||''),original:{...original},lockedCoordinates:true,lockedTime:true};
    if(get('utcOffsetMinutes')!==undefined&&get('utcOffsetMinutes')!=='')point.utcOffsetMinutes=numeric(get('utcOffsetMinutes'));
    for(const e of rowErrors)errors.push({row:i+2,...e});points.push(point);
  });
  return {headers,rows,points,errors,mapping:chosen};
}
