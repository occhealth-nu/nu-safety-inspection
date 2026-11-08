-- =====================================================================
-- เครื่องมือเตรียมข้อมูลพร้อมใช้ (ใช้ใน Supabase SQL Editor เท่านั้น)
--   app.generate_plan_tasks   — สร้างงานตรวจตามรอบ (แกนกลางของ generate_inspection_tasks ไม่ตรวจสิทธิ์)
--   app.import_asset          — เพิ่มจุดตรวจด้วยรหัสอาคาร/ชั้น/ห้อง
--   app.import_plan           — เพิ่มแผนการตรวจของหน่วยงาน แล้วสร้างงานตรวจทันที
-- รันซ้ำได้ (idempotent)
-- =====================================================================

create or replace function app.generate_plan_tasks(p_plan_id uuid, p_until date default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  p public.inspection_plans;
  d date; v_next date; v_due date; v_until date; v_total int := 0; n int; v_guard int := 0;
begin
  select * into p from public.inspection_plans where id = p_plan_id;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบแผนการตรวจ'); end if;
  if not p.is_active then perform app.fail('INVALID_STATE', 'แผนการตรวจนี้ปิดใช้งานแล้ว'); end if;
  v_until := coalesce(p_until, (date_trunc('year', app.today()) + interval '1 year - 1 day')::date);
  v_until := least(v_until, coalesce(p.end_on, v_until), app.today() + 400);
  d := p.start_on;
  while d <= v_until loop
    v_guard := v_guard + 1;
    if v_guard > 800 then exit; end if;
    v_next := app.next_period(d, p.frequency, p.custom_interval_days);
    v_due := case when p.due_within_days is null then v_next - 1
                  else least(d + p.due_within_days - 1, greatest(v_next - 1, d)) end;
    insert into public.inspection_tasks (plan_id, asset_id, organization_id, template_id, assignee_id, period_start, due_on)
    select p.id, a.id, a.organization_id, p.template_id, p.default_inspector_id, d, v_due
      from public.assets a join public.organizations o on o.id = a.organization_id
     where a.status = 'active'
       and p.organization_id = any(o.ancestors)
       and (p.building_id is null or a.building_id = p.building_id)
       and (p.asset_type_id is null or a.asset_type_id = p.asset_type_id)
    on conflict (plan_id, asset_id, period_start) where plan_id is not null do nothing;
    get diagnostics n = row_count;
    v_total := v_total + n;
    d := v_next;
  end loop;
  update public.assets a set next_due_on = t.next_due
    from (select asset_id, min(due_on) next_due from public.inspection_tasks
           where status = 'open' and plan_id = p.id group by asset_id) t
   where a.id = t.asset_id and (a.next_due_on is null or a.next_due_on > t.next_due or a.next_due_on < app.today());
  return v_total;
end $$;
revoke execute on function app.generate_plan_tasks(uuid, date) from public, anon, authenticated;

-- ตัวที่เรียกจากเว็บ: ตรวจสิทธิ์ก่อน แล้วใช้แกนกลางเดียวกัน
create or replace function public.generate_inspection_tasks(p_plan_id uuid, p_until date default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); v_org uuid;
begin
  select organization_id into v_org from public.inspection_plans where id = p_plan_id;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบแผนการตรวจ'); end if;
  if not app.can_manage_org(v_org) then perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์จัดการแผนการตรวจของหน่วยงานนี้'); end if;
  return app.generate_plan_tasks(p_plan_id, p_until);
end $$;

-- ---------- จุดตรวจ ----------
create or replace function app.import_asset(p_code text, p_name text, p_type text, p_building text, p_floor text,
                                            p_location text default null, p_detail text default null,
                                            p_notes text default null) returns text
language plpgsql security definer set search_path = public as $$
declare b public.buildings; v_type public.asset_types; v_floor uuid; v_loc uuid; v_fname text;
begin
  select * into b from public.buildings where upper(code) = upper(btrim(p_building));
  if not found then raise exception 'ไม่พบอาคารรหัส "%"', p_building; end if;
  select * into v_type from public.asset_types where upper(code) = upper(btrim(p_type));
  if not found then raise exception 'ไม่พบประเภทจุดตรวจ "%" (FE, FH, EL, EX, FA, EE, SP, LAB)', p_type; end if;
  v_fname := btrim(p_floor);
  if v_fname ~ '^[0-9]+$' then v_fname := 'ชั้น ' || v_fname; end if;
  select id into v_floor from public.floors where building_id = b.id and name = v_fname;
  if v_floor is null then raise exception 'ไม่พบ "%" ในอาคาร %', v_fname, b.code; end if;
  if nullif(btrim(p_location), '') is not null then
    select id into v_loc from public.locations where floor_id = v_floor and name = btrim(p_location);
    if v_loc is null then raise exception 'ไม่พบห้อง/พื้นที่ "%" ใน % %', p_location, b.code, v_fname; end if;
  end if;
  if exists (select 1 from public.assets where upper(code) = upper(btrim(p_code))) then
    return 'มีอยู่แล้ว: ' || upper(btrim(p_code));
  end if;
  insert into public.assets (code, name, asset_type_id, organization_id, building_id, floor_id, location_id,
                             location_detail, frequency, status, notes)
  values (upper(btrim(p_code)), btrim(p_name), v_type.id, b.organization_id, b.id, v_floor, v_loc,
          nullif(btrim(p_detail), ''), v_type.default_frequency, 'active', nullif(btrim(p_notes), ''));
  return 'เพิ่มแล้ว: ' || upper(btrim(p_code)) || ' ' || btrim(p_name);
end $$;

-- ---------- แผนการตรวจ ----------
-- ครอบคลุมจุดตรวจทุกจุดของประเภทนี้ในหน่วยงาน (และหน่วยงานย่อย) หรือเฉพาะอาคารเมื่อระบุ p_building
create or replace function app.import_plan(p_name text, p_org text, p_type text, p_frequency text default null,
                                           p_due_within_days int default null, p_start date default null,
                                           p_building text default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_org uuid := app.import_org_id(p_org); v_type public.asset_types; v_b uuid; v_id uuid; n int;
        v_freq public.frequency;
begin
  select * into v_type from public.asset_types where upper(code) = upper(btrim(p_type));
  if not found then raise exception 'ไม่พบประเภทจุดตรวจ "%"', p_type; end if;
  if v_type.default_template_id is null then raise exception 'ประเภท % ยังไม่ได้ผูกแบบตรวจ', v_type.code; end if;
  if nullif(btrim(p_building), '') is not null then
    select id into v_b from public.buildings where upper(code) = upper(btrim(p_building));
    if v_b is null then raise exception 'ไม่พบอาคารรหัส "%"', p_building; end if;
  end if;
  v_freq := coalesce(nullif(btrim(p_frequency), '')::public.frequency, v_type.default_frequency);
  if v_freq = 'custom' then raise exception 'แผนแบบกำหนดเองให้สร้างในเว็บ'; end if;
  select id into v_id from public.inspection_plans
   where organization_id = v_org and asset_type_id = v_type.id and building_id is not distinct from v_b and is_active
   order by created_at limit 1;
  if v_id is null then
    insert into public.inspection_plans (name, organization_id, building_id, asset_type_id, template_id, frequency,
                                         start_on, due_within_days)
    values (btrim(p_name), v_org, v_b, v_type.id, v_type.default_template_id, v_freq,
            coalesce(p_start, date_trunc('month', app.today())::date), p_due_within_days)
    returning id into v_id;
  end if;
  n := app.generate_plan_tasks(v_id, null);
  return btrim(p_name) || ' — สร้างงานตรวจเพิ่ม ' || n || ' งาน';
end $$;

revoke execute on function app.import_asset(text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function app.import_plan(text, text, text, text, int, date, text) from public, anon, authenticated;

-- ให้ Supabase API โหลดรายการตาราง/ฟังก์ชันใหม่ทันที (ไม่ต้องรอ)
notify pgrst, 'reload schema';
