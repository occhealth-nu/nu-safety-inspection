-- =====================================================================
-- ช่องทางนำเข้า/ดึงรายงานจาก Google Sheets (Apps Script)
--   • ใช้ "รหัสนำเข้า" (import key) แยกต่างหาก — ไม่ต้องใส่ Secret key ของ Supabase ในสคริปต์
--   • รหัสนำเข้าทำได้เฉพาะ: นำเข้าหน่วยงาน/อาคาร/ห้อง/จุดตรวจ/แผนการตรวจ/ผู้ใช้ และดึงรายงานสรุป
--     (ลบข้อมูล แก้ผลตรวจ หรือเปลี่ยนสิทธิ์ผู้ดูแลระบบนอกเหนือการลงทะเบียน ไม่ได้)
--   • เก็บเฉพาะค่า hash ของรหัสในฐานข้อมูล · ยกเลิกได้ทุกเมื่อ · บันทึกการใช้งานใน audit_logs
-- สร้างรหัส (รันใน SQL Editor):   select app.create_import_key('Google Sheet ผู้ดูแลระบบ');
-- ยกเลิกรหัสทั้งหมด:              select app.revoke_import_keys();
-- รันซ้ำได้ (idempotent)
-- =====================================================================
create table if not exists app.import_keys (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  key_hash      text not null unique,
  key_hint      text not null,                -- 4 ตัวท้าย ไว้ดูว่าเป็นรหัสไหน
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  use_count     int not null default 0,
  revoked_at    timestamptz
);
revoke all on app.import_keys from public, anon, authenticated;

create or replace function app.create_import_key(p_name text default 'Google Sheet') returns text
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_key text := 'nuimp_' || encode(gen_random_bytes(24), 'hex');
begin
  insert into app.import_keys (name, key_hash, key_hint)
  values (coalesce(nullif(btrim(p_name), ''), 'Google Sheet'), encode(digest(v_key, 'sha256'), 'hex'), right(v_key, 4));
  return v_key;   -- แสดงครั้งเดียว: คัดลอกไปใส่ใน Apps Script ทันที
end $$;

create or replace function app.revoke_import_keys() returns text
language sql security definer set search_path = public, app as $$
  with u as (update app.import_keys set revoked_at = now() where revoked_at is null returning 1)
  select 'ยกเลิกรหัสนำเข้าแล้ว ' || count(*) || ' รหัส' from u
$$;
revoke execute on function app.create_import_key(text), app.revoke_import_keys() from public, anon, authenticated;

create or replace function app.check_import_key(p_key text) returns uuid
language plpgsql security definer set search_path = public, app, extensions as $$
declare v_id uuid;
begin
  if p_key is null or p_key !~ '^nuimp_[0-9a-f]{48}$' then
    perform pg_sleep(0.5);
    raise exception 'รหัสนำเข้าไม่ถูกต้อง' using hint = 'BAD_KEY';
  end if;
  update app.import_keys set last_used_at = now(), use_count = use_count + 1
   where key_hash = encode(digest(p_key, 'sha256'), 'hex') and revoked_at is null
  returning id into v_id;
  if v_id is null then
    perform pg_sleep(0.5);
    raise exception 'รหัสนำเข้าไม่ถูกต้องหรือถูกยกเลิกแล้ว' using hint = 'BAD_KEY';
  end if;
  return v_id;
end $$;
revoke execute on function app.check_import_key(text) from public, anon, authenticated;

-- ---------- นำเข้า: ส่งเป็นชุด แต่ละแถวสำเร็จ/ไม่สำเร็จแยกกัน ----------
-- p_kind: organizations | buildings | locations | assets | plans | users
-- p_rows: [{"row": 2, ...ค่าแต่ละคอลัมน์...}, ...]  → คืน [{"row": 2, "ok": true, "message": "..."}]
create or replace function public.sheet_import(p_key text, p_kind text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare
  v_key uuid := app.check_import_key(p_key);
  r jsonb; v_msg text; v_out jsonb := '[]'::jsonb; n_ok int := 0; n_err int := 0;
  t text;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'ข้อมูลต้องเป็นรายการแถว'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'ส่งได้ครั้งละไม่เกิน 1000 แถว'; end if;
  if p_kind not in ('organizations', 'buildings', 'locations', 'assets', 'plans', 'users') then
    raise exception 'ไม่รู้จักชนิดข้อมูล "%"', p_kind;
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      t := null;
      v_msg := case p_kind
        when 'organizations' then app.import_organization(r->>'code', r->>'name', coalesce(nullif(r->>'type', ''), 'faculty'),
                                                          r->>'name_en', r->>'parent')
        when 'buildings' then app.import_building(r->>'org', r->>'code', r->>'name',
                                                  coalesce(nullif(r->>'floors', '')::numeric::int, 1), r->>'address',
                                                  nullif(r->>'building_no', '')::numeric::int, r->>'building_type')
        when 'locations' then app.import_location(r->>'building', r->>'floor', r->>'name', r->>'room_no', r->>'type')
        when 'assets' then app.import_asset(r->>'code', r->>'name', r->>'type', r->>'building', r->>'floor',
                                            r->>'location', r->>'detail', r->>'notes')
        when 'plans' then app.import_plan(r->>'name', r->>'org', r->>'type', nullif(r->>'frequency', ''),
                                          nullif(r->>'due_within_days', '')::numeric::int)
        when 'users' then app.import_user(r->>'email', r->>'full_name', r->>'position', r->>'faculty', r->>'unit', r->>'role')
      end;
      v_out := v_out || jsonb_build_object('row', r->'row', 'ok', true, 'message', v_msg);
      n_ok := n_ok + 1;
    exception when others then
      v_out := v_out || jsonb_build_object('row', r->'row', 'ok', false,
        'message', case when sqlstate = '22P02' then 'ตัวเลขไม่ถูกต้อง (จำนวนชั้น/เลขอาคารต้องเป็นตัวเลข)' else sqlerrm end);
      n_err := n_err + 1;
    end;
  end loop;
  insert into public.audit_logs (actor_id, action, table_name, record_id, new_data)
  values (null, 'SHEET_IMPORT', p_kind, v_key::text, jsonb_build_object('ok', n_ok, 'error', n_err));
  return jsonb_build_object('ok', n_ok, 'error', n_err, 'results', v_out);
end $$;

-- ---------- ดึงรายงานลงชีต ----------
-- p_kind: buildings (สรุปรายอาคาร) | findings (ข้อบกพร่องที่ยังไม่ปิด) | users (ผู้ใช้และบทบาท) | assets (ทะเบียนจุดตรวจ)
create or replace function public.sheet_export(p_key text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_key uuid := app.check_import_key(p_key); v jsonb;
begin
  if p_kind = 'buildings' then
    select coalesce(jsonb_agg(x order by x->>'หน่วยงานเจ้าของ', x->>'รหัสอาคาร'), '[]') into v from (
      select jsonb_build_object(
        'หน่วยงานเจ้าของ', o.name_th, 'รหัสอาคาร', b.code, 'เลขอาคาร', b.building_no, 'ชื่ออาคาร', b.name,
        'ประเภทอาคาร', b.building_type,
        'จำนวนชั้น', (select count(*) from floors f where f.building_id = b.id),
        'ชั้นที่มีผัง', (select count(*) from floors f where f.building_id = b.id and f.plan_path is not null),
        'มีพิกัด', case when b.latitude is not null then 'มี' else 'ยังไม่มี' end,
        'จุดตรวจ', (select count(*) from assets a where a.building_id = b.id and a.status = 'active'),
        'งานตรวจเกินกำหนด', (select count(*) from inspection_tasks t join assets a on a.id = t.asset_id
                              where a.building_id = b.id and t.status = 'open' and t.due_on < app.today()),
        'ข้อบกพร่องค้าง', (select count(*) from findings fi join assets a on a.id = fi.asset_id
                            where a.building_id = b.id and fi.status <> 'closed'),
        'เร่งด่วนค้าง', (select count(*) from findings fi join assets a on a.id = fi.asset_id
                          where a.building_id = b.id and fi.status <> 'closed' and fi.severity in ('high', 'critical')),
        'ตรวจล่าสุด', (select to_char(max(i.submitted_at) at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI')
                        from inspections i join assets a on a.id = i.asset_id where a.building_id = b.id and i.status = 'submitted')
      ) x
      from buildings b join organizations o on o.id = b.organization_id where b.is_active) s;
  elsif p_kind = 'findings' then
    select coalesce(jsonb_agg(x order by x->>'ครบกำหนด' nulls last), '[]') into v from (
      select jsonb_build_object(
        'เลขที่', fi.finding_no, 'ความเร่งด่วน', fi.severity, 'สถานะ', fi.status, 'หัวข้อ', fi.title,
        'รหัสจุดตรวจ', a.code, 'อาคาร', b.code || ' ' || b.name, 'หน่วยงาน', o.name_th,
        'ผู้รับผิดชอบ', p.full_name, 'ครบกำหนด', fi.due_on,
        'เกินกำหนด', case when fi.due_on < app.today() then 'เกิน' else '' end,
        'ความคืบหน้า (%)', fi.progress_pct,
        'พบเมื่อ', to_char(fi.created_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD')) x
      from findings fi join assets a on a.id = fi.asset_id join buildings b on b.id = a.building_id
      join organizations o on o.id = fi.organization_id left join profiles p on p.id = fi.assignee_id
      where fi.status <> 'closed') s;
  elsif p_kind = 'users' then
    select coalesce(jsonb_agg(x order by x->>'อีเมล'), '[]') into v from (
      select jsonb_build_object('อีเมล', u.email, 'ชื่อ-นามสกุล', u.full_name, 'ตำแหน่ง', u.position,
        'สังกัด', u.org, 'บทบาท', u.roles, 'สถานะ', u.st) x from (
        select p.email, p.full_name, p.position, o.name_th as org,
               coalesce(string_agg(ra.role::text || ' @ ' || ro.name_th, ', ' order by ra.role), '') as roles,
               case when not p.is_active then 'ระงับ' when count(ra.id) = 0 then 'รอกำหนดสิทธิ์' else 'ใช้งาน' end as st
          from profiles p left join organizations o on o.id = p.organization_id
          left join role_assignments ra on ra.user_id = p.id left join organizations ro on ro.id = ra.organization_id
         group by p.id, o.name_th
        union all
        select pa.email, pa.full_name, pa.position, ho.name_th, pa.role::text || ' @ ' || po.name_th, 'ลงทะเบียนล่วงหน้า (ยังไม่เคยเข้าระบบ)'
          from user_preassignments pa join organizations po on po.id = pa.organization_id
          left join organizations ho on ho.id = pa.home_organization_id
         where pa.applied_at is null) u) s;
  elsif p_kind = 'assets' then
    select coalesce(jsonb_agg(x order by x->>'รหัสจุดตรวจ'), '[]') into v from (
      select jsonb_build_object('รหัสจุดตรวจ', a.code, 'ชื่อ', a.name, 'ประเภท', t.code, 'อาคาร', b.code,
        'ชั้น', f.name, 'ห้อง/พื้นที่', l.name, 'สถานะ', a.status, 'ตรวจครั้งถัดไป', a.next_due_on,
        'ปักหมุดบนผัง', case when a.plan_x is not null then 'แล้ว' else 'ยัง' end) x
      from assets a join asset_types t on t.id = a.asset_type_id join buildings b on b.id = a.building_id
      left join floors f on f.id = a.floor_id left join locations l on l.id = a.location_id) s;
  else
    raise exception 'ไม่รู้จักรายงาน "%"', p_kind;
  end if;
  return jsonb_build_object('generated_at', to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI'), 'rows', v);
end $$;

-- ตรวจการเชื่อมต่อจาก Apps Script (ตอบเฉพาะว่ารหัสใช้ได้ + จำนวนข้อมูลสรุป)
create or replace function public.sheet_ping(p_key text) returns jsonb
language plpgsql security definer set search_path = public, app as $$
declare v_key uuid := app.check_import_key(p_key);
begin
  return jsonb_build_object('ok', true, 'organizations', (select count(*) from organizations),
    'buildings', (select count(*) from buildings), 'assets', (select count(*) from assets),
    'users', (select count(*) from profiles));
end $$;

revoke execute on function public.sheet_import(text, text, jsonb), public.sheet_export(text, text), public.sheet_ping(text) from public;
grant execute on function public.sheet_import(text, text, jsonb), public.sheet_export(text, text), public.sheet_ping(text) to anon, authenticated;

notify pgrst, 'reload schema';
