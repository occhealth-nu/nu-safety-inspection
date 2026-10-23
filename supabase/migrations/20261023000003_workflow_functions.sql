-- =====================================================================
-- Workflow RPCs (security definer + ตรวจสิทธิ์ภายในฟังก์ชันทุกครั้ง)
-- ข้อผิดพลาด: message = ข้อความภาษาไทยสำหรับผู้ใช้, hint = รหัสข้อผิดพลาดสำหรับโปรแกรม
-- =====================================================================

create or replace function app.fail(p_code text, p_message text, p_detail text default null) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = p_code, detail = coalesce(p_detail, '');
end $$;

create or replace function app.require_login() returns uuid
language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then perform app.fail('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ'); end if;
  if not exists (select 1 from public.profiles where id = v and is_active) then
    perform app.fail('ACCOUNT_DISABLED', 'บัญชีผู้ใช้ถูกระงับหรือยังไม่ได้ตั้งค่า');
  end if;
  return v;
end $$;

create or replace function app.next_period(p_from date, p_freq public.frequency, p_custom int) returns date
language sql immutable as $$
  select case p_freq
    when 'daily' then p_from + 1
    when 'weekly' then p_from + 7
    when 'monthly' then (p_from + interval '1 month')::date
    when 'quarterly' then (p_from + interval '3 months')::date
    when 'yearly' then (p_from + interval '1 year')::date
    when 'custom' then p_from + greatest(coalesce(p_custom, 30), 1)
  end
$$;

-- ค่าตั้งการแจ้งเตือนที่ใกล้ที่สุดตามลำดับชั้นหน่วยงาน (ไม่มี = ค่าตั้งต้นของมหาวิทยาลัย)
create or replace function app.notif_settings(p_org uuid) returns public.notification_settings
language sql stable security definer set search_path = public as $$
  select s.* from public.notification_settings s
    left join public.organizations o on o.id = p_org
   where s.organization_id is null or s.organization_id = any(o.ancestors)
   order by (s.organization_id is null), array_position(o.ancestors, s.organization_id) desc
   limit 1
$$;

create or replace function app.notify(p_user uuid, p_type text, p_title text, p_body text, p_link text,
                                      p_entity_type text, p_entity_id uuid, p_dedupe text, p_org uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_email boolean;
begin
  if p_user is null then return; end if;
  select email_enabled into v_email from app.notif_settings(p_org);
  insert into public.notifications (user_id, type, title, body, link, entity_type, entity_id, dedupe_key, email_status)
  values (p_user, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id, p_dedupe,
          case when coalesce(v_email, true) then 'pending' else 'not_required' end)
  on conflict (user_id, dedupe_key) do nothing;
end $$;

create or replace function app.notify_roles(p_roles public.app_role[], p_org uuid, p_type text, p_title text, p_body text,
                                            p_link text, p_entity_type text, p_entity_id uuid, p_dedupe text, p_exclude uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select * from app.users_with_role(p_roles, p_org) loop
    if u is distinct from p_exclude then
      perform app.notify(u, p_type, p_title, p_body, p_link, p_entity_type, p_entity_id, p_dedupe, p_org);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- ข้อมูลผู้ใช้ปัจจุบัน
-- ---------------------------------------------------------------------
create or replace function public.my_context() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'roles', coalesce((select jsonb_agg(jsonb_build_object(
                'role', ra.role, 'organization_id', ra.organization_id,
                'organization_name', o.name_th, 'is_root', o.parent_id is null) order by ra.role)
              from public.role_assignments ra join public.organizations o on o.id = ra.organization_id
             where ra.user_id = auth.uid()), '[]'::jsonb),
    'unread_notifications', (select count(*) from public.notifications n where n.user_id = auth.uid() and n.read_at is null)
  )
$$;

-- ---------------------------------------------------------------------
-- จัดการสิทธิ์ผู้ใช้
-- ---------------------------------------------------------------------
create or replace function public.grant_role(p_user uuid, p_role public.app_role, p_org uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); v_root boolean; v_id uuid;
begin
  select parent_id is null into v_root from public.organizations where id = p_org;
  if v_root is null then perform app.fail('NOT_FOUND', 'ไม่พบหน่วยงาน'); end if;
  if not app.is_system_admin() then
    if p_role in ('system_admin','safety_coordinator') or v_root then
      perform app.fail('FORBIDDEN', 'เฉพาะผู้ดูแลระบบมหาวิทยาลัยที่กำหนดบทบาทระดับส่วนกลางได้');
    end if;
    if not app.has_role('{org_admin}', p_org) then
      perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์กำหนดบทบาทในหน่วยงานนี้');
    end if;
  end if;
  if p_role in ('system_admin','safety_coordinator') and not v_root then
    perform app.fail('INVALID_INPUT', 'บทบาทส่วนกลางต้องกำหนดที่ระดับมหาวิทยาลัย');
  end if;
  insert into public.role_assignments (user_id, role, organization_id, granted_by)
  values (p_user, p_role, p_org, v_me)
  on conflict (user_id, role, organization_id) do update set granted_by = excluded.granted_by
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.revoke_role(p_assignment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); v_ra public.role_assignments;
begin
  select * into v_ra from public.role_assignments where id = p_assignment_id;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบสิทธิ์ที่ต้องการลบ'); end if;
  if not (app.is_system_admin()
          or (v_ra.role not in ('system_admin','safety_coordinator') and app.has_role('{org_admin}', v_ra.organization_id))) then
    perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์ลบบทบาทนี้');
  end if;
  if v_ra.user_id = v_me and v_ra.role = 'system_admin' then
    perform app.fail('FORBIDDEN', 'ไม่สามารถถอนสิทธิ์ผู้ดูแลระบบของตนเองได้');
  end if;
  delete from public.role_assignments where id = p_assignment_id;
end $$;

-- ---------------------------------------------------------------------
-- แบบตรวจ: สร้างเวอร์ชันใหม่ / เผยแพร่
-- ---------------------------------------------------------------------
create or replace function app.valid_legal_refs(p jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(p) = 'array' and not exists (
    select 1 from jsonb_array_elements(p) e
     where coalesce(trim(e->>'source'), '') = '' or coalesce(trim(e->>'edition'), '') = ''
        or coalesce(e->>'checked_on', '') !~ '^\d{4}-\d{2}-\d{2}$')
$$;
alter table public.checklist_versions add constraint legal_refs_complete check (app.valid_legal_refs(legal_references));
-- จะระบุว่าไม่ใช่ร่างได้ ต้องมีผู้เชี่ยวชาญรับรองและมีแหล่งอ้างอิงอย่างน้อย 1 รายการ
alter table public.checklist_versions add constraint certified_requires_reference check (
  is_expert_review_draft or (jsonb_array_length(legal_references) > 0 and coalesce(trim(approved_by_expert), '') <> ''));

create or replace function public.create_checklist_version(p_template_id uuid, p_change_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); v_prev public.checklist_versions; v_id uuid;
begin
  if not app.can_manage_template(p_template_id) then perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์แก้ไขแบบตรวจนี้'); end if;
  select id into v_id from public.checklist_versions where template_id = p_template_id and status = 'draft';
  if v_id is not null then return v_id; end if;
  select * into v_prev from public.checklist_versions where template_id = p_template_id order by version_no desc limit 1;
  insert into public.checklist_versions (template_id, version_no, status, is_expert_review_draft, legal_references, change_note, created_by)
  values (p_template_id, coalesce(v_prev.version_no, 0) + 1, 'draft', true,
          coalesce(v_prev.legal_references, '[]'::jsonb), p_change_note, v_me)
  returning id into v_id;
  if v_prev.id is not null then
    insert into public.checklist_items (version_id, seq, section, title, description, method, severity, allow_na, photo_required_on_fail)
    select v_id, seq, section, title, description, method, severity, allow_na, photo_required_on_fail
      from public.checklist_items where version_id = v_prev.id;
  end if;
  return v_id;
end $$;

create or replace function public.publish_checklist_version(p_version_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); v public.checklist_versions;
begin
  select * into v from public.checklist_versions where id = p_version_id for update;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบเวอร์ชันแบบตรวจ'); end if;
  if not app.can_manage_template(v.template_id) then perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์เผยแพร่แบบตรวจนี้'); end if;
  if v.status <> 'draft' then perform app.fail('INVALID_STATE', 'เวอร์ชันนี้เผยแพร่แล้ว'); end if;
  if not exists (select 1 from public.checklist_items where version_id = p_version_id) then
    perform app.fail('VALIDATION_FAILED', 'แบบตรวจต้องมีรายการตรวจอย่างน้อย 1 ข้อ');
  end if;
  update public.checklist_versions set status = 'retired' where template_id = v.template_id and status = 'published';
  update public.checklist_versions set status = 'published', published_at = now(), published_by = v_me where id = p_version_id;
end $$;

-- ---------------------------------------------------------------------
-- แผนการตรวจ → สร้างงานตรวจตามรอบ
-- ---------------------------------------------------------------------
create or replace function public.generate_inspection_tasks(p_plan_id uuid, p_until date default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := app.require_login();
  p public.inspection_plans;
  d date; v_next date; v_due date; v_until date; v_total int := 0; n int; v_guard int := 0;
begin
  select * into p from public.inspection_plans where id = p_plan_id;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบแผนการตรวจ'); end if;
  if not app.can_manage_org(p.organization_id) then perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์จัดการแผนการตรวจของหน่วยงานนี้'); end if;
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
  -- อัปเดตกำหนดตรวจครั้งถัดไปของอุปกรณ์
  update public.assets a set next_due_on = t.next_due
    from (select asset_id, min(due_on) next_due from public.inspection_tasks
           where status = 'open' and plan_id = p.id group by asset_id) t
   where a.id = t.asset_id and (a.next_due_on is null or a.next_due_on > t.next_due or a.next_due_on < app.today());
  return v_total;
end $$;

-- แจ้งผู้ตรวจเมื่อได้รับมอบหมายงาน (เฉพาะงานที่ถึงรอบภายใน 7 วัน; งานล่วงหน้าแจ้งผ่านงานแจ้งเตือนรายวัน)
create or replace function app.task_assignment_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_asset text;
begin
  if new.assignee_id is not null and new.status = 'open'
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and new.period_start <= app.today() + 7 and new.due_on >= app.today() then
    select code || ' ' || name into v_asset from public.assets where id = new.asset_id;
    perform app.notify(new.assignee_id, 'task_assigned', 'ได้รับมอบหมายงานตรวจ',
      format('%s ครบกำหนด %s', v_asset, to_char(new.due_on, 'DD/MM/') || (extract(year from new.due_on)::int + 543)),
      '/inspect?task=' || new.id, 'inspection_task', new.id, 'task_assigned:' || new.id || ':' || new.assignee_id,
      new.organization_id);
  end if;
  return null;
end $$;
create trigger inspection_tasks_assignment_notify after insert or update of assignee_id on public.inspection_tasks
  for each row execute function app.task_assignment_notify();

-- ---------------------------------------------------------------------
-- การตรวจ
-- ---------------------------------------------------------------------
create or replace function public.start_inspection(p_asset_id uuid, p_task_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := app.require_login();
  a public.assets; t public.inspection_tasks; v_template uuid; v_version uuid; v_id uuid;
begin
  select * into a from public.assets where id = p_asset_id;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบจุดตรวจ/อุปกรณ์'); end if;

  if p_task_id is not null then
    select * into t from public.inspection_tasks where id = p_task_id;
    if not found or t.asset_id <> p_asset_id then perform app.fail('TASK_MISMATCH', 'งานตรวจไม่ตรงกับจุดตรวจนี้'); end if;
  else
    -- สแกน QR: ผูกกับงานที่เปิดอยู่และถึงรอบแล้ว (ให้ความสำคัญงานที่มอบหมายให้ตนเอง และครบกำหนดก่อน)
    select * into t from public.inspection_tasks
     where asset_id = p_asset_id and status = 'open' and period_start <= app.today()
     order by (assignee_id is not distinct from v_me) desc, due_on
     limit 1;
  end if;

  if not (app.has_role('{inspector,org_admin,safety_coordinator,system_admin}', a.organization_id)
          or coalesce(t.assignee_id = v_me, false)) then
    perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์ตรวจจุดตรวจนี้');
  end if;
  if a.status <> 'active' then perform app.fail('ASSET_INACTIVE', 'จุดตรวจนี้ไม่อยู่ในสถานะใช้งาน'); end if;
  if t.id is not null then
    if t.status = 'completed' then perform app.fail('TASK_ALREADY_COMPLETED', 'งานตรวจนี้ส่งผลแล้ว'); end if;
    if t.status = 'cancelled' then perform app.fail('INVALID_STATE', 'งานตรวจนี้ถูกยกเลิก'); end if;
    if t.assignee_id is not null and t.assignee_id <> v_me and not app.can_manage_org(a.organization_id) then
      perform app.fail('TASK_ASSIGNED_TO_OTHER', 'งานตรวจนี้มอบหมายให้ผู้ตรวจท่านอื่น');
    end if;
  end if;

  select id into v_id from public.inspections
   where inspector_id = v_me and asset_id = p_asset_id and status = 'draft' and task_id is not distinct from t.id
   order by started_at desc limit 1;
  if v_id is not null then return v_id; end if;

  v_template := coalesce(t.template_id, (select default_template_id from public.asset_types where id = a.asset_type_id));
  if v_template is null then perform app.fail('NO_TEMPLATE', 'ยังไม่ได้กำหนดแบบตรวจสำหรับประเภทอุปกรณ์นี้'); end if;
  select id into v_version from public.checklist_versions where template_id = v_template and status = 'published';
  if v_version is null then perform app.fail('NO_PUBLISHED_VERSION', 'แบบตรวจยังไม่มีเวอร์ชันที่เผยแพร่'); end if;

  insert into public.inspections (task_id, asset_id, organization_id, checklist_version_id, inspector_id)
  values (t.id, a.id, a.organization_id, v_version, v_me)
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.upsert_responses(p_inspection uuid, p_version uuid, p_responses jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_responses is null or jsonb_typeof(p_responses) <> 'array' then return; end if;
  if exists (select 1 from jsonb_array_elements(p_responses) r
              where not exists (select 1 from public.checklist_items i
                                 where i.id = (r->>'item_id')::uuid and i.version_id = p_version)) then
    perform app.fail('INVALID_INPUT', 'มีรายการตรวจที่ไม่อยู่ในแบบตรวจเวอร์ชันนี้');
  end if;
  insert into public.inspection_responses (inspection_id, item_id, result, note, na_reason, urgency, photo_exempt_reason, answered_at)
  select p_inspection, (r->>'item_id')::uuid,
         nullif(r->>'result', '')::public.item_result,
         nullif(trim(r->>'note'), ''),
         nullif(trim(r->>'na_reason'), ''),
         nullif(r->>'urgency', '')::public.severity_level,
         nullif(trim(r->>'photo_exempt_reason'), ''),
         now()
    from jsonb_array_elements(p_responses) r
  on conflict (inspection_id, item_id) do update
     set result = excluded.result, note = excluded.note, na_reason = excluded.na_reason,
         urgency = excluded.urgency, photo_exempt_reason = excluded.photo_exempt_reason, answered_at = now();
end $$;

create or replace function public.save_inspection_draft(p_inspection_id uuid, p_responses jsonb, p_summary text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); i public.inspections;
begin
  select * into i from public.inspections where id = p_inspection_id for update;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบแบบบันทึกการตรวจ'); end if;
  if i.inspector_id <> v_me then perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์แก้ไขผลตรวจนี้'); end if;
  if i.status = 'submitted' then perform app.fail('ALREADY_SUBMITTED', 'ผลตรวจนี้ส่งแล้ว ไม่สามารถแก้ไขฉบับร่างได้'); end if;
  perform app.upsert_responses(i.id, i.checklist_version_id, p_responses);
  update public.inspections set summary_note = coalesce(nullif(trim(p_summary), ''), summary_note) where id = i.id;
  return jsonb_build_object('ok', true, 'saved_at', now());
end $$;

create or replace function public.submit_inspection(p_inspection_id uuid, p_responses jsonb,
                                                    p_summary text default null, p_client_submission_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := app.require_login();
  i public.inspections; t public.inspection_tasks; a public.assets;
  v_errors jsonb := '[]'::jsonb;
  r record; v_prev record;
  v_pass int; v_fail int; v_na int; v_score numeric; v_overall text;
  v_finding_id uuid; v_findings jsonb := '[]'::jsonb; v_no text;
begin
  select * into i from public.inspections where id = p_inspection_id for update;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบแบบบันทึกการตรวจ'); end if;
  if i.inspector_id <> v_me then perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์ส่งผลตรวจนี้'); end if;

  -- กันการส่งซ้ำ: คำขอเดิม (client_submission_id เดิม) คืนผลเดิม, คำขอใหม่ถูกปฏิเสธ
  if i.status = 'submitted' then
    if p_client_submission_id is not null and i.client_submission_id = p_client_submission_id then
      return jsonb_build_object('ok', true, 'already_submitted', true, 'inspection_id', i.id,
        'findings', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'finding_no', f.finding_no))
                                from public.findings f where f.inspection_id = i.id), '[]'::jsonb));
    end if;
    perform app.fail('ALREADY_SUBMITTED', 'ผลตรวจนี้ถูกส่งแล้ว ไม่สามารถส่งซ้ำได้');
  end if;

  if i.task_id is not null then
    select * into t from public.inspection_tasks where id = i.task_id for update;
    if t.status = 'completed' then perform app.fail('TASK_ALREADY_COMPLETED', 'งานตรวจนี้มีการส่งผลแล้วโดยผู้ตรวจอีกท่าน'); end if;
    if t.status = 'cancelled' then perform app.fail('INVALID_STATE', 'งานตรวจนี้ถูกยกเลิก'); end if;
  end if;
  select * into a from public.assets where id = i.asset_id;
  if not (app.has_role('{inspector,org_admin,safety_coordinator,system_admin}', i.organization_id)
          or coalesce(t.assignee_id = v_me, false)) then
    perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์ส่งผลตรวจของหน่วยงานนี้');
  end if;

  perform app.upsert_responses(i.id, i.checklist_version_id, p_responses);

  -- ตรวจความครบถ้วนรายข้อ
  for r in
    select ci.id item_id, ci.seq, ci.title, ci.allow_na, ci.photo_required_on_fail,
           ir.id response_id, ir.result, ir.note, ir.na_reason, ir.urgency, ir.photo_exempt_reason,
           exists (select 1 from public.attachments at where at.response_id = ir.id) has_photo
      from public.checklist_items ci
      left join public.inspection_responses ir on ir.item_id = ci.id and ir.inspection_id = i.id
     where ci.version_id = i.checklist_version_id
     order by ci.seq
  loop
    if r.result is null then
      v_errors := v_errors || jsonb_build_object('item_id', r.item_id, 'seq', r.seq, 'message', 'ยังไม่ได้บันทึกผลตรวจ');
    elsif r.result = 'na' then
      if not r.allow_na then
        v_errors := v_errors || jsonb_build_object('item_id', r.item_id, 'seq', r.seq, 'message', 'ข้อนี้ไม่อนุญาตให้เลือก "ไม่เกี่ยวข้อง"');
      elsif r.na_reason is null then
        v_errors := v_errors || jsonb_build_object('item_id', r.item_id, 'seq', r.seq, 'message', 'ต้องระบุเหตุผลที่ไม่เกี่ยวข้อง');
      end if;
    elsif r.result = 'fail' then
      if r.note is null then
        v_errors := v_errors || jsonb_build_object('item_id', r.item_id, 'seq', r.seq, 'message', 'ต้องระบุรายละเอียดข้อบกพร่อง');
      end if;
      if r.urgency is null then
        v_errors := v_errors || jsonb_build_object('item_id', r.item_id, 'seq', r.seq, 'message', 'ต้องระบุระดับความเร่งด่วน');
      end if;
      if r.photo_required_on_fail and not r.has_photo and r.photo_exempt_reason is null then
        v_errors := v_errors || jsonb_build_object('item_id', r.item_id, 'seq', r.seq,
                     'message', 'ต้องแนบภาพหลักฐาน หรือระบุเหตุผลที่ไม่สามารถถ่ายภาพได้');
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_errors) > 0 then
    perform app.fail('VALIDATION_FAILED', format('ข้อมูลยังไม่ครบ %s รายการ', jsonb_array_length(v_errors)), v_errors::text);
  end if;

  select count(*) filter (where result = 'pass'), count(*) filter (where result = 'fail'), count(*) filter (where result = 'na')
    into v_pass, v_fail, v_na
    from public.inspection_responses ir join public.checklist_items ci on ci.id = ir.item_id
   where ir.inspection_id = i.id and ci.version_id = i.checklist_version_id;
  -- ข้อ "ไม่เกี่ยวข้อง" ไม่นับในตัวหาร
  v_score := case when v_pass + v_fail > 0 then round(v_pass * 100.0 / (v_pass + v_fail), 2) end;
  v_overall := case when v_fail > 0 then 'fail' when v_pass > 0 then 'pass' else 'na' end;

  update public.inspections
     set status = 'submitted', submitted_at = now(), client_submission_id = p_client_submission_id,
         pass_count = v_pass, fail_count = v_fail, na_count = v_na, score_pct = v_score, overall_result = v_overall,
         summary_note = coalesce(nullif(trim(p_summary), ''), summary_note)
   where id = i.id;

  -- สร้างข้อบกพร่องจากข้อที่ไม่ผ่าน
  for r in
    select ir.id response_id, ir.note, ir.urgency, ci.id item_id, ci.title
      from public.inspection_responses ir join public.checklist_items ci on ci.id = ir.item_id
     where ir.inspection_id = i.id and ir.result = 'fail'
     order by ci.seq
  loop
    select f.id, f.recurrence_count into v_prev
      from public.findings f join public.checklist_items ci2 on ci2.id = f.checklist_item_id
     where f.asset_id = i.asset_id and ci2.title = r.title and f.created_at > now() - interval '365 days'
     order by f.created_at desc limit 1;
    v_no := 'NC-' || app.be_year() || '-' || lpad(nextval('public.finding_no_seq')::text, 5, '0');
    insert into public.findings (finding_no, inspection_id, response_id, checklist_item_id, asset_id, organization_id,
                                 title, description, severity, recurrence_of, recurrence_count)
    values (v_no, i.id, r.response_id, r.item_id, i.asset_id, i.organization_id,
            r.title, r.note, r.urgency, v_prev.id, coalesce(v_prev.recurrence_count + 1, 0))
    returning id into v_finding_id;
    insert into public.corrective_actions (finding_id, action_type, actor_id, note, to_status)
    values (v_finding_id, 'created', v_me, 'พบข้อบกพร่องจากการตรวจ', 'open');
    v_findings := v_findings || jsonb_build_object('id', v_finding_id, 'finding_no', v_no);

    perform app.notify_roles('{org_admin}', i.organization_id, 'finding_new', 'พบข้อบกพร่องใหม่ รอมอบหมาย',
      format('%s — %s (%s)', v_no, r.title, a.code), '/findings/' || v_finding_id, 'finding', v_finding_id,
      'finding_new:' || v_finding_id, v_me);
    if r.urgency in ('high','critical') and (app.notif_settings(i.organization_id)).notify_on_urgent then
      perform app.notify_roles('{org_admin,safety_coordinator}', i.organization_id, 'finding_urgent',
        'พบข้อบกพร่องเร่งด่วน', format('%s — %s ที่ %s %s', v_no, r.title, a.code, a.name),
        '/findings/' || v_finding_id, 'finding', v_finding_id, 'finding_urgent:' || v_finding_id, v_me);
    end if;
  end loop;

  if t.id is not null then
    perform set_config('app.in_workflow', 'on', true);
    update public.inspection_tasks set status = 'completed', completed_inspection_id = i.id, completed_at = now()
     where id = t.id;
    perform set_config('app.in_workflow', 'off', true);
  end if;

  update public.assets
     set last_inspected_at = now(),
         next_due_on = coalesce((select min(due_on) from public.inspection_tasks
                                  where asset_id = a.id and status = 'open' and due_on >= app.today()),
                                app.next_period(app.today(), a.frequency, a.custom_interval_days))
   where id = a.id;

  return jsonb_build_object('ok', true, 'already_submitted', false, 'inspection_id', i.id,
                            'pass', v_pass, 'fail', v_fail, 'na', v_na, 'score_pct', v_score, 'findings', v_findings);
end $$;

-- ---------------------------------------------------------------------
-- ไฟล์แนบ
-- ---------------------------------------------------------------------
create or replace function app.attachment_target(p_entity_type text, p_entity_id uuid, p_kind text, p_for_upload boolean)
returns uuid  -- คืน organization_id หากมีสิทธิ์ ไม่เช่นนั้น error
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_ok boolean := false; i public.inspections; f public.findings;
begin
  if p_entity_type = 'inspection' then
    select * into i from public.inspections where id = p_entity_id;
    if not found then perform app.fail('NOT_FOUND', 'ไม่พบผลตรวจ'); end if;
    v_org := i.organization_id;
    v_ok := coalesce(i.inspector_id = auth.uid(), false) and i.status = 'draft' and p_kind in ('evidence','before');
  elsif p_entity_type = 'finding' then
    select * into f from public.findings where id = p_entity_id;
    if not found then perform app.fail('NOT_FOUND', 'ไม่พบรายการข้อบกพร่อง'); end if;
    v_org := f.organization_id;
    v_ok := f.status <> 'closed' and p_kind in ('after','evidence','document')
            and (coalesce(f.assignee_id = auth.uid(), false) or app.can_manage_org(f.organization_id)
                 or app.has_role('{verifier}', f.organization_id));
  elsif p_entity_type = 'asset' then
    select organization_id into v_org from public.assets where id = p_entity_id;
    if v_org is null then perform app.fail('NOT_FOUND', 'ไม่พบจุดตรวจ'); end if;
    v_ok := coalesce(app.can_manage_org(v_org), false) and p_kind in ('photo','document');
  end if;
  -- หมายเหตุ: ใช้ coalesce ทุกเงื่อนไข เพราะ NULL ใน "if not" จะทำให้ข้ามการตรวจสิทธิ์
  if not coalesce(v_ok, false) then perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์แนบไฟล์กับรายการนี้'); end if;
  return v_org;
end $$;

create or replace function public.register_attachment(p_entity_type text, p_entity_id uuid, p_storage_path text,
  p_mime_type text, p_size_bytes int, p_kind text default 'evidence', p_item_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); v_org uuid; v_resp uuid; v_id uuid; v_version uuid;
begin
  v_org := app.attachment_target(p_entity_type, p_entity_id, p_kind, true);
  if p_storage_path not like p_entity_type || '/' || p_entity_id || '/%' or p_storage_path like '%..%' then
    perform app.fail('INVALID_INPUT', 'ตำแหน่งไฟล์ไม่ถูกต้อง');
  end if;
  if p_mime_type not in ('image/jpeg','image/png','image/webp','application/pdf') then
    perform app.fail('INVALID_INPUT', 'รองรับเฉพาะไฟล์ภาพ JPG/PNG/WebP หรือ PDF');
  end if;
  if p_entity_type = 'inspection' then
    if p_item_id is null then perform app.fail('INVALID_INPUT', 'ต้องระบุข้อที่แนบภาพ'); end if;
    select checklist_version_id into v_version from public.inspections where id = p_entity_id;
    if not exists (select 1 from public.checklist_items where id = p_item_id and version_id = v_version) then
      perform app.fail('INVALID_INPUT', 'ข้อที่แนบภาพไม่อยู่ในแบบตรวจนี้');
    end if;
    insert into public.inspection_responses (inspection_id, item_id) values (p_entity_id, p_item_id)
    on conflict (inspection_id, item_id) do update set answered_at = public.inspection_responses.answered_at
    returning id into v_resp;
  end if;
  insert into public.attachments (entity_type, entity_id, response_id, item_id, kind, storage_path, mime_type, size_bytes,
                                  organization_id, uploaded_by)
  values (p_entity_type, p_entity_id, v_resp, p_item_id, p_kind, p_storage_path, p_mime_type, p_size_bytes, v_org, v_me)
  returning id into v_id;
  return v_id;
end $$;

-- ลบไฟล์แนบได้เฉพาะผู้อัปโหลด และรายการยังแก้ไขได้ (ร่างผลตรวจ / งานแก้ไขยังไม่ปิด)
create or replace function public.remove_attachment(p_attachment_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); at public.attachments;
begin
  select * into at from public.attachments where id = p_attachment_id;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบไฟล์แนบ'); end if;
  if at.uploaded_by <> v_me then perform app.fail('FORBIDDEN', 'ลบได้เฉพาะไฟล์ที่ตนเองอัปโหลด'); end if;
  perform app.attachment_target(at.entity_type, at.entity_id, at.kind, true);
  if at.entity_type = 'finding' and exists (select 1 from public.findings where id = at.entity_id and status = 'pending_verification') then
    perform app.fail('INVALID_STATE', 'ไม่สามารถลบหลักฐานระหว่างรอตรวจยืนยัน');
  end if;
  delete from public.attachments where id = p_attachment_id;
  return at.storage_path;
end $$;

-- ---------------------------------------------------------------------
-- การติดตามแก้ไข: open → assigned → in_progress → pending_verification → closed
--                                       ↑______________ (ส่งกลับ) ____|
-- ---------------------------------------------------------------------
create or replace function app.log_action(p_finding uuid, p_type text, p_note text, p_from public.finding_status,
                                          p_to public.finding_status, p_pct int default null) returns void
language sql security definer set search_path = public as $$
  insert into public.corrective_actions (finding_id, action_type, actor_id, note, progress_pct, from_status, to_status)
  values (p_finding, p_type, auth.uid(), nullif(trim(p_note), ''), p_pct, p_from, p_to)
$$;

create or replace function public.assign_finding(p_finding_id uuid, p_assignee_id uuid, p_due_on date,
  p_initial_measure text default null, p_responsible_org_id uuid default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); f public.findings; v_new public.finding_status; v_type text;
begin
  select * into f from public.findings where id = p_finding_id for update;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบรายการข้อบกพร่อง'); end if;
  if not app.can_manage_org(f.organization_id) then perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์มอบหมายงานแก้ไขของหน่วยงานนี้'); end if;
  if f.status not in ('open','assigned','in_progress') then
    perform app.fail('INVALID_STATE', 'มอบหมายได้เฉพาะงานที่ยังไม่ส่งตรวจยืนยันหรือปิดงาน');
  end if;
  if p_due_on is null or p_due_on < app.today() then perform app.fail('INVALID_INPUT', 'กำหนดแล้วเสร็จต้องไม่เป็นวันที่ผ่านมาแล้ว'); end if;
  if not exists (select 1 from public.role_assignments ra join public.profiles p on p.id = ra.user_id
                  where ra.user_id = p_assignee_id and ra.role = 'responsible' and p.is_active) then
    perform app.fail('INVALID_INPUT', 'ผู้ใช้ที่เลือกไม่มีบทบาทผู้รับผิดชอบแก้ไข');
  end if;
  v_type := case when f.status = 'open' then 'assign' else 'reassign' end;
  v_new := case when f.status = 'open' or f.assignee_id is distinct from p_assignee_id then 'assigned' else f.status end;
  update public.findings
     set status = v_new, assignee_id = p_assignee_id, due_on = p_due_on,
         responsible_org_id = coalesce(p_responsible_org_id, (select organization_id from public.profiles where id = p_assignee_id)),
         initial_measure = coalesce(nullif(trim(p_initial_measure), ''), initial_measure),
         assigned_by = v_me, assigned_at = now()
   where id = f.id;
  perform app.log_action(f.id, v_type,
    coalesce(nullif(trim(p_note), ''), 'มอบหมายผู้รับผิดชอบ กำหนดเสร็จ ' || to_char(p_due_on, 'DD/MM/') || app.be_year(p_due_on)),
    f.status, v_new);
  if (app.notif_settings(f.organization_id)).notify_on_assignment then
    perform app.notify(p_assignee_id, 'finding_assigned', 'ได้รับมอบหมายงานแก้ไข',
      format('%s — %s ครบกำหนด %s', f.finding_no, f.title, to_char(p_due_on, 'DD/MM/') || app.be_year(p_due_on)),
      '/findings/' || f.id, 'finding', f.id,
      'finding_assigned:' || f.id || ':' || p_assignee_id || ':' || extract(epoch from now())::bigint, f.organization_id);
  end if;
end $$;

create or replace function public.start_corrective_work(p_finding_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); f public.findings;
begin
  select * into f from public.findings where id = p_finding_id for update;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบรายการข้อบกพร่อง'); end if;
  if f.assignee_id is distinct from v_me then perform app.fail('FORBIDDEN', 'เฉพาะผู้รับผิดชอบที่ได้รับมอบหมายเท่านั้น'); end if;
  if f.status <> 'assigned' then perform app.fail('INVALID_STATE', 'งานนี้ไม่ได้อยู่ในสถานะรอแก้ไข'); end if;
  update public.findings set status = 'in_progress' where id = f.id;
  perform app.log_action(f.id, 'start', coalesce(p_note, 'รับงานและเริ่มดำเนินการแก้ไข'), 'assigned', 'in_progress');
end $$;

create or replace function public.add_corrective_progress(p_finding_id uuid, p_note text, p_progress_pct int default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); f public.findings;
begin
  select * into f from public.findings where id = p_finding_id for update;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบรายการข้อบกพร่อง'); end if;
  if not (coalesce(f.assignee_id = v_me, false) or app.can_manage_org(f.organization_id)) then
    perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์รายงานความคืบหน้างานนี้');
  end if;
  if f.status not in ('assigned','in_progress') then perform app.fail('INVALID_STATE', 'รายงานความคืบหน้าได้เฉพาะงานที่กำลังแก้ไข'); end if;
  if coalesce(trim(p_note), '') = '' then perform app.fail('INVALID_INPUT', 'กรุณาระบุรายละเอียดความคืบหน้า'); end if;
  if p_progress_pct is not null and (p_progress_pct < 0 or p_progress_pct > 100) then
    perform app.fail('INVALID_INPUT', 'ร้อยละความคืบหน้าต้องอยู่ระหว่าง 0–100');
  end if;
  if f.status = 'assigned' and coalesce(f.assignee_id = v_me, false) then
    update public.findings set status = 'in_progress' where id = f.id;
    perform app.log_action(f.id, 'start', 'เริ่มดำเนินการแก้ไข', 'assigned', 'in_progress');
  end if;
  update public.findings set progress_pct = coalesce(p_progress_pct, progress_pct) where id = f.id;
  perform app.log_action(f.id, 'progress', p_note, null, null, p_progress_pct);
end $$;

create or replace function public.submit_corrective_fix(p_finding_id uuid, p_note text, p_no_photo_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); f public.findings; v_since timestamptz;
begin
  select * into f from public.findings where id = p_finding_id for update;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบรายการข้อบกพร่อง'); end if;
  if f.assignee_id is distinct from v_me then perform app.fail('FORBIDDEN', 'เฉพาะผู้รับผิดชอบที่ได้รับมอบหมายเท่านั้น'); end if;
  if f.status not in ('assigned','in_progress') then perform app.fail('INVALID_STATE', 'งานนี้ไม่อยู่ในสถานะที่ส่งผลแก้ไขได้'); end if;
  if coalesce(trim(p_note), '') = '' then perform app.fail('INVALID_INPUT', 'กรุณาอธิบายการแก้ไขที่ดำเนินการ'); end if;
  -- ต้องมีหลักฐานหลังแก้ไขที่แนบหลังการมอบหมาย/ส่งกลับครั้งล่าสุด
  select max(created_at) into v_since from public.corrective_actions
   where finding_id = f.id and action_type in ('assign','reassign','reject');
  if not exists (select 1 from public.attachments where entity_type = 'finding' and entity_id = f.id and kind = 'after'
                    and created_at >= coalesce(v_since, f.created_at))
     and coalesce(trim(p_no_photo_reason), '') = '' then
    perform app.fail('VALIDATION_FAILED', 'กรุณาแนบภาพหลังแก้ไข หรือระบุเหตุผลที่ไม่สามารถถ่ายภาพได้');
  end if;
  if f.status = 'assigned' then
    update public.findings set status = 'in_progress' where id = f.id;
    perform app.log_action(f.id, 'start', 'เริ่มดำเนินการแก้ไข', 'assigned', 'in_progress');
  end if;
  update public.findings set status = 'pending_verification', progress_pct = 100,
         fix_submitted_by = v_me, fix_submitted_at = now(), verified_by = null, verified_at = null
   where id = f.id;
  perform app.log_action(f.id, 'submit_fix',
    p_note || case when coalesce(trim(p_no_photo_reason), '') <> '' then E'\n(ไม่แนบภาพ: ' || trim(p_no_photo_reason) || ')' else '' end,
    'in_progress', 'pending_verification', 100);
  if (app.notif_settings(f.organization_id)).notify_on_verification then
    perform app.notify_roles('{verifier}', f.organization_id, 'fix_submitted', 'มีผลการแก้ไขรอตรวจยืนยัน',
      format('%s — %s', f.finding_no, f.title), '/findings/' || f.id, 'finding', f.id,
      'fix_submitted:' || f.id || ':' || f.rework_count, v_me);
  end if;
end $$;

create or replace function public.verify_finding(p_finding_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); f public.findings;
begin
  select * into f from public.findings where id = p_finding_id for update;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบรายการข้อบกพร่อง'); end if;
  if not app.has_role('{verifier,safety_coordinator,system_admin}', f.organization_id) then
    perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์ตรวจยืนยันงานของหน่วยงานนี้');
  end if;
  if f.status <> 'pending_verification' then
    perform app.fail('NOT_PENDING_VERIFICATION', 'ตรวจยืนยันได้เฉพาะงานที่ผู้รับผิดชอบส่งผลแก้ไขแล้ว');
  end if;
  if v_me = f.fix_submitted_by or v_me = f.assignee_id then
    perform app.fail('SELF_VERIFICATION', 'ผู้แก้ไขไม่สามารถตรวจยืนยันงานของตนเองได้');
  end if;
  if p_approve then
    update public.findings set status = 'closed', verified_by = v_me, verified_at = now(), closed_at = now() where id = f.id;
    perform app.log_action(f.id, 'approve', coalesce(p_note, 'ตรวจยืนยันผลการแก้ไขและปิดงาน'), 'pending_verification', 'closed');
  else
    if coalesce(trim(p_note), '') = '' then perform app.fail('INVALID_INPUT', 'กรุณาระบุเหตุผลที่ส่งกลับแก้ไข'); end if;
    update public.findings set status = 'in_progress', rework_count = rework_count + 1, progress_pct = least(progress_pct, 90)
     where id = f.id;
    perform app.log_action(f.id, 'reject', p_note, 'pending_verification', 'in_progress');
  end if;
  if (app.notif_settings(f.organization_id)).notify_on_verification then
    perform app.notify(f.assignee_id, 'verification_result',
      case when p_approve then 'งานแก้ไขผ่านการตรวจยืนยันแล้ว' else 'งานแก้ไขถูกส่งกลับให้แก้ไขเพิ่มเติม' end,
      format('%s — %s%s', f.finding_no, f.title, case when p_approve then '' else ' : ' || p_note end),
      '/findings/' || f.id, 'finding', f.id, 'verification:' || f.id || ':' || f.rework_count || ':' || p_approve, f.organization_id);
  end if;
end $$;

-- ใบงานส่งหน่วยงานภายนอก (ยังไม่เชื่อม API: บันทึกในระบบ + ส่งออกเอกสาร)
create or replace function public.create_work_order(p_finding_id uuid, p_target_unit text, p_description text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); f public.findings; v_no text; v_id uuid;
begin
  select * into f from public.findings where id = p_finding_id;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบรายการข้อบกพร่อง'); end if;
  if not (app.can_manage_org(f.organization_id) or coalesce(f.assignee_id = v_me, false)) then
    perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์ออกใบงานสำหรับรายการนี้');
  end if;
  if f.status = 'closed' then perform app.fail('INVALID_STATE', 'งานนี้ปิดแล้ว'); end if;
  if coalesce(trim(p_target_unit), '') = '' or coalesce(trim(p_description), '') = '' then
    perform app.fail('INVALID_INPUT', 'กรุณาระบุหน่วยงานปลายทางและรายละเอียดงาน');
  end if;
  v_no := 'WO-' || app.be_year() || '-' || lpad(nextval('public.work_order_no_seq')::text, 5, '0');
  insert into public.work_orders (wo_no, finding_id, target_unit, description, created_by)
  values (v_no, f.id, trim(p_target_unit), trim(p_description), v_me) returning id into v_id;
  perform app.log_action(f.id, 'work_order', 'ออกใบงาน ' || v_no || ' ถึง ' || trim(p_target_unit), null, null);
  return jsonb_build_object('id', v_id, 'wo_no', v_no);
end $$;

-- ---------------------------------------------------------------------
-- งานแจ้งเตือนตามเวลา (เรียกจาก cron ด้วย service role)
-- ---------------------------------------------------------------------
create or replace function public.run_notification_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; s public.notification_settings;
  v_due_soon int := 0; v_overdue int := 0; v_escalated int := 0; v_today date := app.today();
begin
  -- งานตรวจใกล้ครบกำหนด / เกินกำหนด
  for r in select t.*, a.code asset_code, a.name asset_name from public.inspection_tasks t join public.assets a on a.id = t.asset_id
            where t.status = 'open' and t.due_on <= v_today + 60 and t.period_start <= v_today + 60 loop
    s := app.notif_settings(r.organization_id);
    if r.assignee_id is not null and r.due_on >= v_today and r.due_on <= v_today + s.due_soon_days then
      perform app.notify(r.assignee_id, 'task_due_soon', 'งานตรวจใกล้ครบกำหนด',
        format('%s %s ครบกำหนด %s', r.asset_code, r.asset_name, to_char(r.due_on, 'DD/MM/') || app.be_year(r.due_on)),
        '/inspect?task=' || r.id, 'inspection_task', r.id, 'task_due_soon:' || r.id, r.organization_id);
      v_due_soon := v_due_soon + 1;
    elsif r.due_on < v_today then
      if r.assignee_id is not null then
        perform app.notify(r.assignee_id, 'task_overdue', 'งานตรวจเกินกำหนด',
          format('%s %s ครบกำหนด %s', r.asset_code, r.asset_name, to_char(r.due_on, 'DD/MM/') || app.be_year(r.due_on)),
          '/inspect?task=' || r.id, 'inspection_task', r.id, 'task_overdue:' || r.id, r.organization_id);
      end if;
      v_overdue := v_overdue + 1;
      if r.due_on < v_today - s.escalate_after_days then
        perform app.notify_roles(s.escalation_roles, r.organization_id, 'task_escalated', 'ยกระดับ: งานตรวจเกินกำหนด',
          format('%s %s เกินกำหนดมากกว่า %s วัน', r.asset_code, r.asset_name, s.escalate_after_days),
          '/tasks?status=overdue', 'inspection_task', r.id, 'task_escalated:' || r.id);
        v_escalated := v_escalated + 1;
      end if;
    end if;
  end loop;

  -- งานแก้ไขใกล้ครบกำหนด / เกินกำหนด
  for r in select * from public.findings where status in ('assigned','in_progress') and due_on is not null loop
    s := app.notif_settings(r.organization_id);
    if r.due_on >= v_today and r.due_on <= v_today + s.due_soon_days then
      perform app.notify(r.assignee_id, 'finding_due_soon', 'งานแก้ไขใกล้ครบกำหนด',
        format('%s — %s ครบกำหนด %s', r.finding_no, r.title, to_char(r.due_on, 'DD/MM/') || app.be_year(r.due_on)),
        '/findings/' || r.id, 'finding', r.id, 'finding_due_soon:' || r.id || ':' || r.due_on, r.organization_id);
      v_due_soon := v_due_soon + 1;
    elsif r.due_on < v_today then
      perform app.notify(r.assignee_id, 'finding_overdue', 'งานแก้ไขเกินกำหนด',
        format('%s — %s ครบกำหนด %s', r.finding_no, r.title, to_char(r.due_on, 'DD/MM/') || app.be_year(r.due_on)),
        '/findings/' || r.id, 'finding', r.id, 'finding_overdue:' || r.id || ':' || r.due_on, r.organization_id);
      v_overdue := v_overdue + 1;
      if r.due_on < v_today - s.escalate_after_days then
        perform app.notify_roles(s.escalation_roles, r.organization_id, 'finding_escalated', 'ยกระดับ: งานแก้ไขเกินกำหนด',
          format('%s — %s เกินกำหนดมากกว่า %s วัน', r.finding_no, r.title, s.escalate_after_days),
          '/findings/' || r.id, 'finding', r.id, 'finding_escalated:' || r.id || ':' || r.due_on);
        v_escalated := v_escalated + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('due_soon', v_due_soon, 'overdue', v_overdue, 'escalated', v_escalated, 'run_at', now());
end $$;
revoke execute on function public.run_notification_jobs() from public, anon, authenticated;
grant execute on function public.run_notification_jobs() to service_role;

-- RPC permissions
revoke execute on all functions in schema public from public, anon;
grant execute on function public.my_context(), public.grant_role(uuid, public.app_role, uuid), public.revoke_role(uuid),
  public.create_checklist_version(uuid, text), public.publish_checklist_version(uuid),
  public.generate_inspection_tasks(uuid, date), public.start_inspection(uuid, uuid),
  public.save_inspection_draft(uuid, jsonb, text), public.submit_inspection(uuid, jsonb, text, uuid),
  public.register_attachment(text, uuid, text, text, int, text, uuid), public.remove_attachment(uuid),
  public.assign_finding(uuid, uuid, date, text, uuid, text), public.start_corrective_work(uuid, text),
  public.add_corrective_progress(uuid, text, int), public.submit_corrective_fix(uuid, text, text),
  public.verify_finding(uuid, boolean, text), public.create_work_order(uuid, text, text)
  to authenticated;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
