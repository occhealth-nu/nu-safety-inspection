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

-- สถานะฐานข้อมูลสำหรับหน้า /setup-check (ตัวเลขสรุปเท่านั้น ไม่มีข้อมูลรายบุคคล)
-- ใช้ตรวจว่าเว็บบน Vercel เชื่อมกับโปรเจกต์ Supabase ที่นำเข้าข้อมูลแล้วจริง
create or replace function public.system_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'schema_building_locations', to_regprocedure('public.building_safety_overview(date,date,uuid)') is not null,
    'schema_building_details', exists (select 1 from information_schema.columns
                                        where table_schema = 'public' and table_name = 'buildings' and column_name = 'building_no'),
    'organizations', (select count(*) from public.organizations where is_active),
    'buildings', (select count(*) from public.buildings where is_active),
    'assets', (select count(*) from public.assets where status = 'active'),
    'users', (select count(*) from public.profiles where is_active),
    'demo_data', exists (select 1 from public.organizations where name_th like '%(ตัวอย่าง)')
                 or exists (select 1 from public.profiles where lower(email) like '%@demo.example.com'))
$$;
grant execute on function public.system_status() to anon, authenticated;

notify pgrst, 'reload schema';
