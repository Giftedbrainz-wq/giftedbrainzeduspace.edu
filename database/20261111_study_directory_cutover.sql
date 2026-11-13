-- Gifted Brainz EduSpace v12.16.0 — transactional STUDY directory + partnerships.
-- STAGING FIRST. Run after v12.14 and v12.15 migrations. No data is dropped.
-- Never enable the opt-in source switch without a verified, completed backfill.

alter table public.gb_study_students add column if not exists last_seen_at bigint not null default 0;
alter table public.gb_study_partnerships add column if not exists created_at timestamptz not null default now();

create table if not exists public.gb_study_blocks (
 from_id text not null,
 to_id text not null,
 created_at timestamptz not null default now(),
 primary key (from_id, to_id),
 check (from_id <> to_id)
);
create index if not exists gb_study_blocks_to on public.gb_study_blocks(to_id,from_id);
alter table public.gb_study_blocks enable row level security;
revoke all on public.gb_study_blocks from anon, authenticated;
grant all on public.gb_study_blocks to service_role;

-- A single unordered partnership pair is enforced even if requests race on
-- different EdgeOne instances. PRE-FLIGHT: this index will deliberately fail
-- on duplicates rather than deleting old partnership records without consent.
create unique index if not exists gb_study_unique_pair_v1216
 on public.gb_study_partnerships (least(from_id,to_id), greatest(from_id,to_id));
create index if not exists gb_study_partner_to_status_v1216
 on public.gb_study_partnerships (to_id, status);
create index if not exists gb_study_students_online_v1216 on public.gb_study_students (last_seen_at desc);

create or replace function public.gb_study_partner_mutate(
 p_action text, p_actor text, p_other text default '', p_id text default '', p_accept boolean default false
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare
 v_row public.gb_study_partnerships%rowtype;
 v_from text; v_to text; v_room text; v_status text;
 v_count integer;
begin
 if p_actor is null or length(p_actor)<1 or length(p_actor)>120 then raise exception 'invalid actor';end if;
 if p_action not in ('request','respond','remove','block') then raise exception 'unknown action';end if;
 if p_action in ('request','block') then
  if p_other is null or p_other=p_actor or length(p_other)<1 or length(p_other)>120 then raise exception 'invalid peer';end if;
  v_from:=p_actor;v_to:=p_other;
 else
  select * into v_row from public.gb_study_partnerships where id=p_id;
  if not found then raise exception 'partnership unavailable' using errcode='P0002'; end if;
  v_from:=v_row.from_id;v_to:=v_row.to_id;
  if p_action='respond' and (v_to<>p_actor or v_row.status<>'pending') then
   raise exception 'pending request to recipient required' using errcode='42501';
  elsif p_action='remove' and p_actor not in (v_from,v_to) then
   raise exception 'not a participant' using errcode='42501';
  end if;
 end if;
 -- Lock the pair consistently across instances before checking status/limits.
 perform pg_advisory_xact_lock(hashtextextended(least(v_from,v_to)||chr(0)||greatest(v_from,v_to),0));
 if p_action in ('request','block') then
  if not exists(select 1 from public.gb_study_students where id=v_from and status='active') or
     not exists(select 1 from public.gb_study_students where id=v_to and status='active') then
   raise exception 'student unavailable' using errcode='P0002';
  end if;
 end if;
 v_room := 'p:'||encode(sha256(convert_to(least(v_from,v_to)||chr(0)||greatest(v_from,v_to),'UTF8')),'hex');
 if p_action='request' then
  if exists(select 1 from public.gb_study_blocks where (from_id=v_from and to_id=v_to) or (from_id=v_to and to_id=v_from)) then
   raise exception 'partnership unavailable' using errcode='42501';
  end if;
  if exists(select 1 from public.gb_study_partnerships where least(from_id,to_id)=least(v_from,v_to)
      and greatest(from_id,to_id)=greatest(v_from,v_to)) then
   raise exception 'request or partnership already exists' using errcode='23505';
  end if;
  -- Lock the actor row to serialise concurrent requests to different peers.
  perform 1 from public.gb_study_students where id=p_actor for update;
  select count(*) into v_count from public.gb_study_partnerships
   where (from_id=p_actor or to_id=p_actor) and status<>'declined';
  if v_count>=30 then raise exception 'partnership limit reached' using errcode='23514';end if;
  insert into public.gb_study_partnerships(id,from_id,to_id,status)
   values(gen_random_uuid()::text,v_from,v_to,'pending') returning * into v_row;
 elsif p_action='respond' then
  select * into v_row from public.gb_study_partnerships where id=p_id for update;
  if not found or v_row.to_id<>p_actor or v_row.status<>'pending' then
   raise exception 'pending request unavailable' using errcode='P0002';end if;
  v_status:=case when p_accept then 'accepted' else 'declined' end;
  update public.gb_study_partnerships set status=v_status,updated_at=now()
    where id=p_id returning * into v_row;
  if v_status='accepted' and not exists(select 1 from public.gb_study_blocks
     where (from_id=v_from and to_id=v_to) or (from_id=v_to and to_id=v_from)) then
   insert into public.gb_study_room_members(room_key,user_id) values(v_room,v_from),(v_room,v_to)
   on conflict do nothing;
  else
   delete from public.gb_study_room_members where room_key=v_room;
  end if;
 elsif p_action='remove' then
  delete from public.gb_study_partnerships where id=p_id returning * into v_row;
  if not found then raise exception 'partnership already removed' using errcode='P0002';end if;
  delete from public.gb_study_room_members where room_key=v_room;
 elsif p_action='block' then
  insert into public.gb_study_blocks(from_id,to_id) values(v_from,v_to) on conflict do nothing;
  delete from public.gb_study_partnerships
    where least(from_id,to_id)=least(v_from,v_to) and greatest(from_id,to_id)=greatest(v_from,v_to);
  delete from public.gb_study_room_members where room_key=v_room;
  return jsonb_build_object('ok',true);
 end if;
 return jsonb_build_object('id',v_row.id,'from',v_row.from_id,'to',v_row.to_id,
  'status',v_row.status,'createdAt',v_row.created_at,'updatedAt',v_row.updated_at);
end $$;
revoke all on function public.gb_study_partner_mutate(text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.gb_study_partner_mutate(text,text,text,text,boolean) to service_role;

-- Only public directory fields, authenticated EduSpace server role. The
-- actor is supplied by an already verified server session, never a browser ID.
create or replace function public.gb_study_student_search(
 p_actor text,p_query text default '',p_offset int default 0,p_limit int default 40
) returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare v_total integer;v_rows jsonb;
begin
 if not exists(select 1 from public.gb_study_students where id=p_actor and status='active')
 then raise exception 'unknown active student' using errcode='42501';end if;
 p_query:=translate(left(trim(coalesce(p_query,'')),50),'%_','');
 p_offset:=greatest(0,least(coalesce(p_offset,0),10000));
 p_limit:=greatest(1,least(coalesce(p_limit,40),40));
 select count(*) into v_total from public.gb_study_students s
  where s.status='active' and s.id<>p_actor
    and (p_query='' or lower(s.username) like '%'||lower(p_query)||'%' or lower(s.display_name) like '%'||lower(p_query)||'%')
    and not exists(select 1 from public.gb_study_blocks b
      where (b.from_id=p_actor and b.to_id=s.id) or (b.to_id=p_actor and b.from_id=s.id));
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.display_name,
  'username',x.username,'avatar',x.avatar,'online',x.last_seen_at>(extract(epoch from now())*1000-120000))), '[]'::jsonb)
 into v_rows from (
   select s.* from public.gb_study_students s
   where s.status='active' and s.id<>p_actor
    and (p_query='' or lower(s.username) like '%'||lower(p_query)||'%' or lower(s.display_name) like '%'||lower(p_query)||'%')
    and not exists(select 1 from public.gb_study_blocks b
      where (b.from_id=p_actor and b.to_id=s.id) or (b.to_id=p_actor and b.from_id=s.id))
   order by s.last_seen_at desc,s.username asc,s.id asc limit p_limit offset p_offset
  ) x;
 return jsonb_build_object('students',v_rows,'total',v_total,'hasMore',p_offset+p_limit<v_total);
end $$;
revoke all on function public.gb_study_student_search(text,text,int,int) from public,anon,authenticated;
grant execute on function public.gb_study_student_search(text,text,int,int) to service_role;

create or replace function public.gb_study_touch_student(p_id text,p_at bigint)
returns void language plpgsql security invoker set search_path=public as $$
begin
 update public.gb_study_students set last_seen_at=greatest(last_seen_at,p_at)
 where id=p_id and status='active' and last_seen_at < p_at-45000;
end $$;
revoke all on function public.gb_study_touch_student(text,bigint) from public,anon,authenticated;
grant execute on function public.gb_study_touch_student(text,bigint) to service_role;
notify pgrst,'reload schema';
