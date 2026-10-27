import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
export function localEnvironment(dataDir){
 mkdirSync(dataDir,{recursive:true});const database=new DatabaseSync(join(dataDir,'reis.sqlite'));database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 const version=database.prepare('PRAGMA user_version').get().user_version;if(version>1)throw Error('Версия базы новее приложения.');
 if(!version){database.exec(readFileSync(new URL('../drizzle/0000_initial.sql',import.meta.url),'utf8'));database.exec('CREATE TABLE files (key TEXT PRIMARY KEY, bytes BLOB NOT NULL, type TEXT); PRAGMA user_version=1;');}
 const wrap=(sql,args=[])=>({bind(...a){return wrap(sql,a);},async first(){return database.prepare(sql).get(...args)||null;},async all(){return {results:database.prepare(sql).all(...args)};},async run(){const r=database.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};},_sql:sql,_args:args});
 const DB={prepare:sql=>wrap(sql),async batch(statements){database.exec('BEGIN IMMEDIATE');try{const out=[];for(const s of statements){const r=database.prepare(s._sql).run(...s._args);out.push({meta:{changes:Number(r.changes)}});}database.exec('COMMIT');return out;}catch(e){database.exec('ROLLBACK');throw e;}}};
 const BUCKET={async put(key,value,opts){const bytes=typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value);database.prepare('INSERT INTO files(key,bytes,type) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET bytes=excluded.bytes,type=excluded.type').run(key,bytes,opts?.httpMetadata?.contentType||'application/json');},async get(key){const row=database.prepare('SELECT bytes,type FROM files WHERE key=?').get(key);if(!row)return null;return {async arrayBuffer(){return Uint8Array.from(row.bytes).buffer;}};},async delete(key){database.prepare('DELETE FROM files WHERE key=?').run(key);}};
 return {DB,BUCKET,LOCAL:true,_database:database,close:()=>database.close()};
}
