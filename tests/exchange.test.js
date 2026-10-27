import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs/dist/exceljs.min.js';
import { buildWorkbook } from '../src/export.js';
import { parseImport,parseDelimited } from '../src/import.js';

const trip={id:'trip-test',title:'=1+1',client:'ООО «Тест»',vehicle:'А123ВС',timezone:'Europe/Moscow',points:[{id:'p1',name:'Первая',lat:55.1234567,lon:37.9876543,localTime:'2026-10-20T08:00:00',timezone:'Europe/Moscow',event:'departure',source:'document',radiusM:100},{id:'p2',name:'Вторая',lat:55.2,lon:38,localTime:'2026-10-20T09:00:00',event:'arrival',source:'user'}],profile:{maxSpeedKph:80},route:{source:'demo'}};
const result={algorithmVersion:'test-1',track:[{seq:1,timestampUtc:'2026-10-20T05:00:00.000Z',localTime:'2026-10-20T08:00:00.000+03:00',timezone:'Europe/Moscow',utcOffsetMinutes:180,lat:55.1234567,lon:37.9876543,speedKph:0,course:1,distanceM:0,state:'stopped',source:'checkpoint',pointId:'p1',legIndex:0,events:['departure']},{seq:2,timestampUtc:'2026-10-20T05:00:10.000Z',localTime:'2026-10-20T08:00:10.000+03:00',timezone:'Europe/Moscow',utcOffsetMinutes:180,lat:55.1235567,lon:37.9877543,speedKph:36,course:45,distanceM:100,state:'moving',source:'reconstruction',legIndex:0,events:[]}],stops:[{id:'s1',type:'assumed-stop',source:'reconstruction',startUtc:'2026-10-20T05:01:00Z',endUtc:'2026-10-20T06:01:00Z',durationSeconds:3600,lat:55.2,lon:38,distanceM:1000,name:'Место остановки не установлено',reason:'Избыток времени',uncertaintyRadiusM:1000,locked:false,legIndex:0}],checks:[{severity:'warning',code:'REST_LOCATION',message:'Место не установлено',legIndex:0}],assumptions:['Синтетическая геометрия'],summary:{distanceM:1000,routerDistanceM:1100,driveSeconds:3600,stopSeconds:3600,startUtc:'2026-10-20T05:00:00Z',endUtc:'2026-10-20T06:00:00Z',checkpointCount:2}};
const version={id:'version-1',tripId:trip.id,revision:3,result,snapshot:trip};

test('CSV preserves order, decimal comma, quoted delimiters, newlines and source originals',async()=>{
  const input='Место;Широта;Долгота;Дата и время;Источник\r\n"Склад; A";"55,2";"37,5";20.10.2026 08:00;document\r\n"Повтор\nместа";55.2;37.5;2026-10-21T09:00;user';
  const parsed=await parseImport({text:input});
  assert.equal(parsed.errors.length,0);assert.equal(parsed.points.length,2);assert.equal(parsed.points[0].lat,55.2);assert.equal(parsed.points[0].name,'Склад; A');assert.equal(parsed.points[1].name,'Повтор\nместа');assert.equal(parsed.points[0].localTime,'2026-10-20T08:00:00');assert.equal(parsed.points[0].source,'document');assert.equal(parsed.points[0].original.Широта,'55,2');
});
test('column mapping and invalid coordinate do not silently swap values',async()=>{
  const preview=await parseImport({text:'x,y,t\n120,55,2026-10-20T12:00'});assert.equal(preview.points.length,0);assert.ok(preview.headers.includes('x'));
  const parsed=await parseImport({text:'x,y,t\n120,55,2026-10-20T12:00',mapping:{lat:'x',lon:'y',localTime:'t'}});
  assert.equal(parsed.points[0].lat,120);assert.equal(parsed.points[0].lon,55);assert.ok(parsed.errors.some(e=>e.field==='lat'));
});
test('TSV quoted multiline and unclosed quote handling',()=>{
  assert.deepEqual(parseDelimited('a\tb\n"x""y"\t"line1\nline2"'),[['a','b'],['x"y','line1\nline2']]);assert.throws(()=>parseDelimited('a,b\n"unfinished'),/кавычки/);
});
test('XLSX is readable with numeric coords, provenance, UTC/local wall times and immutable profile',async()=>{
  const before=JSON.stringify(version);const bytes=await buildWorkbook(trip,version);
  const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
  assert.deepEqual(book.worksheets.map(s=>s.name),['Рейс','Контрольные точки','Трек','Стоянки','Проверки']);
  const sheet=book.getWorksheet('Трек');assert.equal(sheet.rowCount,6);assert.equal(sheet.views[0].ySplit,4);assert.ok(sheet.autoFilter);
  const headers=sheet.getRow(4).values.slice(1);const at=(r,label)=>sheet.getCell(r,headers.indexOf(label)+1).value;
  assert.equal(at(5,'Широта WGS84'),55.1234567);assert.equal(at(5,'Долгота WGS84'),37.9876543);assert.equal(at(5,'Происхождение данных'),'Контрольная отметка');assert.equal(at(6,'Происхождение данных'),'Реконструкция');
  assert.equal(at(5,'ISO UTC'),'2026-10-20T05:00:00.000Z');assert.equal(at(5,'UTC дата и время').toISOString(),'2026-10-20T05:00:00.000Z');assert.equal(at(5,'Местное время места').toISOString(),'2026-10-20T08:00:00.000Z');assert.equal(at(5,'Спутники (неизвестно)'),null);
  assert.equal(book.getWorksheet('Рейс').getCell('B6').type,ExcelJS.ValueType.String);assert.equal(book.getWorksheet('Рейс').getCell('B6').value,'=1+1');
  const alternate=await buildWorkbook(trip,version,{timezone:'Asia/Yekaterinburg',columns:['speedKph','distanceM','displayTime'],speedUnit:'m/s',distanceUnit:'m',columnNames:{speedKph:'Метров в секунду'}});
  const alt=new ExcelJS.Workbook();await alt.xlsx.load(alternate);const h=alt.getWorksheet('Трек').getRow(4).values.slice(1);assert.ok(h.includes('Происхождение данных'));assert.ok(h.includes('ISO UTC'));assert.equal(alt.getWorksheet('Трек').getCell(6,h.indexOf('Метров в секунду')+1).value,10);assert.equal(alt.getWorksheet('Трек').getCell(5,h.indexOf('Время просмотра (Asia/Yekaterinburg)')+1).value.toISOString(),'2026-10-20T10:00:00.000Z');
  assert.equal(JSON.stringify(version),before);
});
test('generated workbook independently round-trips through Python openpyxl',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'reis-xlsx-'));const file=path.join(dir,'report.xlsx');
  try{
    await writeFile(file,await buildWorkbook(trip,version));
    const script='import sys,json,openpyxl\nw=openpyxl.load_workbook(sys.argv[1],data_only=False)\ns=w["Трек"]\nh=[c.value for c in s[4]]\ndef v(r,k): return s.cell(r,h.index(k)+1).value\nassert len(w.sheetnames)==5\nassert s.max_row==6\nassert s.freeze_panes=="A5"\nassert s.auto_filter.ref=="A4:X6"\nassert isinstance(v(5,"Широта WGS84"),float)\nassert abs(v(5,"Широта WGS84")-55.1234567)<1e-10\nassert v(5,"UTC дата и время").isoformat()=="2026-10-20T05:00:00"\nassert v(5,"Местное время места").isoformat()=="2026-10-20T08:00:00"\nassert v(6,"Происхождение данных")=="Реконструкция"\nassert w["Рейс"]["B6"].data_type=="s"\nprint(json.dumps({"sheets":len(w.sheetnames),"messages":s.max_row-4}))';
    const checked=spawnSync('python',['-c',script,file],{encoding:'utf8'});
    if(checked.error?.code==='ENOENT')return t.skip('Python unavailable; independent parser check not run');
    assert.equal(checked.status,0,checked.stderr);assert.deepEqual(JSON.parse(checked.stdout),{sheets:5,messages:2});
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('historical version exports its own checkpoint snapshot, not changed draft',async()=>{
  const bytes=await buildWorkbook({...trip,title:'Изменённый черновик',points:[]},version);
  const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
  assert.equal(book.getWorksheet('Рейс').getCell('B6').value,'=1+1');
  assert.equal(book.getWorksheet('Контрольные точки').rowCount,6);
});
test('XLSX imports actual dates as wall times and retains literal text',async()=>{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Точки');sheet.addRow(['Название','Широта','Долгота','Дата и время']);sheet.addRow(['=danger',55,37,new Date('2026-10-20T08:30:00Z')]);
  const bytes=await book.xlsx.writeBuffer();const parsed=await parseImport({filename:'points.xlsx',base64:Buffer.from(bytes).toString('base64')});assert.equal(parsed.errors.length,0);assert.equal(parsed.points[0].name,'=danger');assert.equal(parsed.points[0].localTime,'2026-10-20T08:30:00.000');assert.equal(parsed.points[0].source,'user');
});
test('oversized, empty and malformed inputs fail visibly',async()=>{
  await assert.rejects(parseImport({text:''}),/пуста/);await assert.rejects(parseImport({text:'a'.repeat(8*1024*1024+1)}),/8 МБ/);await assert.rejects(parseImport({filename:'bad.xlsx',base64:Buffer.from('PKnotzip').toString('base64')}),/ZIP/);await assert.rejects(buildWorkbook(trip,{result:{}}),/трек/);await assert.rejects(buildWorkbook(trip,version,{timezone:'Not/AZone'}),/пояс/);
});
