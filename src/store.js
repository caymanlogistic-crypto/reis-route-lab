export class Store {
  constructor(env) { this.db=env.DB; this.bucket=env.BUCKET; }
  async get(kind,id) { const r=await this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').bind(kind,id).first(); return r ? JSON.parse(r.data) : null; }
  async list(kind,tripId) { const q=tripId ? this.db.prepare('SELECT data FROM records WHERE kind=? AND trip_id=? ORDER BY updated_at DESC').bind(kind,tripId) : this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY updated_at DESC').bind(kind); const r=await q.all(); return r.results.map(x=>JSON.parse(x.data)); }
  async put(kind,obj,tripId=null) { await this.db.prepare('INSERT INTO records(kind,id,trip_id,revision,updated_at,data) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET trip_id=excluded.trip_id,revision=excluded.revision,updated_at=excluded.updated_at,data=excluded.data').bind(kind,obj.id,tripId,obj.revision||1,obj.updatedAt||new Date().toISOString(),JSON.stringify(obj)).run(); return obj; }
  async insert(kind,obj,tripId=null) { const r=await this.db.prepare('INSERT OR IGNORE INTO records(kind,id,trip_id,revision,updated_at,data) VALUES(?,?,?,?,?,?)').bind(kind,obj.id,tripId,obj.revision||1,obj.updatedAt||new Date().toISOString(),JSON.stringify(obj)).run(); return r.meta.changes>0; }
  async updateTrip(trip,expected) { const r=await this.db.prepare('UPDATE records SET revision=?,updated_at=?,data=? WHERE kind=? AND id=? AND revision=?').bind(trip.revision,trip.updatedAt,JSON.stringify(trip),'trip',trip.id,expected).run(); return r.meta.changes>0; }
  async audit(action,tripId,details={}) { return this.put('audit',{id:crypto.randomUUID(),action,tripId,details,at:new Date().toISOString()},tripId); }
  async putFile(key,bytes,type='application/json') { await this.bucket.put(key,bytes,{httpMetadata:{contentType:type}}); }
  async file(key) { const obj=await this.bucket.get(key); if(!obj) return null; return new Uint8Array(await obj.arrayBuffer()); }
  async jsonFile(key) { const a=await this.file(key); return a?JSON.parse(new TextDecoder().decode(a)):null; }
  async settings() { return (await this.get('meta','settings'))||{id:'settings',licenseConfirmed:false,backupIntervalHours:24,backupRetention:7}; }
  async backup() { const r=await this.db.prepare('SELECT kind,id,data FROM records WHERE kind NOT IN (?,?) ORDER BY kind,id').bind('backup','restore').all(); const entries=r.results.map(x=>({kind:x.kind,id:x.id,data:JSON.parse(x.data)})); const keys=[...new Set(entries.flatMap(e=>[e.data.resultKey,e.data.fileKey].filter(Boolean)))]; const files=[]; for(const key of keys) { const bytes=await this.file(key); if(!bytes) throw Error('Не найден связанный файл: '+key); files.push({key,base64:toBase64(bytes),sha256:await digest(bytes)}); } return {format:'reis-backup',schemaVersion:1,createdAt:new Date().toISOString(),entries,files}; }
}
export function toBase64(bytes) { let s=''; for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(s); }
export function fromBase64(s) { return Uint8Array.from(atob(s),c=>c.charCodeAt(0)); }
export async function digest(bytes) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(''); }
