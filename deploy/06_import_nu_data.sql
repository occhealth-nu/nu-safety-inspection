-- =====================================================================
-- NU Safety Inspection — นำเข้าหน่วยงาน 43 หน่วยงาน + อาคารทั้งมหาวิทยาลัย 204 อาคาร
--   (เลขอาคาร ประเภทอาคาร หน่วยงานเจ้าของ — ตรวจและแก้ข้อมูลแล้ว ดู data/nu-buildings-changes.csv)
-- และติดตั้งเครื่องมือนำเข้าผู้ใช้/ห้อง จากแบบฟอร์ม Excel
-- วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run  (รันหลังไฟล์ 01–02 และ 05)
-- รันซ้ำได้: หน่วยงาน/อาคารที่มีอยู่แล้ว (รหัสหรือชื่อตรงกัน) จะไม่ถูกเพิ่มซ้ำ
-- ไฟล์นี้สร้างอัตโนมัติจาก scripts/build-import-data.py — อย่าแก้ด้วยมือ
-- =====================================================================

-- ---------- ส่วนที่ 1: เครื่องมือนำเข้า (ตาราง user_preassignments + ฟังก์ชัน app.import_*) ----------
-- =====================================================================
-- นำเข้าข้อมูลจำนวนมากผ่าน Supabase SQL Editor (ใช้คู่กับไฟล์ Excel แบบฟอร์มนำเข้า)
--   1) ลงทะเบียนผู้ใช้ล่วงหน้า (pre-registration) ด้วยอีเมล @nu.ac.th + หน่วยงาน + บทบาท
--      ผู้ใช้กด "เข้าสู่ระบบด้วยบัญชี Google" ครั้งแรก → ระบบกำหนดหน่วยงาน/บทบาทให้อัตโนมัติ
--      ถ้าผู้ใช้เคยเข้าระบบแล้ว (รอกำหนดสิทธิ์) → กำหนดให้ทันที
--   2) เพิ่มหน่วยงาน อาคาร+ชั้น และห้อง/พื้นที่ ด้วยชื่อ/รหัส (ไม่ต้องรู้ uuid)
-- ฟังก์ชัน app.import_* เรียกได้เฉพาะใน SQL Editor (บทบาท postgres) — ไม่เปิดให้ผู้ใช้ทั่วไปผ่าน API
-- รันซ้ำได้ (idempotent)
-- =====================================================================

create table if not exists public.user_preassignments (
  id               uuid primary key default gen_random_uuid(),
  email            text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  full_name        text,
  position         text,
  organization_id  uuid not null references public.organizations(id) on delete cascade,   -- หน่วยงานที่ได้รับสิทธิ์ (unit)
  home_organization_id uuid references public.organizations(id) on delete set null,    -- สังกัดของผู้ใช้ (faculty)
  role             public.app_role not null,
  created_at       timestamptz not null default now(),
  applied_at       timestamptz,
  applied_user_id  uuid references public.profiles(id) on delete set null,
  unique (email, role, organization_id)
);
alter table public.user_preassignments add column if not exists home_organization_id uuid references public.organizations(id) on delete set null;
create index if not exists user_preassignments_email_idx on public.user_preassignments(email) where applied_at is null;

alter table public.user_preassignments enable row level security;
drop policy if exists user_preassignments_read on public.user_preassignments;
create policy user_preassignments_read on public.user_preassignments for select to authenticated
  using (app.is_central() or app.has_role('{org_admin}', organization_id));
revoke insert, update, delete on public.user_preassignments from anon, authenticated;

-- ใช้รายการที่ลงทะเบียนไว้กับผู้ใช้ (เรียกจาก trigger และจาก app.import_user)
create or replace function app.apply_user_preassignments(p_user uuid, p_email text) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if p_user is null or p_email is null then return 0; end if;
  for r in select * from public.user_preassignments
            where email = lower(btrim(p_email)) and applied_at is null order by created_at, id loop
    update public.profiles
       set organization_id = coalesce(organization_id, r.home_organization_id, r.organization_id),
           full_name = coalesce(nullif(btrim(r.full_name), ''), full_name),
           position  = coalesce(nullif(btrim(r.position), ''), position),
           is_active = true
     where id = p_user;
    insert into public.role_assignments (user_id, role, organization_id)
    values (p_user, r.role, r.organization_id) on conflict do nothing;
    update public.user_preassignments set applied_at = now(), applied_user_id = p_user where id = r.id;
    n := n + 1;
  end loop;
  if n > 0 then
    update public.notifications set read_at = coalesce(read_at, now())
     where dedupe_key = 'user_pending:' || p_user;
  end if;
  return n;
end $$;
revoke execute on function app.apply_user_preassignments(uuid, text) from public, anon, authenticated;

create or replace function app.profiles_apply_preassignments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.apply_user_preassignments(new.id, new.email);
  return null;
end $$;
drop trigger if exists profiles_apply_preassignments on public.profiles;
create trigger profiles_apply_preassignments after insert on public.profiles
  for each row execute function app.profiles_apply_preassignments();

-- หา id หน่วยงานจากรหัสหรือชื่อภาษาไทย (ตรงตัว ไม่สนช่องว่างหัวท้าย)
create or replace function app.import_org_id(p_org text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.organizations where upper(code) = upper(btrim(p_org));
  if v is null then
    select id into v from public.organizations where btrim(name_th) = btrim(p_org) order by is_active desc limit 1;
  end if;
  if v is null then raise exception 'ไม่พบหน่วยงาน "%" — ตรวจรหัส/ชื่อให้ตรงกับแท็บ หน่วยงาน', p_org; end if;
  return v;
end $$;

-- ---------- หน่วยงาน ----------
create or replace function app.import_organization(p_code text, p_name_th text, p_org_type text default 'faculty',
                                                   p_name_en text default null, p_parent text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_parent uuid; v_id uuid;
begin
  v_parent := case when nullif(btrim(p_parent), '') is null
                   then (select id from public.organizations where parent_id is null limit 1)
                   else app.import_org_id(p_parent) end;
  if v_parent is null then raise exception 'ยังไม่มีหน่วยงานราก — รันไฟล์ 02_starter_data.sql ก่อน'; end if;
  select id into v_id from public.organizations where upper(code) = upper(btrim(p_code)) or btrim(name_th) = btrim(p_name_th)
   order by (upper(code) = upper(btrim(p_code))) desc limit 1;
  if v_id is not null then
    update public.organizations set name_en = coalesce(name_en, nullif(btrim(p_name_en), '')) where id = v_id;
    return 'มีอยู่แล้ว: ' || btrim(p_name_th);
  end if;
  insert into public.organizations (parent_id, code, name_th, name_en, org_type)
  values (v_parent, upper(btrim(p_code)), btrim(p_name_th), nullif(btrim(p_name_en), ''), coalesce(nullif(btrim(p_org_type), ''), 'faculty'));
  return 'เพิ่มแล้ว: ' || btrim(p_name_th);
end $$;

-- ---------- อาคาร + ชั้น ----------
create or replace function app.import_building(p_org text, p_code text, p_name text, p_floors int default 0,
                                               p_address text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_org uuid := app.import_org_id(p_org); v_id uuid; v_new boolean := false;
begin
  if nullif(btrim(p_code), '') is null or nullif(btrim(p_name), '') is null then raise exception 'ต้องระบุรหัสและชื่ออาคาร'; end if;
  if coalesce(p_floors, 0) < 0 or coalesce(p_floors, 0) > 60 then raise exception 'จำนวนชั้นต้องอยู่ระหว่าง 0–60'; end if;
  select id into v_id from public.buildings where upper(code) = upper(btrim(p_code));
  if v_id is null then
    insert into public.buildings (organization_id, code, name, address)
    values (v_org, upper(btrim(p_code)), btrim(p_name), nullif(btrim(p_address), '')) returning id into v_id;
    v_new := true;
  end if;
  insert into public.floors (building_id, name, level)
  select v_id, 'ชั้น ' || g, g from generate_series(1, coalesce(p_floors, 0)) g
  on conflict (building_id, name) do nothing;
  return (case when v_new then 'เพิ่มแล้ว: ' else 'มีอยู่แล้ว (เติมชั้นที่ขาด): ' end) || upper(btrim(p_code)) || ' ' || btrim(p_name);
end $$;

-- ---------- ห้อง/พื้นที่ ----------
create or replace function app.import_location(p_building text, p_floor text, p_name text, p_room_no text default null,
                                               p_type text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_b uuid; v_f uuid; v_floor text; v_level int;
begin
  select id into v_b from public.buildings where upper(code) = upper(btrim(p_building));
  if v_b is null then raise exception 'ไม่พบอาคารรหัส "%"', p_building; end if;
  v_floor := btrim(p_floor);
  if v_floor ~ '^[0-9]+$' then v_floor := 'ชั้น ' || v_floor; end if;
  select id into v_f from public.floors where building_id = v_b and name = v_floor;
  if v_f is null then
    v_level := coalesce(nullif(regexp_replace(v_floor, '[^0-9-]', '', 'g'), '')::int, 1);
    insert into public.floors (building_id, name, level) values (v_b, v_floor, v_level) returning id into v_f;
  end if;
  if nullif(btrim(p_type), '') is not null and btrim(p_type) not in ('laboratory','electrical','common','storage') then
    raise exception 'ประเภทพื้นที่ "%" ไม่ถูกต้อง (laboratory, electrical, common, storage หรือเว้นว่าง)', p_type;
  end if;
  insert into public.locations (floor_id, name, room_no, location_type)
  values (v_f, btrim(p_name), nullif(btrim(p_room_no), ''), nullif(btrim(p_type), ''))
  on conflict (floor_id, name) do update set room_no = coalesce(excluded.room_no, public.locations.room_no),
                                              location_type = coalesce(excluded.location_type, public.locations.location_type);
  return 'บันทึกแล้ว: ' || upper(btrim(p_building)) || ' / ' || v_floor || ' / ' || btrim(p_name);
end $$;

-- ---------- ผู้ใช้ (ลงทะเบียนล่วงหน้า) ----------
-- p_faculty = สังกัดของผู้ใช้, p_unit = หน่วยงานที่ได้รับสิทธิ์ตามบทบาท (เว้นว่าง = เท่ากับ p_faculty)
create or replace function app.import_user(p_email text, p_full_name text, p_position text, p_faculty text,
                                           p_unit text, p_role text) returns text
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(btrim(p_email)); v_home uuid; v_org uuid; v_role public.app_role; v_user uuid; n int;
begin
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'อีเมล "%" ไม่ถูกต้อง', p_email; end if;
  if not app.email_domain_allowed(v_email) then
    raise exception 'อีเมล % ไม่อยู่ในโดเมนที่อนุญาต (ตั้งค่าระบบ › ภาพลักษณ์และการเข้าสู่ระบบ)', v_email;
  end if;
  v_home := app.import_org_id(p_faculty);
  v_org  := case when nullif(btrim(p_unit), '') is null then v_home else app.import_org_id(p_unit) end;
  begin v_role := btrim(p_role)::public.app_role;
  exception when invalid_text_representation then
    raise exception 'บทบาท "%" ไม่ถูกต้อง (system_admin, safety_coordinator, org_admin, inspector, responsible, verifier, executive)', p_role;
  end;
  insert into public.user_preassignments (email, full_name, position, organization_id, home_organization_id, role)
  values (v_email, nullif(btrim(p_full_name), ''), nullif(btrim(p_position), ''), v_org, v_home, v_role)
  on conflict (email, role, organization_id) do update
     set full_name = excluded.full_name, position = excluded.position,
         home_organization_id = excluded.home_organization_id;
  select id into v_user from public.profiles where lower(email) = v_email;
  if v_user is not null then
    n := app.apply_user_preassignments(v_user, v_email);
    return 'กำหนดสิทธิ์ทันที (มีบัญชีแล้ว): ' || v_email || ' → ' || v_role;
  end if;
  return 'ลงทะเบียนล่วงหน้าแล้ว: ' || v_email || ' → ' || v_role || ' (มีผลเมื่อเข้าสู่ระบบด้วย Google ครั้งแรก)';
end $$;

revoke execute on function app.import_org_id(text) from public, anon, authenticated;
revoke execute on function app.import_organization(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function app.import_building(text, text, text, int, text) from public, anon, authenticated;
revoke execute on function app.import_location(text, text, text, text, text) from public, anon, authenticated;
drop function if exists app.import_user(text, text, text, text, text);
revoke execute on function app.import_user(text, text, text, text, text, text) from public, anon, authenticated;

-- ให้ Supabase API โหลดรายการตาราง/ฟังก์ชันใหม่ทันที (ไม่ต้องรอ)
notify pgrst, 'reload schema';


-- =====================================================================
-- รายละเอียดอาคาร: เลขอาคารตามสถานที่ + ประเภทอาคารของมหาวิทยาลัย
-- และ app.import_building รุ่นใหม่ (อัปเดตชื่อ/หน่วยงาน/เลข/ประเภท เมื่อรันซ้ำ)
-- รันซ้ำได้ (idempotent)
-- =====================================================================
alter table public.buildings add column if not exists building_no int check (building_no is null or building_no > 0);
alter table public.buildings add column if not exists building_type text;
create index if not exists buildings_no_idx on public.buildings(building_no);

drop function if exists app.import_building(text, text, text, int, text);
create or replace function app.import_building(p_org text, p_code text, p_name text, p_floors int default 0,
                                               p_address text default null, p_building_no int default null,
                                               p_building_type text default null, p_description text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare v_org uuid := app.import_org_id(p_org); v_id uuid; v_new boolean := false; n int;
begin
  if nullif(btrim(p_code), '') is null or nullif(btrim(p_name), '') is null then raise exception 'ต้องระบุรหัสและชื่ออาคาร'; end if;
  if coalesce(p_floors, 0) < 0 or coalesce(p_floors, 0) > 60 then raise exception 'จำนวนชั้นต้องอยู่ระหว่าง 0–60'; end if;
  select id into v_id from public.buildings where upper(code) = upper(btrim(p_code));
  if v_id is null then
    insert into public.buildings (organization_id, code, name, address, building_no, building_type, description)
    values (v_org, upper(btrim(p_code)), btrim(p_name), nullif(btrim(p_address), ''), p_building_no,
            nullif(btrim(p_building_type), ''), nullif(btrim(p_description), ''))
    returning id into v_id;
    v_new := true;
  else
    -- ข้อมูลจากไฟล์นำเข้าเป็นข้อมูลหลัก: ปรับชื่อ หน่วยงาน เลขอาคาร และประเภทให้ตรง
    update public.buildings
       set name = btrim(p_name), organization_id = v_org,
           building_no = coalesce(p_building_no, building_no),
           building_type = coalesce(nullif(btrim(p_building_type), ''), building_type),
           address = coalesce(nullif(btrim(p_address), ''), address),
           description = coalesce(nullif(btrim(p_description), ''), description)
     where id = v_id;
  end if;
  insert into public.floors (building_id, name, level)
  select v_id, 'ชั้น ' || g, g from generate_series(1, coalesce(p_floors, 0)) g
  on conflict (building_id, name) do nothing;
  get diagnostics n = row_count;
  return (case when v_new then 'เพิ่มแล้ว: ' else 'อัปเดตแล้ว: ' end) || upper(btrim(p_code)) || ' ' || btrim(p_name)
         || case when n > 0 and not v_new then ' (+' || n || ' ชั้น)' else '' end;
end $$;
revoke execute on function app.import_building(text, text, text, int, text, int, text, text) from public, anon, authenticated;

-- เปลี่ยนรหัสอาคาร (และรหัสจุดตรวจที่มีรหัสอาคารอยู่ในรหัส) เช่น PH1 → PHP03 — ใช้เมื่อปรับตามทะเบียนอาคารของมหาวิทยาลัย
create or replace function app.rename_building_code(p_old text, p_new text) returns text
language plpgsql security definer set search_path = public as $$
declare v_id uuid; n int;
begin
  select id into v_id from public.buildings where upper(code) = upper(btrim(p_old));
  if v_id is null then return 'ไม่มีรหัส ' || p_old || ' (ข้าม)'; end if;
  if exists (select 1 from public.buildings where upper(code) = upper(btrim(p_new))) then
    return 'มีรหัส ' || p_new || ' อยู่แล้ว — ไม่เปลี่ยน ' || p_old;
  end if;
  update public.buildings set code = upper(btrim(p_new)) where id = v_id;
  update public.assets set code = replace(code, '-' || upper(btrim(p_old)) || '-', '-' || upper(btrim(p_new)) || '-')
   where building_id = v_id and code like '%-' || upper(btrim(p_old)) || '-%';
  get diagnostics n = row_count;
  return 'เปลี่ยนรหัส ' || p_old || ' → ' || p_new || ' (จุดตรวจ ' || n || ' จุด)';
end $$;
revoke execute on function app.rename_building_code(text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ---------- ส่วนที่ 2: หน่วยงาน (จากไฟล์ NU-Inspections-Users_3.csv) ----------
select r as ผลการนำเข้าหน่วยงาน from (values
  (app.import_organization('AGNRE', 'คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติและสิ่งแวดล้อม', 'faculty')),
  (app.import_organization('PHAR', 'คณะเภสัชศาสตร์', 'faculty')),
  (app.import_organization('MED', 'คณะแพทยศาสตร์', 'faculty')),
  (app.import_organization('LDSC', 'คณะโลจิสติกส์และดิจิทัลซัพพลายเชน', 'faculty')),
  (app.import_organization('DENT', 'คณะทันตแพทยศาสตร์', 'faculty')),
  (app.import_organization('LAW', 'คณะนิติศาสตร์', 'faculty')),
  (app.import_organization('BEC', 'คณะบริหารธุรกิจ เศรษฐศาสตร์และการสื่อสาร', 'faculty')),
  (app.import_organization('NURS', 'คณะพยาบาลศาสตร์', 'faculty')),
  (app.import_organization('HUM', 'คณะมนุษยศาสตร์', 'faculty')),
  (app.import_organization('SC', 'คณะวิทยาศาสตร์', 'faculty')),
  (app.import_organization('MEDSCI', 'คณะวิทยาศาสตร์การแพทย์', 'faculty')),
  (app.import_organization('EN', 'คณะวิศวกรรมศาสตร์', 'faculty')),
  (app.import_organization('EDU', 'คณะศึกษาศาสตร์', 'faculty')),
  (app.import_organization('ARCH', 'คณะสถาปัตยกรรมศาสตร์ ศิลปะและการออกแบบ', 'faculty')),
  (app.import_organization('AHS', 'คณะสหเวชศาสตร์', 'faculty')),
  (app.import_organization('SOC', 'คณะสังคมศาสตร์', 'faculty')),
  (app.import_organization('PH', 'คณะสาธารณสุขศาสตร์', 'faculty')),
  (app.import_organization('GRAD', 'บัณฑิตวิทยาลัย', 'faculty')),
  (app.import_organization('CFR', 'วิทยาลัยเพื่อการค้นคว้าระดับรากฐาน', 'faculty')),
  (app.import_organization('NUIC', 'วิทยาลัยนานาชาติ', 'faculty')),
  (app.import_organization('SGT', 'วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'faculty')),
  (app.import_organization('PLAN', 'กองแผนงาน', 'office')),
  (app.import_organization('LEGAL', 'กองกฎหมาย', 'office')),
  (app.import_organization('GAD', 'กองกลาง', 'office')),
  (app.import_organization('IPTT', 'กองการถ่ายทอดเทคโนโลยีและบริหารจัดการทรัพย์สินทางปัญญา', 'office')),
  (app.import_organization('HRD', 'กองการบริหารงานบุคคล', 'office')),
  (app.import_organization('RDI', 'กองการวิจัยและนวัตกรรม', 'office')),
  (app.import_organization('STA', 'กองกิจการนิสิต', 'office')),
  (app.import_organization('FIN', 'กองคลัง', 'office')),
  (app.import_organization('ITC', 'กองบริการเทคโนโลยีสารสนเทศและการสื่อสาร', 'office')),
  (app.import_organization('ACS', 'กองบริการการศึกษา', 'office')),
  (app.import_organization('EQA', 'กองพัฒนาคุณภาพการศึกษา', 'office')),
  (app.import_organization('ILA', 'กองพัฒนาภาษาและกิจการต่างประเทศ', 'office')),
  (app.import_organization('ASV', 'กองส่งเสริมการบริการวิชาการ', 'office')),
  (app.import_organization('ACU', 'กองส่งเสริมศิลปวัฒนธรรม', 'office')),
  (app.import_organization('BLDG', 'กองอาคารสถานที่', 'office')),
  (app.import_organization('LAC', 'สถานสัตว์ทดลองเพื่อการวิจัย', 'center')),
  (app.import_organization('AUDIT', 'สำนักงานตรวจสอบภายใน', 'office')),
  (app.import_organization('PRES', 'สำนักงานอธิการบดี', 'office')),
  (app.import_organization('SCIPARK', 'อุทยานวิทยาศาสตร์มหาวิทยาลัยนเรศวร', 'center')),
  (app.import_organization('LIB', 'สำนักหอสมุด', 'center')),
  (app.import_organization('SSCH', 'โรงเรียนมัธยมสาธิตมหาวิทยาลัยนเรศวร', 'unit')),
  (app.import_organization('PSCH', 'โรงเรียนอนุบาลและประถมสาธิตมหาวิทยาลัยนเรศวร', 'unit'))
) v(r);

-- ---------- ส่วนที่ 3: ปรับรหัสอาคารเดิมให้ตรงทะเบียนอาคาร (ถ้าเคยนำเข้า PH1–PH3) ----------
select r as ผลการปรับรหัส from (values
  (app.rename_building_code('PH1', 'PHP03')),
  (app.rename_building_code('PH2', 'PHP02')),
  (app.rename_building_code('PH3', 'PHP01'))
) v(r);

-- ---------- ส่วนที่ 4: อาคาร 204 อาคาร (จากทะเบียนอาคาร — file CAD อาคาร) ----------
-- อาคารที่ไม่ทราบจำนวนชั้นสร้าง "ชั้น 1" ไว้ก่อน — เติมจำนวนชั้นจริงในแบบฟอร์ม Excel แล้วรันคำสั่งของแถวนั้นซ้ำ
select r as ผลการนำเข้าอาคาร from (values
  (app.import_building('กองคลัง', 'MAS01', 'อาคารมิ่งขวัญ 1 (อาคารกลาง)', 1, null, 101, 'สนับสนุนการบริหาร', null)),
  (app.import_building('กองคลัง', 'MAS02', 'อาคารมิ่งขวัญ 2 (อาคารฝั่งซ้าย)', 1, null, 102, 'สนับสนุนการบริหาร', null)),
  (app.import_building('กองคลัง', 'MAS03', 'อาคารมิ่งขวัญ 3 (อาคารฝั่งขวา)', 1, null, 103, 'สนับสนุนการบริหาร', null)),
  (app.import_building('กองคลัง', 'MAS04', 'อาคารเสลา 53 (อาคารเก็บของ)', 1, null, 104, 'อาคารอื่นๆ', null)),
  (app.import_building('คณะมนุษยศาสตร์', 'HSU01', 'อาคารคณะมนุษยศาสตร์ อาคาร1', 1, null, 90, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะมนุษยศาสตร์', 'HSU02', 'อาคารคณะมนุษยศาสตร์ อาคาร2', 1, null, 91, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะมนุษยศาสตร์', 'HSU03', 'อาคารคณะมนุษยศาสตร์ อาคาร3', 1, null, 92, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะมนุษยศาสตร์', 'HSU04', 'อาคารคณะมนุษยศาสตร์ อาคาร4', 1, null, 93, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะมนุษยศาสตร์', 'HSU05', 'อาคารคณะมนุษยศาสตร์ อาคาร5', 1, null, 94, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะมนุษยศาสตร์', 'HSU06', 'อาคารคณะมนุษยศาสตร์ อาคาร6', 1, null, 95, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะมนุษยศาสตร์', 'NIC', 'อาคารวิทยาลัยนานาชาติ', 1, null, 96, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะเภสัชศาสตร์', 'PHA01', 'อาคารคณะเภสัชศาสตร์ (อาคาร1)', 1, null, 24, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะเภสัชศาสตร์', 'PHA02', 'อาคารคณะเภสัชศาสตร์ (อาคาร2)', 1, null, 25, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะเภสัชศาสตร์', 'PHA03', 'อาคารคณะเภสัชศาสตร์ (อาคาร3)', 1, null, 26, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะเภสัชศาสตร์', 'PHA04', 'อาคารคณะเภสัชศาสตร์ (อาคาร4)', 1, null, 27, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะเภสัชศาสตร์', 'PHA05', 'อาคารคณะเภสัชศาสตร์ (อาคาร5)', 1, null, 28, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะเภสัชศาสตร์', 'PHA06', 'อาคารคณะเภสัชศาสตร์ (อาคาร6)', 1, null, 29, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะเภสัชศาสตร์', 'PHA07', 'อาคารปฏิบัติการสมุนไพรของคณะเภสัชศาสตร์', 1, null, 30, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('คณะเภสัชศาสตร์', 'PHA08', 'อาคารสถานปฏิบัติการเภสัชกรรมชุมชน แห่งที่ 2', 1, null, 31, 'อาคารอื่นๆ', null)),
  (app.import_building('คณะศึกษาศาสตร์', 'EDU01', 'อาคารคณะศึกษาศาสตร์ (อาคาร ED1)', 1, null, 86, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะศึกษาศาสตร์', 'EDU02', 'อาคารคณะศึกษาศาสตร์ (อาคาร ED2)', 1, null, 87, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('กองอาคารสถานที่', 'DOR01', 'อาคาร มน.นิเวศ 1', 1, null, 163, 'อาคารหอพัก', null)),
  (app.import_building('กองอาคารสถานที่', 'DOR02', 'อาคาร มน.นิเวศ 2', 1, null, 164, 'อาคารหอพัก', null)),
  (app.import_building('กองอาคารสถานที่', 'DOR03', 'อาคาร มน.นิเวศ 3', 1, null, 165, 'อาคารหอพัก', null)),
  (app.import_building('กองอาคารสถานที่', 'DOR04', 'อาคาร มน.นิเวศ 4', 1, null, 166, 'อาคารหอพัก', null)),
  (app.import_building('กองอาคารสถานที่', 'DOR05', 'อาคาร มน.นิเวศ 5', 1, null, 167, 'อาคารหอพัก', null)),
  (app.import_building('กองอาคารสถานที่', 'DOR06', 'อาคาร มน.นิเวศ 6', 1, null, 168, 'อาคารหอพัก', null)),
  (app.import_building('กองอาคารสถานที่', 'DOR07', 'อาคาร มน.นิเวศ 7', 1, null, 169, 'อาคารหอพัก', null)),
  (app.import_building('กองอาคารสถานที่', 'DOR08', 'อาคาร มน.นิเวศ 8', 1, null, 170, 'อาคารหอพัก', null)),
  (app.import_building('กองอาคารสถานที่', 'DOR09', 'อาคาร มน.นิเวศ 9', 1, null, 171, 'อาคารหอพัก', null)),
  (app.import_building('กองอาคารสถานที่', 'DOR10', 'อาคาร มน.นิเวศ 10', 1, null, 172, 'อาคารหอพัก', null)),
  (app.import_building('กองอาคารสถานที่', 'DOR11', 'อาคาร มน.นิเวศ 11', 1, null, 173, 'อาคารหอพัก', null)),
  (app.import_building('กองอาคารสถานที่', 'DOR12', 'อาคาร มน.นิเวศ 12', 1, null, 174, 'อาคารหอพัก', null)),
  (app.import_building('กองอาคารสถานที่', 'DOR14', 'อาคาร มน.นิเวศ 14', 1, null, 175, 'อาคารหอพัก', null)),
  (app.import_building('กองอาคารสถานที่', 'DOR15', 'อาคาร มน.นิเวศ 15', 1, null, 176, 'อาคารหอพัก', null)),
  (app.import_building('คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติและสิ่งแวดล้อม', 'AGI01', 'อาคารคณะเกษตรศาสตร์ (อาคารสำนักงานเลขานุการ)', 1, null, 74, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติและสิ่งแวดล้อม', 'AGI02', 'อาคารคณะเกษตรศาสตร์ (อาคารเรียนรวม)', 1, null, 75, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติและสิ่งแวดล้อม', 'AGI03', 'อาคารคณะเกษตรศาสตร์ (อาคารปฏิบัติการพืชศาสตร์)', 1, null, 76, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติและสิ่งแวดล้อม', 'AGI04', 'อาคารคณะเกษตรศาสตร์ (อาคารปฏิบัติการอุตสาหกรรมเกษตร)', 1, null, 77, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติและสิ่งแวดล้อม', 'AGI06', 'อาคารคณะเกษตรศาสตร์ (อาคารปฏิบัติการแปรรูปอาหาร)', 1, null, 78, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติและสิ่งแวดล้อม', 'AGI07', 'อาคารคณะเกษตรศาสตร์ (อาคารเรือนกระจก1 และอาคารเรือนกระจก2)', 1, null, 79, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติและสิ่งแวดล้อม', 'AGI08', 'อาคารนวัตกรรมเทคโนโลยีการแปรรูปผลผลิตทางเกษตรและอาหาร', 1, null, 80, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติและสิ่งแวดล้อม', 'AGI09', 'อาคารศูนย์พัฒนามาตรฐานและเฝ้าระวังการปนเปื้อนสารเคมีฯ', 1, null, 81, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติและสิ่งแวดล้อม', 'AGI10', 'อาคารวิจัยแมลงและศัตรูพืช', 1, null, 82, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('คณะวิศวกรรมศาสตร์', 'ENG01', 'อาคารคณะวิศวกรรมศาสตร์ (อาคารเรียนรวม EN)', 1, null, 64, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะวิศวกรรมศาสตร์', 'ENG02', 'อาคารคณะวิศวกรรมศาสตร์ (อาคารวิศวกรรมโยธา)', 1, null, 65, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะวิศวกรรมศาสตร์', 'ENG03', 'อาคารคณะวิศวกรรมศาสตร์ (อาคารวิศวกรรมอุตสาหการ)', 1, null, 66, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะวิศวกรรมศาสตร์', 'ENG04', 'อาคารคณะวิศวกรรมศาสตร์ (อาคารวิศวกรรมไฟฟ้า)', 1, null, 67, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะวิศวกรรมศาสตร์', 'ENG05', 'อาคารคณะวิศวกรรมศาสตร์ (อาคารปฏิบัติการโยธา)', 1, null, 68, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะวิศวกรรมศาสตร์', 'ENG06', 'อาคารคณะวิศวกรรมศาสตร์ (อาคารปฏิบัติการวิศวกรรมเครื่องกล)', 1, null, 69, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('คณะวิศวกรรมศาสตร์', 'ENG07', 'อาคารคณะวิศวกรรมศาสตร์ (อาคารปฏิบัติการวิศวกรรมอุตสาหการ)', 1, null, 70, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('คณะวิศวกรรมศาสตร์', 'ENG08', 'อาคารคณะวิศวกรรมศาสตร์ (อาคารปฏิบัติการวิศวกรรมไฟฟ้า)', 1, null, 71, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('คณะวิศวกรรมศาสตร์', 'ENG09', 'กลุ่มอาคาร Startup and Innovation ของธุรกิจสมุนไพรและอุตสาหกรรมเกษตร', 1, null, 72, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('คณะวิทยาศาสตร์การแพทย์', 'AMS01', 'อาคารคณะวิทยาศาสตร์การแพทย์', 1, null, 32, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะวิทยาศาสตร์', 'SCI01', 'อาคารคณะวิทยาศาสตร์ (สำนักงานเลขานุการ)', 1, null, 36, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะวิทยาศาสตร์', 'SCI02', 'อาคารคณะวิทยาศาสตร์ (ภาควิชาเคมี)', 1, null, 37, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะวิทยาศาสตร์', 'SCI03', 'อาคารคณะวิทยาศาสตร์ (ภาควิชาชีววิทยา)', 1, null, 38, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะวิทยาศาสตร์', 'SCI04', 'อาคารคณะวิทยาศาสตร์ (ภาควิชาคณิตศาสตร์)', 1, null, 39, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะวิทยาศาสตร์', 'SCI05', 'อาคารคณะวิทยาศาสตร์ (ภาควิชาฟิสิกส์)', 1, null, 40, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะวิทยาศาสตร์', 'SCI06', 'อาคารคณะวิทยาศาสตร์ (อาคารเก็บวัตถุอันตราย / อาคารศูนย์ปฏิบัติการวิทยาศาสตร์)', 1, null, 41, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะวิทยาศาสตร์', 'SCI07', 'อาคารปฏิบัติการกัมมันตรังสี (อาคารแหล่งกำเนิดนิวตรอนคณะวิทยาศาสตร์)', 1, null, 42, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('คณะวิทยาศาสตร์', 'SCI08', 'อาคารควบคุมพลังงานโซล่าเซลล์', 1, null, 43, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('คณะวิทยาศาสตร์', 'SCI09', 'อาคารปฏิบัติการแบตเตอรี่ฯ', 1, null, 44, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('คณะวิทยาศาสตร์', 'SCI10', 'อาคาร Student Center', 1, null, 45, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('กองอาคารสถานที่', 'STD01', 'อาคารกีฬากลางแจ้งพร้อมอัฒจันทร์ 2000 ที่นั่ง', 1, null, 143, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'STD02', 'อาคารกีฬากลางแจ้งพร้อมอัฒจันทร์ (อาคารใหม่)', 1, null, 144, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองกิจการนิสิต', 'GYM01', 'อาคารอเนกประสงค์ (อาคารยิมเนเซียม)', 1, null, 131, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองกิจการนิสิต', 'GYM02', 'อาคารกีฬาในร่ม', 1, null, 132, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองกิจการนิสิต', 'GYM03', 'อาคารกิจกรรมด้านศิลปวัฒนธรรม', 1, null, 133, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองกิจการนิสิต', 'GYM04', 'อาคารกิจกรรมด้านข้างอเนกประสงค์', 1, null, 134, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองกิจการนิสิต', 'GYM05', 'อาคารสระว่ายน้ำสุพรรณกัลยา', 1, null, 135, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองกิจการนิสิต', 'GYM06', 'อาคารห้องน้ำชาย-หญิง ข้างสนามฟุตซอล', 1, null, 136, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองกิจการนิสิต', 'SA01', 'อาคารชมรมนิสิต อาคาร 1', 1, null, 138, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองกิจการนิสิต', 'SA02', 'อาคารชมรมนิสิต อาคาร 2', 1, null, 139, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองกิจการนิสิต', 'SA03', 'อาคารชมรมนิสิต อาคาร 3', 1, null, 140, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองกิจการนิสิต', 'SA04', 'อาคารชมรมนิสิต อาคาร 4', 1, null, 141, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองกิจการนิสิต', 'SA05', 'อาคารชมรมนิสิต อาคาร 5', 1, null, 142, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองส่งเสริมศิลปวัฒนธรรม', 'NUAC', 'อาคารวิสุทธิกษัตริย์', 1, null, 129, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองบริการเทคโนโลยีสารสนเทศและการสื่อสาร', 'CIT', 'อาคารศูนย์บริการเทคโนโลยีและการสื่อสาร', 1, null, 130, 'สนับสนุนการบริหาร', null)),
  (app.import_building('กองกิจการนิสิต', 'DRS01', 'อาคารหอพักนิสิต อาคาร1', 1, null, 148, 'อาคารหอพัก', null)),
  (app.import_building('กองกิจการนิสิต', 'DRS02', 'อาคารหอพักนิสิต อาคาร2', 1, null, 149, 'อาคารหอพัก', null)),
  (app.import_building('กองกิจการนิสิต', 'DRS03', 'อาคารหอพักนิสิต อาคาร3', 1, null, 150, 'อาคารหอพัก', null)),
  (app.import_building('กองกิจการนิสิต', 'DRS04', 'อาคารหอพักนิสิต อาคาร4', 1, null, 151, 'อาคารหอพัก', null)),
  (app.import_building('กองกิจการนิสิต', 'DRS05', 'อาคารหอพักนิสิต อาคาร5', 1, null, 152, 'อาคารหอพัก', null)),
  (app.import_building('กองกิจการนิสิต', 'DRS06', 'อาคารหอพักนิสิต อาคาร6', 1, null, 153, 'อาคารหอพัก', null)),
  (app.import_building('กองกิจการนิสิต', 'DRS07', 'อาคารหอพักนิสิต อาคาร7', 1, null, 154, 'อาคารหอพัก', null)),
  (app.import_building('กองกิจการนิสิต', 'DRS08', 'อาคารหอพักนิสิต อาคาร8', 1, null, 155, 'อาคารหอพัก', null)),
  (app.import_building('กองกิจการนิสิต', 'DRS09', 'อาคารหอพักนิสิต อาคาร9', 1, null, 156, 'อาคารหอพัก', null)),
  (app.import_building('กองกิจการนิสิต', 'DRS10', 'อาคารหอพักนิสิต อาคาร10', 1, null, 157, 'อาคารหอพัก', null)),
  (app.import_building('กองกิจการนิสิต', 'DRS11', 'อาคารหอพักนิสิต อาคาร11', 1, null, 158, 'อาคารหอพัก', null)),
  (app.import_building('กองกิจการนิสิต', 'DRS12', 'อาคารหอพักนิสิต อาคาร12', 1, null, 159, 'อาคารหอพัก', null)),
  (app.import_building('กองกิจการนิสิต', 'DRS13', 'อาคารหอพักนิสิต อาคาร13', 1, null, 160, 'อาคารหอพัก', null)),
  (app.import_building('กองกิจการนิสิต', 'DRS14', 'อาคารหอพักนิสิต อาคาร14', 1, null, 161, 'อาคารหอพัก', null)),
  (app.import_building('กองกิจการนิสิต', 'DRS15', 'อาคารหอพักนิสิต อาคาร15', 1, null, 162, 'อาคารหอพัก', null)),
  (app.import_building('คณะแพทยศาสตร์', 'DRS16', 'อาคารหอพักนิสิตแพทย์', 1, null, 9, 'อาคารหอพัก', null)),
  (app.import_building('กองกิจการนิสิต', 'NSA', 'อาคารขวัญเมือง', 1, null, 145, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองกิจการนิสิต', 'NSQ', 'อาคาร NU SQUARE', 1, null, 146, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองกิจการนิสิต', 'NSC', 'อาคาร NU CANTEEN', 1, null, 147, 'สนับสนุนการบริการ', null)),
  (app.import_building('สำนักหอสมุด', 'LIB01', 'อาคารสำนักหอสมุด (อาคารแสงเทียน)', 1, null, 109, 'สนับสนุนการบริการ', null)),
  (app.import_building('สำนักหอสมุด', 'LIB02', 'อาคารสำนักหอสมุด (อาคารเรียนรู้)', 1, null, 110, 'สนับสนุนการบริการ', null)),
  (app.import_building('คณะสถาปัตยกรรมศาสตร์ ศิลปะและการออกแบบ', 'ARC01', 'คณะสถาปัตยกรรมศาสตร์ (อาคาร ARC)', 1, null, 83, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะสถาปัตยกรรมศาสตร์ ศิลปะและการออกแบบ', 'ARC02', 'คณะสถาปัตยกรรมศาสตร์ (อาคาร ARL)', 1, null, 84, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะสถาปัตยกรรมศาสตร์ ศิลปะและการออกแบบ', 'ARC03', 'อาคารอุตสาหกรรมศึกษา', 1, null, 85, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('กองบริการการศึกษา', 'QSA', 'อาคารเฉลิมพระเกียรติ 72 พรรษา บรมราชินีนาถ (QS)', 1, null, 105, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('กองบริการการศึกษา', 'QSB', 'อาคารโรงละคร', 1, null, 106, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองบริการการศึกษา', 'QSC', 'อาคารปราบไตรจักร1', 1, null, 107, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('กองบริการการศึกษา', 'QSD', 'อาคารปราบไตรจักร2', 1, null, 108, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('กองอาคารสถานที่', 'DBA', 'อาคารกองอาคารสถานที่ (สำนักงาน)', 1, null, 202, 'สนับสนุนการบริหาร', null)),
  (app.import_building('สถานสัตว์ทดลองเพื่อการวิจัย', 'CAR', 'อาคารศูนย์ปฏิบัติการวิจัยและทดสอบด้านความปลอดภัยในสัตว์ทดลอง', 1, null, 119, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('กองส่งเสริมการบริการวิชาการ', 'NAN01', 'อาคารบริการ (กลุ่มอาคารนาโนเทคโนโลยีทางการแพทย์)', 1, null, 113, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองส่งเสริมการบริการวิชาการ', 'NAN02', 'อาคารมหาธรรมราชา (อาคาร A)', 1, null, 114, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('กองส่งเสริมการบริการวิชาการ', 'NAN03', 'อาคารมหาธรรมราชา (อาคาร B)', 1, null, 115, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('กองส่งเสริมการบริการวิชาการ', 'NAN04', 'อาคารมหาธรรมราชา (อาคาร C)', 1, null, 116, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('กองส่งเสริมการบริการวิชาการ', 'NAN05', 'อาคารเอกาทศรถ', 1, null, 112, 'สนับสนุนการบริการ', null)),
  (app.import_building('คณะวิทยาศาสตร์การแพทย์', 'NAN06', 'อาคารกายวิภาคศาสตร์', 1, null, 33, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('สถานสัตว์ทดลองเพื่อการวิจัย', 'NAN07', 'อาคารสถานสัตว์ทดลองเพื่อการวิจัย', 1, null, 118, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('คณะวิทยาศาสตร์การแพทย์', 'NAN08', 'อาคารดองศพอาจารย์ใหญ่', 1, null, 34, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('คณะวิทยาศาสตร์การแพทย์', 'NAN09', 'อาคารล้างศพ', 1, null, 35, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('กองส่งเสริมการบริการวิชาการ', 'KNC', 'ศูนย์แสดงนิทรรศการและการจัดประชุมนานาชาติสมเด็จพระนเรศวรมหาราช (KNECC)', 1, null, 111, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'NEW01', 'อาคารสำหรับยกระดับตำรายาแผนไทยสู่มาตรฐานสากล', 1, null, 204, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('คณะโลจิสติกส์และดิจิทัลซัพพลายเชน', 'LOG', 'อาคารคณะโลจิสติกส์และดิจิทัลซัพพลายเชน (อาคารเพราพิลาส)', 1, null, 46, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะสหเวชศาสตร์', 'AHS04', 'อาคารธาราบำบัดมาตรฐานสำหรับผู้สูงอายุ', 1, null, 17, 'สนับสนุนการบริการ', null)),
  (app.import_building('คณะทันตแพทยศาสตร์', 'DEN01', 'อาคารคณะทันตแพทยศาสตร์ (อาคารบริหาร)', 1, null, 11, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะทันตแพทยศาสตร์', 'DEN02', 'อาคารคณะทันตแพทยศาสตร์ (อาคารปฏิบัติการทันตกรรม)', 1, null, 12, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะทันตแพทยศาสตร์', 'DEN03', 'อาคารโรงพยาบาลทันตกรรม 2', 1, null, 13, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะสหเวชศาสตร์', 'AHS01', 'อาคารคณะสหเวชศาสตร์ (อาคารบริหาร)', 1, null, 14, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะสหเวชศาสตร์', 'AHS02', 'อาคารคณะสหเวชศาสตร์ (อาคารปฏิบัติการ 1)', 1, null, 15, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะสหเวชศาสตร์', 'AHS03', 'อาคารคณะสหเวชศาสตร์ (อาคารปฏิบัติการ 2)', 1, null, 16, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะพยาบาลศาสตร์', 'NUR01', 'อาคารคณะพยาบาลศาสตร์ (อาคารบริหาร)', 1, null, 18, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะพยาบาลศาสตร์', 'NUR02', 'อาคารคณะพยาบาลศาสตร์ (อาคารปฏิบัติการ)', 1, null, 19, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะพยาบาลศาสตร์', 'NUR03', 'อาคารคณะพยาบาลศาสตร์ (อาคารเรียนรวม)', 1, null, 20, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะสาธารณสุขศาสตร์', 'PHP01', 'อาคารคณะสาธารณสุขศาสตร์ (อาคารบริหาร)', 4, null, 21, 'สนับสนุนการเรียนการสอน', 'ชื่อเรียกอื่น: อาคารบริหาร คณะสาธารณสุขศาสตร์ (PH3 เดิม)')),
  (app.import_building('คณะสาธารณสุขศาสตร์', 'PHP02', 'อาคารคณะสาธารณสุขศาสตร์ (อาคารปฏิบัติการ)', 4, null, 22, 'สนับสนุนการเรียนการสอน', 'ชื่อเรียกอื่น: อาคารสุขวิทยาสถิตย์ (PH2 เดิม — ต้องยืนยันว่าเป็นอาคารเดียวกัน)')),
  (app.import_building('คณะสาธารณสุขศาสตร์', 'PHP03', 'อาคารคณะสาธารณสุขศาสตร์ (อาคารเรียนรวม)', 4, null, 23, 'สนับสนุนการเรียนการสอน', 'ชื่อเรียกอื่น: อาคารเรียนรวม คณะสาธารณสุขศาสตร์ (PH1 เดิม)')),
  (app.import_building('คณะนิติศาสตร์', 'LAW', 'กลุ่มอาคารอุตสาหกรรมบริการ (อาคารคณะนิติศาสตร์)', 1, null, 97, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะสังคมศาสตร์', 'SOC', 'กลุ่มอาคารอุตสาหกรรมบริการ (อาคารคณะสังคมศาสตร์)', 1, null, 98, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('คณะบริหารธุรกิจ เศรษฐศาสตร์และการสื่อสาร', 'BEC', 'กลุ่มอาคารอุตสาหกรรมบริการ (อาคารคณะบริหารธุรกิจเศรษฐศาสตร์และการสื่อสาร)', 1, null, 99, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('กองอาคารสถานที่', 'CWW', 'อาคารสถานีบำบัดน้ำเสียส่วนกลาง', 1, null, 182, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองกลาง', 'CEN01', 'อาคารสำนักงานอธิการบดี', 1, null, 100, 'สนับสนุนการบริหาร', null)),
  (app.import_building('กองอาคารสถานที่', 'CPB01', 'อาคารจอดรถ กลุ่มอาคารสาธารณสุข', 1, null, 199, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'CPB02', 'อาคารจอดรถ กลุ่มอาคารอุตสาหกรรมบริการ', 1, null, 200, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'OSP', 'อาคารเวทีแสดงละครกลางแจ้ง (เวทีศิลป์ศาลา)', 1, null, 137, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'CPB03', 'อาคารจอดรถบัส', 1, null, 198, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'CPS', 'อาคารสถานีตำรวจชุมชน', 1, null, 180, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'SSP', 'อาคารสถานีไฟฟ้าย่อย', 1, null, 181, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'HPT', 'อาคารหอพระเทพฯ', 1, null, 179, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'TFH01', 'บ้านพักอาจารย์1', 1, null, 177, 'อาคารอื่นๆ', null)),
  (app.import_building('กองอาคารสถานที่', 'TFH02', 'บ้านพักอาจารย์2', 1, null, 178, 'อาคารอื่นๆ', null)),
  (app.import_building('กองอาคารสถานที่', 'DWP', 'อาคารผลิตน้ำดื่ม', 1, null, 195, 'อาคารอื่นๆ', null)),
  (app.import_building('กองส่งเสริมศิลปวัฒนธรรม', 'LMH01', 'อาคารพิพิธภัณฑ์ชีวิต (อาคารศูนย์บริการข้อมูล)', 1, null, 120, 'อาคารอื่นๆ', null)),
  (app.import_building('กองส่งเสริมศิลปวัฒนธรรม', 'LMH02', 'อาคารพิพิธภัณฑ์ชีวิต (อาคารห้องน้ำชาย-หญิง)', 1, null, 121, 'อาคารอื่นๆ', null)),
  (app.import_building('กองส่งเสริมศิลปวัฒนธรรม', 'LMH03', 'อาคารพิพิธภัณฑ์ชีวิต (อาคารบรรยาย)', 1, null, 122, 'อาคารอื่นๆ', null)),
  (app.import_building('กองส่งเสริมศิลปวัฒนธรรม', 'LMH04', 'อาคารพิพิธภัณฑ์ชีวิต (อาคารรับรอง 1)', 1, null, 123, 'อาคารอื่นๆ', null)),
  (app.import_building('กองส่งเสริมศิลปวัฒนธรรม', 'LMH05', 'อาคารพิพิธภัณฑ์ชีวิต (อาคารรับรอง 2)', 1, null, 124, 'อาคารอื่นๆ', null)),
  (app.import_building('กองส่งเสริมศิลปวัฒนธรรม', 'LMH06', 'อาคารพิพิธภัณฑ์ชีวิต (อาคารสาธิต 1)', 1, null, 125, 'อาคารอื่นๆ', null)),
  (app.import_building('กองส่งเสริมศิลปวัฒนธรรม', 'LMH07', 'อาคารพิพิธภัณฑ์ชีวิต (อาคารสาธิต 2)', 1, null, 126, 'อาคารอื่นๆ', null)),
  (app.import_building('กองส่งเสริมศิลปวัฒนธรรม', 'LMH08', 'อาคารพิพิธภัณฑ์ชีวิต (อาคารสาธิต 3)', 1, null, 127, 'อาคารอื่นๆ', null)),
  (app.import_building('กองส่งเสริมศิลปวัฒนธรรม', 'LMH09', 'อาคารพิพิธภัณฑ์ชีวิต (อาคารสาธิต 4)', 1, null, 128, 'อาคารอื่นๆ', null)),
  (app.import_building('คณะแพทยศาสตร์', 'NSU01', 'กลุ่มอาคารโรงพยาบาล (อาคารสิรินธร)', 1, null, 1, 'สนับสนุนการบริการ', null)),
  (app.import_building('คณะแพทยศาสตร์', 'NSU02', 'กลุ่มอาคารโรงพยาบาล (อาคารเฉลิมพระเกียรติ 7 รอบพระชนมพรรษา 1)', 1, null, 2, 'สนับสนุนการบริการ', null)),
  (app.import_building('คณะแพทยศาสตร์', 'NSU03', 'กลุ่มอาคารโรงพยาบาล (อาคารเฉลิมพระเกียรติ 7 รอบพระชนมพรรษา 2)', 1, null, 3, 'สนับสนุนการบริการ', null)),
  (app.import_building('คณะแพทยศาสตร์', 'NSU04', 'กลุ่มอาคารโรงพยาบาล (อาคารบริการ)', 1, null, 4, 'สนับสนุนการบริการ', null)),
  (app.import_building('คณะแพทยศาสตร์', 'NSU05', 'กลุ่มอาคารโรงพยาบาล (อาคารรังสีรักษา)', 1, null, 5, 'สนับสนุนการบริการ', null)),
  (app.import_building('คณะแพทยศาสตร์', 'NSU06', 'กลุ่มอาคารโรงพยาบาล (อาคารปั้มน้ำ)', 1, null, 6, 'สนับสนุนการบริการ', null)),
  (app.import_building('คณะแพทยศาสตร์', 'NSU07', 'กลุ่มอาคารโรงพยาบาล (อาคารพักขยะ)', 1, null, 7, 'สนับสนุนการบริการ', null)),
  (app.import_building('คณะแพทยศาสตร์', 'NSU08', 'กลุ่มอาคารโรงพยาบาล (อาคารจอดรถ)', 1, null, 8, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'NEW02', 'อาคารฟื้นฟูผู้สูงวัย', 1, null, 10, 'สนับสนุนการบริการ', null)),
  (app.import_building('คณะศึกษาศาสตร์', 'NUDS01', 'อาคารโรงเรียนอนุบาลและประถมศึกษามหาวิทยาลัยนเรศวร อาคารโภชนาการ 2 (คชาธาร 1)', 1, null, 88, 'สนับสนุนการบริการ', null)),
  (app.import_building('คณะศึกษาศาสตร์', 'NUDS02', 'อาคารโรงเรียนสาธิตมหาวิทยาลัยนเรศวร อาคารอินฟินิตี้ (คชาธาร 2)', 1, null, 89, 'สนับสนุนการบริการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER01', 'อาคาร สำนักงาน Sgtech', 1, null, 47, 'สนับสนุนการบริการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER02', 'อาคาร ASEAN-ONR-Smart Grid Simulator (ASIM)', 1, null, 48, 'สนับสนุนการบริการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER03', 'อาคาร ASEAN EU APEC Cooperation Office (AEA)', 1, null, 49, 'สนับสนุนการบริการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER04', 'อาคาร U-MAC Smart City & Co-Working Space', 1, null, 50, 'สนับสนุนการบริการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER05', 'อาคาร NU Digital Innovation & Research Labs (NDIR)', 1, null, 51, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER06', 'อาคาร SEPCON LAB', 1, null, 52, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER07', 'อาคาร Testing', 1, null, 53, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER08', 'อาคาร สัมมนา', 1, null, 54, 'สนับสนุนการบริการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER09', 'อาคาร Solar Energy Learning and Exhibition Center', 1, null, 55, 'สนับสนุนการบริการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER10', 'อาคาร 10 kW', 1, null, 56, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER11', 'อาคาร ควบคุม PV Micro-Grid', 1, null, 57, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER12', 'อาคาร Pyramid', 1, null, 58, 'อาคารอื่นๆ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER13', 'อาคารสำนักงานอาจารย์ Advisor Office 1', 1, null, 59, 'สนับสนุนการบริการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER14', 'อาคารสำนักงานอาจารย์ Advisor Office 2', 1, null, 60, 'สนับสนุนการบริการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER15', 'อาคารสำนักงานอาจารย์ Advisor Office 3', 1, null, 61, 'สนับสนุนการบริการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER16', 'อาคารสำนักงานอาจารย์ Advisor Office 4', 1, null, 62, 'สนับสนุนการบริการ', null)),
  (app.import_building('วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี', 'SER17', 'อาคารสำนักงานอาจารย์ Advisor Office 5', 1, null, 63, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองส่งเสริมการบริการวิชาการ', 'RLC', 'อาคารวิชชาลัยข้าวและชาวนา', 1, null, 203, 'สนับสนุนการเรียนการสอน', null)),
  (app.import_building('กองอาคารสถานที่', 'HWB', 'อาคารเก็บขยะมีพิษ', 1, null, 117, 'สนับสนุนการบริการ', null)),
  (app.import_building('คณะวิศวกรรมศาสตร์', 'ENG10', 'อาคารคณะวิศวกรรมศาสตร์ (อาคารปฏิบัติการวิศวกรรมเคมี)', 1, null, 73, 'สนับสนุนการวิจัย/ปฏิบัติการ', null)),
  (app.import_building('กองอาคารสถานที่', 'WTP01', 'อาคารโรงผลิตน้ำประปา (อาคารเก็บสารเคมี)', 1, null, 183, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'WTP02', 'อาคารโรงผลิตน้ำประปา (ห้องควบคุมการผลิต)', 1, null, 184, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'WTP03', 'อาคารโรงผลิตน้ำประปา (ระบบผลิตน้ำประปา 300 ลบ.ม./ชม.)', 1, null, 185, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'WTP04', 'อาคารโรงผลิตน้ำประปา (ถังเก็บน้ำ 1-2)', 1, null, 186, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'WTP12', 'อาคารโรงผลิตน้ำประปา (ระบบผลิตน้ำประปา 60 ลบ.ม./ชม.)', 1, null, 187, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'WTP05', 'อาคารโรงผลิตน้ำประปา (อาคารสูบน้ำถังสูง 1)', 1, null, 188, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'WTP06', 'อาคารโรงผลิตน้ำประปา (อาคารสูบน้ำถังสูง 2)', 1, null, 189, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'WTP07', 'อาคารโรงผลิตน้ำประปา (อาคารสำนักงานและห้องบรรยาย)', 1, null, 190, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'WTP08', 'อาคารโรงผลิตน้ำประปา (สถานีสูบน้ำดิบ 1)', 1, null, 191, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'WTP09', 'อาคารโรงผลิตน้ำประปา (สถานีสูบน้ำดิบ 2)', 1, null, 192, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'WTP10', 'อาคารโรงผลิตน้ำประปา (อาคารสูบน้ำถังสูง 3)', 1, null, 193, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'WTP11', 'อาคารโรงผลิตน้ำประปา (ถังเก็บน้ำ 3)', 1, null, 194, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'RWB', 'อาคารห้องน้ำชาย-หญิง ลาดจอดรถหอพัก 14-15', 1, null, 201, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'TSI01', 'อาคารสถานีขนส่งมวลชน 1 (ที่จอดรถไฟฟ้า)', 1, null, 196, 'สนับสนุนการบริการ', null)),
  (app.import_building('กองอาคารสถานที่', 'TSI02', 'อาคารสถานีขนส่งมวลชน 2 (ที่รอรถโดยสาร)', 1, null, 197, 'สนับสนุนการบริการ', null))
) v(r);

-- ---------- ตรวจผล: จำนวนอาคารต่อหน่วยงาน (รวมต้องได้ 204 อาคาร) ----------
select coalesce(o.name_th, 'รวมทั้งหมด') as หน่วยงานเจ้าของ, count(*) as จำนวนอาคาร
  from public.buildings b join public.organizations o on o.id = b.organization_id
 where b.code in ('MAS01', 'MAS02', 'MAS03', 'MAS04', 'HSU01', 'HSU02', 'HSU03', 'HSU04', 'HSU05', 'HSU06', 'NIC', 'PHA01', 'PHA02', 'PHA03', 'PHA04', 'PHA05', 'PHA06', 'PHA07', 'PHA08', 'EDU01', 'EDU02', 'DOR01', 'DOR02', 'DOR03', 'DOR04', 'DOR05', 'DOR06', 'DOR07', 'DOR08', 'DOR09', 'DOR10', 'DOR11', 'DOR12', 'DOR14', 'DOR15', 'AGI01', 'AGI02', 'AGI03', 'AGI04', 'AGI06', 'AGI07', 'AGI08', 'AGI09', 'AGI10', 'ENG01', 'ENG02', 'ENG03', 'ENG04', 'ENG05', 'ENG06', 'ENG07', 'ENG08', 'ENG09', 'AMS01', 'SCI01', 'SCI02', 'SCI03', 'SCI04', 'SCI05', 'SCI06', 'SCI07', 'SCI08', 'SCI09', 'SCI10', 'STD01', 'STD02', 'GYM01', 'GYM02', 'GYM03', 'GYM04', 'GYM05', 'GYM06', 'SA01', 'SA02', 'SA03', 'SA04', 'SA05', 'NUAC', 'CIT', 'DRS01', 'DRS02', 'DRS03', 'DRS04', 'DRS05', 'DRS06', 'DRS07', 'DRS08', 'DRS09', 'DRS10', 'DRS11', 'DRS12', 'DRS13', 'DRS14', 'DRS15', 'DRS16', 'NSA', 'NSQ', 'NSC', 'LIB01', 'LIB02', 'ARC01', 'ARC02', 'ARC03', 'QSA', 'QSB', 'QSC', 'QSD', 'DBA', 'CAR', 'NAN01', 'NAN02', 'NAN03', 'NAN04', 'NAN05', 'NAN06', 'NAN07', 'NAN08', 'NAN09', 'KNC', 'NEW01', 'LOG', 'AHS04', 'DEN01', 'DEN02', 'DEN03', 'AHS01', 'AHS02', 'AHS03', 'NUR01', 'NUR02', 'NUR03', 'PHP01', 'PHP02', 'PHP03', 'LAW', 'SOC', 'BEC', 'CWW', 'CEN01', 'CPB01', 'CPB02', 'OSP', 'CPB03', 'CPS', 'SSP', 'HPT', 'TFH01', 'TFH02', 'DWP', 'LMH01', 'LMH02', 'LMH03', 'LMH04', 'LMH05', 'LMH06', 'LMH07', 'LMH08', 'LMH09', 'NSU01', 'NSU02', 'NSU03', 'NSU04', 'NSU05', 'NSU06', 'NSU07', 'NSU08', 'NEW02', 'NUDS01', 'NUDS02', 'SER01', 'SER02', 'SER03', 'SER04', 'SER05', 'SER06', 'SER07', 'SER08', 'SER09', 'SER10', 'SER11', 'SER12', 'SER13', 'SER14', 'SER15', 'SER16', 'SER17', 'RLC', 'HWB', 'ENG10', 'WTP01', 'WTP02', 'WTP03', 'WTP04', 'WTP12', 'WTP05', 'WTP06', 'WTP07', 'WTP08', 'WTP09', 'WTP10', 'WTP11', 'RWB', 'TSI01', 'TSI02')
 group by rollup (o.name_th) order by o.name_th nulls last;
