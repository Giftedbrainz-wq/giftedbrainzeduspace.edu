import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const sql=await fs.readFile(new URL('../database/20261111_study_directory_cutover.sql',import.meta.url),'utf8');
test('directory migration is non-destructive and all tables enable RLS',()=>{
 assert.match(sql,/gb_study_blocks/);assert.match(sql,/enable row level security/i);
 assert.doesNotMatch(sql,/drop table\s+/i);assert.doesNotMatch(sql,/grant\s+all[^;]*\s+to\s+(?:anon|authenticated)/i);
});
test('pair uniqueness, locking, limits and room revocation are enforced transactionally',()=>{
 assert.match(sql,/create unique index if not exists gb_study_unique_pair/i);
 assert.match(sql,/pg_advisory_xact_lock/i);assert.match(sql,/v_count\s*>=\s*30/i);
 assert.match(sql,/delete from public\.gb_study_room_members/i);
 assert.match(sql,/security invoker/i);
 assert.match(sql,/sha256\(convert_to/i);
});
test('directory exposes only public fields and RPC access is service-role only',()=>{
 assert.match(sql,/jsonb_build_object\('id',x\.id,'name',x\.display_name/i);
 assert.match(sql,/grant execute on function public\.gb_study_student_search[^;]*to service_role/i);
 assert.match(sql,/grant execute on function public\.gb_study_partner_mutate[^;]*to service_role/i);
 assert.doesNotMatch(sql,/grant execute[^;]*to anon/i);
});
