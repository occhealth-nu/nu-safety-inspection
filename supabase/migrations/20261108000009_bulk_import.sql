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
