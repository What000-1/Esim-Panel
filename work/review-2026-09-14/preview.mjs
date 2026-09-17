// Local visual QA fixture only. No production storage or Telegram access.
import http from 'node:http';
import worker from '../../worker/entry.js';
import { fixture, sample } from '../../tests/helpers.mjs';
import { todayString, addCalendarCycle } from '../../shared/dates.js';
const f=await fixture([
  {...sample,id:'uk',name:'英国保号卡',number:'+44 7911 123456',startDate:todayString(),expireDate:addCalendarCycle(todayString(),30,'day'),cycle:30,cycleUnit:'day'},
  {...sample,id:'us',name:'美国旅行备用号码',number:'+1 234 567890',expireDate:addCalendarCycle(todayString(),8,'day'),remark:'发送一条短信完成保号',autoRenew:true},
  {...sample,id:'hk',name:'香港备用号码',number:'+852 1234 5678',expireDate:todayString(),reminderDays:0}
]);
globalThis.fetch=async(url,options)=>{
  if(new URL(url).hostname!=='api.telegram.org')throw new Error('External access disabled');
  const code=JSON.parse(options.body).text.match(/验证码：(\d{6})/)?.[1];
  if(code)console.log('LOCAL FIXTURE OTP: '+code);
  return Response.json({ok:true});
};
const env={ESIM_STORE:{idFromName:()=> 'local',get:()=>f.store}};
const server=http.createServer(async(req,res)=>{
  try{
    const buffers=[];for await(const part of req)buffers.push(part);
    const headers=new Headers(req.headers);headers.set('cf-connecting-ip','192.0.2.1');
    const response=await worker.fetch(new Request('http://127.0.0.1:8789'+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(buffers)}:{})}),env);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){res.writeHead(500);res.end(e.message);}
});
server.listen(8789,'127.0.0.1',()=>console.log('Local fixture ready on http://127.0.0.1:8789'));
