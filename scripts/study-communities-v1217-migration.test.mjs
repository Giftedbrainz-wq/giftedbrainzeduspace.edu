import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const sql=await fs.readFile(new URL('../database/20261111_study_community_transactions.sql',import.meta.url),'utf8');
test('community schema keeps RLS on and denies anonymous mutations',()=>{
 assert.match(sql,/gb_study_community_requests enable row level security/i);
 assert.match(sql,/grant execute on function public\.gb_study_community_mutate[^;]*to service_role/i);
 assert.doesNotMatch(sql,/drop table\s+/i);
 assert.doesNotMatch(sql,/grant\s+execute[^;]*to\s+anon/i);
});
test('community capacity and membership authority use database transaction locks',()=>{
 assert.match(sql,/for update/i);assert.match(sql,/v_count>=20/i);
 assert.match(sql,/delete from public\.gb_study_room_members/i);
 assert.match(sql,/security invoker/i);
 assert.match(sql,/community lead required/i);
});
