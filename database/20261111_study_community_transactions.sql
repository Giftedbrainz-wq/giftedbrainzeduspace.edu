-- v12.17: transactional community membership; STAGING FIRST, after v12.14-v12.16.
-- No source/old tables are deleted; keep flag disabled until verified backfill.
alter table public.gb_study_community_directory
 add column if not exists description text not null default '',
 add column if not exists join_mode text not null default 'open',
 add column if not exists invite_code text not null default '',
 add column if not exists created_at timestamptz not null default now();
create table if not exists public.gb_study_community_requests (
 community_id text not null references public.gb_study_community_directory(id) on delete cascade,
 user_id text not null,
 requested_at timestamptz not null default now(),
 primary key(community_id,user_id)
);
create index if not exists gb_study_community_visible on public.gb_study_community_directory(visibility,created_at desc);
create index if not exists gb_study_community_lead on public.gb_study_community_directory(lead_id);
create index if not exists gb_study_community_requests_student on public.gb_study_community_requests(user_id);
alter table public.gb_study_community_requests enable row level security;
revoke all on public.gb_study_community_requests from anon,authenticated;
grant all on public.gb_study_community_requests to service_role;

-- Mutations use row locks, preventing the twentieth place being granted twice.
create or replace function public.gb_study_community_mutate(
 p_action text,p_actor text,p_community text default '',p_target text default '',
 p_accept boolean default false,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare c public.gb_study_community_directory%rowtype;
 v_count integer; v_joined boolean; v_invited boolean; v_room text;
 v_name text; v_id text;
begin
 if p_actor is null or length(p_actor)<1 or length(p_actor)>120 then raise exception 'invalid actor';end if;
 if not exists(select 1 from public.gb_study_students where id=p_actor and status='active')
 then raise exception 'student unavailable' using errcode='P0002';end if;
 if p_action='create' then
  v_name=trim(coalesce(p_payload->>'name',''));
  if length(v_name)<4 or length(v_name)>75 then raise exception 'invalid community name';end if;
  perform 1 from public.gb_study_students where id=p_actor for update;
  if (select count(*) from public.gb_study_community_directory where lead_id=p_actor)>=5
   then raise exception 'community lead limit reached' using errcode='23514';end if;
  v_id=gen_random_uuid()::text;
  insert into public.gb_study_community_directory(id,name,subject,description,visibility,join_mode,invite_code,lead_id)
   values(v_id,v_name,left(coalesce(p_payload->>'subject','General Study'),60),
    left(coalesce(p_payload->>'description',''),240),
    case when p_payload->>'visibility'='private' then 'private' else 'public' end,
    case when p_payload->>'joinMode'='approval' then 'approval' else 'open' end,
    encode(gen_random_bytes(12),'hex'),p_actor);
  insert into public.gb_study_community_members(community_id,user_id,role)
    values(v_id,p_actor,'lead');
  insert into public.gb_study_room_members(room_key,user_id) values('c:'||v_id,p_actor);
  return jsonb_build_object('ok',true,'id',v_id,'status','created');
 end if;
 select * into c from public.gb_study_community_directory where id=p_community for update;
 if not found then raise exception 'community unavailable' using errcode='P0002';end if;
 v_room='c:'||c.id;
 select exists(select 1 from public.gb_study_community_members where community_id=c.id and user_id=p_actor) into v_joined;
 if p_action='join' then
   v_invited=length(c.invite_code)>0 and coalesce(p_payload->>'code','')=c.invite_code;
   if c.visibility='private' and not v_invited then raise exception 'invitation required' using errcode='42501';end if;
   if v_joined then return jsonb_build_object('ok',true,'status','joined');end if;
   if exists(select 1 from public.gb_study_community_requests where community_id=c.id and user_id=p_actor) then
     return jsonb_build_object('ok',true,'status','pending');end if;
   select count(*) into v_count from public.gb_study_community_members where community_id=c.id;
   if v_count>=20 then raise exception 'community full' using errcode='23514';end if;
   if c.join_mode='approval' and not v_invited then
     insert into public.gb_study_community_requests(community_id,user_id) values(c.id,p_actor);
     return jsonb_build_object('ok',true,'status','pending');
   end if;
   insert into public.gb_study_community_members(community_id,user_id) values(c.id,p_actor);
   insert into public.gb_study_room_members(room_key,user_id) values(v_room,p_actor) on conflict do nothing;
   return jsonb_build_object('ok',true,'status','joined');
 end if;
 if p_action='leave' then
   if not v_joined then raise exception 'membership required' using errcode='42501';end if;
   if c.lead_id=p_actor then
     select count(*) into v_count from public.gb_study_community_members where community_id=c.id;
     if v_count>1 then raise exception 'transfer leadership first' using errcode='23514';end if;
     delete from public.gb_study_room_members where room_key=v_room;
     delete from public.gb_study_community_members where community_id=c.id;
     delete from public.gb_study_community_directory where id=c.id;
     return jsonb_build_object('ok',true,'deleted',true);
   end if;
   delete from public.gb_study_community_members where community_id=c.id and user_id=p_actor;
   delete from public.gb_study_room_members where room_key=v_room and user_id=p_actor;
   return jsonb_build_object('ok',true);
 end if;
 if c.lead_id<>p_actor then raise exception 'community lead required' using errcode='42501';end if;
 if p_action='respond' then
   if not exists(select 1 from public.gb_study_community_requests where community_id=c.id and user_id=p_target)
    then raise exception 'request unavailable' using errcode='P0002';end if;
   if p_accept then
     select count(*) into v_count from public.gb_study_community_members where community_id=c.id;
     if v_count>=20 then raise exception 'community full' using errcode='23514';end if;
     insert into public.gb_study_community_members(community_id,user_id) values(c.id,p_target)
       on conflict do nothing;
     insert into public.gb_study_room_members(room_key,user_id) values(v_room,p_target)
       on conflict do nothing;
   end if;
   delete from public.gb_study_community_requests where community_id=c.id and user_id=p_target;
 elsif p_action='remove' then
   if p_target=p_actor then raise exception 'cannot remove current lead' using errcode='23514';end if;
   delete from public.gb_study_community_members where community_id=c.id and user_id=p_target;
   if not found then raise exception 'member unavailable' using errcode='P0002';end if;
   delete from public.gb_study_room_members where room_key=v_room and user_id=p_target;
 elsif p_action='lead' then
   if p_target=p_actor or not exists(select 1 from public.gb_study_community_members where community_id=c.id and user_id=p_target)
    then raise exception 'choose an existing member';end if;
   perform 1 from public.gb_study_students where id=p_target for update;
   if (select count(*) from public.gb_study_community_directory where lead_id=p_target)>=5
    then raise exception 'community lead limit reached' using errcode='23514';end if;
   update public.gb_study_community_directory set lead_id=p_target,updated_at=now() where id=c.id;
   update public.gb_study_community_members set role='member' where community_id=c.id and user_id=p_actor;
   update public.gb_study_community_members set role='lead' where community_id=c.id and user_id=p_target;
 else raise exception 'unknown community action';end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.gb_study_community_mutate(text,text,text,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.gb_study_community_mutate(text,text,text,text,boolean,jsonb) to service_role;
notify pgrst, 'reload schema';

-- Query a filtered page with membership summaries (only called by authenticated EduSpace server).
create or replace function public.gb_study_community_snapshot(
 p_actor text,p_query text default '',p_mine boolean default false,p_id text default '',p_limit integer default 150
) returns jsonb language sql stable security invoker set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',s.id,'name',s.name,'description',s.description,'subject',s.subject,
   'visibility',s.visibility,'joinMode',s.join_mode,'lead',s.lead_id,
   'inviteCode',case when exists(select 1 from public.gb_study_community_members m
     where m.community_id=s.id and m.user_id=p_actor) then s.invite_code else '' end,
   'members',coalesce((select jsonb_agg(m.user_id order by m.joined_at)
     from public.gb_study_community_members m where m.community_id=s.id),'[]'::jsonb),
   'pending',coalesce((select jsonb_agg(r.user_id order by r.requested_at)
     from public.gb_study_community_requests r where r.community_id=s.id),'[]'::jsonb),
   'createdAt',s.created_at,'updatedAt',s.updated_at
 ) order by s.created_at desc),'[]'::jsonb)
 from (select c.* from public.gb_study_community_directory c
   where (p_id='' or c.id=p_id)
    and (p_mine and (exists(select 1 from public.gb_study_community_members m
      where m.community_id=c.id and m.user_id=p_actor)
       or exists(select 1 from public.gb_study_community_requests r
      where r.community_id=c.id and r.user_id=p_actor))
      or not p_mine and (c.visibility='public'
       or exists(select 1 from public.gb_study_community_members m
         where m.community_id=c.id and m.user_id=p_actor)))
    and (p_query='' or c.name ilike '%'||p_query||'%'
      or c.subject ilike '%'||p_query||'%'
      or c.description ilike '%'||p_query||'%')
    order by c.created_at desc limit greatest(1,least(p_limit,150))) s;
$$;
revoke all on function public.gb_study_community_snapshot(text,text,boolean,text,integer) from public,anon,authenticated;
grant execute on function public.gb_study_community_snapshot(text,text,boolean,text,integer) to service_role;

-- Clean deleted accounts without leaving orphaned Community Leads.
create or replace function public.gb_study_community_purge_student(p_user text)
returns integer language plpgsql security invoker set search_path=public as $$
declare c record; v_next text; v_count integer := 0;
begin
 if p_user is null or length(p_user)<1 or length(p_user)>120 then raise exception 'invalid user';end if;
 for c in select d.id,d.lead_id from public.gb_study_community_directory d
   where d.lead_id=p_user or exists(select 1 from public.gb_study_community_members m
    where m.community_id=d.id and m.user_id=p_user) order by d.id for update loop
   if c.lead_id=p_user then
     select user_id into v_next from public.gb_study_community_members
      where community_id=c.id and user_id<>p_user order by joined_at,user_id limit 1;
     if v_next is null then
       delete from public.gb_study_room_members where room_key='c:'||c.id;
       delete from public.gb_study_community_members where community_id=c.id;
       delete from public.gb_study_community_requests where community_id=c.id;
       delete from public.gb_study_community_directory where id=c.id;
       v_count:=v_count+1;
       continue;
     end if;
     update public.gb_study_community_directory set lead_id=v_next,updated_at=now() where id=c.id;
     update public.gb_study_community_members set role='lead'
       where community_id=c.id and user_id=v_next;
   end if;
   delete from public.gb_study_room_members where room_key='c:'||c.id and user_id=p_user;
   delete from public.gb_study_community_members where community_id=c.id and user_id=p_user;
   delete from public.gb_study_community_requests where community_id=c.id and user_id=p_user;
 end loop;
 delete from public.gb_study_community_requests where user_id=p_user;
 return v_count;
end $$;
revoke all on function public.gb_study_community_purge_student(text) from public,anon,authenticated;
grant execute on function public.gb_study_community_purge_student(text) to service_role;
