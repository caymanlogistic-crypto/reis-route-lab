export class RoutingError extends Error { constructor(message,status=422) { super(message);this.status=status; } }
export async function yandexRoute(trip,env) {
  if(!env.YANDEX_ROUTER_KEY) throw new RoutingError('Не настроен серверный ключ Яндекс Router API.');
  if(trip.points.length<2||trip.points.length>50)throw new RoutingError('Для грузового маршрута нужно от 2 до 50 опор.');
  const params=new URLSearchParams({apikey:env.YANDEX_ROUTER_KEY,waypoints:trip.points.map(p=>`${p.lat},${p.lon}`).join('|'),mode:'truck',traffic:'disabled'});
  const mapping={weight:'weight',maxWeight:'max_weight',axleWeight:'axle_weight',height:'height',width:'width',length:'length',hasTrailer:'has_trailer'};
  const supportedParameters={};for(const [k,v]of Object.entries(mapping)){if(trip.profile?.[k]!==undefined){params.set(v,String(trip.profile[k]));supportedParameters[v]=trip.profile[k];}}
  let response;try{response=await fetch('https://api.routing.yandex.net/v2/route?'+params,{signal:AbortSignal.timeout(20000)});}catch{throw new RoutingError('Сервис маршрутизации недоступен или не ответил за 20 секунд.',503);}
  if(!response.ok){const status=response.status;throw new RoutingError(status===401||status===403?'Яндекс отклонил ключ или права на Router API (HTTP '+status+'). Проверьте подключение продукта API Получение деталей маршрута.':status===429?'Исчерпана квота Router API (HTTP 429).':'Ошибка Router API (HTTP '+status+').',status===429?429:422);}
  let data;try{data=await response.json();}catch{throw new RoutingError('Router API вернул некорректный JSON.');}
  const raw=data.route?.legs;if(!raw||raw.length!==trip.points.length-1)throw new RoutingError('Нет полного грузового маршрута для заданных опор.');
  let vertices=0;const legs=raw.map((leg,i)=>{if(leg.status!=='OK')throw new RoutingError(`Участок ${i+1}: маршрут не найден.`);let points=[];let distanceM=0,durationS=0;for(const s of leg.steps||[]){const p=s.polyline?.points;if(!Array.isArray(p))throw new RoutingError('Нет дорожной геометрии участка '+(i+1));for(const xy of p){if(!Array.isArray(xy)||xy.length!==2||!xy.every(Number.isFinite)||Math.abs(xy[0])>90||Math.abs(xy[1])>180)throw new RoutingError('Некорректные координаты маршрутизатора.');if(!points.length||points.at(-1)[0]!==xy[0]||points.at(-1)[1]!==xy[1])points.push(xy);}distanceM+=Number(s.length)||0;durationS+=Number(s.duration)||0;}vertices+=points.length;if(points.length<2)throw new RoutingError('Пустая дорожная геометрия участка '+(i+1));return {points,distanceM,durationS};});
  if(vertices>100000)throw new RoutingError('Слишком подробный маршрут: разделите рейс.');
  return {source:'yandex',mode:'truck',traffic:'disabled',createdAt:new Date().toISOString(),legs,supportedParameters,roadSpeedLimitsKnown:false,notes:['Маршрут без исторических пробок; критерий — кратчайшее расстояние.','Международное покрытие грузовых ограничений требует отдельной проверки.']};
}
