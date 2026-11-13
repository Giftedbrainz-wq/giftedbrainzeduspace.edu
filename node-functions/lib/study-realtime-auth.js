/* Narrowly scoped, short-lived signed Realtime subscriber token. It is NOT a
 * login token for EduSpace and never carries database secrets or service-role
 * privileges. Only the authenticated EduSpace server may issue it. */
import crypto from 'node:crypto';
export function realtimeConfiguration(env) {
  if (!/^(1|true|yes|on)$/i.test(String(env.GB_CHAT_REALTIME_ENABLED||''))) return null;
  if (String(env.GB_CHAT_BACKEND).toLowerCase()!=='supabase') throw Error('Realtime requires the dedicated Supabase messaging backend.');
  const source=String(env.GB_CHAT_SUPABASE_URL||'').replace(/\/+$/,'');
  const secret=String(env.GB_CHAT_REALTIME_JWT_SECRET||'');
  const key=String(env.GB_CHAT_REALTIME_PUBLISHABLE_KEY||'');
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(source)||secret.length<32||key.length<20||/^(sb_secret_|eyJ.*service_role)/i.test(key))
    throw Error('Realtime is enabled but its Supabase URL, publishable key or server-only JWT signing secret is invalid.');
  return {source,key,secret};
}
export function signRealtimeToken(config,userId,{now=Math.floor(Date.now()/1000),expiresIn=120}={}) {
  if(!config||!userId||!Number.isInteger(expiresIn)||expiresIn<60||expiresIn>180)throw Error('Invalid Realtime token parameters.');
  const header={alg:'HS256',typ:'JWT'};
  const payload={sub:String(userId),role:'authenticated',aud:'authenticated',iss:'gifted-brainz-eduspace',iat:now,nbf:now-3,exp:now+expiresIn,jti:crypto.randomUUID()};
  const left=Buffer.from(JSON.stringify(header)).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url');
  return {token:left+'.'+crypto.createHmac('sha256',config.secret).update(left).digest('base64url'),expiresAt:(now+expiresIn)*1000};
}
export function realtimeTopic(room) {
  if(!/^(p:[a-f0-9]{64}|c:[a-zA-Z0-9-]{4,120})$/.test(String(room)))throw Error('Invalid Realtime room identifier.');
  return 'realtime:gb-study:'+room;
}
