-- =====================================================================
-- NU Safety Inspection — ลบข้อมูลตัวอย่าง (DEMO) ออกจากระบบจริง
-- ลบ: หน่วยงาน "(ตัวอย่าง)", อาคาร EN1/SC2/QS พร้อมชั้น ห้อง จุดตรวจ แผน งานตรวจ ผลตรวจ ข้อบกพร่อง
--      ผู้ใช้สาธิต @demo.example.com และฟังก์ชัน demo_seed_activity
-- ไม่ลบ: หน่วยงาน/อาคาร/ผู้ใช้จริง แบบตรวจ ประเภทจุดตรวจ และการตั้งค่า
--   * ผู้ใช้จริงหรืออาคารจริงที่อยู่ใต้หน่วยงานตัวอย่าง → ย้ายไปหน่วยงานจริงชื่อเดียวกัน
--     (เช่น "คณะวิศวกรรมศาสตร์ (ตัวอย่าง)" → "คณะวิศวกรรมศาสตร์") ควรรันไฟล์ 06 ก่อน
--   * ถ้าพบข้อมูลจริงที่ย้ายไม่ได้ ระบบหยุดทั้งหมดโดยไม่ลบอะไร และบอกว่าต้องแก้ตรงไหน
-- วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run (รันซ้ำได้)
-- =====================================================================
do $$
declare
  v_root uuid;
  v_demo_orgs uuid[];
  v_demo_bld uuid[];
  v_demo_users uuid[];
  v_demo_assets uuid[];
  r record; v_target uuid; n int; v_msg text := '';
begin
  select id into v_root from public.organizations where parent_id is null limit 1;

  select coalesce(array_agg(id), '{}') into v_demo_orgs from public.organizations
   where id in ('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000011',
                '10000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000013')
      or name_th like '%(ตัวอย่าง)';
  select coalesce(array_agg(id), '{}') into v_demo_bld from public.buildings
   where id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003')
      or organization_id = any(v_demo_orgs) and (description = 'ข้อมูลตัวอย่าง' or name like 'อาคารตัวอย่าง%');
  select coalesce(array_agg(id), '{}') into v_demo_users from auth.users where lower(email) like '%@demo.example.com';
  select coalesce(array_agg(id), '{}') into v_demo_assets from public.assets where building_id = any(v_demo_bld);

  if cardinality(v_demo_orgs) + cardinality(v_demo_bld) + cardinality(v_demo_users) = 0
     and to_regprocedure('public.demo_seed_activity()') is null then
    raise notice 'ไม่พบข้อมูลตัวอย่างในระบบ — ไม่มีอะไรต้องลบ';
    return;
  end if;

  perform set_config('app.in_workflow', 'on', true);
  -- ---------- 1) ย้ายข้อมูลจริงที่ผูกกับหน่วยงานตัวอย่าง ไปหน่วยงานจริงชื่อเดียวกัน ----------
  for r in select id, name_th, btrim(replace(name_th, '(ตัวอย่าง)', '')) as real_name
             from public.organizations where id = any(v_demo_orgs) loop
    select id into v_target from public.organizations
     where btrim(name_th) = r.real_name and not (id = any(v_demo_orgs)) limit 1;
    -- อาคารจริง (ไม่ใช่อาคารตัวอย่าง) และจุดตรวจในอาคารจริง
    if exists (select 1 from public.buildings where organization_id = r.id and not (id = any(v_demo_bld)))
       or exists (select 1 from public.assets where organization_id = r.id and not (id = any(v_demo_assets))) then
      if v_target is null then
        raise exception 'หน่วยงานตัวอย่าง "%" มีอาคาร/จุดตรวจจริงอยู่ แต่ไม่พบหน่วยงานจริงชื่อ "%" — รันไฟล์ 06 ก่อน หรือย้ายอาคารในเว็บก่อน (ยังไม่มีการลบใด ๆ)',
          r.name_th, r.real_name;
      end if;
      update public.buildings set organization_id = v_target where organization_id = r.id and not (id = any(v_demo_bld));
      update public.assets set organization_id = v_target where organization_id = r.id and not (id = any(v_demo_assets));
      update public.inspection_tasks set organization_id = v_target where organization_id = r.id and not (asset_id = any(v_demo_assets));
      update public.inspections set organization_id = v_target where organization_id = r.id and not (asset_id = any(v_demo_assets));
      update public.findings set organization_id = v_target where organization_id = r.id and not (asset_id = any(v_demo_assets));
      update public.attachments a set organization_id = v_target where a.organization_id = r.id
         and not exists (select 1 from public.inspection_responses ir join public.inspections i on i.id = ir.inspection_id
                          where ir.id = a.response_id and i.asset_id = any(v_demo_assets));
    end if;
    -- ผู้ใช้จริง: สังกัด / บทบาท / รายการลงทะเบียนล่วงหน้า
    update public.profiles set organization_id = coalesce(v_target, v_root)
     where organization_id = r.id and not (id = any(v_demo_users));
    get diagnostics n = row_count;
    if v_target is not null then
      insert into public.role_assignments (user_id, role, organization_id, granted_by)
      select user_id, role, v_target, granted_by from public.role_assignments
       where organization_id = r.id and not (user_id = any(v_demo_users))
      on conflict do nothing;
      update public.user_preassignments set organization_id = v_target where organization_id = r.id
        and not exists (select 1 from public.user_preassignments x where x.email = user_preassignments.email
                         and x.role = user_preassignments.role and x.organization_id = v_target);
      update public.user_preassignments set home_organization_id = v_target where home_organization_id = r.id;
    elsif exists (select 1 from public.role_assignments where organization_id = r.id and not (user_id = any(v_demo_users))) then
      v_msg := v_msg || format(E'\n  • บทบาทของผู้ใช้จริงใน "%s" ถูกถอนออก (ไม่พบหน่วยงานจริงชื่อเดียวกัน) — กำหนดใหม่ที่ ตั้งค่า › ผู้ใช้', r.name_th);
    end if;
    -- งาน/ข้อบกพร่องจริงที่อ้างหน่วยงานตัวอย่าง
    if exists (select 1 from public.findings where (organization_id = r.id or responsible_org_id = r.id) and not (asset_id = any(v_demo_assets)))
       or exists (select 1 from public.inspection_plans where organization_id = r.id and coalesce(name, '') not like '%(ตัวอย่าง)') then
      if v_target is null then
        raise exception 'หน่วยงานตัวอย่าง "%" มีแผนการตรวจ/ข้อบกพร่องจริง แต่ไม่พบหน่วยงานจริงชื่อ "%" — รันไฟล์ 06 ก่อน (ยังไม่มีการลบใด ๆ)', r.name_th, r.real_name;
      end if;
      update public.findings set responsible_org_id = v_target where responsible_org_id = r.id and not (asset_id = any(v_demo_assets));
      update public.inspection_plans set organization_id = v_target where organization_id = r.id and coalesce(name, '') not like '%(ตัวอย่าง)';
    end if;
  end loop;

  -- ข้อมูลจริงที่อ้างผู้ใช้สาธิต: เคลียร์ช่องที่ว่างได้ / หยุดถ้าเป็นผลตรวจจริง
  if exists (select 1 from public.inspections where inspector_id = any(v_demo_users) and not (asset_id = any(v_demo_assets))) then
    raise exception 'มีผลตรวจจริงที่บันทึกโดยบัญชีสาธิต (@demo.example.com) — ไม่สามารถลบบัญชีสาธิตได้ (ยังไม่มีการลบใด ๆ)';
  end if;
  update public.findings set assignee_id = null where assignee_id = any(v_demo_users) and not (asset_id = any(v_demo_assets))
     and status in ('open');
  if exists (select 1 from public.findings where assignee_id = any(v_demo_users) and not (asset_id = any(v_demo_assets))) then
    raise exception 'มีข้อบกพร่องจริงที่มอบหมายให้บัญชีสาธิต — มอบหมายใหม่ในเว็บก่อน แล้วรันไฟล์นี้อีกครั้ง (ยังไม่มีการลบใด ๆ)';
  end if;
  update public.inspection_tasks set assignee_id = null where assignee_id = any(v_demo_users) and not (asset_id = any(v_demo_assets));
  update public.inspection_plans set default_inspector_id = null where default_inspector_id = any(v_demo_users);
  update public.assets set responsible_user_id = null where responsible_user_id = any(v_demo_users);

  -- ---------- 2) ลบข้อมูลตัวอย่าง (เรียงตามความสัมพันธ์) ----------
  delete from public.work_orders where finding_id in (select id from public.findings where asset_id = any(v_demo_assets));
  delete from public.corrective_actions where finding_id in (select id from public.findings where asset_id = any(v_demo_assets));
  update public.findings set recurrence_of = null
   where recurrence_of in (select id from public.findings where asset_id = any(v_demo_assets));
  delete from public.findings where asset_id = any(v_demo_assets);
  delete from public.inspection_tasks where asset_id = any(v_demo_assets);
  delete from public.attachments where response_id in (select ir.id from public.inspection_responses ir
           join public.inspections i on i.id = ir.inspection_id where i.asset_id = any(v_demo_assets));
  delete from public.inspections where asset_id = any(v_demo_assets);
  delete from public.inspection_tasks where asset_id = any(v_demo_assets);
  delete from public.inspection_plans where organization_id = any(v_demo_orgs) or building_id = any(v_demo_bld)
      or id::text like '50000000-0000-0000-0000-%';
  delete from public.assets where id = any(v_demo_assets);
  delete from public.buildings where id = any(v_demo_bld);          -- ชั้นและห้องลบตามอัตโนมัติ
  delete from public.notifications where user_id = any(v_demo_users);
  delete from public.attachments where uploaded_by = any(v_demo_users);
  delete from auth.users where id = any(v_demo_users);               -- โปรไฟล์และบทบาทลบตามอัตโนมัติ
  delete from public.notification_settings where organization_id = any(v_demo_orgs);
  delete from public.user_preassignments where organization_id = any(v_demo_orgs);
  update public.checklist_templates set organization_id = null where organization_id = any(v_demo_orgs);
  delete from public.organizations where id = any(v_demo_orgs);
  perform set_config('app.in_workflow', 'off', true);

  drop function if exists public.demo_seed_activity();

  raise notice E'ลบข้อมูลตัวอย่างเรียบร้อย: หน่วยงาน % · อาคาร % · จุดตรวจ % · ผู้ใช้สาธิต % %',
    cardinality(v_demo_orgs), cardinality(v_demo_bld), cardinality(v_demo_assets), cardinality(v_demo_users), v_msg;
end $$;

-- ตรวจผล: ทุกช่องต้องเป็น 0
select (select count(*) from public.organizations where name_th like '%(ตัวอย่าง)') as หน่วยงานตัวอย่าง,
       (select count(*) from public.buildings where code in ('EN1','SC2','QS')) as อาคารตัวอย่าง,
       (select count(*) from public.assets where notes = 'ข้อมูลตัวอย่าง (DEMO)') as จุดตรวจตัวอย่าง,
       (select count(*) from auth.users where lower(email) like '%@demo.example.com') as ผู้ใช้สาธิต;

notify pgrst, 'reload schema';
