/* EduSpace private Realtime transport (Supabase Phoenix WebSocket protocol v1).
 * Browser NEVER writes to Supabase or stores any database secret. It receives a
 * 120-second subscriber JWT from its authenticated EduSpace API. Messages are
 * fetched through EduSpace on an authenticated change notification. */
window.GBStudyLive=(()=>{'use strict';
 const LIVE={CLOSED:'offline',CONNECTING:'connecting',CONNECTED:'live'};
 const connection=({path,onChange,onStatus=()=>{},WebSocketImpl=globalThis.WebSocket,
   fetchTicket=()=>GBStudy.api('messaging/realtime-ticket'+path)})=>{
   let socket=null,stopped=false,ready=false,attempt=0,ref=0,topic='',token='',expires=0,
       heartbeat=null,renewal=null,retry=null,changeDebounce=null,health=0,joinRef='';
   const emit=s=>{try{onStatus(s)}catch{}};
   const clear=()=>{for(const id of [heartbeat,renewal,retry,changeDebounce])clearTimeout(id);heartbeat=renewal=retry=changeDebounce=null};
   const send=(event,payload={},where=topic)=>{
     if(!socket||socket.readyState!==1)return null;
     const id=String(++ref);
     socket.send(JSON.stringify({topic:where,event,payload,ref:id,join_ref:where==='phoenix'?null:joinRef}));
     return id;
   };
   const change=()=>{clearTimeout(changeDebounce);changeDebounce=setTimeout(()=>{if(!stopped&&!document.hidden)onChange()},120)};
   const backoff=()=>Math.min(30000,1500*(2**Math.min(attempt++,5)))+Math.floor(Math.random()*400);
   const stopSocket=()=>{clearTimeout(heartbeat);clearTimeout(renewal);heartbeat=renewal=null;
     const s=socket;socket=null;ready=false;if(s){s.onopen=s.onmessage=s.onerror=s.onclose=null;try{s.close()}catch{}}};
   const schedule=()=>{if(stopped||document.hidden)return;clearTimeout(retry);emit(LIVE.CLOSED);retry=setTimeout(connect,backoff())};
   const pulse=()=>{if(!ready||stopped)return;
     // Close stalled connections; the next connection reconciles missing events.
     if(health&&Date.now()-health>44000){stopSocket();schedule();return}
     send('heartbeat',{},'phoenix');health=Date.now();heartbeat=setTimeout(pulse,22000);
   };
   const renew=async()=>{
     if(stopped||document.hidden||!ready)return;
     try{
       const result=await fetchTicket();
       if(result.topic!==topic)throw Error('Room access changed');
       token=result.token;expires=result.expiresAt;
       send('access_token',{access_token:token});
       renewal=setTimeout(renew,55000);
     }catch{stopSocket();schedule()}
   };
   const connect=async()=>{
     if(stopped||document.hidden||!WebSocketImpl)return;
     emit(LIVE.CONNECTING);
     let ticket;
     try{ticket=await fetchTicket()}catch(e){
       // Disabled/misconfigured backend: stay on periodic HTTP reconciliation.
       if(/not enabled|not configured|realtime is not enabled|partnership|membership|access required|too many connection requests|not active/i.test(String(e.message||''))){emit('polling');return}
       schedule();return;
     }
     if(stopped||document.hidden)return;
     if(!ticket||ticket.transport!=='websocket'||!/^wss:\/\/[a-z0-9-]+\.supabase\.co\/realtime\/v1\/websocket$/i.test(ticket.url)
         ||!/^realtime:gb-study:(p:[a-f0-9]{64}|c:[a-zA-Z0-9-]{4,120})$/.test(ticket.topic)
         ||typeof ticket.token!=='string'||typeof ticket.key!=='string'){
       emit('polling');return;
     }
     topic=ticket.topic;token=ticket.token;expires=ticket.expiresAt;
     const uri=ticket.url+'?'+new URLSearchParams({apikey:ticket.key,vsn:'1.0.0'});
     let ws;try{ws=new WebSocketImpl(uri)}catch{schedule();return}socket=ws;
     ws.onopen=()=>{
       if(stopped||ws!==socket)return;
       joinRef=String(++ref);
       ws.send(JSON.stringify({topic,event:'phx_join',payload:{config:{broadcast:{ack:false,self:false},private:true},access_token:token},ref:joinRef,join_ref:joinRef}));
     };
     ws.onmessage=event=>{
       if(ws!==socket||stopped)return;
       let msg;try{msg=JSON.parse(event.data)}catch{return}
       if(Array.isArray(msg))msg={join_ref:msg[0],ref:msg[1],topic:msg[2],event:msg[3],payload:msg[4]};
       if(msg.event==='phx_reply'&&msg.topic===topic&&String(msg.ref)===joinRef){
         if(msg.payload?.status!=='ok'){stopSocket();schedule();return}
         ready=true;attempt=0;health=0;emit(LIVE.CONNECTED);change(); // close gap between initial HTTP read and join
         heartbeat=setTimeout(pulse,22000);renewal=setTimeout(renew,55000);
       }else if(msg.event==='phx_reply'&&msg.topic==='phoenix'){
         health=0;
       }else if(msg.event==='broadcast'&&msg.topic===topic&&msg.payload?.event==='gb_changed'){
         change();
       }else if(['phx_error','phx_close'].includes(msg.event)&&msg.topic===topic){
         stopSocket();schedule();
       }
     };
     ws.onclose=()=>{if(ws!==socket||stopped)return;stopSocket();schedule()};
     ws.onerror=()=>{if(ws!==socket||stopped)return;stopSocket();schedule()};
   };
   const visibility=()=>{
     if(document.hidden){clear();stopSocket();emit(LIVE.CLOSED)}
     else if(!stopped){clear();connect();change()}
   };
   document.addEventListener('visibilitychange',visibility);
   return {start(){stopped=false;connect()},close(){stopped=true;clear();stopSocket();document.removeEventListener('visibilitychange',visibility);emit(LIVE.CLOSED)},isLive(){return ready}};
 };
 return {connection};
})();
