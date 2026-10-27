import {build} from 'esbuild';
import {readFile,mkdir,writeFile,cp} from 'node:fs/promises';
import {resolve} from 'node:path';
const assets={};for(const [url,file,type]of [['/','index.html','text/html; charset=utf-8'],['/app.js','app.js','text/javascript; charset=utf-8'],['/style.css','style.css','text/css; charset=utf-8']])assets[url]={content:await readFile('src/ui/'+file,'utf8'),type};assets['/index.html']=assets['/'];
await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
await build({entryPoints:['src/worker.js'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'assets',setup(b){b.onResolve({filter:/^reis:assets$/},()=>({path:'assets',namespace:'reis'}));b.onLoad({filter:/.*/,namespace:'reis'},()=>({contents:'export default '+JSON.stringify(assets),loader:'js'}));}}]});
await cp('.openai/hosting.json','dist/.openai/hosting.json');await cp('drizzle','dist/.openai/drizzle',{recursive:true});
await writeFile('dist/package.json','{"type":"module"}');console.log('Сборка Worker и миграций завершена.');
