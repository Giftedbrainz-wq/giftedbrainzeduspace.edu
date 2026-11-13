-- Gifted Brainz EduSpace: optional dedicated messaging store.
-- Run in a dedicated Supabase project (or an existing trusted project).
-- Never expose its secret/service-role credential to the browser.
-- This migration creates new objects; it does not change existing EduSpace data.
create extension if not exists pgcrypto;
create table if not exists public.gb_study_messages (
  id uuid primary key default gen_random_uuid(),
  room_key text not null,
  sender_id text not null,
  recipient_id text,
  client_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.gb_study_messages add column if not exists updated_at timestamptz not null default now();
create unique index if not exists gb_study_message_dedup on public.gb_study_messages(room_key,sender_id,client_id);
create index if not exists gb_study_messages_room_time on public.gb_study_messages(room_key,created_at desc,id desc);
create index if not exists gb_study_messages_room_changed on public.gb_study_messages(room_key,updated_at asc,id asc);
create index if not exists gb_study_messages_sender_time on public.gb_study_messages(sender_id,created_at desc);
create index if not exists gb_study_messages_recipient_unread on public.gb_study_messages(recipient_id,created_at desc) where recipient_id is not null;
alter table public.gb_study_messages enable row level security;
revoke all on public.gb_study_messages from anon, authenticated;

-- Only the server, authenticated with its secret key, can invoke these routines.
create or replace function public.gb_study_send(p_room text,p_sender text,p_recipient text,p_client text,p_text text,p_reply text default '')
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_id uuid:=gen_random_uuid(); v_when timestamptz:=clock_timestamp(); v_item jsonb; v_saved jsonb;
begin
 if length(p_room)>180 or length(p_sender)>120 or length(p_client)>120 or length(trim(p_text))<1 or length(p_text)>1000
 then raise exception 'invalid message'; end if;
 v_item:=jsonb_build_object('id',v_id,'from',p_sender,'to',p_recipient,'text',p_text,'clientId',p_client,'replyTo',p_reply,
 'createdAt',to_char(v_when at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'reactions','[]'::jsonb,'deletedFor','[]'::jsonb,'readAt',null,'deliveredAt',null);
 insert into public.gb_study_messages(id,room_key,sender_id,recipient_id,client_id,payload,created_at)
 values(v_id,p_room,p_sender,p_recipient,p_client,v_item,v_when)
 on conflict(room_key,sender_id,client_id) do nothing returning payload into v_saved;
 if v_saved is null then select payload into v_saved from public.gb_study_messages where room_key=p_room and sender_id=p_sender and client_id=p_client; end if;
 return v_saved;
end $$;

create or replace function public.gb_study_action(p_room text,p_id uuid,p_actor text,p_action text,p_value text default '',p_moderator boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_row public.gb_study_messages%rowtype; v_data jsonb; v_reacts jsonb; v_for jsonb;
begin
 select * into v_row from public.gb_study_messages where id=p_id and room_key=p_room for update;
 if not found then raise exception 'message not found'; end if;
 v_data:=v_row.payload;
 if p_action='edit' then
  if v_row.sender_id<>p_actor or v_data ? 'deletedAt' or clock_timestamp()>v_row.created_at+interval '15 minutes' then raise exception 'message cannot be edited';end if;
  if length(trim(p_value))<1 or length(p_value)>1000 then raise exception 'invalid message';end if;
  v_data:=v_data||jsonb_build_object('text',p_value,'editedAt',to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 elsif p_action='delete_everyone' then
  if (v_row.sender_id<>p_actor and not p_moderator) then raise exception 'permission denied';end if;
  if v_row.sender_id=p_actor and not p_moderator and clock_timestamp()>v_row.created_at+interval '48 hours' then raise exception 'withdrawal window ended';end if;
  v_data:=v_data||jsonb_build_object('text','','deletedAt',to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'reactions','[]'::jsonb);
 elsif p_action='delete_me' then
  v_for:=coalesce(v_data->'deletedFor','[]'::jsonb);
  if not(v_for @> to_jsonb(p_actor)) then v_for:=v_for||jsonb_build_array(p_actor);end if;
  v_data:=jsonb_set(v_data,'{deletedFor}',v_for);
 elsif p_action='react' then
  if v_data ? 'deletedAt' then raise exception 'deleted message';end if;
  if p_value not in ('','👍','❤️','😂','🎉','👏','🙏') then raise exception 'reaction unavailable';end if;
  select coalesce(jsonb_agg(r),'[]'::jsonb) into v_reacts from jsonb_array_elements(coalesce(v_data->'reactions','[]'::jsonb)) as r where r->>'userId'<>p_actor;
  if p_value<>'' then v_reacts:=v_reacts||jsonb_build_array(jsonb_build_object('userId',p_actor,'emoji',p_value));end if;
  v_data:=jsonb_set(v_data,'{reactions}',v_reacts);
 else raise exception 'unknown action';end if;
 update public.gb_study_messages set payload=v_data,updated_at=clock_timestamp() where id=v_row.id;
 return v_data;
end $$;

create or replace function public.gb_study_read(p_room text,p_recipient text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_when text:=to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');v_count integer;
begin
 update public.gb_study_messages set updated_at=clock_timestamp(),payload=payload||jsonb_build_object('readAt',v_when,'deliveredAt',coalesce(nullif(payload->'deliveredAt','null'::jsonb),to_jsonb(v_when)))
 where room_key=p_room and recipient_id=p_recipient and (payload->>'readAt') is null and (payload->>'deletedAt') is null;
 get diagnostics v_count=row_count;
 return jsonb_build_object('ok',true,'count',v_count,'readAt',v_when);
end $$;

create or replace function public.gb_study_deliver(p_recipient text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_when text:=to_char(clock_timestamp() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');v_count integer;
begin
 update public.gb_study_messages set updated_at=clock_timestamp(),payload=jsonb_set(payload,'{deliveredAt}',to_jsonb(v_when))
 where recipient_id=p_recipient and (payload->>'deliveredAt') is null and (payload->>'deletedAt') is null;
 get diagnostics v_count=row_count;return jsonb_build_object('ok',true,'count',v_count);
end $$;

-- Safe to create an index for direct Inbox queries; limited to recipient's latest activity.
create or replace function public.gb_study_inbox(p_user text)
returns jsonb language sql stable security invoker set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('peer',peer,'lastMessage',last_item,'unreadCount',unread_count)),'[]'::jsonb)
 from (
  select case when sender_id=p_user then recipient_id else sender_id end peer,
         (array_agg(payload order by created_at desc))[1] last_item,
         count(*) filter(where recipient_id=p_user and (payload->>'readAt') is null and (payload->>'deletedAt') is null
           and not (coalesce(payload->'deletedFor','[]'::jsonb) @> to_jsonb(p_user))) unread_count
  from public.gb_study_messages
  where room_key like 'p:%' and (sender_id=p_user or recipient_id=p_user)
  group by 1
 ) x;
$$;

revoke all on function public.gb_study_send(text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.gb_study_action(text,uuid,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.gb_study_read(text,text) from public, anon, authenticated;
revoke all on function public.gb_study_deliver(text) from public, anon, authenticated;
revoke all on function public.gb_study_inbox(text) from public, anon, authenticated;
-- service_role has table access and can execute these server-only routines.
grant all on public.gb_study_messages to service_role;
grant execute on function public.gb_study_send(text,text,text,text,text,text) to service_role;
grant execute on function public.gb_study_action(text,uuid,text,text,text,boolean) to service_role;
grant execute on function public.gb_study_read(text,text) to service_role;
grant execute on function public.gb_study_deliver(text) to service_role;
grant execute on function public.gb_study_inbox(text) to service_role;
notify pgrst, 'reload schema';
