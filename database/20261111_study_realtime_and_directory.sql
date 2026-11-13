-- EduSpace v12.15.0: authenticated Supabase Realtime and separated directory/relationship tables.
-- Run AFTER 20261111_study_message_store.sql, in STAGING first.
-- No existing tables are dropped. No access is granted to anonymous browsers.
create table if not exists public.gb_study_students (
 id text primary key, display_name text not null default '', username text not null default '',
 avatar text not null default '', status text not null default 'active', updated_at timestamptz not null default now()
);
create index if not exists gb_study_students_search on public.gb_study_students (lower(username), lower(display_name));
create table if not exists public.gb_study_partnerships (
 id text primary key, from_id text not null, to_id text not null,
 status text not null check(status in ('pending','accepted','declined')),
 updated_at timestamptz not null default now()
);
create index if not exists gb_study_partners_from on public.gb_study_partnerships(from_id,status);
create index if not exists gb_study_partners_to on public.gb_study_partnerships(to_id,status);
create table if not exists public.gb_study_community_directory (
 id text primary key, name text not null, subject text not null default '',
 visibility text not null default 'public', lead_id text not null,
 updated_at timestamptz not null default now()
);
create table if not exists public.gb_study_community_members (
 community_id text not null, user_id text not null, role text not null default 'member',
 joined_at timestamptz not null default now(),
 primary key (community_id,user_id)
);
create index if not exists gb_study_members_by_student on public.gb_study_community_members(user_id);
-- The ONLY table used for Realtime WebSocket topic authorization.
create table if not exists public.gb_study_room_members (
 room_key text not null, user_id text not null,
 created_at timestamptz not null default now(), primary key(room_key,user_id)
);
create index if not exists gb_study_rooms_user on public.gb_study_room_members(user_id);

alter table public.gb_study_students enable row level security;
alter table public.gb_study_partnerships enable row level security;
alter table public.gb_study_community_directory enable row level security;
alter table public.gb_study_community_members enable row level security;
alter table public.gb_study_room_members enable row level security;
revoke all on public.gb_study_students, public.gb_study_partnerships,
 public.gb_study_community_directory, public.gb_study_community_members,
 public.gb_study_room_members from anon,authenticated;
grant all on public.gb_study_students, public.gb_study_partnerships,
 public.gb_study_community_directory, public.gb_study_community_members,
 public.gb_study_room_members to service_role;

-- Atomic room-authority reconciliation; called ONLY after EduSpace's
-- authenticated server has verified the current partnership or group members.
create or replace function public.gb_study_sync_room(p_room text, p_members text[])
returns integer language plpgsql security invoker set search_path=public as $$
declare v_count integer;
begin
 if length(p_room)<4 or length(p_room)>190 or p_members is null or cardinality(p_members)>20
 then raise exception 'invalid room membership'; end if;
 if exists(select 1 from unnest(p_members) as u where length(u)<1 or length(u)>120)
 then raise exception 'invalid student identifier'; end if;
 -- For a private conversation there may only be two members; community maximum 20.
 if left(p_room,2)='p:' and cardinality(p_members) not in(0,2) then raise exception 'invalid private pair';end if;
 delete from public.gb_study_room_members where room_key=p_room
  and not(user_id=any(p_members));
 insert into public.gb_study_room_members(room_key,user_id)
 select p_room,u from (select distinct unnest(p_members) u) k
 on conflict(room_key,user_id) do nothing;
 select count(*) into v_count from public.gb_study_room_members where room_key=p_room;
 return v_count;
end $$;
revoke all on function public.gb_study_sync_room(text,text[]) from public,anon,authenticated;
grant execute on function public.gb_study_sync_room(text,text[]) to service_role;

-- Atomic community membership mirror, without deleting all existing rows on
-- every request (which would create unnecessary locks and incorrect presence).
create or replace function public.gb_study_sync_community(p_community text,p_lead text,p_members text[])
returns integer language plpgsql security invoker set search_path=public as $$
declare v_count integer;
begin
 if length(p_community)<4 or length(p_community)>120 or p_members is null or cardinality(p_members)<1 or cardinality(p_members)>20
 or not(p_lead=any(p_members)) then raise exception 'invalid community membership';end if;
 delete from public.gb_study_community_members where community_id=p_community
  and not(user_id=any(p_members));
 insert into public.gb_study_community_members(community_id,user_id,role)
 select p_community,u,case when u=p_lead then 'lead' else 'member' end
 from (select distinct unnest(p_members) u) users
 on conflict(community_id,user_id) do update set role=excluded.role
 where public.gb_study_community_members.role is distinct from excluded.role;
 select count(*) into v_count from public.gb_study_community_members where community_id=p_community;
 return v_count;
end $$;
revoke all on function public.gb_study_sync_community(text,text,text[]) from public,anon,authenticated;
grant execute on function public.gb_study_sync_community(text,text,text[]) to service_role;

-- SECURITY DEFINER helper deliberately obtains the user ID FROM VERIFIED JWT,
-- not from caller-supplied parameters, and returns a boolean only.
create or replace function public.gb_study_can_receive(p_topic text)
returns boolean language sql stable security definer set search_path = public as $$
 select exists(select 1 from public.gb_study_room_members r
 where p_topic=concat('realtime:gb-study:',r.room_key)
 and r.user_id=(auth.jwt()->>'sub'));
$$;
revoke all on function public.gb_study_can_receive(text) from public,anon;
grant execute on function public.gb_study_can_receive(text) to authenticated;

-- Supabase owns realtime.messages and already enables its RLS. Do NOT
-- ALTER its RLS settings or grant clients permission to broadcast writes.
drop policy if exists "gb_study_receive_v1215" on realtime.messages;
create policy "gb_study_receive_v1215" on realtime.messages for select
 to authenticated using (
  realtime.messages.extension='broadcast'
  and left(realtime.topic(),18)='realtime:gb-study:'
  and public.gb_study_can_receive(realtime.topic())
 );

-- Only a database-side committed message mutation can trigger a broadcast.
-- Broadcast contains no text / message content. The client fetches through
-- its authenticated EduSpace API to reconcile the actual message state.
create or replace function public.gb_study_notify_realtime()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_room text;
begin
 -- One broadcast PER ROOM PER STATEMENT (rather than per affected message),
 -- avoiding hundreds of pushes when read receipts are marked in bulk.
 for v_room in select distinct room_key from new_rows loop
  perform realtime.send(
   jsonb_build_object('kind','changed'), 'gb_changed',
   'gb-study:' || v_room, true
  );
 end loop;
 return null;
end $$;
drop trigger if exists gb_study_realtime_notify on public.gb_study_messages;
drop trigger if exists gb_study_realtime_insert on public.gb_study_messages;
drop trigger if exists gb_study_realtime_update on public.gb_study_messages;
create trigger gb_study_realtime_insert after insert on public.gb_study_messages
 referencing new table as new_rows for each statement execute function public.gb_study_notify_realtime();
create trigger gb_study_realtime_update after update on public.gb_study_messages
 referencing new table as new_rows for each statement execute function public.gb_study_notify_realtime();
notify pgrst, 'reload schema';
