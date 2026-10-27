import {api} from './service.js';
import assets from 'reis:assets';
export default {async fetch(request,env,ctx){const path=new URL(request.url).pathname;if(path.startsWith('/api/'))return api(request,env,ctx);const a=assets[path];if(!a)return new Response('Not found',{status:404});return new Response(a.content,{headers:{'content-type':a.type,'cache-control':'no-cache','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'}});}};
