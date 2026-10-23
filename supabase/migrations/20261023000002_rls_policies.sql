-- =====================================================================
-- Permission helpers + Row Level Security
-- หลักการ: สิทธิ์ถูกผูกกับ (บทบาท, หน่วยงาน). บทบาทที่หน่วยงาน X มีผลกับ X และหน่วยงานลูกทั้งหมด
-- บทบาทส่วนกลางกำหนดที่หน่วยงานราก (มหาวิทยาลัย) จึงเห็นทั้งมหาวิทยาลัย
-- การเขียนข้อมูลเชิงกระบวนการ (ผลตรวจ, ข้อบกพร่อง) ทำผ่านฟังก์ชัน RPC เท่านั้น
-- =====================================================================

create or replace function app.uid() returns uuid
language sql stable as $$ select auth.uid() $$;

-- ผู้ใช้มีบทบาทใดบทบาทหนึ่งใน p_roles ที่หน่วยงาน p_org หรือหน่วยงานแม่ของ p_org
create or replace function app.has_role(p_roles public.app_role[], p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.role_assignments ra
      join public.organizations o on o.id = p_org
      join public.profiles p on p.id = ra.user_id and p.is_active
     where ra.user_id = auth.uid()
       and ra.role = any(p_roles)
       and ra.organization_id = any(o.ancestors)
  )
$$;

-- มีบทบาทนี้ที่ใดก็ได้
create or replace function app.has_any_role(p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.role_assignments ra join public.profiles p on p.id = ra.user_id and p.is_active
                  where ra.user_id = auth.uid() and ra.role = any(p_roles))
$$;

-- เห็นข้อมูลของหน่วยงานได้หรือไม่ (มีบทบาทใดก็ได้ในสายบังคับบัญชา)
create or replace function app.can_view_org(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role(enum_range(null::public.app_role), p_org)
$$;

-- ชุดหน่วยงานทั้งหมดที่ผู้ใช้มองเห็น (ใช้ใน policy แบบ (select ...) เพื่อคำนวณครั้งเดียวต่อคำสั่ง)
create or replace function app.visible_org_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(o.id), '{}') from public.organizations o
   where exists (select 1 from public.role_assignments ra join public.profiles p on p.id = ra.user_id and p.is_active
                  where ra.user_id = auth.uid() and ra.organization_id = any(o.ancestors))
$$;

create or replace function app.can_manage_org(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role('{system_admin,safety_coordinator,org_admin}', p_org)
$$;

create or replace function app.is_system_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.role_assignments ra
                   join public.organizations o on o.id = ra.organization_id and o.parent_id is null
                   join public.profiles p on p.id = ra.user_id and p.is_active
                  where ra.user_id = auth.uid() and ra.role = 'system_admin')
$$;

create or replace function app.is_central() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.role_assignments ra
                   join public.organizations o on o.id = ra.organization_id and o.parent_id is null
                   join public.profiles p on p.id = ra.user_id and p.is_active
                  where ra.user_id = auth.uid() and ra.role in ('system_admin','safety_coordinator'))
$$;

-- ผู้ใช้ที่มีบทบาท r ในหน่วยงาน p_org (รวมบทบาทที่หน่วยงานแม่)
create or replace function app.users_with_role(p_roles public.app_role[], p_org uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct ra.user_id
    from public.role_assignments ra
    join public.organizations o on o.id = p_org
    join public.profiles p on p.id = ra.user_id and p.is_active
   where ra.role = any(p_roles) and ra.organization_id = any(o.ancestors)
$$;

-- ผู้ใช้เข้าถึงงานแก้ไขนี้ได้ (หน่วยงานเจ้าของ, หน่วยงานรับผิดชอบ, หรือผู้รับผิดชอบโดยตรง)
create or replace function app.can_view_finding(p_finding uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.findings f
                  where f.id = p_finding
                    and (app.can_view_org(f.organization_id)
                         or f.assignee_id = auth.uid()
                         or (f.responsible_org_id is not null and app.can_view_org(f.responsible_org_id))))
$$;

create or replace function app.can_view_inspection(p_inspection uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.inspections i
                  where i.id = p_inspection
                    and (i.inspector_id = auth.uid() or app.can_view_org(i.organization_id)
                         or exists (select 1 from public.findings f where f.inspection_id = i.id and app.can_view_finding(f.id))))
$$;

create or replace function app.can_view_asset(p_asset uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.assets a
                  where a.id = p_asset
                    and (app.can_view_org(a.organization_id)
                         or a.responsible_user_id = auth.uid()
                         or exists (select 1 from public.inspection_tasks t where t.asset_id = a.id and t.assignee_id = auth.uid())
                         or exists (select 1 from public.findings f where f.asset_id = a.id and f.assignee_id = auth.uid())))
$$;

create or replace function app.can_view_attachment(p_entity_type text, p_entity_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_entity_type
           when 'asset' then app.can_view_asset(p_entity_id)
           when 'inspection' then app.can_view_inspection(p_entity_id)
           when 'finding' then app.can_view_finding(p_entity_id)
           else false end
$$;

-- revoke default broad grants from anon; everything requires login except branding
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Enable RLS on every table
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    -- ไม่ใช้ FORCE: ฟังก์ชัน security definer (เจ้าของตาราง) ต้องอ่านข้อมูลเพื่อตรวจสิทธิ์ได้
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Master data: องค์กร/อาคาร/ชั้น/ห้อง/ประเภทอุปกรณ์/แบบตรวจ
-- อ่านได้ทุกคนที่เข้าสู่ระบบ (ข้อมูลอ้างอิงตำแหน่ง ไม่ใช่ข้อมูลลับ) แต่แก้ไขได้ตามขอบเขตหน่วยงาน
-- ---------------------------------------------------------------------
create policy organizations_read on public.organizations for select to authenticated using (true);
create policy organizations_write on public.organizations for all to authenticated
  using (app.is_system_admin()) with check (app.is_system_admin());

create policy buildings_read on public.buildings for select to authenticated using (true);
create policy buildings_write on public.buildings for all to authenticated
  using (app.can_manage_org(organization_id)) with check (app.can_manage_org(organization_id));

create policy floors_read on public.floors for select to authenticated using (true);
create policy floors_write on public.floors for all to authenticated
  using (exists (select 1 from public.buildings b where b.id = building_id and app.can_manage_org(b.organization_id)))
  with check (exists (select 1 from public.buildings b where b.id = building_id and app.can_manage_org(b.organization_id)));

create policy locations_read on public.locations for select to authenticated using (true);
create policy locations_write on public.locations for all to authenticated
  using (exists (select 1 from public.floors f join public.buildings b on b.id = f.building_id
                  where f.id = floor_id and app.can_manage_org(b.organization_id)))
  with check (exists (select 1 from public.floors f join public.buildings b on b.id = f.building_id
                  where f.id = floor_id and app.can_manage_org(b.organization_id)));

create policy asset_types_read on public.asset_types for select to authenticated using (true);
create policy asset_types_write on public.asset_types for all to authenticated
  using (app.is_central()) with check (app.is_central());

create policy checklist_templates_read on public.checklist_templates for select to authenticated using (true);
create policy checklist_templates_write on public.checklist_templates for all to authenticated
  using (case when organization_id is null then app.is_central() else app.can_manage_org(organization_id) end)
  with check (case when organization_id is null then app.is_central() else app.can_manage_org(organization_id) end);

create or replace function app.can_manage_template(p_template uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.checklist_templates t where t.id = p_template
                  and case when t.organization_id is null then app.is_central() else app.can_manage_org(t.organization_id) end)
$$;
grant execute on function app.can_manage_template(uuid) to authenticated;

create policy checklist_versions_read on public.checklist_versions for select to authenticated using (true);
create policy checklist_versions_write on public.checklist_versions for update to authenticated
  using (app.can_manage_template(template_id)) with check (app.can_manage_template(template_id));
-- สร้าง/เผยแพร่เวอร์ชันผ่าน RPC create_checklist_version / publish_checklist_version

create policy checklist_items_read on public.checklist_items for select to authenticated using (true);
create policy checklist_items_write on public.checklist_items for all to authenticated
  using (exists (select 1 from public.checklist_versions v where v.id = version_id and app.can_manage_template(v.template_id)))
  with check (exists (select 1 from public.checklist_versions v where v.id = version_id and app.can_manage_template(v.template_id)));

-- ---------------------------------------------------------------------
-- Profiles & roles
-- ---------------------------------------------------------------------
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid()
         or app.is_central()
         or (organization_id is not null and app.can_view_org(organization_id))
         -- รายชื่อผู้รับผิดชอบแก้ไข/ผู้ตรวจยืนยัน เปิดให้ผู้ดูแลหน่วยงานเลือกมอบหมายข้ามหน่วยงานได้
         or (app.has_any_role('{org_admin,verifier}') and exists
              (select 1 from public.role_assignments ra where ra.user_id = profiles.id and ra.role in ('responsible','verifier'))));
-- ผู้ใช้แก้ไขข้อมูลติดต่อตนเองได้ แต่เปลี่ยนหน่วยงาน/สถานะไม่ได้ (ตรวจใน trigger)
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or app.is_system_admin() or (organization_id is not null and app.can_manage_org(organization_id)))
  with check (id = auth.uid() or app.is_system_admin() or (organization_id is not null and app.can_manage_org(organization_id)));

create or replace function app.profiles_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null or app.is_system_admin() then return new; end if;
  if new.id = auth.uid() and not app.can_manage_org(coalesce(old.organization_id, new.organization_id)) then
    if new.organization_id is distinct from old.organization_id or new.is_active is distinct from old.is_active
       or new.email is distinct from old.email then
      raise exception using message = 'ไม่มีสิทธิ์เปลี่ยนหน่วยงานหรือสถานะบัญชีของตนเอง', hint = 'FORBIDDEN';
    end if;
  end if;
  if new.organization_id is distinct from old.organization_id
     and (new.organization_id is null or not app.can_manage_org(new.organization_id)) then
    raise exception using message = 'ไม่มีสิทธิ์ย้ายผู้ใช้ไปยังหน่วยงานนี้', hint = 'FORBIDDEN';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function app.profiles_guard();

create policy role_assignments_read on public.role_assignments for select to authenticated
  using (user_id = auth.uid() or app.is_central() or app.has_role('{org_admin}', organization_id)
         or app.has_any_role('{org_admin,verifier}'));
-- เพิ่ม/ลบสิทธิ์ผ่าน RPC grant_role / revoke_role เท่านั้น

-- ---------------------------------------------------------------------
-- Assets
-- ---------------------------------------------------------------------
create policy assets_read on public.assets for select to authenticated
  using (organization_id = any((select app.visible_org_ids())::uuid[])
         or responsible_user_id = (select auth.uid())
         or exists (select 1 from public.inspection_tasks t where t.asset_id = assets.id and t.assignee_id = (select auth.uid()))
         or exists (select 1 from public.findings f where f.asset_id = assets.id
                      and (f.assignee_id = (select auth.uid()) or f.responsible_org_id = any((select app.visible_org_ids())::uuid[]))));
create policy assets_insert on public.assets for insert to authenticated
  with check (app.can_manage_org(organization_id));
create policy assets_update on public.assets for update to authenticated
  using (app.can_manage_org(organization_id)) with check (app.can_manage_org(organization_id));
-- ไม่อนุญาตลบ ใช้สถานะ "จำหน่าย" แทน เพื่อรักษาประวัติ

-- ---------------------------------------------------------------------
-- Planning
-- ---------------------------------------------------------------------
create policy plans_read on public.inspection_plans for select to authenticated
  using (organization_id = any((select app.visible_org_ids())::uuid[]));
create policy plans_write on public.inspection_plans for all to authenticated
  using (app.can_manage_org(organization_id)) with check (app.can_manage_org(organization_id));

create policy tasks_read on public.inspection_tasks for select to authenticated
  using (assignee_id = (select auth.uid()) or organization_id = any((select app.visible_org_ids())::uuid[]));
create policy tasks_update on public.inspection_tasks for update to authenticated
  using (app.can_manage_org(organization_id)) with check (app.can_manage_org(organization_id));

create or replace function app.tasks_guard() returns trigger
language plpgsql as $$
begin
  -- การปิดงานตรวจทำได้จาก submit_inspection เท่านั้น
  if auth.uid() is not null and current_setting('app.in_workflow', true) is distinct from 'on' then
    if new.status is distinct from old.status and (new.status = 'completed' or old.status = 'completed') then
      raise exception using message = 'สถานะงานตรวจเปลี่ยนได้จากการส่งผลตรวจเท่านั้น', hint = 'FORBIDDEN';
    end if;
    if new.completed_inspection_id is distinct from old.completed_inspection_id
       or new.asset_id is distinct from old.asset_id or new.organization_id is distinct from old.organization_id then
      raise exception using message = 'ไม่อนุญาตให้แก้ไขข้อมูลอ้างอิงของงานตรวจ', hint = 'FORBIDDEN';
    end if;
  end if;
  return new;
end $$;
create trigger inspection_tasks_guard before update on public.inspection_tasks for each row execute function app.tasks_guard();

-- ---------------------------------------------------------------------
-- Inspections — อ่านตามขอบเขต เขียนผ่าน RPC เท่านั้น
-- ---------------------------------------------------------------------
create policy inspections_read on public.inspections for select to authenticated
  using (inspector_id = (select auth.uid())
         or organization_id = any((select app.visible_org_ids())::uuid[])
         or exists (select 1 from public.findings f where f.inspection_id = inspections.id
                      and (f.assignee_id = (select auth.uid()) or f.responsible_org_id = any((select app.visible_org_ids())::uuid[]))));
create policy responses_read on public.inspection_responses for select to authenticated using (app.can_view_inspection(inspection_id));

-- ---------------------------------------------------------------------
-- Findings / corrective actions / work orders — อ่านตามขอบเขต เขียนผ่าน RPC เท่านั้น
-- ---------------------------------------------------------------------
create policy findings_read on public.findings for select to authenticated
  using (organization_id = any((select app.visible_org_ids())::uuid[])
         or assignee_id = (select auth.uid())
         or responsible_org_id = any((select app.visible_org_ids())::uuid[]));
create policy corrective_actions_read on public.corrective_actions for select to authenticated using (app.can_view_finding(finding_id));
create policy work_orders_read on public.work_orders for select to authenticated using (app.can_view_finding(finding_id));

-- ---------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------
create policy attachments_read on public.attachments for select to authenticated
  using (app.can_view_attachment(entity_type, entity_id));
-- insert ผ่าน RPC register_attachment (ตรวจว่าผู้ใช้มีสิทธิ์แนบไฟล์กับรายการนั้น)

-- ---------------------------------------------------------------------
-- Notifications — เห็นเฉพาะของตนเอง และทำเครื่องหมายอ่านแล้วได้
-- ---------------------------------------------------------------------
create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create policy notification_settings_read on public.notification_settings for select to authenticated
  using (organization_id is null or app.can_view_org(organization_id));
create policy notification_settings_write on public.notification_settings for all to authenticated
  using (case when organization_id is null then app.is_central() else app.can_manage_org(organization_id) end)
  with check (case when organization_id is null then app.is_central() else app.can_manage_org(organization_id) end);

-- ---------------------------------------------------------------------
-- App settings — อ่านได้แม้ยังไม่เข้าสู่ระบบ (ชื่อ/สีสำหรับหน้า login)
-- ---------------------------------------------------------------------
grant select on public.app_settings to anon;
create policy app_settings_read on public.app_settings for select to anon, authenticated using (true);
create policy app_settings_write on public.app_settings for update to authenticated
  using (app.is_system_admin()) with check (app.is_system_admin());

-- ---------------------------------------------------------------------
-- Audit logs — append-only; อ่านได้เฉพาะผู้ดูแล
-- ---------------------------------------------------------------------
create policy audit_logs_read on public.audit_logs for select to authenticated
  using (app.is_central() or (organization_id is not null and app.has_role('{org_admin}', organization_id)));
revoke insert, update, delete, truncate on public.audit_logs from authenticated;

-- ไม่ให้ผู้ใช้เขียนตารางกระบวนการโดยตรง (เขียนผ่าน security definer RPC)
revoke insert, update, delete on public.inspections, public.inspection_responses, public.findings,
  public.corrective_actions, public.work_orders, public.attachments, public.role_assignments from authenticated;
revoke insert, delete on public.inspection_tasks, public.checklist_versions from authenticated;
revoke delete on public.assets, public.profiles from authenticated;
