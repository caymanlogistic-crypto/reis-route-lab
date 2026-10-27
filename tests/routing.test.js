import test from 'node:test';
import assert from 'node:assert/strict';
import {yandexRoute} from '../src/routing.js';
test('truck routing preserves latitude/longitude order, vehicle settings and no historical departure',async()=>{
 const original=globalThis.fetch;let received;
 globalThis.fetch=async url=>{received=new URL(url);return Response.json({route:{legs:[{status:'OK',steps:[{length:1000,duration:120,polyline:{points:[[55.75,37.61],[55.76,37.62]]}}]}]}});};
 try{const route=await yandexRoute({points:[{lat:55.75,lon:37.61},{lat:55.76,lon:37.62}],profile:{weight:20,height:4,hasTrailer:true}},{YANDEX_ROUTER_KEY:'test-private'});assert.equal(received.searchParams.get('waypoints'),'55.75,37.61|55.76,37.62');assert.equal(received.searchParams.get('mode'),'truck');assert.equal(received.searchParams.get('traffic'),'disabled');assert.equal(received.searchParams.has('departure_time'),false);assert.equal(received.searchParams.has('optimize'),false);assert.equal(route.legs[0].points[0][0],55.75);assert.equal(route.supportedParameters.has_trailer,true);assert.equal(JSON.stringify(route).includes('test-private'),false);}finally{globalThis.fetch=original;}
});
test('routing authorization and partial failures never fall back to another geometry or leak key',async()=>{
 const original=globalThis.fetch,trip={points:[{lat:55,lon:37},{lat:56,lon:38}],profile:{}};
 try{globalThis.fetch=async()=>new Response('Invalid key',{status:403});await assert.rejects(()=>yandexRoute(trip,{YANDEX_ROUTER_KEY:'sensitive'}),e=>e.message.includes('403')&&!e.message.includes('sensitive'));globalThis.fetch=async()=>Response.json({route:{legs:[{status:'FAIL',steps:[]}]}});await assert.rejects(()=>yandexRoute(trip,{YANDEX_ROUTER_KEY:'sensitive'}),/Участок 1/);}finally{globalThis.fetch=original;}
});
