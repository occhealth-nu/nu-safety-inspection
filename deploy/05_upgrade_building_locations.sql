-- =====================================================================
-- NU Safety Inspection — อัปเกรด: ระบบตรวจสอบความปลอดภัยอาคาร
--   (วิทยาเขต → โซน → อาคาร → ชั้น → ห้อง → จุดตรวจ + ผังชั้น + หมุดตำแหน่ง + พิกัด GPS)
--
-- ใช้กับฐานข้อมูลที่ติดตั้ง 01–04 ไปแล้ว (ระบบที่ใช้งานอยู่) — ข้อมูลเดิมไม่หาย
-- วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run
--   * รันซ้ำได้อย่างปลอดภัย (ถ้ารันไม่ครบเพราะหลุด ให้รันใหม่ทั้งไฟล์)
--   * ต้องเห็นข้อความ "Success. No rows returned" ด้านล่าง
-- ติดตั้งระบบใหม่ทั้งหมด: ใช้ 01_install_database.sql (รวมไฟล์นี้แล้ว) ไม่ต้องรันไฟล์นี้ซ้ำ
-- =====================================================================
-- =====================================================================
-- ระบบตรวจสอบความปลอดภัยอาคาร: ลำดับพื้นที่จากใหญ่ไปเล็ก + การระบุตำแหน่ง
--
--   วิทยาเขต/พื้นที่ตั้ง (campuses)
--     └ โซน/กลุ่มอาคาร (zones)                 ← ไม่บังคับ
--         └ อาคาร (buildings)  + พิกัด GPS
--             └ ชั้น (floors)  + ภาพผังชั้น (bucket "floor-plans")
--                 └ ห้อง/พื้นที่ (locations)
--                     └ จุดตรวจ/อุปกรณ์ (assets) + หมุดบนผังชั้น (plan_x, plan_y) + พิกัด GPS (ไม่บังคับ)
--                         └ ข้อบกพร่อง (findings) + หมุดตำแหน่งที่พบจริงบนผังชั้น
--
-- * หมุดบนผังเก็บเป็นร้อยละของความกว้าง/สูงภาพ (0–100) จึงไม่ขึ้นกับขนาดภาพหรือหน้าจอ
-- * พิกัดผู้ตรวจบันทึกครั้งเดียวขณะส่งผลตรวจ เพื่อยืนยันว่าตรวจหน้างานจริง (ปิดได้ในหน้าตั้งค่า)
-- * ตัวกรองแดชบอร์ดเพิ่ม p_campus / p_zone / p_floor ทุกฟังก์ชัน (ค่าเดิมยังเรียกได้เหมือนเดิม)
-- รันซ้ำได้ (idempotent) สำหรับฐานข้อมูลที่ติดตั้งแล้ว
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. วิทยาเขต และ โซน
-- ---------------------------------------------------------------------
create table if not exists public.campuses (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  address     text,
  latitude    numeric(9,6) check (latitude between -90 and 90),
  longitude   numeric(9,6) check (longitude between -180 and 180),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint campuses_latlng_pair check ((latitude is null) = (longitude is null))
);

create table if not exists public.zones (
  id          uuid primary key default gen_random_uuid(),
  campus_id   uuid not null references public.campuses(id) on delete restrict,
  code        text not null,
  name        text not null,
  description text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (campus_id, code)
);
create index if not exists zones_campus_idx on public.zones(campus_id);

drop trigger if exists campuses_touch on public.campuses;
create trigger campuses_touch before update on public.campuses for each row execute function app.touch_updated_at();
drop trigger if exists zones_touch on public.zones;
create trigger zones_touch before update on public.zones for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- 2. คอลัมน์ตำแหน่งในตารางเดิม
-- ---------------------------------------------------------------------
alter table public.buildings
  add column if not exists campus_id uuid references public.campuses(id) on delete restrict,
  add column if not exists zone_id   uuid references public.zones(id) on delete set null,
  add column if not exists latitude  numeric(9,6) check (latitude between -90 and 90),
  add column if not exists longitude numeric(9,6) check (longitude between -180 and 180),
  add column if not exists address   text;
create index if not exists buildings_campus_idx on public.buildings(campus_id);
create index if not exists buildings_zone_idx on public.buildings(zone_id);
do $$ begin
  alter table public.buildings add constraint buildings_latlng_pair check ((latitude is null) = (longitude is null));
exception when duplicate_object then null; end $$;

alter table public.floors
  add column if not exists plan_path       text,
  add column if not exists plan_updated_at timestamptz;

alter table public.assets
  add column if not exists plan_x    numeric(5,2) check (plan_x between 0 and 100),
  add column if not exists plan_y    numeric(5,2) check (plan_y between 0 and 100),
  add column if not exists latitude  numeric(9,6) check (latitude between -90 and 90),
  add column if not exists longitude numeric(9,6) check (longitude between -180 and 180);
do $$ begin
  alter table public.assets add constraint assets_pin_pair check ((plan_x is null) = (plan_y is null));
exception when duplicate_object then null; end $$;
do $$ begin
  -- หมุดบนผังต้องอ้างอิงชั้น
  alter table public.assets add constraint assets_pin_needs_floor check (plan_x is null or floor_id is not null);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.assets add constraint assets_latlng_pair check ((latitude is null) = (longitude is null));
exception when duplicate_object then null; end $$;

alter table public.findings
  add column if not exists plan_x        numeric(5,2) check (plan_x between 0 and 100),
  add column if not exists plan_y        numeric(5,2) check (plan_y between 0 and 100),
  add column if not exists location_note text;
do $$ begin
  alter table public.findings add constraint findings_pin_pair check ((plan_x is null) = (plan_y is null));
exception when duplicate_object then null; end $$;

alter table public.inspections
  add column if not exists geo_lat         numeric(9,6),
  add column if not exists geo_lng         numeric(9,6),
  add column if not exists geo_accuracy_m  numeric(8,1),
  add column if not exists geo_distance_m  numeric(10,1),
  add column if not exists geo_status      text check (geo_status in ('ok','far','no_reference','denied','unavailable','disabled')),
  add column if not exists geo_captured_at timestamptz;

alter table public.app_settings
  add column if not exists geo_capture_enabled boolean not null default true,
  add column if not exists geo_radius_m        int not null default 300 check (geo_radius_m between 20 and 5000);

-- อาคารที่ระบุโซน: วิทยาเขตต้องตรงกับวิทยาเขตของโซน (เติมให้อัตโนมัติ)
create or replace function app.buildings_scope_guard() returns trigger
language plpgsql as $$
declare v_campus uuid;
begin
  if new.zone_id is not null then
    select campus_id into v_campus from public.zones where id = new.zone_id;
    if new.campus_id is null then new.campus_id := v_campus;
    elsif new.campus_id <> v_campus then raise exception 'โซนที่เลือกไม่อยู่ในวิทยาเขตนี้';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists buildings_scope_guard on public.buildings;
create trigger buildings_scope_guard before insert or update on public.buildings
  for each row execute function app.buildings_scope_guard();

-- ประวัติการใช้งาน
do $$
declare t text;
begin
  foreach t in array array['campuses','zones'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function app.audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. สิทธิ์ (RLS)
-- ---------------------------------------------------------------------
alter table public.campuses enable row level security;
alter table public.zones enable row level security;
grant select, insert, update, delete on public.campuses, public.zones to authenticated;
revoke all on public.campuses, public.zones from anon;

drop policy if exists campuses_read on public.campuses;
drop policy if exists campuses_write on public.campuses;
drop policy if exists zones_read on public.zones;
drop policy if exists zones_write on public.zones;
create policy campuses_read on public.campuses for select to authenticated using (true);
create policy campuses_write on public.campuses for all to authenticated
  using ((select app.is_central())) with check ((select app.is_central()));
create policy zones_read on public.zones for select to authenticated using (true);
create policy zones_write on public.zones for all to authenticated
  using ((select app.is_central())) with check ((select app.is_central()));

-- มองเห็นอาคาร (ผังชั้น): มีสิทธิ์ในหน่วยงานเจ้าของอาคาร หรือมองเห็นจุดตรวจใดในอาคารนั้น
create or replace function app.can_view_building(p_building uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.buildings b where b.id = p_building and app.can_view_org(b.organization_id))
      or exists (select 1 from public.assets a where a.building_id = p_building and a.organization_id = any(app.visible_org_ids()))
$$;
create or replace function app.can_manage_building(p_building uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.buildings b where b.id = p_building and app.can_manage_org(b.organization_id))
$$;
grant execute on function app.can_view_building(uuid), app.can_manage_building(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. ภาพผังชั้น: bucket private "floor-plans" path = floor/{floor_id}/{uuid}.{ext}
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('floor-plans', 'floor-plans', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false;

create or replace function app.floor_of_plan_path(p_name text) returns uuid
language plpgsql immutable as $$
declare parts text[] := string_to_array(p_name, '/');
begin
  if parts[1] <> 'floor' or array_length(parts, 1) <> 3 or p_name like '%..%' then return null; end if;
  return parts[2]::uuid;
exception when others then return null;
end $$;

create or replace function app.floor_plan_can_read(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.floors f where f.id = app.floor_of_plan_path(p_name) and app.can_view_building(f.building_id))
$$;
create or replace function app.floor_plan_can_write(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.floors f where f.id = app.floor_of_plan_path(p_name) and app.can_manage_building(f.building_id))
$$;
grant execute on function app.floor_of_plan_path(text), app.floor_plan_can_read(text), app.floor_plan_can_write(text) to authenticated;

drop policy if exists "nu_floor_plans_read" on storage.objects;
drop policy if exists "nu_floor_plans_insert" on storage.objects;
drop policy if exists "nu_floor_plans_delete" on storage.objects;
create policy "nu_floor_plans_read" on storage.objects for select to authenticated
  using (bucket_id = 'floor-plans' and app.floor_plan_can_read(name));
create policy "nu_floor_plans_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'floor-plans' and app.floor_plan_can_write(name));
create policy "nu_floor_plans_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'floor-plans' and app.floor_plan_can_write(name));

-- ---------------------------------------------------------------------
-- 5. RPC ระบุตำแหน่ง
-- ---------------------------------------------------------------------
-- ระยะทางบนผิวโลก (เมตร) แบบ haversine
create or replace function app.distance_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric) returns numeric
language sql immutable as $$
  select round((2 * 6371000 * asin(sqrt(
           power(sin(radians((lat2 - lat1)::float8) / 2), 2)
         + cos(radians(lat1::float8)) * cos(radians(lat2::float8)) * power(sin(radians((lng2 - lng1)::float8) / 2), 2))))::numeric, 1)
$$;

-- ตั้ง/ล้างภาพผังชั้น (ไฟล์ต้องอยู่ใต้ floor/{floor_id}/ และผู้เรียกต้องดูแลอาคารนั้น)
create or replace function public.set_floor_plan(p_floor_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); f public.floors;
begin
  select * into f from public.floors where id = p_floor_id;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบชั้น'); end if;
  if not app.can_manage_building(f.building_id) then perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์จัดการผังชั้นของอาคารนี้'); end if;
  if p_path is not null and app.floor_of_plan_path(p_path) is distinct from p_floor_id then
    perform app.fail('INVALID_INPUT', 'ไฟล์ผังชั้นไม่ถูกต้อง');
  end if;
  update public.floors set plan_path = p_path, plan_updated_at = case when p_path is null then null else now() end where id = p_floor_id;
end $$;

-- ปักหมุดตำแหน่งข้อบกพร่องบนผังชั้น (ผู้ดูแลหน่วยงาน ผู้รับผิดชอบ หรือผู้ตรวจที่พบ)
create or replace function public.set_finding_pin(p_finding_id uuid, p_x numeric, p_y numeric, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); f public.findings; v_floor uuid; v_inspector uuid;
begin
  select * into f from public.findings where id = p_finding_id;
  if not found or not app.can_view_finding(p_finding_id) then perform app.fail('NOT_FOUND', 'ไม่พบข้อบกพร่อง'); end if;
  select inspector_id into v_inspector from public.inspections where id = f.inspection_id;
  if not (app.can_manage_org(f.organization_id) or coalesce(f.assignee_id = v_me, false) or coalesce(v_inspector = v_me, false)) then
    perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์ระบุตำแหน่งข้อบกพร่องนี้');
  end if;
  if f.status = 'closed' then perform app.fail('INVALID_STATE', 'ข้อบกพร่องปิดงานแล้ว แก้ไขตำแหน่งไม่ได้'); end if;
  select floor_id into v_floor from public.assets where id = f.asset_id;
  if p_x is not null and v_floor is null then perform app.fail('INVALID_INPUT', 'จุดตรวจนี้ยังไม่ได้ระบุชั้น จึงปักหมุดบนผังไม่ได้'); end if;
  if (p_x is null) <> (p_y is null) or p_x not between 0 and 100 or p_y not between 0 and 100 then
    perform app.fail('INVALID_INPUT', 'ตำแหน่งบนผังไม่ถูกต้อง');
  end if;
  update public.findings set plan_x = p_x, plan_y = p_y, location_note = nullif(trim(coalesce(p_note, '')), '') where id = p_finding_id;
  insert into public.corrective_actions (finding_id, actor_id, action_type, note)
  values (p_finding_id, v_me, 'comment', 'ระบุตำแหน่งบนผังชั้น' || coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), ''));
end $$;

-- บันทึกพิกัดผู้ตรวจขณะส่งผล (เฉพาะฉบับร่างของตนเอง) และคำนวณระยะห่างจากจุดตรวจ/อาคาร
create or replace function public.record_inspection_location(p_inspection_id uuid, p_lat numeric, p_lng numeric,
                                                             p_accuracy numeric default null, p_status text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := app.require_login(); i public.inspections; a public.assets; b public.buildings;
  v_ref_lat numeric; v_ref_lng numeric; v_dist numeric; v_status text; v_radius int; v_enabled boolean;
begin
  select * into i from public.inspections where id = p_inspection_id for update;
  if not found or i.inspector_id <> v_me then perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์บันทึกตำแหน่งของการตรวจนี้'); end if;
  if i.status <> 'draft' then perform app.fail('ALREADY_SUBMITTED', 'ผลตรวจนี้ส่งแล้ว ไม่สามารถแก้ไขตำแหน่งได้'); end if;
  select geo_capture_enabled, geo_radius_m into v_enabled, v_radius from public.app_settings where id = 1;
  if not coalesce(v_enabled, true) then
    update public.inspections set geo_lat = null, geo_lng = null, geo_accuracy_m = null, geo_distance_m = null,
           geo_status = 'disabled', geo_captured_at = now() where id = i.id;
    return jsonb_build_object('status', 'disabled');
  end if;

  if p_lat is null or p_lng is null then
    v_status := case when p_status in ('denied','unavailable') then p_status else 'unavailable' end;
    update public.inspections set geo_lat = null, geo_lng = null, geo_accuracy_m = null, geo_distance_m = null,
           geo_status = v_status, geo_captured_at = now() where id = i.id;
    return jsonb_build_object('status', v_status);
  end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then perform app.fail('INVALID_INPUT', 'พิกัดไม่ถูกต้อง'); end if;

  select * into a from public.assets where id = i.asset_id;
  select * into b from public.buildings where id = a.building_id;
  v_ref_lat := coalesce(a.latitude, b.latitude); v_ref_lng := coalesce(a.longitude, b.longitude);
  if v_ref_lat is null then
    v_status := 'no_reference';
  else
    v_dist := app.distance_m(p_lat, p_lng, v_ref_lat, v_ref_lng);
    -- เผื่อความคลาดเคลื่อนของ GPS (สูงสุด 200 ม.)
    v_status := case when v_dist <= v_radius + least(coalesce(p_accuracy, 0), 200) then 'ok' else 'far' end;
  end if;
  update public.inspections set geo_lat = round(p_lat, 6), geo_lng = round(p_lng, 6), geo_accuracy_m = round(p_accuracy, 1),
         geo_distance_m = v_dist, geo_status = v_status, geo_captured_at = now() where id = i.id;
  return jsonb_build_object('status', v_status, 'distance_m', v_dist, 'radius_m', v_radius);
end $$;

grant execute on function public.set_floor_plan(uuid, text), public.set_finding_pin(uuid, numeric, numeric, text),
  public.record_inspection_location(uuid, numeric, numeric, numeric, text) to authenticated;
revoke execute on function public.set_floor_plan(uuid, text), public.set_finding_pin(uuid, numeric, numeric, text),
  public.record_inspection_location(uuid, numeric, numeric, numeric, text) from public, anon;

-- ข้อบกพร่องใหม่: ใช้ตำแหน่งหมุดของจุดตรวจเป็นค่าเริ่มต้น (แก้ภายหลังด้วย set_finding_pin)
create or replace function app.findings_default_pin() returns trigger
language plpgsql as $$
begin
  if new.plan_x is null then
    select a.plan_x, a.plan_y into new.plan_x, new.plan_y from public.assets a where a.id = new.asset_id;
  end if;
  return new;
end $$;
drop trigger if exists findings_default_pin on public.findings;
create trigger findings_default_pin before insert on public.findings for each row execute function app.findings_default_pin();

-- ---------------------------------------------------------------------
-- 6. Views: เพิ่มข้อมูลสโคปพื้นที่ (วิทยาเขต → โซน → อาคาร → ชั้น → ห้อง) และหมุดบนผัง
--    (สร้างใหม่เพราะ f.* / i.* มีคอลัมน์เพิ่ม — ฟังก์ชันแดชบอร์ดถูกสร้างใหม่ด้านล่าง)
-- ---------------------------------------------------------------------
drop view if exists public.v_inspection_tasks, public.v_findings, public.v_assets, public.v_inspections;

create view public.v_inspection_tasks with (security_invoker = true) as
select t.id, t.plan_id, t.asset_id, t.organization_id, t.template_id, t.assignee_id,
       t.period_start, t.due_on, t.status, t.completed_inspection_id, t.completed_at, t.created_at,
       a.code as asset_code, a.name as asset_name, a.building_id, a.floor_id, a.location_detail,
       a.asset_type_id, aty.category, aty.name as asset_type_name,
       b.name as building_name, o.name_th as organization_name, o.ancestors as org_ancestors,
       p.full_name as assignee_name, ct.name as template_name,
       i.overall_result, i.fail_count, i.score_pct,
       case when t.status = 'completed' then 'done'
            when t.status = 'cancelled' then 'cancelled'
            when t.due_on < app.today() then 'overdue'
            when t.period_start <= app.today() then 'pending'
            else 'upcoming' end as display_status,
       (t.status = 'completed' and (t.completed_at at time zone 'Asia/Bangkok')::date > t.due_on) as completed_late,
       b.campus_id, b.zone_id, a.location_id
  from public.inspection_tasks t
  join public.assets a on a.id = t.asset_id
  join public.asset_types aty on aty.id = a.asset_type_id
  join public.buildings b on b.id = a.building_id
  join public.organizations o on o.id = t.organization_id
  join public.checklist_templates ct on ct.id = t.template_id
  left join public.profiles p on p.id = t.assignee_id
  left join public.inspections i on i.id = t.completed_inspection_id;

create view public.v_findings with (security_invoker = true) as
select f.*,
       a.code as asset_code, a.name as asset_name, a.building_id, a.location_detail,
       aty.category, aty.name as asset_type_name, b.name as building_name,
       o.name_th as organization_name, o.ancestors as org_ancestors,
       p.full_name as assignee_name, ro.name_th as responsible_org_name,
       case when f.status in ('open','assigned') then 'waiting'
            when f.status = 'in_progress' then 'in_progress'
            when f.status = 'pending_verification' then 'pending_verification'
            else 'closed' end as remediation_group,
       (f.status in ('assigned','in_progress') and f.due_on < app.today()) as is_overdue,
       (f.status <> 'closed' and f.severity in ('high','critical')) as is_urgent_open,
       b.campus_id, b.zone_id, a.floor_id, a.location_id, fl.name as floor_name, l.name as location_name,
       a.plan_x as asset_plan_x, a.plan_y as asset_plan_y
  from public.findings f
  join public.assets a on a.id = f.asset_id
  join public.asset_types aty on aty.id = a.asset_type_id
  join public.buildings b on b.id = a.building_id
  join public.organizations o on o.id = f.organization_id
  left join public.floors fl on fl.id = a.floor_id
  left join public.locations l on l.id = a.location_id
  left join public.profiles p on p.id = f.assignee_id
  left join public.organizations ro on ro.id = f.responsible_org_id;

create view public.v_assets with (security_invoker = true) as
select a.*, aty.name as asset_type_name, aty.category, aty.tracks_expiry,
       b.name as building_name, fl.name as floor_name, l.name as location_name,
       o.name_th as organization_name, o.ancestors as org_ancestors, p.full_name as responsible_name,
       (select count(*) from public.findings f where f.asset_id = a.id and f.status <> 'closed') as open_findings,
       b.code as building_code, b.campus_id, b.zone_id, c.name as campus_name, z.name as zone_name, fl.level as floor_level,
       (select count(*) from public.findings f where f.asset_id = a.id and f.status <> 'closed' and f.severity in ('high','critical')) as urgent_findings,
       (select count(*) from public.inspection_tasks t where t.asset_id = a.id and t.status = 'open' and t.due_on < app.today()) as overdue_tasks
  from public.assets a
  join public.asset_types aty on aty.id = a.asset_type_id
  join public.buildings b on b.id = a.building_id
  join public.organizations o on o.id = a.organization_id
  left join public.campuses c on c.id = b.campus_id
  left join public.zones z on z.id = b.zone_id
  left join public.floors fl on fl.id = a.floor_id
  left join public.locations l on l.id = a.location_id
  left join public.profiles p on p.id = a.responsible_user_id;

create view public.v_inspections with (security_invoker = true) as
select i.*, a.code as asset_code, a.name as asset_name, a.building_id, aty.category,
       b.name as building_name, o.name_th as organization_name, o.ancestors as org_ancestors,
       p.full_name as inspector_name, ct.name as template_name, cv.version_no, cv.is_expert_review_draft,
       b.campus_id, b.zone_id, a.floor_id
  from public.inspections i
  join public.assets a on a.id = i.asset_id
  join public.asset_types aty on aty.id = a.asset_type_id
  join public.buildings b on b.id = a.building_id
  join public.organizations o on o.id = i.organization_id
  join public.checklist_versions cv on cv.id = i.checklist_version_id
  join public.checklist_templates ct on ct.id = cv.template_id
  left join public.profiles p on p.id = i.inspector_id;

grant select on public.v_inspection_tasks, public.v_findings, public.v_assets, public.v_inspections to authenticated;
revoke all on public.v_inspection_tasks, public.v_findings, public.v_assets, public.v_inspections from anon;

-- ---------------------------------------------------------------------
-- 7. ฟังก์ชันแดชบอร์ด: เพิ่มตัวกรองสโคป p_campus / p_zone / p_floor
-- ---------------------------------------------------------------------
drop function if exists public.dashboard_kpis(date, date, uuid, uuid, text, uuid);
drop function if exists public.dashboard_annual(int, text, uuid, uuid, text, uuid);
drop function if exists public.dashboard_trend(date, date, uuid, uuid, text, uuid);
drop function if exists public.dashboard_findings_by_category(date, date, uuid, uuid, text, uuid);

-- KPI หลัก (นิยามสูตรอยู่ใน docs/KPI_DEFINITIONS.md)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_kpis(
  p_from date, p_to date,
  p_org uuid default null, p_building uuid default null, p_category text default null, p_assignee uuid default null,
  p_campus uuid default null, p_zone uuid default null, p_floor uuid default null)
returns jsonb
language sql stable security invoker set search_path = public as $$
with
tasks as (
  select * from public.v_inspection_tasks t
   where t.status <> 'cancelled' and t.due_on between p_from and p_to
     and (p_org is null or p_org = any(t.org_ancestors))
     and (p_building is null or t.building_id = p_building)
     and (p_campus is null or t.campus_id = p_campus) and (p_zone is null or t.zone_id = p_zone) and (p_floor is null or t.floor_id = p_floor)
     and (p_category is null or t.category = p_category)
     and (p_assignee is null or t.assignee_id = p_assignee)
),
resp as (
  select r.result, i.id inspection_id, i.fail_count
    from public.v_inspections i
    join public.inspection_responses r on r.inspection_id = i.id
   where i.status = 'submitted'
     and (i.submitted_at at time zone 'Asia/Bangkok')::date between p_from and p_to
     and (p_org is null or p_org = any(i.org_ancestors))
     and (p_building is null or i.building_id = p_building)
     and (p_campus is null or i.campus_id = p_campus) and (p_zone is null or i.zone_id = p_zone) and (p_floor is null or i.floor_id = p_floor)
     and (p_category is null or i.category = p_category)
     and (p_assignee is null or i.inspector_id = p_assignee)
),
fnd as (
  select * from public.v_findings f
   where (p_org is null or p_org = any(f.org_ancestors))
     and (p_building is null or f.building_id = p_building)
     and (p_campus is null or f.campus_id = p_campus) and (p_zone is null or f.zone_id = p_zone) and (p_floor is null or f.floor_id = p_floor)
     and (p_category is null or f.category = p_category)
     and (p_assignee is null or f.assignee_id = p_assignee)
),
closed_period as (
  select * from fnd where status = 'closed' and (closed_at at time zone 'Asia/Bangkok')::date between p_from and p_to
)
select jsonb_build_object(
  'generated_at', now(),
  'period', jsonb_build_object('from', p_from, 'to', p_to),
  'assets_active', (select count(*) from public.v_assets a
                     where a.status = 'active'
                       and (p_org is null or p_org = any(a.org_ancestors))
                       and (p_building is null or a.building_id = p_building)
     and (p_campus is null or a.campus_id = p_campus) and (p_zone is null or a.zone_id = p_zone) and (p_floor is null or a.floor_id = p_floor)
                       and (p_category is null or a.category = p_category)),
  'tasks', (select jsonb_build_object(
      'due', count(*),
      'done', count(*) filter (where display_status = 'done'),
      'done_late', count(*) filter (where completed_late),
      'not_done', count(*) filter (where display_status <> 'done'),
      'upcoming', count(*) filter (where display_status = 'upcoming'),
      'pending', count(*) filter (where display_status = 'pending'),
      'overdue', count(*) filter (where display_status = 'overdue'),
      'coverage_pct', case when count(*) > 0
                           then round(count(*) filter (where display_status = 'done') * 100.0 / count(*), 1) end)
     from tasks),
  'results', (select jsonb_build_object(
      'pass', count(*) filter (where result = 'pass'),
      'fail', count(*) filter (where result = 'fail'),
      'na', count(*) filter (where result = 'na'),
      'pass_rate_pct', case when count(*) filter (where result in ('pass','fail')) > 0
                            then round(count(*) filter (where result = 'pass') * 100.0
                                       / count(*) filter (where result in ('pass','fail')), 1) end,
      'inspections', count(distinct inspection_id),
      'inspections_with_findings', count(distinct inspection_id) filter (where fail_count > 0))
     from resp),
  'findings', (select jsonb_build_object(
      'open', count(*) filter (where status <> 'closed'),
      'urgent_open', count(*) filter (where is_urgent_open),
      'overdue', count(*) filter (where is_overdue),
      'waiting', count(*) filter (where remediation_group = 'waiting'),
      'unassigned', count(*) filter (where status = 'open'),
      'in_progress', count(*) filter (where remediation_group = 'in_progress'),
      'pending_verification', count(*) filter (where remediation_group = 'pending_verification'),
      'recurring_open', count(*) filter (where status <> 'closed' and recurrence_of is not null),
      'new_in_period', count(*) filter (where (created_at at time zone 'Asia/Bangkok')::date between p_from and p_to))
     from fnd),
  'closure', (select jsonb_build_object(
      'closed', count(*),
      'closed_with_due', count(*) filter (where due_on is not null),
      'closed_on_time', count(*) filter (where due_on is not null and (closed_at at time zone 'Asia/Bangkok')::date <= due_on),
      'on_time_pct', case when count(*) filter (where due_on is not null) > 0
                          then round(count(*) filter (where due_on is not null and (closed_at at time zone 'Asia/Bangkok')::date <= due_on)
                                     * 100.0 / count(*) filter (where due_on is not null), 1) end)
     from closed_period)
)
$$;

-- ตารางตรวจรายปี ม.ค.–ธ.ค.: จำนวนตรวจแล้ว / ถึงกำหนด ต่อเดือน (ปี ค.ศ. ใน parameter แสดงผลเป็น พ.ศ. ที่หน้าจอ)
create or replace function public.dashboard_annual(
  p_year int, p_group text default 'category',
  p_org uuid default null, p_building uuid default null, p_category text default null, p_assignee uuid default null,
  p_campus uuid default null, p_zone uuid default null, p_floor uuid default null)
returns table (group_key text, group_label text, month int, due bigint, done bigint, overdue bigint)
language sql stable security invoker set search_path = public as $$
  select case when p_group = 'asset' then t.asset_id::text else t.category end,
         case when p_group = 'asset' then t.asset_code || ' ' || t.asset_name else t.category end,
         extract(month from t.due_on)::int,
         count(*), count(*) filter (where t.display_status = 'done'), count(*) filter (where t.display_status = 'overdue')
    from public.v_inspection_tasks t
   where t.status <> 'cancelled'
     and t.due_on between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
     and (p_org is null or p_org = any(t.org_ancestors))
     and (p_building is null or t.building_id = p_building)
     and (p_campus is null or t.campus_id = p_campus) and (p_zone is null or t.zone_id = p_zone) and (p_floor is null or t.floor_id = p_floor)
     and (p_category is null or t.category = p_category)
     and (p_assignee is null or t.assignee_id = p_assignee)
   group by 1, 2, 3
   order by 2, 3
$$;

-- แนวโน้มรายเดือน
create or replace function public.dashboard_trend(
  p_from date, p_to date,
  p_org uuid default null, p_building uuid default null, p_category text default null, p_assignee uuid default null,
  p_campus uuid default null, p_zone uuid default null, p_floor uuid default null)
returns table (month_start date, tasks_due bigint, tasks_done bigint, findings_opened bigint, findings_closed bigint)
language sql stable security invoker set search_path = public as $$
  with months as (
    select generate_series(date_trunc('month', p_from)::date, date_trunc('month', p_to)::date, interval '1 month')::date m
  ),
  t as (
    select date_trunc('month', due_on)::date m, count(*) due, count(*) filter (where display_status = 'done') done
      from public.v_inspection_tasks
     where status <> 'cancelled' and due_on between date_trunc('month', p_from)::date and p_to
       and (p_org is null or p_org = any(org_ancestors)) and (p_building is null or building_id = p_building)
     and (p_campus is null or campus_id = p_campus) and (p_zone is null or zone_id = p_zone) and (p_floor is null or floor_id = p_floor)
       and (p_category is null or category = p_category) and (p_assignee is null or assignee_id = p_assignee)
     group by 1
  ),
  f as (
    select date_trunc('month', (created_at at time zone 'Asia/Bangkok'))::date m, count(*) n
      from public.v_findings
     where (p_org is null or p_org = any(org_ancestors)) and (p_building is null or building_id = p_building)
     and (p_campus is null or campus_id = p_campus) and (p_zone is null or zone_id = p_zone) and (p_floor is null or floor_id = p_floor)
       and (p_category is null or category = p_category) and (p_assignee is null or assignee_id = p_assignee)
     group by 1
  ),
  c as (
    select date_trunc('month', (closed_at at time zone 'Asia/Bangkok'))::date m, count(*) n
      from public.v_findings
     where status = 'closed'
       and (p_org is null or p_org = any(org_ancestors)) and (p_building is null or building_id = p_building)
     and (p_campus is null or campus_id = p_campus) and (p_zone is null or zone_id = p_zone) and (p_floor is null or floor_id = p_floor)
       and (p_category is null or category = p_category) and (p_assignee is null or assignee_id = p_assignee)
     group by 1
  )
  select months.m, coalesce(t.due, 0), coalesce(t.done, 0), coalesce(f.n, 0), coalesce(c.n, 0)
    from months left join t on t.m = months.m left join f on f.m = months.m left join c on c.m = months.m
   order by months.m
$$;

-- ข้อบกพร่องแยกประเภท (สร้างในช่วงเวลา)
create or replace function public.dashboard_findings_by_category(
  p_from date, p_to date,
  p_org uuid default null, p_building uuid default null, p_category text default null, p_assignee uuid default null,
  p_campus uuid default null, p_zone uuid default null, p_floor uuid default null)
returns table (category text, total bigint, open bigint, closed bigint, urgent bigint)
language sql stable security invoker set search_path = public as $$
  select category, count(*), count(*) filter (where status <> 'closed'), count(*) filter (where status = 'closed'),
         count(*) filter (where severity in ('high','critical'))
    from public.v_findings
   where (created_at at time zone 'Asia/Bangkok')::date between p_from and p_to
     and (p_org is null or p_org = any(org_ancestors)) and (p_building is null or building_id = p_building)
     and (p_campus is null or campus_id = p_campus) and (p_zone is null or zone_id = p_zone) and (p_floor is null or floor_id = p_floor)
     and (p_category is null or category = p_category) and (p_assignee is null or assignee_id = p_assignee)
   group by category
   order by count(*) desc
$$;


grant execute on function public.dashboard_kpis(date, date, uuid, uuid, text, uuid, uuid, uuid, uuid),
  public.dashboard_annual(int, text, uuid, uuid, text, uuid, uuid, uuid, uuid),
  public.dashboard_trend(date, date, uuid, uuid, text, uuid, uuid, uuid, uuid),
  public.dashboard_findings_by_category(date, date, uuid, uuid, text, uuid, uuid, uuid, uuid) to authenticated;
revoke execute on function public.dashboard_kpis(date, date, uuid, uuid, text, uuid, uuid, uuid, uuid),
  public.dashboard_annual(int, text, uuid, uuid, text, uuid, uuid, uuid, uuid),
  public.dashboard_trend(date, date, uuid, uuid, text, uuid, uuid, uuid, uuid),
  public.dashboard_findings_by_category(date, date, uuid, uuid, text, uuid, uuid, uuid, uuid) from public, anon;

-- ---------------------------------------------------------------------
-- 8. ภาพรวมความปลอดภัยรายอาคาร (ผ่าน RLS: นับเฉพาะข้อมูลที่ผู้ดูมีสิทธิ์)
-- ---------------------------------------------------------------------
create or replace function public.building_safety_overview(
  p_from date, p_to date, p_campus uuid default null, p_zone uuid default null, p_org uuid default null)
returns table (building_id uuid, building_code text, building_name text, organization_id uuid,
               campus_id uuid, campus_name text, zone_id uuid, zone_name text,
               latitude numeric, longitude numeric, floors bigint, floors_with_plan bigint,
               assets_active bigint, assets_pinned bigint, tasks_due bigint, tasks_done bigint, tasks_overdue bigint,
               findings_open bigint, findings_urgent bigint, last_inspected_at timestamptz)
language sql stable security invoker set search_path = public as $$
  with a as (
    select * from public.v_assets va
     where va.status = 'active' and (p_org is null or p_org = any(va.org_ancestors))
  ), t as (
    select vt.building_id, count(*) due, count(*) filter (where vt.display_status = 'done') done,
           count(*) filter (where vt.display_status = 'overdue') overdue
      from public.v_inspection_tasks vt
     where vt.status <> 'cancelled' and vt.due_on between p_from and p_to
       and (p_org is null or p_org = any(vt.org_ancestors))
     group by vt.building_id
  ), f as (
    select vf.building_id, count(*) filter (where vf.status <> 'closed') open_n,
           count(*) filter (where vf.is_urgent_open) urgent_n
      from public.v_findings vf
     where (p_org is null or p_org = any(vf.org_ancestors))
     group by vf.building_id
  )
  select b.id, b.code, b.name, b.organization_id, b.campus_id, c.name, b.zone_id, z.name, b.latitude, b.longitude,
         (select count(*) from public.floors fl where fl.building_id = b.id),
         (select count(*) from public.floors fl where fl.building_id = b.id and fl.plan_path is not null),
         (select count(*) from a where a.building_id = b.id),
         (select count(*) from a where a.building_id = b.id and a.plan_x is not null),
         coalesce(t.due, 0), coalesce(t.done, 0), coalesce(t.overdue, 0),
         coalesce(f.open_n, 0), coalesce(f.urgent_n, 0),
         (select max(a.last_inspected_at) from a where a.building_id = b.id)
    from public.buildings b
    left join public.campuses c on c.id = b.campus_id
    left join public.zones z on z.id = b.zone_id
    left join t on t.building_id = b.id
    left join f on f.building_id = b.id
   where b.is_active
     and (p_campus is null or b.campus_id = p_campus)
     and (p_zone is null or b.zone_id = p_zone)
     and (exists (select 1 from a where a.building_id = b.id) or app.can_view_building(b.id))
     and (p_org is null or exists (select 1 from a where a.building_id = b.id) or b.organization_id = p_org)
   order by c.sort_order nulls last, c.name nulls last, z.sort_order nulls last, z.name nulls last, b.code
$$;
grant execute on function public.building_safety_overview(date, date, uuid, uuid, uuid) to authenticated;
revoke execute on function public.building_safety_overview(date, date, uuid, uuid, uuid) from public, anon;

-- ---------------------------------------------------------------------
-- ข้อมูลตั้งต้น: วิทยาเขตหลัก (แก้ชื่อ/พิกัดภายหลังได้ที่ ตั้งค่าระบบ › สถานที่)
-- อาคารเดิมที่ยังไม่ระบุวิทยาเขต จะถูกจัดเข้าวิทยาเขตหลักให้
-- ---------------------------------------------------------------------
insert into public.campuses (code, name, sort_order)
select 'MAIN', 'วิทยาเขตหลัก (แก้ไขชื่อได้)', 1
 where not exists (select 1 from public.campuses);
update public.buildings set campus_id = (select id from public.campuses order by sort_order, created_at limit 1)
 where campus_id is null;
