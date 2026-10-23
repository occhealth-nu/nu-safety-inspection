-- =====================================================================
-- Database tests: สิทธิ์ข้ามหน่วยงาน, การส่งผลซ้ำ, KPI, ข้อไม่เกี่ยวข้อง,
-- การส่งกลับแก้ไข, ห้ามปิดงานก่อนตรวจยืนยัน, เวอร์ชันแบบตรวจ, การแจ้งเตือนซ้ำ
-- รันด้วย scripts/test-db.sh (ต้องมี migration + seed ก่อน)
-- ทุกการทดสอบรันในบทบาท authenticated พร้อม JWT claims เหมือนผ่าน PostgREST จริง
-- =====================================================================
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema test;
grant usage on schema test to authenticated, anon, service_role;
create sequence test.n;
grant usage on sequence test.n to authenticated, anon, service_role;

create function test.ok(p_cond boolean, p_name text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'not ok - %', p_name; end if;
  raise notice 'ok % - %', nextval('test.n'), p_name;
end $$;

-- รัน SQL แล้วคาดว่าจะ error ด้วย hint (รหัสข้อผิดพลาด) หรือ SQLSTATE ที่กำหนด
create function test.throws(p_sql text, p_expect text, p_name text) returns void language plpgsql as $$
declare v_hint text; v_state text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate, v_msg = message_text;
    if v_hint = p_expect or v_state = p_expect then
      raise notice 'ok % - % (%: %)', nextval('test.n'), p_name, p_expect, v_msg;
      return;
    end if;
    raise exception 'not ok - % : expected %, got hint=% state=% msg=%', p_name, p_expect, v_hint, v_state, v_msg;
  end;
  raise exception 'not ok - % : expected error % but statement succeeded', p_name, p_expect;
end $$;

create function test.login(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false)
$$;

create function test.item(p_seq int) returns uuid language sql stable as $$
  select ci.id from public.checklist_items ci
   where ci.version_id = (select id from public.checklist_versions where template_id = '40000000-0000-0000-0000-000000000001' and status = 'published')
     and ci.seq = p_seq
$$;

-- คำตอบผ่านทุกข้อ ยกเว้นข้อที่กำหนด
create function test.answers(p_overrides jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select jsonb_agg(coalesce(p_overrides -> ci.seq::text, '{}'::jsonb) || jsonb_build_object('item_id', ci.id)
                   || case when p_overrides ? ci.seq::text then '{}'::jsonb else '{"result":"pass"}'::jsonb end)
    from public.checklist_items ci
   where ci.version_id = (select id from public.checklist_versions where template_id = '40000000-0000-0000-0000-000000000001' and status = 'published')
$$;
grant execute on all functions in schema test to authenticated, anon, service_role;

-- ---------------------------------------------------------------------
-- Fixture: หน่วยงานทดสอบ TST → A, B
-- ---------------------------------------------------------------------
insert into public.organizations (id, parent_id, code, name_th, org_type) values
  ('a0000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'TST', 'หน่วยงานทดสอบ', 'faculty');
insert into public.organizations (id, parent_id, code, name_th, org_type) values
  ('a0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'TST-A', 'หน่วยทดสอบ A', 'unit'),
  ('a0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000000', 'TST-B', 'หน่วยทดสอบ B', 'unit');

insert into auth.users (id, email, raw_user_meta_data) values
  ('b0000000-0000-0000-0000-000000000001', 'admin.a@test.local', '{"full_name":"Admin A"}'),
  ('b0000000-0000-0000-0000-000000000002', 'insp.a@test.local',  '{"full_name":"Inspector A"}'),
  ('b0000000-0000-0000-0000-000000000003', 'insp.b@test.local',  '{"full_name":"Inspector B"}'),
  ('b0000000-0000-0000-0000-000000000004', 'admin.b@test.local', '{"full_name":"Admin B"}'),
  ('b0000000-0000-0000-0000-000000000005', 'fixer@test.local',   '{"full_name":"Fixer A"}'),
  ('b0000000-0000-0000-0000-000000000006', 'verify@test.local',  '{"full_name":"Verifier TST"}'),
  ('b0000000-0000-0000-0000-000000000007', 'exec@test.local',    '{"full_name":"Executive TST"}'),
  ('b0000000-0000-0000-0000-000000000008', 'nobody@test.local',  '{"full_name":"No Role"}');
update public.profiles set organization_id = 'a0000000-0000-0000-0000-00000000000a' where email in ('admin.a@test.local','insp.a@test.local','fixer@test.local');
update public.profiles set organization_id = 'a0000000-0000-0000-0000-00000000000b' where email in ('admin.b@test.local','insp.b@test.local');
update public.profiles set organization_id = 'a0000000-0000-0000-0000-000000000000' where email in ('verify@test.local','exec@test.local');
insert into public.role_assignments (user_id, role, organization_id) values
  ('b0000000-0000-0000-0000-000000000001', 'org_admin',   'a0000000-0000-0000-0000-00000000000a'),
  ('b0000000-0000-0000-0000-000000000002', 'inspector',   'a0000000-0000-0000-0000-00000000000a'),
  ('b0000000-0000-0000-0000-000000000003', 'inspector',   'a0000000-0000-0000-0000-00000000000b'),
  ('b0000000-0000-0000-0000-000000000004', 'org_admin',   'a0000000-0000-0000-0000-00000000000b'),
  ('b0000000-0000-0000-0000-000000000005', 'responsible', 'a0000000-0000-0000-0000-00000000000a'),
  ('b0000000-0000-0000-0000-000000000006', 'verifier',    'a0000000-0000-0000-0000-000000000000'),
  ('b0000000-0000-0000-0000-000000000007', 'executive',   'a0000000-0000-0000-0000-000000000000');

insert into public.buildings (id, organization_id, code, name) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', 'TB', 'อาคารทดสอบ');
insert into public.assets (id, code, name, asset_type_id, organization_id, building_id, frequency) values
  ('d0000000-0000-0000-0000-0000000000a1', 'T-A1', 'ถังทดสอบ A1', '30000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'monthly'),
  ('d0000000-0000-0000-0000-0000000000a2', 'T-A2', 'ถังทดสอบ A2', '30000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'monthly'),
  ('d0000000-0000-0000-0000-0000000000b1', 'T-B1', 'ถังทดสอบ B1', '30000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000001', 'monthly');
insert into public.inspection_plans (id, name, organization_id, asset_type_id, template_id, frequency, start_on, default_inspector_id) values
  ('e0000000-0000-0000-0000-00000000000a', 'แผนทดสอบ A', 'a0000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001', 'monthly', '2026-01-01', 'b0000000-0000-0000-0000-000000000002');

-- วันที่จำลองสำหรับการทดสอบ (เวลาประเทศไทย)
set app.today_override = '2026-06-15';

-- =====================================================================
\echo '--- 1. การวางแผน: สร้างงานตรวจตามรอบ'
-- =====================================================================
set role authenticated;
select test.login('b0000000-0000-0000-0000-000000000001');
select test.ok(public.generate_inspection_tasks('e0000000-0000-0000-0000-00000000000a', '2026-12-31') = 24,
               'รายเดือน 2 อุปกรณ์ × 12 เดือน = 24 งาน');
select test.ok(public.generate_inspection_tasks('e0000000-0000-0000-0000-00000000000a', '2026-12-31') = 0,
               'สร้างซ้ำไม่เกิดงานซ้ำ (unique plan/asset/period)');
select test.ok((select due_on from public.inspection_tasks where plan_id = 'e0000000-0000-0000-0000-00000000000a'
                 and asset_id = 'd0000000-0000-0000-0000-0000000000a1' and period_start = '2026-02-01') = '2026-02-28',
               'ครบกำหนดวันสุดท้ายของรอบ (ก.พ. = 28)');
select test.login('b0000000-0000-0000-0000-000000000004');
select test.throws($$select public.generate_inspection_tasks('e0000000-0000-0000-0000-00000000000a', '2026-12-31')$$,
                   'FORBIDDEN', 'ผู้ดูแลหน่วยงาน B สร้างงานในแผนของ A ไม่ได้');

-- =====================================================================
\echo '--- 2. สิทธิ์ข้ามหน่วยงาน'
-- =====================================================================
select test.login('b0000000-0000-0000-0000-000000000003');  -- inspector B
select test.ok((select count(*) from public.assets where code like 'T-%') = 1, 'ผู้ตรวจ B เห็นเฉพาะอุปกรณ์ของ B');
select test.ok((select count(*) from public.inspection_tasks where organization_id = 'a0000000-0000-0000-0000-00000000000a') = 0,
               'ผู้ตรวจ B ไม่เห็นงานตรวจของ A');
select test.ok((select count(*) from public.assets where code like 'ENG%' or organization_id = '10000000-0000-0000-0000-000000000011') = 0,
               'ผู้ตรวจ B ไม่เห็นอุปกรณ์ของคณะอื่น');
select test.throws($$select public.start_inspection('d0000000-0000-0000-0000-0000000000a1')$$, 'FORBIDDEN',
                   'ผู้ตรวจ B เริ่มตรวจอุปกรณ์ของ A ไม่ได้ (แม้รู้ id/สแกน QR)');
select test.throws($$insert into public.assets (code, name, asset_type_id, organization_id, building_id)
                     values ('X-1','x','30000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001')$$,
                   '42501', 'ผู้ตรวจเพิ่มอุปกรณ์ไม่ได้ (RLS)');
select test.login('b0000000-0000-0000-0000-000000000004');  -- admin B
select test.throws($$insert into public.assets (code, name, asset_type_id, organization_id, building_id)
                     values ('X-2','x','30000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001')$$,
                   '42501', 'ผู้ดูแล B เพิ่มอุปกรณ์ในหน่วยงาน A ไม่ได้');
update public.assets set name = 'hacked' where id = 'd0000000-0000-0000-0000-0000000000a1';
reset role;
select test.ok((select name from public.assets where id = 'd0000000-0000-0000-0000-0000000000a1') = 'ถังทดสอบ A1',
               'ผู้ดูแล B แก้ไขอุปกรณ์ของ A ไม่ได้ (update ไม่มีผล)');
set role authenticated;
select test.throws($$select public.grant_role('b0000000-0000-0000-0000-000000000003', 'org_admin', 'a0000000-0000-0000-0000-00000000000a')$$,
                   'FORBIDDEN', 'ผู้ดูแล B ให้สิทธิ์ในหน่วยงาน A ไม่ได้');
select test.throws($$select public.grant_role('b0000000-0000-0000-0000-000000000003', 'system_admin', '10000000-0000-0000-0000-000000000001')$$,
                   'FORBIDDEN', 'ผู้ดูแลหน่วยงานให้สิทธิ์ส่วนกลางไม่ได้');
select test.throws($$insert into public.role_assignments (user_id, role, organization_id) values
                     ('b0000000-0000-0000-0000-000000000004','system_admin','10000000-0000-0000-0000-000000000001')$$,
                   '42501', 'ยกระดับสิทธิ์ตนเองโดยเขียนตารางตรงไม่ได้');
-- งานที่ยังไม่มอบหมายผู้ตรวจ (assignee เป็น NULL) ต้องไม่ทำให้ข้ามการตรวจสิทธิ์
reset role;
insert into public.inspection_tasks (asset_id, organization_id, template_id, period_start, due_on)
values ('d0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '2026-06-01', '2026-06-20');
set role authenticated;
select test.login('b0000000-0000-0000-0000-000000000003');  -- inspector B
select test.throws($$select public.start_inspection('d0000000-0000-0000-0000-0000000000a2',
                     (select id from public.inspection_tasks where asset_id = 'd0000000-0000-0000-0000-0000000000a2' and plan_id is null))$$,
                   'FORBIDDEN', 'งานที่ยังไม่มอบหมาย: ผู้ตรวจต่างหน่วยงานเปิดตรวจไม่ได้ (NULL ไม่ข้ามการตรวจสิทธิ์)');
select test.throws($$select public.start_inspection('d0000000-0000-0000-0000-0000000000a2')$$,
                   'FORBIDDEN', 'สแกน QR จุดตรวจต่างหน่วยงานที่มีงานยังไม่มอบหมาย → ไม่มีสิทธิ์');
reset role;
select test.ok((select count(*) from public.inspections where asset_id = 'd0000000-0000-0000-0000-0000000000a2') = 0, 'ไม่มีฉบับร่างถูกสร้างจากความพยายามข้างต้น');
delete from public.inspection_tasks where asset_id = 'd0000000-0000-0000-0000-0000000000a2' and plan_id is null;
set role authenticated;
select test.login('b0000000-0000-0000-0000-000000000007');  -- executive at TST
select test.ok((select count(*) from public.assets where code like 'T-%') = 3, 'ผู้บริหารระดับ TST เห็นทั้ง A และ B');
select test.ok((select count(*) from public.assets where organization_id = '10000000-0000-0000-0000-000000000011') = 0,
               'ผู้บริหารระดับ TST ไม่เห็นข้อมูลนอกขอบเขต');
select test.throws($$select public.start_inspection('d0000000-0000-0000-0000-0000000000a1')$$, 'FORBIDDEN',
                   'ผู้บริหาร (ดูอย่างเดียว) ส่งผลตรวจไม่ได้');
select test.login('b0000000-0000-0000-0000-000000000008');  -- no role
select test.ok((select count(*) from public.assets) = 0 and (select count(*) from public.findings) = 0,
               'ผู้ใช้ที่ไม่มีบทบาทไม่เห็นข้อมูลใด');
reset role;
set role anon;
select test.throws($$select count(*) from public.assets$$, '42501', 'ผู้ไม่ได้เข้าสู่ระบบอ่านตารางไม่ได้');
reset role;

-- =====================================================================
\echo '--- 3. ตรวจหน้างาน: ข้อไม่เกี่ยวข้อง และหลักฐานภาพ'
-- =====================================================================
set role authenticated;
select test.login('b0000000-0000-0000-0000-000000000002');  -- inspector A
create temp table ctx (k text primary key, v uuid);
grant all on ctx to authenticated;
insert into ctx select 'task_may_a1', id from public.inspection_tasks
  where asset_id = 'd0000000-0000-0000-0000-0000000000a1' and period_start = '2026-05-01';
insert into ctx select 'task_jun_a1', id from public.inspection_tasks
  where asset_id = 'd0000000-0000-0000-0000-0000000000a1' and period_start = '2026-06-01';
insert into ctx values ('insp_may', public.start_inspection('d0000000-0000-0000-0000-0000000000a1', (select v from ctx where k = 'task_may_a1')));
select test.ok((select v from ctx where k = 'insp_may') = public.start_inspection('d0000000-0000-0000-0000-0000000000a1', (select v from ctx where k = 'task_may_a1')),
               'เปิดงานเดิมซ้ำได้ฉบับร่างเดิม (ไม่สร้างร่างซ้ำ)');
select test.ok((public.save_inspection_draft((select v from ctx where k = 'insp_may'),
                 test.answers('{"1":{"result":"na"}}'))->>'ok')::boolean, 'บันทึกฉบับร่างได้แม้ยังไม่ครบ');
select test.throws(format($$select public.submit_inspection(%L, test.answers('{"1":{"result":"na"}}'), null, gen_random_uuid())$$,
                          (select v from ctx where k = 'insp_may')),
                   'VALIDATION_FAILED', 'ไม่เกี่ยวข้องโดยไม่ระบุเหตุผล → ส่งไม่ได้');
select test.throws(format($$select public.submit_inspection(%L, test.answers('{"2":{"result":"na","na_reason":"x"}}'), null, gen_random_uuid())$$,
                          (select v from ctx where k = 'insp_may')),
                   'VALIDATION_FAILED', 'ข้อที่ไม่อนุญาต "ไม่เกี่ยวข้อง" → ส่งไม่ได้');
select test.throws(format($$select public.submit_inspection(%L, test.answers('{"3":{"result":"fail","note":"สายฉีดแตก","urgency":"medium"}}'), null, gen_random_uuid())$$,
                          (select v from ctx where k = 'insp_may')),
                   'VALIDATION_FAILED', 'ไม่ผ่านโดยไม่แนบภาพและไม่ระบุเหตุผลยกเว้น → ส่งไม่ได้');
select test.throws(format($$select public.submit_inspection(%L, test.answers('{"3":{"result":"fail","photo_exempt_reason":"ห้ามถ่ายภาพ","urgency":"medium"}}'), null, gen_random_uuid())$$,
                          (select v from ctx where k = 'insp_may')),
                   'VALIDATION_FAILED', 'ไม่ผ่านโดยไม่ระบุรายละเอียด → ส่งไม่ได้');
select test.ok((select status from public.inspections where id = (select v from ctx where k = 'insp_may')) = 'draft',
               'การส่งที่ไม่ผ่านการตรวจสอบไม่เปลี่ยนสถานะเป็นส่งแล้ว');
insert into ctx values ('sub_may', gen_random_uuid());
select test.ok((public.submit_inspection((select v from ctx where k = 'insp_may'),
                 test.answers('{"1":{"result":"na","na_reason":"ถังชนิด CO2 ไม่มีเกจ"}}'), 'ปกติ', (select v from ctx where k = 'sub_may'))->>'score_pct')::numeric = 100,
               'ผ่าน 5 + ไม่เกี่ยวข้อง 1 → คะแนน 100% (NA ไม่อยู่ในตัวหาร)');

-- =====================================================================
\echo '--- 4. ป้องกันการส่งผลตรวจซ้ำ'
-- =====================================================================
select test.ok((public.submit_inspection((select v from ctx where k = 'insp_may'), test.answers(), null, (select v from ctx where k = 'sub_may'))->>'already_submitted')::boolean,
               'กดส่งซ้ำด้วยคำขอเดิม (retry) → คืนผลเดิม ไม่สร้างซ้ำ');
select test.throws(format($$select public.submit_inspection(%L, test.answers(), null, gen_random_uuid())$$, (select v from ctx where k = 'insp_may')),
                   'ALREADY_SUBMITTED', 'ส่งซ้ำด้วยคำขอใหม่ → ถูกปฏิเสธ');
select test.throws(format($$select public.save_inspection_draft(%L, test.answers())$$, (select v from ctx where k = 'insp_may')),
                   'ALREADY_SUBMITTED', 'แก้ไขผลตรวจหลังส่งแล้วไม่ได้');
select test.throws(format($$select public.start_inspection('d0000000-0000-0000-0000-0000000000a1', %L)$$, (select v from ctx where k = 'task_may_a1')),
                   'TASK_ALREADY_COMPLETED', 'เปิดตรวจงานที่ส่งผลแล้วซ้ำไม่ได้');
select test.ok((select count(*) from public.inspections where task_id = (select v from ctx where k = 'task_may_a1') and status = 'submitted') = 1,
               'งานตรวจมีผลตรวจที่ส่งแล้วเพียง 1 รายการ');
-- ผู้ตรวจสองคนเปิดร่างพร้อมกันในงานเดียวกัน: คนที่ส่งทีหลังต้องถูกปฏิเสธ
select test.login('b0000000-0000-0000-0000-000000000001');  -- admin A (มีสิทธิ์ตรวจ)
insert into ctx values ('insp_jun_admin', public.start_inspection('d0000000-0000-0000-0000-0000000000a1', (select v from ctx where k = 'task_jun_a1')));
select test.login('b0000000-0000-0000-0000-000000000002');
insert into ctx values ('insp_jun', public.start_inspection('d0000000-0000-0000-0000-0000000000a1', (select v from ctx where k = 'task_jun_a1')));
select test.ok((select v from ctx where k = 'insp_jun') <> (select v from ctx where k = 'insp_jun_admin'), 'ร่างแยกตามผู้ตรวจ');
reset role;
-- ไฟล์แนบจำลอง (อัปโหลดจริงผ่าน Storage ทดสอบใน e2e) สำหรับข้อ 4 ที่ไม่ผ่าน
set role authenticated;
select test.ok(public.register_attachment('inspection', (select v from ctx where k = 'insp_jun'),
                 'inspection/' || (select v from ctx where k = 'insp_jun') || '/photo1.jpg', 'image/jpeg', 2048, 'evidence', test.item(4)) is not null,
               'แนบภาพหลักฐานกับข้อที่ไม่ผ่านได้');
select test.throws(format($$select public.register_attachment('inspection', %L, 'inspection/other/x.jpg', 'image/jpeg', 10, 'evidence', %L)$$,
                          (select v from ctx where k = 'insp_jun'), test.item(4)),
                   'INVALID_INPUT', 'path ไฟล์ต้องอยู่ใต้รายการของตนเท่านั้น');
insert into ctx values ('sub_jun', gen_random_uuid());
select test.ok((public.submit_inspection((select v from ctx where k = 'insp_jun'),
                 test.answers('{"4":{"result":"fail","note":"ตัวถังเป็นสนิม","urgency":"high"},"6":{"result":"na","na_reason":"ไม่มีบัตรตรวจ"}}'),
                 null, (select v from ctx where k = 'sub_jun'))->>'score_pct')::numeric = 80,
               'ผ่าน 4 ไม่ผ่าน 1 ไม่เกี่ยวข้อง 1 → 80% (4/5)');
select test.login('b0000000-0000-0000-0000-000000000001');
select test.throws(format($$select public.submit_inspection(%L, test.answers(), null, gen_random_uuid())$$, (select v from ctx where k = 'insp_jun_admin')),
                   'TASK_ALREADY_COMPLETED', 'ร่างของผู้ตรวจอีกคนในงานเดียวกันส่งซ้ำไม่ได้');
select test.login('b0000000-0000-0000-0000-000000000002');
insert into ctx select 'finding', id from public.findings where inspection_id = (select v from ctx where k = 'insp_jun');
select test.ok((select count(*) from public.findings where inspection_id = (select v from ctx where k = 'insp_jun')) = 1,
               'ข้อไม่ผ่าน 1 ข้อ → สร้างข้อบกพร่อง 1 รายการ เชื่อมโยงผลตรวจต้นทาง');
select test.ok((select status = 'open' and severity = 'high' and finding_no like 'NC-2569-%' from public.findings where id = (select v from ctx where k = 'finding')),
               'เลขที่งานใช้ปี พ.ศ. และสถานะเริ่มต้น "พบข้อบกพร่อง"');
reset role;
select test.ok(exists (select 1 from public.notifications n join public.role_assignments ra on ra.user_id = n.user_id
                        where n.type = 'finding_urgent' and n.entity_id = (select v from ctx where k = 'finding')),
               'ข้อบกพร่องระดับสูงแจ้งเตือนผู้ดูแล/ผู้ประสานงาน');
-- ข้อบกพร่องสถานะ "พบข้อบกพร่อง" (ยังไม่มีผู้รับผิดชอบ) ต้องไม่เปิดช่องให้คนนอกหน่วยงาน
set role authenticated;
select test.login('b0000000-0000-0000-0000-000000000003');  -- inspector B
select test.throws(format($$select public.create_work_order(%L, 'x', 'y')$$, (select v from ctx where k = 'finding')),
                   'FORBIDDEN', 'ข้อบกพร่องยังไม่มอบหมาย: คนนอกหน่วยงานออกใบงานไม่ได้');
select test.throws(format($$select public.add_corrective_progress(%L, 'x', 10)$$, (select v from ctx where k = 'finding')),
                   'FORBIDDEN', 'ข้อบกพร่องยังไม่มอบหมาย: คนนอกหน่วยงานรายงานความคืบหน้าไม่ได้');
select test.throws(format($$select public.register_attachment('finding', %L, 'finding/' || %L || '/x.jpg', 'image/jpeg', 10, 'after', null)$$,
                          (select v from ctx where k = 'finding'), (select v from ctx where k = 'finding')),
                   'FORBIDDEN', 'ข้อบกพร่องยังไม่มอบหมาย: คนนอกหน่วยงานแนบไฟล์ไม่ได้');
reset role;
-- ย้อนเวลาส่งผลให้อยู่ในเดือนที่ตรวจ (เพื่อทดสอบ KPI ตามช่วงเวลา)
update public.inspections set submitted_at = '2026-05-20 03:00+00' where id = (select v from ctx where k = 'insp_may');
update public.inspections set submitted_at = '2026-06-10 03:00+00' where id = (select v from ctx where k = 'insp_jun');
set app.in_workflow = 'on';
update public.inspection_tasks set completed_at = '2026-05-20 03:00+00' where id = (select v from ctx where k = 'task_may_a1');
update public.inspection_tasks set completed_at = '2026-06-10 03:00+00' where id = (select v from ctx where k = 'task_jun_a1');
set app.in_workflow = 'off';
update public.findings set created_at = '2026-06-10 03:00+00' where id = (select v from ctx where k = 'finding');

-- =====================================================================
\echo '--- 5. ห้ามปิดงานก่อนตรวจยืนยัน'
-- =====================================================================
set role authenticated;
select test.login('b0000000-0000-0000-0000-000000000001');
select test.throws(format($$update public.findings set status = 'closed' where id = %L$$, (select v from ctx where k = 'finding')),
                   '42501', 'ผู้ใช้แก้สถานะข้อบกพร่องตรงในตารางไม่ได้');
select test.throws(format($$select public.verify_finding(%L, true, 'ok')$$, (select v from ctx where k = 'finding')),
                   'FORBIDDEN', 'ผู้ดูแลหน่วยงาน (ไม่ใช่ผู้ตรวจยืนยัน) ปิดงานไม่ได้');
select test.login('b0000000-0000-0000-0000-000000000006');
select test.throws(format($$select public.verify_finding(%L, true, 'ok')$$, (select v from ctx where k = 'finding')),
                   'NOT_PENDING_VERIFICATION', 'ผู้ตรวจยืนยันปิดงานที่ยังไม่ได้แก้ไขไม่ได้');
reset role;
select test.throws(format($$update public.findings set status = 'closed', closed_at = now() where id = %L$$, (select v from ctx where k = 'finding')),
                   'INVALID_TRANSITION', 'แม้ผู้ดูแลฐานข้อมูลก็ข้ามลำดับสถานะไม่ได้ (trigger)');
select test.throws(format($$update public.findings set status = 'pending_verification', assignee_id = 'b0000000-0000-0000-0000-000000000005', due_on = '2026-07-01' where id = %L$$, (select v from ctx where k = 'finding')),
                   'INVALID_TRANSITION', 'ข้ามจากพบข้อบกพร่องไปรอตรวจยืนยันไม่ได้');

-- =====================================================================
\echo '--- 6. มอบหมาย → แก้ไข → ส่งกลับ → แก้ไขใหม่ → ตรวจยืนยัน → ปิดงาน'
-- =====================================================================
set role authenticated;
select test.login('b0000000-0000-0000-0000-000000000004');  -- admin B
select test.throws(format($$select public.assign_finding(%L, 'b0000000-0000-0000-0000-000000000005', '2026-06-30')$$, (select v from ctx where k = 'finding')),
                   'FORBIDDEN', 'ผู้ดูแล B มอบหมายงานของ A ไม่ได้');
select test.login('b0000000-0000-0000-0000-000000000001');  -- admin A
select test.throws(format($$select public.assign_finding(%L, 'b0000000-0000-0000-0000-000000000003', '2026-06-30')$$, (select v from ctx where k = 'finding')),
                   'INVALID_INPUT', 'มอบหมายให้ผู้ที่ไม่มีบทบาทผู้รับผิดชอบไม่ได้');
select test.throws(format($$select public.assign_finding(%L, 'b0000000-0000-0000-0000-000000000005', '2026-06-01')$$, (select v from ctx where k = 'finding')),
                   'INVALID_INPUT', 'กำหนดแล้วเสร็จย้อนหลังไม่ได้');
select public.assign_finding((select v from ctx where k = 'finding'), 'b0000000-0000-0000-0000-000000000005', '2026-06-30',
                             'กั้นพื้นที่ชั่วคราว', null, null);
select test.ok((select status = 'assigned' from public.findings where id = (select v from ctx where k = 'finding')), 'สถานะ → มอบหมาย');
select test.login('b0000000-0000-0000-0000-000000000003');
select test.ok((select count(*) from public.findings where id = (select v from ctx where k = 'finding')) = 0, 'ผู้ตรวจ B มองไม่เห็นข้อบกพร่องของ A');
select test.login('b0000000-0000-0000-0000-000000000005');  -- fixer
select test.ok((select count(*) from public.findings where id = (select v from ctx where k = 'finding')) = 1, 'ผู้รับผิดชอบเห็นงานที่ได้รับมอบหมาย');
select test.ok(exists (select 1 from public.notifications where type = 'finding_assigned' and entity_id = (select v from ctx where k = 'finding')),
               'ผู้รับผิดชอบได้รับการแจ้งเตือนการมอบหมาย');
select public.start_corrective_work((select v from ctx where k = 'finding'), null);
select public.add_corrective_progress((select v from ctx where k = 'finding'), 'สั่งซื้อถังใหม่แล้ว', 50);
select test.throws(format($$select public.submit_corrective_fix(%L, 'เปลี่ยนแล้ว')$$, (select v from ctx where k = 'finding')),
                   'VALIDATION_FAILED', 'ส่งผลแก้ไขโดยไม่มีภาพหลังแก้ไขไม่ได้');
select public.register_attachment('finding', (select v from ctx where k = 'finding'),
  'finding/' || (select v from ctx where k = 'finding') || '/after1.jpg', 'image/jpeg', 4096, 'after', null);
select public.submit_corrective_fix((select v from ctx where k = 'finding'), 'เปลี่ยนถังใหม่แล้ว', null);
select test.ok((select status = 'pending_verification' from public.findings where id = (select v from ctx where k = 'finding')), 'สถานะ → รอตรวจยืนยัน');
select test.throws(format($$select public.verify_finding(%L, true, 'ok')$$, (select v from ctx where k = 'finding')),
                   'FORBIDDEN', 'ผู้รับผิดชอบปิดงานตนเองไม่ได้');
reset role;
insert into public.role_assignments (user_id, role, organization_id) values
  ('b0000000-0000-0000-0000-000000000005', 'verifier', 'a0000000-0000-0000-0000-00000000000a');
set role authenticated;
select test.throws(format($$select public.verify_finding(%L, true, 'ok')$$, (select v from ctx where k = 'finding')),
                   'SELF_VERIFICATION', 'แม้มีบทบาทผู้ตรวจยืนยัน ก็ยืนยันงานที่ตนแก้เองไม่ได้');
select test.login('b0000000-0000-0000-0000-000000000006');  -- verifier
select test.throws(format($$select public.verify_finding(%L, false, '')$$, (select v from ctx where k = 'finding')),
                   'INVALID_INPUT', 'ส่งกลับต้องระบุเหตุผล');
select public.verify_finding((select v from ctx where k = 'finding'), false, 'ยังไม่ติดป้ายตำแหน่ง');
select test.ok((select status = 'in_progress' and rework_count = 1 from public.findings where id = (select v from ctx where k = 'finding')),
               'ส่งกลับ → กำลังแก้ไข และนับจำนวนครั้งที่ส่งกลับ');
select test.login('b0000000-0000-0000-0000-000000000005');
select test.ok(exists (select 1 from public.notifications where type = 'verification_result' and body like '%ยังไม่ติดป้าย%'),
               'ผู้รับผิดชอบได้รับแจ้งเหตุผลการส่งกลับ');
select test.throws(format($$select public.submit_corrective_fix(%L, 'ติดป้ายแล้ว')$$, (select v from ctx where k = 'finding')),
                   'VALIDATION_FAILED', 'หลังถูกส่งกลับต้องแนบหลักฐานใหม่');
select public.submit_corrective_fix((select v from ctx where k = 'finding'), 'ติดป้ายแล้ว', 'พื้นที่ห้องเครื่องห้ามถ่ายภาพ');
select test.login('b0000000-0000-0000-0000-000000000006');
select public.verify_finding((select v from ctx where k = 'finding'), true, 'เรียบร้อย');
select test.ok((select status = 'closed' and verified_by = 'b0000000-0000-0000-0000-000000000006' and closed_at is not null
                  from public.findings where id = (select v from ctx where k = 'finding')), 'ตรวจยืนยัน → ปิดงาน');
select test.ok((select array_agg(action_type order by created_at, id) from public.corrective_actions where finding_id = (select v from ctx where k = 'finding'))
                 @> array['created','assign','start','progress','submit_fix','reject','approve'],
               'ทุกการเปลี่ยนสถานะมีประวัติผู้ดำเนินการ');
select test.ok((select bool_and(actor_id is not null) from public.corrective_actions where finding_id = (select v from ctx where k = 'finding')),
               'ประวัติระบุผู้ดำเนินการทุกรายการ');
select test.throws(format($$select public.add_corrective_progress(%L, 'x', 10)$$, (select v from ctx where k = 'finding')),
                   'FORBIDDEN', 'งานที่ปิดแล้วรายงานความคืบหน้าไม่ได้');
reset role;
select test.ok((select count(*) from public.audit_logs where table_name = 'findings' and record_id = (select v::text from ctx where k = 'finding')) >= 5,
               'audit log บันทึกการเปลี่ยนแปลงข้อบกพร่อง');
update public.findings set closed_at = '2026-06-20 03:00+00', verified_at = '2026-06-20 03:00+00' where id = (select v from ctx where k = 'finding');

-- =====================================================================
\echo '--- 7. KPI (ช่วง 1 พ.ค.–30 มิ.ย. 2569, วันนี้ = 15 มิ.ย. 2569, หน่วยงาน A)'
-- =====================================================================
set role authenticated;
select test.login('b0000000-0000-0000-0000-000000000007');  -- executive (อ่านอย่างเดียว)
create temp table k as select public.dashboard_kpis('2026-05-01', '2026-06-30', 'a0000000-0000-0000-0000-00000000000a') j;
select test.ok((select (j->'tasks'->>'due')::int from k) = 4, 'งานถึงกำหนดในช่วง = 4 (2 อุปกรณ์ × 2 เดือน)');
select test.ok((select (j->'tasks'->>'done')::int from k) = 2, 'ตรวจแล้ว = 2');
select test.ok((select (j->'tasks'->>'overdue')::int from k) = 1, 'เกินกำหนด = 1 (A2 พ.ค.)');
select test.ok((select (j->'tasks'->>'pending')::int from k) = 1, 'รอตรวจ = 1 (A2 มิ.ย.)');
select test.ok((select (j->'tasks'->>'coverage_pct')::numeric from k) = 50.0, 'ความครอบคลุม = ตรวจแล้ว/ถึงกำหนด = 50%');
select test.ok((select (j->>'assets_active')::int from k) = 2, 'อุปกรณ์ใช้งานอยู่ = 2 (ไม่ใช่ตัวหารของความครอบคลุม)');
select test.ok((select (j->'results'->>'pass')::int = 9 and (j->'results'->>'fail')::int = 1 and (j->'results'->>'na')::int = 2 from k),
               'ผลรายข้อ: ผ่าน 9 ไม่ผ่าน 1 ไม่เกี่ยวข้อง 2');
select test.ok((select (j->'results'->>'pass_rate_pct')::numeric from k) = 90.0, 'อัตราผ่าน = 9/(9+1) = 90% (ไม่นับ NA)');
select test.ok((select (j->'closure'->>'on_time_pct')::numeric from k) = 100.0, 'ปิดงานภายในกำหนด 1/1 = 100%');
select test.ok((select (j->'findings'->>'open')::int from k) = 0, 'ข้อบกพร่องเปิดอยู่ = 0');
create temp table k2 as select public.dashboard_kpis('2026-01-01', '2026-12-31', 'a0000000-0000-0000-0000-000000000000') j;
select test.ok((select (j->'tasks'->>'due')::int from k2) = 24, 'ทั้งปีหน่วยงาน TST = 24 งาน (B ไม่มีแผน)');
select test.login('b0000000-0000-0000-0000-000000000003');  -- inspector B
select test.ok((select (public.dashboard_kpis('2026-01-01', '2026-12-31', null)->'tasks'->>'due')::int) = 0,
               'KPI ถูกกรองตามสิทธิ์: ผู้ตรวจ B ไม่เห็นงานของ A');
select test.login('b0000000-0000-0000-0000-000000000007');
select test.ok((select sum(due) from public.dashboard_annual(2026, 'category', 'a0000000-0000-0000-0000-00000000000a')) = 24
               and (select due = 2 and done = 1 from public.dashboard_annual(2026, 'category', 'a0000000-0000-0000-0000-00000000000a') where month = 5),
               'ตารางรายปี: พ.ค. ตรวจแล้ว 1 / ถึงกำหนด 2');

-- =====================================================================
\echo '--- 8. เวอร์ชันแบบตรวจ'
-- =====================================================================
select test.login('b0000000-0000-0000-0000-000000000001');  -- org admin ไม่ใช่ส่วนกลาง
select test.throws($$select public.create_checklist_version('40000000-0000-0000-0000-000000000001')$$, 'FORBIDDEN',
                   'ผู้ดูแลหน่วยงานแก้แบบตรวจกลางไม่ได้');
reset role;
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-000000000009', 'central@test.local');
insert into public.role_assignments (user_id, role, organization_id) values
  ('b0000000-0000-0000-0000-000000000009', 'safety_coordinator', '10000000-0000-0000-0000-000000000001');
set role authenticated;
select test.login('b0000000-0000-0000-0000-000000000009');
select test.throws($$update public.checklist_items set title = 'แก้ไข' where id = test.item(1)$$, 'CHECKLIST_VERSION_LOCKED',
                   'แก้ไขรายการของเวอร์ชันที่เผยแพร่แล้วไม่ได้');
insert into ctx values ('v2', public.create_checklist_version('40000000-0000-0000-0000-000000000001', 'ทดสอบ'));
select test.ok((select count(*) from public.checklist_items where version_id = (select v from ctx where k = 'v2')) = 6, 'เวอร์ชันใหม่คัดลอกรายการเดิม');
update public.checklist_items set title = 'เกจวัดแรงดัน (ปรับถ้อยคำ)' where version_id = (select v from ctx where k = 'v2') and seq = 1;
select test.throws(format($$update public.checklist_versions set is_expert_review_draft = false where id = %L$$, (select v from ctx where k = 'v2')),
                   '23514', 'ยกเลิกสถานะร่างโดยไม่มีแหล่งอ้างอิงและผู้รับรองไม่ได้');
select test.throws(format($$update public.checklist_versions set legal_references = '[{"source":"x"}]' where id = %L$$, (select v from ctx where k = 'v2')),
                   '23514', 'แหล่งอ้างอิงต้องระบุฉบับและวันที่ตรวจสอบ');
select public.publish_checklist_version((select v from ctx where k = 'v2'));
select test.ok((select status from public.checklist_versions where template_id = '40000000-0000-0000-0000-000000000001' and version_no = 1) = 'retired',
               'เผยแพร่เวอร์ชันใหม่ → เวอร์ชันเดิมเลิกใช้');
select test.ok((select ci.title from public.inspection_responses r join public.checklist_items ci on ci.id = r.item_id
                 where r.inspection_id = (select v from ctx where k = 'insp_may') and ci.seq = 1) = 'เกจวัดแรงดันอยู่ในช่วงใช้งาน',
               'ผลตรวจเดิมยังแสดงเกณฑ์ของเวอร์ชันที่ใช้ในวันตรวจ');

-- =====================================================================
\echo '--- 9. การแจ้งเตือนไม่ซ้ำ'
-- =====================================================================
reset role;
set role service_role;
select public.run_notification_jobs();
create temp table nc as select count(*) c from public.notifications;
select public.run_notification_jobs();
select test.ok((select count(*) from public.notifications) = (select c from nc), 'รันงานแจ้งเตือนซ้ำไม่เกิดการแจ้งเตือนซ้ำ');
select test.ok(exists (select 1 from public.notifications where type = 'task_overdue'), 'แจ้งเตือนงานตรวจเกินกำหนด');
reset role;
set role authenticated;
select test.throws($$select public.run_notification_jobs()$$, '42501', 'ผู้ใช้ทั่วไปเรียกงานแจ้งเตือนไม่ได้');
select test.login('b0000000-0000-0000-0000-000000000002');
select test.ok((select count(*) from public.notifications where user_id <> 'b0000000-0000-0000-0000-000000000002') = 0,
               'เห็นเฉพาะการแจ้งเตือนของตนเอง');

-- =====================================================================
\echo '--- 10. Storage policies (ไฟล์แนบ private)'
-- =====================================================================
select test.login('b0000000-0000-0000-0000-000000000003');  -- inspector B
select test.throws(format($$insert into storage.objects (bucket_id, name, owner_id) values ('attachments', 'inspection/%s/evil.jpg', auth.uid()::text)$$,
                          (select v from ctx where k = 'insp_jun')),
                   '42501', 'ผู้ตรวจ B อัปโหลดไฟล์เข้าผลตรวจของ A ไม่ได้');
reset role;
insert into storage.objects (bucket_id, name, owner_id) values
  ('attachments', 'inspection/' || (select v from ctx where k = 'insp_jun') || '/photo1.jpg', 'b0000000-0000-0000-0000-000000000002');
set role authenticated;
select test.ok((select count(*) from storage.objects where bucket_id = 'attachments') = 0, 'ผู้ตรวจ B อ่านไฟล์ของ A ไม่ได้');
select test.login('b0000000-0000-0000-0000-000000000006');
select test.ok((select count(*) from storage.objects where bucket_id = 'attachments') = 1, 'ผู้ตรวจยืนยันที่มีสิทธิ์อ่านไฟล์ได้');
reset role;

-- =====================================================================
\echo '--- 11. เข้าสู่ระบบด้วย Google: จำกัดเฉพาะโดเมนมหาวิทยาลัย'
-- =====================================================================
reset role;
insert into auth.users (id, email) values
  ('f0000000-0000-0000-0000-000000000001', 'outsider@gmail.com'),
  ('f0000000-0000-0000-0000-000000000002', 'staff@nu.ac.th'),
  ('f0000000-0000-0000-0000-000000000003', 'fake@nu.ac.th'),
  ('f0000000-0000-0000-0000-000000000004', 'contractor@example.com');
select test.throws($$insert into auth.identities (provider_id, user_id, provider, identity_data)
                     values ('g-1', 'f0000000-0000-0000-0000-000000000001', 'google', '{"email":"outsider@gmail.com","email_verified":true}')$$,
                   'DOMAIN_NOT_ALLOWED', 'บัญชี Google ภายนอก (gmail.com) ถูกปฏิเสธที่ฐานข้อมูล');
select test.throws($$insert into auth.identities (provider_id, user_id, provider, identity_data)
                     values ('g-3', 'f0000000-0000-0000-0000-000000000003', 'google', '{"email":"fake@nu.ac.th","email_verified":true,"custom_claims":{"hd":"evil.com"}}')$$,
                   'DOMAIN_NOT_ALLOWED', 'อีเมล @nu.ac.th แต่องค์กร Google (hd) ไม่ใช่มหาวิทยาลัย → ปฏิเสธ');
select test.throws($$insert into auth.identities (provider_id, user_id, provider, identity_data)
                     values ('g-3b', 'f0000000-0000-0000-0000-000000000003', 'google', '{"email":"fake@nu.ac.th","email_verified":false}')$$,
                   'EMAIL_NOT_VERIFIED', 'อีเมลที่ Google ยังไม่ยืนยัน → ปฏิเสธ');
insert into auth.identities (provider_id, user_id, provider, identity_data)
values ('g-2', 'f0000000-0000-0000-0000-000000000002', 'google', '{"email":"staff@nu.ac.th","email_verified":true,"custom_claims":{"hd":"nu.ac.th"}}');
select test.ok(exists (select 1 from auth.identities where provider_id = 'g-2'), 'บัญชี Google @nu.ac.th เข้าสู่ระบบได้');
select test.ok(exists (select 1 from public.notifications n where n.type = 'user_pending' and n.entity_id = 'f0000000-0000-0000-0000-000000000002'
                        and n.user_id = 'b0000000-0000-0000-0000-000000000009'),
               'ผู้ประสานงานส่วนกลางได้รับแจ้ง “ผู้ใช้ใหม่รอกำหนดสิทธิ์”');
insert into auth.identities (provider_id, user_id, provider, identity_data)
values ('f0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000004', 'email', '{"email":"contractor@example.com"}');
select test.ok(true, 'บัญชีอีเมล/รหัสผ่านที่ผู้ดูแลสร้าง ไม่ถูกจำกัดโดเมน (ผู้ดูแลควบคุมเอง)');
set role authenticated;
select test.login('f0000000-0000-0000-0000-000000000002');
select test.ok((select count(*) from public.assets) = 0 and (select count(*) from public.findings) = 0 and (select count(*) from public.inspection_tasks) = 0,
               'บุคลากรที่เข้าด้วย Google ครั้งแรก (ยังไม่มีบทบาท) ไม่เห็นข้อมูลใดจนกว่าผู้ดูแลกำหนดสิทธิ์');
select test.ok(public.email_domain_allowed('a@NU.AC.TH') and not public.email_domain_allowed('a@nu.ac.th.evil.com'), 'ตรวจโดเมนแบบตรงตัว ไม่สนตัวพิมพ์');
reset role;

do $$ begin raise notice '==> ALL % DATABASE TESTS PASSED', (select last_value from test.n); end $$;
