-- =====================================================================
-- (ไม่บังคับ) ข้อมูลสาธิต — คณะ/อาคาร/จุดตรวจ/แผนการตรวจ ที่เป็นข้อมูลตัวอย่าง
-- ใช้สำหรับทดลองระบบเท่านั้น ห้ามรันบนระบบที่ใช้งานจริง (รันหลัง 02)
-- =====================================================================

-- ---------- หน่วยงานตัวอย่าง ----------
insert into public.organizations (id, parent_id, code, name_th, name_en, org_type) values
  ('10000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 'BLD', 'กองอาคารสถานที่ (ตัวอย่าง)', 'Building & Facilities Division (demo)', 'office'),
  ('10000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'ENG', 'คณะวิศวกรรมศาสตร์ (ตัวอย่าง)', 'Faculty of Engineering (demo)', 'faculty'),
  ('10000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'SCI', 'คณะวิทยาศาสตร์ (ตัวอย่าง)', 'Faculty of Science (demo)', 'faculty'),
  ('10000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', 'OPR', 'สำนักงานอธิการบดี (ตัวอย่าง)', 'Office of the President (demo)', 'office');

-- ---------- อาคาร / ชั้น / ห้อง ----------
insert into public.buildings (id, organization_id, code, name, description) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', 'EN1', 'อาคารตัวอย่าง EN1', 'ข้อมูลตัวอย่าง'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000012', 'SC2', 'อาคารตัวอย่าง SC2', 'ข้อมูลตัวอย่าง'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000013', 'QS',  'อาคารตัวอย่าง QS (สำนักงาน)', 'ข้อมูลตัวอย่าง');

insert into public.floors (building_id, name, level)
select b.id, 'ชั้น ' || g, g from public.buildings b, generate_series(1, 3) g;

insert into public.locations (floor_id, name, room_no, location_type)
select f.id, x.name, b.code || '-' || f.level || x.suffix, x.kind
  from public.floors f join public.buildings b on b.id = f.building_id
  cross join (values ('โถงบันได', '00', 'common'), ('ทางเดินหลัก', '01', 'common'),
                     ('ห้องปฏิบัติการ', '05', 'laboratory'), ('ห้องควบคุมไฟฟ้า', '09', 'electrical')) x(name, suffix, kind);

-- ---------- จุดตรวจ/อุปกรณ์ (ตัวอย่าง) ----------
insert into public.assets (code, name, asset_type_id, organization_id, building_id, floor_id, location_id, location_detail,
                           brand_model, serial_no, installed_on, expires_on, frequency, status, notes)
select format('%s-%s-%s%s', at.code, b.code, f.level, lpad(n::text, 2, '0')),
       at.name || ' ' || b.code || ' ชั้น ' || f.level || ' จุดที่ ' || n,
       at.id, b.organization_id, b.id, f.id, l.id,
       'ข้อมูลตัวอย่าง — ' || l.name,
       case when at.code = 'FE' then 'ตัวอย่าง ABC 15 ปอนด์' end,
       case when at.code = 'FE' then 'DEMO-' || b.code || f.level || n end,
       case when at.code = 'FE' then date '2024-01-15' end,
       case when at.code = 'FE' then date '2024-01-15' + (365 * 3 + (n * 40)) end,
       at.default_frequency, 'active', 'ข้อมูลตัวอย่าง (DEMO)'
  from public.buildings b
  join public.floors f on f.building_id = b.id
  join public.asset_types at on at.code in ('FE','EL','EX','EE','SP','FH','FA','LAB')
  join lateral (select * from public.locations l where l.floor_id = f.id
                 order by case when at.code = 'LAB' then (l.location_type = 'laboratory')::int
                               when at.code = 'EE' then (l.location_type = 'electrical')::int else 0 end desc, l.name
                 limit 1) l on true
  cross join generate_series(1, case when at.code = 'FE' then 2 else 1 end) n
 where (at.code in ('FE','EL','EX')) or (at.code in ('EE','SP') and f.level = 1)
    or (at.code in ('FH','FA') and f.level = 1 and b.code <> 'QS') or (at.code = 'LAB' and b.code = 'SC2' and f.level <= 2);

-- ---------- แผนการตรวจ (ตัวอย่าง) ----------
insert into public.inspection_plans (id, name, organization_id, building_id, asset_type_id, template_id, frequency, start_on, due_within_days) values
  ('50000000-0000-0000-0000-000000000001', 'ตรวจถังดับเพลิงรายเดือน (ตัวอย่าง)', '10000000-0000-0000-0000-000000000001', null,
     '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'monthly', date '2026-01-01', null),
  ('50000000-0000-0000-0000-000000000002', 'ตรวจไฟฉุกเฉินรายเดือน (ตัวอย่าง)', '10000000-0000-0000-0000-000000000001', null,
     '30000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', 'monthly', date '2026-01-01', null),
  ('50000000-0000-0000-0000-000000000003', 'ตรวจทางหนีไฟรายเดือน (ตัวอย่าง)', '10000000-0000-0000-0000-000000000001', null,
     '30000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', 'monthly', date '2026-01-01', 14),
  ('50000000-0000-0000-0000-000000000004', 'ตรวจระบบไฟฟ้ารายไตรมาส (ตัวอย่าง)', '10000000-0000-0000-0000-000000000001', null,
     '30000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000006', 'quarterly', date '2026-01-01', null),
  ('50000000-0000-0000-0000-000000000005', 'Safety Patrol รายเดือน (ตัวอย่าง)', '10000000-0000-0000-0000-000000000001', null,
     '30000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000007', 'monthly', date '2026-01-01', null),
  ('50000000-0000-0000-0000-000000000006', 'ตรวจห้องปฏิบัติการรายไตรมาส (ตัวอย่าง)', '10000000-0000-0000-0000-000000000012', null,
     '30000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000008', 'quarterly', date '2026-01-01', null),
  ('50000000-0000-0000-0000-000000000007', 'ตรวจตู้สายฉีดน้ำและระบบแจ้งเหตุ รายไตรมาส (ตัวอย่าง)', '10000000-0000-0000-0000-000000000001', null,
     '30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'quarterly', date '2026-01-01', null),
  ('50000000-0000-0000-0000-000000000008', 'ตรวจระบบแจ้งเหตุเพลิงไหม้ รายไตรมาส (ตัวอย่าง)', '10000000-0000-0000-0000-000000000001', null,
     '30000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000005', 'quarterly', date '2026-01-01', null);

-- =====================================================================
-- demo_seed_activity(): สร้างบทบาทผู้ใช้สาธิต + ประวัติการตรวจ/แก้ไขย้อนหลัง
-- เรียกโดย scripts/seed-demo.mjs หลังสร้างผู้ใช้สาธิตแล้ว (service_role เท่านั้น)
-- จำลองการทำงานผ่าน RPC จริง (สวมสิทธิ์ผู้ใช้สาธิตทีละคน) เพื่อให้ข้อมูลผ่านกฎเดียวกับการใช้งานจริง
-- =====================================================================
create or replace function public.demo_seed_activity() returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_root uuid := '10000000-0000-0000-0000-000000000001';
  v_bld uuid := '10000000-0000-0000-0000-000000000010';
  v_eng uuid := '10000000-0000-0000-0000-000000000011';
  v_sci uuid := '10000000-0000-0000-0000-000000000012';
  v_opr uuid := '10000000-0000-0000-0000-000000000013';
  u_admin uuid; u_coord uuid; u_eng_admin uuid; u_sci_admin uuid; u_insp_eng uuid; u_insp_sci uuid;
  u_fixer uuid; u_fixer_eng uuid; u_verifier uuid; u_exec uuid;
  t record; it record; v_insp uuid; v_resp jsonb; v_res jsonb; v_seed float; f record;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_tasks int := 0; v_done int := 0; v_findings int := 0;
begin
  if exists (select 1 from public.inspections) then
    return jsonb_build_object('skipped', true, 'reason', 'demo activity already exists');
  end if;
  select id into u_admin from auth.users where email = 'admin@demo.example.com';
  select id into u_coord from auth.users where email = 'coordinator@demo.example.com';
  select id into u_eng_admin from auth.users where email = 'eng.admin@demo.example.com';
  select id into u_sci_admin from auth.users where email = 'sci.admin@demo.example.com';
  select id into u_insp_eng from auth.users where email = 'inspector.eng@demo.example.com';
  select id into u_insp_sci from auth.users where email = 'inspector.sci@demo.example.com';
  select id into u_fixer from auth.users where email = 'fixer@demo.example.com';
  select id into u_fixer_eng from auth.users where email = 'fixer.eng@demo.example.com';
  select id into u_verifier from auth.users where email = 'verifier@demo.example.com';
  select id into u_exec from auth.users where email = 'executive@demo.example.com';
  if u_admin is null or u_insp_eng is null or u_fixer is null or u_verifier is null then
    raise exception 'demo users not found — run scripts/seed-demo.mjs';
  end if;

  update public.profiles set organization_id = v_root, position = 'ผู้ดูแลระบบ (ตัวอย่าง)' where id = u_admin;
  update public.profiles set organization_id = v_root, position = 'ผู้ประสานงานความปลอดภัย (ตัวอย่าง)' where id = u_coord;
  update public.profiles set organization_id = v_eng, position = 'ผู้ดูแลหน่วยงาน (ตัวอย่าง)' where id = u_eng_admin;
  update public.profiles set organization_id = v_sci, position = 'ผู้ดูแลหน่วยงาน (ตัวอย่าง)' where id = u_sci_admin;
  update public.profiles set organization_id = v_eng, position = 'ผู้ตรวจ (ตัวอย่าง)' where id = u_insp_eng;
  update public.profiles set organization_id = v_sci, position = 'ผู้ตรวจ (ตัวอย่าง)' where id = u_insp_sci;
  update public.profiles set organization_id = v_bld, position = 'ช่างอาคาร (ตัวอย่าง)' where id = u_fixer;
  update public.profiles set organization_id = v_eng, position = 'ช่างประจำคณะ (ตัวอย่าง)' where id = u_fixer_eng;
  update public.profiles set organization_id = v_root, position = 'เจ้าหน้าที่ความปลอดภัย (ตัวอย่าง)' where id = u_verifier;
  update public.profiles set organization_id = v_root, position = 'คณะกรรมการความปลอดภัย (ตัวอย่าง)' where id = u_exec;

  insert into public.role_assignments (user_id, role, organization_id) values
    (u_admin, 'system_admin', v_root), (u_coord, 'safety_coordinator', v_root),
    (u_eng_admin, 'org_admin', v_eng), (u_sci_admin, 'org_admin', v_sci),
    (u_insp_eng, 'inspector', v_eng), (u_insp_eng, 'inspector', v_opr), (u_insp_sci, 'inspector', v_sci),
    (u_fixer, 'responsible', v_bld), (u_fixer_eng, 'responsible', v_eng),
    (u_verifier, 'verifier', v_root), (u_exec, 'executive', v_root)
  on conflict do nothing;

  -- สร้างงานตรวจทั้งปีในนามผู้ประสานงานส่วนกลาง
  perform set_config('request.jwt.claims', json_build_object('sub', u_coord, 'role', 'authenticated')::text, true);
  for t in select id from public.inspection_plans loop
    v_tasks := v_tasks + public.generate_inspection_tasks(t.id, make_date(extract(year from v_today)::int, 12, 31));
  end loop;
  update public.inspection_tasks it2 set assignee_id = case when it2.organization_id = v_sci then u_insp_sci else u_insp_eng end
   where assignee_id is null;

  -- จำลองผลตรวจย้อนหลัง: งานที่ถึงกำหนดแล้วตรวจไปประมาณ 88% และงานในรอบปัจจุบันบางส่วน
  for t in select it3.*, hashtext(it3.id::text) h from public.inspection_tasks it3
            where it3.period_start <= v_today order by it3.due_on loop
    v_seed := abs(t.h % 1000) / 1000.0;
    continue when (t.due_on < v_today and v_seed > 0.88) or (t.due_on >= v_today and v_seed > 0.45);
    perform set_config('request.jwt.claims', json_build_object('sub', t.assignee_id, 'role', 'authenticated')::text, true);
    perform set_config('app.today_override', least(t.due_on - (abs(t.h) % 5), v_today)::text, true);
    v_insp := public.start_inspection(t.asset_id, t.id);
    select jsonb_agg(jsonb_build_object(
             'item_id', ci.id,
             'result', case when x.r < 0.05 then 'fail' when x.r > 0.95 and ci.allow_na then 'na' else 'pass' end,
             'note', case when x.r < 0.05 then 'ข้อมูลตัวอย่าง: พบความผิดปกติ — ' || ci.title end,
             'urgency', case when x.r < 0.05 then (case when x.r < 0.008 then 'high' else ci.severity::text end) end,
             'na_reason', case when x.r > 0.95 and ci.allow_na then 'ข้อมูลตัวอย่าง: ไม่มีอุปกรณ์ส่วนนี้' end,
             'photo_exempt_reason', case when x.r < 0.05 then 'ข้อมูลตัวอย่าง: ไม่มีภาพประกอบ' end))
      into v_resp
      from public.inspections i join public.checklist_items ci on ci.version_id = i.checklist_version_id
      cross join lateral (select abs(hashtext(t.id::text || ci.id::text) % 1000) / 1000.0 r) x
     where i.id = v_insp;
    v_res := public.submit_inspection(v_insp, v_resp, null, gen_random_uuid());
    v_done := v_done + 1;
    -- ปรับเวลาให้เป็นอดีตตามวันตรวจจำลอง
    update public.inspections set started_at = (app.today()::timestamp + interval '9 hours') at time zone 'Asia/Bangkok',
                                  submitted_at = (app.today()::timestamp + interval '10 hours') at time zone 'Asia/Bangkok'
     where id = v_insp;
    perform set_config('app.in_workflow', 'on', true);
    update public.inspection_tasks set completed_at = (app.today()::timestamp + interval '10 hours') at time zone 'Asia/Bangkok' where id = t.id;
    perform set_config('app.in_workflow', 'off', true);
    update public.findings set created_at = (app.today()::timestamp + interval '10 hours') at time zone 'Asia/Bangkok' where inspection_id = v_insp;
    update public.corrective_actions set created_at = (app.today()::timestamp + interval '10 hours') at time zone 'Asia/Bangkok'
     where finding_id in (select id from public.findings where inspection_id = v_insp);
  end loop;

  -- จำลองการแก้ไข: ข้อบกพร่องเก่าส่วนใหญ่ปิดแล้ว บางรายการค้าง/ส่งกลับ/เกินกำหนด
  for f in select fi.*, abs(hashtext(fi.id::text) % 100) r, (fi.created_at at time zone 'Asia/Bangkok')::date d
             from public.findings fi order by fi.created_at loop
    v_findings := v_findings + 1;
    continue when f.d > v_today - 3 and f.r < 50;  -- รายการใหม่บางส่วนยังไม่มอบหมาย
    perform set_config('app.today_override', (f.d + 1)::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub',
      case when f.organization_id = v_eng then u_eng_admin when f.organization_id = v_sci then u_sci_admin else u_coord end,
      'role', 'authenticated')::text, true);
    perform public.assign_finding(f.id, case when f.r % 3 = 0 then u_fixer_eng else u_fixer end,
                                  f.d + case when f.severity in ('high','critical') then 7 else 30 end,
                                  'ข้อมูลตัวอย่าง: กั้นพื้นที่/ติดป้ายเตือนชั่วคราว', null, null);
    continue when f.r >= 85 or f.d > v_today - 10;          -- ยังรอแก้ไข (บางรายการจะเกินกำหนด)
    perform set_config('request.jwt.claims', json_build_object('sub',
      case when f.r % 3 = 0 then u_fixer_eng else u_fixer end, 'role', 'authenticated')::text, true);
    perform set_config('app.today_override', (f.d + 2)::text, true);
    perform public.start_corrective_work(f.id, 'ข้อมูลตัวอย่าง: รับงานแล้ว');
    continue when f.r >= 75;                                  -- กำลังแก้ไข
    perform set_config('app.today_override', (f.d + 3 + f.r % 20)::text, true);
    perform public.submit_corrective_fix(f.id, 'ข้อมูลตัวอย่าง: ดำเนินการแก้ไขเรียบร้อย', 'ข้อมูลตัวอย่าง: ไม่มีภาพประกอบ');
    continue when f.r >= 65;                                  -- รอตรวจยืนยัน
    perform set_config('request.jwt.claims', json_build_object('sub', u_verifier, 'role', 'authenticated')::text, true);
    if f.r < 8 then
      perform public.verify_finding(f.id, false, 'ข้อมูลตัวอย่าง: ยังแก้ไขไม่ครบ กรุณาดำเนินการเพิ่มเติม');
      continue;
    end if;
    perform public.verify_finding(f.id, true, 'ข้อมูลตัวอย่าง: ตรวจแล้วเรียบร้อย');
    update public.findings
       set closed_at = least(now(), ((f.d + 4 + f.r % 25)::timestamp + interval '14 hours') at time zone 'Asia/Bangkok'),
           verified_at = least(now(), ((f.d + 4 + f.r % 25)::timestamp + interval '14 hours') at time zone 'Asia/Bangkok'),
           fix_submitted_at = least(now(), ((f.d + 3 + f.r % 20)::timestamp + interval '11 hours') at time zone 'Asia/Bangkok'),
           assigned_at = ((f.d + 1)::timestamp + interval '9 hours') at time zone 'Asia/Bangkok'
     where id = f.id;
  end loop;
  update public.corrective_actions ca
     set created_at = least(now(), fi.created_at + case ca.action_type when 'assign' then interval '1 day'
                                    when 'start' then interval '2 days' when 'submit_fix' then interval '5 days'
                                    when 'approve' then interval '9 days' when 'reject' then interval '9 days'
                                    else interval '0' end)
    from public.findings fi where fi.id = ca.finding_id;

  perform set_config('app.today_override', '', true);
  perform set_config('request.jwt.claims', '', true);
  -- เคลียร์การแจ้งเตือนย้อนหลังที่เกิดจากการจำลอง (คงไว้เฉพาะ 30 วันล่าสุดและไม่ส่งอีเมล)
  update public.notifications set email_status = 'not_required';
  return jsonb_build_object('tasks_created', v_tasks, 'inspections', v_done, 'findings', v_findings);
end $$;
revoke execute on function public.demo_seed_activity() from public, anon, authenticated;
grant execute on function public.demo_seed_activity() to service_role;

