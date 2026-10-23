-- =====================================================================
-- NU Safety Inspection — Core schema
-- เวลา: เก็บเป็น timestamptz (UTC) ทุกคอลัมน์เวลา, วันที่ตามปฏิทินใช้ date
--       โดยตีความ "วันนี้" ตามเขตเวลา Asia/Bangkok (ดู app.today())
-- =====================================================================

create extension if not exists pgcrypto;

create schema if not exists app;          -- private helpers (not exposed via API)
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.app_role as enum (
  'system_admin',        -- ผู้ดูแลระบบมหาวิทยาลัย
  'safety_coordinator',  -- ผู้ประสานงานความปลอดภัยส่วนกลาง
  'org_admin',           -- ผู้ดูแลระดับคณะ/หน่วยงาน
  'inspector',           -- ผู้ตรวจ
  'responsible',         -- ผู้รับผิดชอบแก้ไข
  'verifier',            -- ผู้ตรวจยืนยัน
  'executive'            -- ผู้บริหาร/คณะกรรมการความปลอดภัย
);
create type public.asset_status as enum ('active','inactive','relocated','disposed');
create type public.frequency as enum ('daily','weekly','monthly','quarterly','yearly','custom');
create type public.item_result as enum ('pass','fail','na');
create type public.severity_level as enum ('low','medium','high','critical');
create type public.finding_status as enum ('open','assigned','in_progress','pending_verification','closed');
create type public.inspection_status as enum ('draft','submitted');
create type public.version_status as enum ('draft','published','retired');

-- ---------------------------------------------------------------------
-- Time helpers
-- ---------------------------------------------------------------------
-- "วันนี้" ตามเวลาประเทศไทย; ปรับได้ในการทดสอบผ่าน set_config('app.today_override', 'YYYY-MM-DD')
create or replace function app.today() returns date
language sql stable as $$
  select coalesce(nullif(current_setting('app.today_override', true), '')::date,
                  (now() at time zone 'Asia/Bangkok')::date)
$$;

create or replace function app.be_year(d date default null) returns int
language sql stable as $$ select extract(year from coalesce(d, app.today()))::int + 543 $$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------
-- Organizations: มหาวิทยาลัย → คณะ/หน่วยงาน (→ หน่วยย่อย)
-- ancestors = ลำดับ id ตั้งแต่รากถึงตัวเอง ใช้ตรวจสิทธิ์ตามลำดับชั้นได้เร็ว
-- ---------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references public.organizations(id) on delete restrict,
  code        text not null unique,
  name_th     text not null,
  name_en     text,
  org_type    text not null default 'faculty'
              check (org_type in ('university','faculty','office','center','unit')),
  ancestors   uuid[] not null default '{}',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint org_root_is_university check ((parent_id is null) = (org_type = 'university'))
);
create index organizations_parent_idx on public.organizations(parent_id);
create index organizations_ancestors_gin on public.organizations using gin(ancestors);

create or replace function app.org_set_ancestors() returns trigger
language plpgsql as $$
declare v_parent uuid[];
begin
  if new.parent_id is null then
    new.ancestors := array[new.id];
  else
    select ancestors into v_parent from public.organizations where id = new.parent_id;
    if v_parent is null then raise exception 'parent organization not found'; end if;
    if new.id = any(v_parent) then raise exception 'organization hierarchy cycle'; end if;
    new.ancestors := v_parent || new.id;
  end if;
  return new;
end $$;
create trigger organizations_ancestors before insert or update of parent_id on public.organizations
  for each row execute function app.org_set_ancestors();
create trigger organizations_touch before update on public.organizations
  for each row execute function app.touch_updated_at();

-- เมื่อย้ายหน่วยงานแม่ ให้ปรับ ancestors ของลูกหลานด้วย
create or replace function app.org_cascade_ancestors() returns trigger
language plpgsql as $$
begin
  if new.ancestors is distinct from old.ancestors then
    update public.organizations set parent_id = parent_id where parent_id = new.id;
  end if;
  return null;
end $$;
create trigger organizations_cascade after update of parent_id on public.organizations
  for each row execute function app.org_cascade_ancestors();

-- ---------------------------------------------------------------------
-- Locations: อาคาร → ชั้น → ห้อง/พื้นที่
-- ---------------------------------------------------------------------
create table public.buildings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  code             text not null unique,
  name             text not null,
  description      text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index buildings_org_idx on public.buildings(organization_id);
create trigger buildings_touch before update on public.buildings for each row execute function app.touch_updated_at();

create table public.floors (
  id           uuid primary key default gen_random_uuid(),
  building_id  uuid not null references public.buildings(id) on delete cascade,
  name         text not null,
  level        int not null default 1,
  created_at   timestamptz not null default now(),
  unique (building_id, name)
);
create index floors_building_idx on public.floors(building_id);

create table public.locations (
  id           uuid primary key default gen_random_uuid(),
  floor_id     uuid not null references public.floors(id) on delete cascade,
  name         text not null,
  room_no      text,
  location_type text,
  description  text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (floor_id, name)
);
create index locations_floor_idx on public.locations(floor_id);

-- ---------------------------------------------------------------------
-- Users / roles
-- ---------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text,
  full_name        text not null default '',
  phone            text,
  position         text,
  organization_id  uuid references public.organizations(id) on delete set null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index profiles_org_idx on public.profiles(organization_id);
create trigger profiles_touch before update on public.profiles for each row execute function app.touch_updated_at();

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

create table public.role_assignments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  role             public.app_role not null,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  granted_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (user_id, role, organization_id)
);
create index role_assignments_user_idx on public.role_assignments(user_id);
create index role_assignments_org_idx on public.role_assignments(organization_id);

-- ---------------------------------------------------------------------
-- Asset types & checklists (versioned)
-- ---------------------------------------------------------------------
create table public.checklist_templates (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  category         text not null check (category in (
                     'fire_extinguisher','fire_hose','emergency_light','fire_exit',
                     'fire_alarm','electrical','safety_patrol','laboratory','other')),
  description      text,
  organization_id  uuid references public.organizations(id) on delete cascade, -- null = แบบตรวจกลางของมหาวิทยาลัย
  is_active        boolean not null default true,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger checklist_templates_touch before update on public.checklist_templates for each row execute function app.touch_updated_at();

create table public.checklist_versions (
  id                     uuid primary key default gen_random_uuid(),
  template_id            uuid not null references public.checklist_templates(id) on delete cascade,
  version_no             int not null check (version_no > 0),
  status                 public.version_status not null default 'draft',
  -- true = ร่างสำหรับผู้เชี่ยวชาญตรวจรับรอง (ยังไม่ได้รับรองว่าสอดคล้องกฎหมาย/มาตรฐาน)
  is_expert_review_draft boolean not null default true,
  -- [{ "source": "...", "edition": "...", "checked_on": "YYYY-MM-DD", "checked_by": "..." }]
  legal_references       jsonb not null default '[]'::jsonb check (jsonb_typeof(legal_references) = 'array'),
  change_note            text,
  approved_by_expert     text,
  published_at           timestamptz,
  published_by           uuid references public.profiles(id) on delete set null,
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  unique (template_id, version_no),
  constraint published_has_timestamp check (status = 'draft' or published_at is not null)
);
create unique index checklist_versions_one_published on public.checklist_versions(template_id) where status = 'published';

create table public.checklist_items (
  id                      uuid primary key default gen_random_uuid(),
  version_id              uuid not null references public.checklist_versions(id) on delete cascade,
  seq                     int not null,
  section                 text,
  title                   text not null,
  description             text,
  method                  text,                                   -- วิธีตรวจ
  severity                public.severity_level not null default 'medium',
  allow_na                boolean not null default true,
  photo_required_on_fail  boolean not null default true,
  created_at              timestamptz not null default now(),
  unique (version_id, seq)
);
create index checklist_items_version_idx on public.checklist_items(version_id);

-- ห้ามแก้ไขรายการของเวอร์ชันที่เผยแพร่แล้ว เพื่อให้ประวัติการตรวจแสดงเกณฑ์ ณ วันที่ตรวจได้ถูกต้อง
create or replace function app.checklist_items_guard() returns trigger
language plpgsql as $$
declare v_status public.version_status;
begin
  select status into v_status from public.checklist_versions
   where id = coalesce(new.version_id, old.version_id);
  if v_status is distinct from 'draft' then
    raise exception using message = 'ไม่สามารถแก้ไขรายการตรวจของเวอร์ชันที่เผยแพร่แล้ว กรุณาสร้างเวอร์ชันใหม่',
                          hint = 'CHECKLIST_VERSION_LOCKED';
  end if;
  if tg_op = 'UPDATE' and new.version_id <> old.version_id then
    raise exception 'cannot move checklist item between versions';
  end if;
  return coalesce(new, old);
end $$;
create trigger checklist_items_guard before insert or update or delete on public.checklist_items
  for each row execute function app.checklist_items_guard();

create or replace function app.checklist_versions_guard() returns trigger
language plpgsql as $$
begin
  if old.status <> 'draft' then
    -- เวอร์ชันที่เผยแพร่แล้วเปลี่ยนได้เฉพาะสถานะ published → retired
    if new.status = 'retired' and old.status = 'published'
       and (new.template_id, new.version_no, new.legal_references, new.is_expert_review_draft)
           is not distinct from (old.template_id, old.version_no, old.legal_references, old.is_expert_review_draft) then
      return new;
    end if;
    raise exception using message = 'เวอร์ชันแบบตรวจที่เผยแพร่แล้วไม่สามารถแก้ไขได้', hint = 'CHECKLIST_VERSION_LOCKED';
  end if;
  return new;
end $$;
create trigger checklist_versions_guard before update on public.checklist_versions
  for each row execute function app.checklist_versions_guard();

create table public.asset_types (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,
  name                 text not null,
  category             text not null,
  default_template_id  uuid references public.checklist_templates(id) on delete set null,
  default_frequency    public.frequency not null default 'monthly',
  tracks_expiry        boolean not null default false,
  created_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Assets / inspection points (ทะเบียนจุดตรวจและอุปกรณ์)
-- ---------------------------------------------------------------------
create table public.assets (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  name                  text not null,
  asset_type_id         uuid not null references public.asset_types(id) on delete restrict,
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  building_id           uuid not null references public.buildings(id) on delete restrict,
  floor_id              uuid references public.floors(id) on delete restrict,
  location_id           uuid references public.locations(id) on delete restrict,
  location_detail       text,
  responsible_user_id   uuid references public.profiles(id) on delete set null,
  brand_model           text,
  serial_no             text,
  installed_on          date,
  expires_on            date,
  frequency             public.frequency not null default 'monthly',
  custom_interval_days  int check (custom_interval_days is null or custom_interval_days between 1 and 3650),
  last_inspected_at     timestamptz,
  next_due_on           date,
  status                public.asset_status not null default 'active',
  -- รหัสอ้างอิงถาวรสำหรับ QR Code: สุ่ม ไม่สื่อความหมาย ไม่มีข้อมูลส่วนบุคคล
  qr_token              text not null unique default encode(gen_random_bytes(9), 'hex'),
  photo_path            text,
  notes                 text,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint custom_frequency_needs_interval check (frequency <> 'custom' or custom_interval_days is not null),
  constraint expiry_after_install check (expires_on is null or installed_on is null or expires_on >= installed_on)
);
create index assets_org_idx on public.assets(organization_id);
create index assets_building_idx on public.assets(building_id);
create index assets_type_idx on public.assets(asset_type_id);
create index assets_status_idx on public.assets(status);
create index assets_next_due_idx on public.assets(next_due_on);
create trigger assets_touch before update on public.assets for each row execute function app.touch_updated_at();

-- ชั้น/ห้องต้องอยู่ในอาคารเดียวกัน
create or replace function app.assets_location_guard() returns trigger
language plpgsql as $$
begin
  if new.floor_id is not null and not exists
     (select 1 from public.floors f where f.id = new.floor_id and f.building_id = new.building_id) then
    raise exception 'ชั้นที่เลือกไม่อยู่ในอาคารนี้';
  end if;
  if new.location_id is not null and not exists
     (select 1 from public.locations l where l.id = new.location_id and l.floor_id = new.floor_id) then
    raise exception 'ห้อง/พื้นที่ที่เลือกไม่อยู่ในชั้นนี้';
  end if;
  return new;
end $$;
create trigger assets_location_guard before insert or update on public.assets
  for each row execute function app.assets_location_guard();

-- ---------------------------------------------------------------------
-- Planning
-- ---------------------------------------------------------------------
create table public.inspection_plans (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  building_id           uuid references public.buildings(id) on delete restrict,
  asset_type_id         uuid references public.asset_types(id) on delete restrict,
  template_id           uuid not null references public.checklist_templates(id) on delete restrict,
  frequency             public.frequency not null,
  custom_interval_days  int check (custom_interval_days is null or custom_interval_days between 1 and 3650),
  start_on              date not null,
  end_on                date,
  -- จำนวนวันนับจากวันเริ่มรอบที่ต้องตรวจให้เสร็จ (null = ภายในรอบนั้น)
  due_within_days       int check (due_within_days is null or due_within_days >= 1),
  default_inspector_id  uuid references public.profiles(id) on delete set null,
  is_active             boolean not null default true,
  created_by            uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint plan_custom_interval check (frequency <> 'custom' or custom_interval_days is not null),
  constraint plan_dates check (end_on is null or end_on >= start_on)
);
create index inspection_plans_org_idx on public.inspection_plans(organization_id);
create trigger inspection_plans_touch before update on public.inspection_plans for each row execute function app.touch_updated_at();

create table public.inspection_tasks (
  id                       uuid primary key default gen_random_uuid(),
  plan_id                  uuid references public.inspection_plans(id) on delete cascade,
  asset_id                 uuid not null references public.assets(id) on delete cascade,
  organization_id          uuid not null references public.organizations(id) on delete restrict,
  template_id              uuid not null references public.checklist_templates(id) on delete restrict,
  assignee_id              uuid references public.profiles(id) on delete set null,
  period_start             date not null,
  due_on                   date not null,
  status                   text not null default 'open' check (status in ('open','completed','cancelled')),
  completed_inspection_id  uuid,
  completed_at             timestamptz,
  created_at               timestamptz not null default now(),
  constraint task_window check (due_on >= period_start),
  constraint task_completed_consistency check ((status = 'completed') = (completed_inspection_id is not null))
);
create unique index inspection_tasks_plan_period_uq on public.inspection_tasks(plan_id, asset_id, period_start) where plan_id is not null;
create index inspection_tasks_org_due_idx on public.inspection_tasks(organization_id, due_on);
create index inspection_tasks_assignee_idx on public.inspection_tasks(assignee_id, status);
create index inspection_tasks_asset_idx on public.inspection_tasks(asset_id);

-- ---------------------------------------------------------------------
-- Inspections
-- ---------------------------------------------------------------------
create table public.inspections (
  id                    uuid primary key default gen_random_uuid(),
  task_id               uuid references public.inspection_tasks(id) on delete set null,
  asset_id              uuid not null references public.assets(id) on delete restrict,
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  checklist_version_id  uuid not null references public.checklist_versions(id) on delete restrict,
  inspector_id          uuid not null references public.profiles(id) on delete restrict,
  status                public.inspection_status not null default 'draft',
  started_at            timestamptz not null default now(),
  submitted_at          timestamptz,
  client_submission_id  uuid unique,
  pass_count            int not null default 0,
  fail_count            int not null default 0,
  na_count              int not null default 0,
  score_pct             numeric(5,2),
  overall_result        text check (overall_result in ('pass','fail','na')),
  summary_note          text,
  updated_at            timestamptz not null default now(),
  constraint submitted_consistency check ((status = 'submitted') = (submitted_at is not null))
);
-- 1 งานตรวจ ส่งผลได้ครั้งเดียว (กันการส่งซ้ำระดับฐานข้อมูล)
create unique index inspections_one_submitted_per_task on public.inspections(task_id) where status = 'submitted' and task_id is not null;
create index inspections_asset_idx on public.inspections(asset_id, submitted_at desc);
create index inspections_org_idx on public.inspections(organization_id, submitted_at);
create index inspections_inspector_idx on public.inspections(inspector_id, status);
create trigger inspections_touch before update on public.inspections for each row execute function app.touch_updated_at();

alter table public.inspection_tasks
  add constraint inspection_tasks_completed_fk foreign key (completed_inspection_id)
  references public.inspections(id) on delete restrict;

create table public.inspection_responses (
  id                   uuid primary key default gen_random_uuid(),
  inspection_id        uuid not null references public.inspections(id) on delete cascade,
  item_id              uuid not null references public.checklist_items(id) on delete restrict,
  result               public.item_result,
  note                 text,
  na_reason            text,
  urgency              public.severity_level,
  photo_exempt_reason  text,      -- เหตุผลที่ไม่แนบภาพ (ไม่ปลอดภัย/พื้นที่ห้ามถ่ายภาพ)
  answered_at          timestamptz not null default now(),
  unique (inspection_id, item_id)
);
create index inspection_responses_item_idx on public.inspection_responses(item_id);

-- ---------------------------------------------------------------------
-- Findings & corrective actions
-- ---------------------------------------------------------------------
create sequence public.finding_no_seq;
create table public.findings (
  id                  uuid primary key default gen_random_uuid(),
  finding_no          text not null unique,
  inspection_id       uuid not null references public.inspections(id) on delete restrict,
  response_id         uuid not null unique references public.inspection_responses(id) on delete restrict,
  checklist_item_id   uuid not null references public.checklist_items(id) on delete restrict,
  asset_id            uuid not null references public.assets(id) on delete restrict,
  organization_id     uuid not null references public.organizations(id) on delete restrict,
  title               text not null,
  description         text not null,
  severity            public.severity_level not null,
  initial_measure     text,
  status              public.finding_status not null default 'open',
  assignee_id         uuid references public.profiles(id) on delete restrict,
  responsible_org_id  uuid references public.organizations(id) on delete restrict,
  due_on              date,
  assigned_by         uuid references public.profiles(id) on delete set null,
  assigned_at         timestamptz,
  progress_pct        int not null default 0 check (progress_pct between 0 and 100),
  fix_submitted_by    uuid references public.profiles(id) on delete set null,
  fix_submitted_at    timestamptz,
  verified_by         uuid references public.profiles(id) on delete set null,
  verified_at         timestamptz,
  closed_at           timestamptz,
  rework_count        int not null default 0,
  recurrence_of       uuid references public.findings(id) on delete set null,
  recurrence_count    int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- ห้ามปิดงานโดยไม่มีผลตรวจยืนยัน
  constraint closed_requires_verification check (
    status <> 'closed' or (verified_by is not null and verified_at is not null and closed_at is not null)),
  constraint assigned_requires_owner check (
    status in ('open','closed') or (assignee_id is not null and due_on is not null)),
  constraint verifier_not_fixer check (verified_by is null or fix_submitted_by is null or verified_by <> fix_submitted_by)
);
create index findings_org_status_idx on public.findings(organization_id, status);
create index findings_assignee_idx on public.findings(assignee_id, status);
create index findings_asset_idx on public.findings(asset_id, checklist_item_id);
create index findings_due_idx on public.findings(due_on) where status <> 'closed';
create index findings_inspection_idx on public.findings(inspection_id);
create index findings_responsible_org_idx on public.findings(responsible_org_id);
create trigger findings_touch before update on public.findings for each row execute function app.touch_updated_at();

-- ลำดับสถานะที่อนุญาต
create or replace function app.findings_transition_guard() returns trigger
language plpgsql as $$
begin
  if new.status = old.status then return new; end if;
  if not (
       (old.status = 'open'                 and new.status = 'assigned')
    or (old.status = 'assigned'             and new.status in ('in_progress'))
    or (old.status = 'in_progress'          and new.status in ('pending_verification','assigned'))
    or (old.status = 'pending_verification' and new.status in ('closed','in_progress'))
  ) then
    raise exception using message = format('ไม่อนุญาตให้เปลี่ยนสถานะจาก %s เป็น %s', old.status, new.status),
                          hint = 'INVALID_TRANSITION';
  end if;
  return new;
end $$;
create trigger findings_transition_guard before update of status on public.findings
  for each row execute function app.findings_transition_guard();

-- ประวัติการดำเนินการ/เปลี่ยนสถานะทุกครั้ง (ผู้ดำเนินการ + เวลา)
create table public.corrective_actions (
  id            uuid primary key default gen_random_uuid(),
  finding_id    uuid not null references public.findings(id) on delete cascade,
  action_type   text not null check (action_type in
                 ('created','assign','reassign','start','progress','submit_fix','approve','reject','work_order','comment')),
  actor_id      uuid references public.profiles(id) on delete set null,
  note          text,
  progress_pct  int check (progress_pct is null or progress_pct between 0 and 100),
  from_status   public.finding_status,
  to_status     public.finding_status,
  created_at    timestamptz not null default now()
);
create index corrective_actions_finding_idx on public.corrective_actions(finding_id, created_at);

create sequence public.work_order_no_seq;
create table public.work_orders (
  id                  uuid primary key default gen_random_uuid(),
  wo_no               text not null unique,
  finding_id          uuid not null references public.findings(id) on delete cascade,
  target_unit         text not null,
  description         text not null,
  -- ยังไม่มี API ภายนอก: บันทึกเป็นใบงานในระบบ สถานะ not_connected
  integration_status  text not null default 'not_connected' check (integration_status in ('not_connected','sent','failed')),
  external_ref        text,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index work_orders_finding_idx on public.work_orders(finding_id);

-- ---------------------------------------------------------------------
-- Attachments (ไฟล์อยู่ใน Storage bucket แบบ private: attachments)
-- ---------------------------------------------------------------------
create table public.attachments (
  id               uuid primary key default gen_random_uuid(),
  entity_type      text not null check (entity_type in ('asset','inspection','finding')),
  entity_id        uuid not null,
  response_id      uuid references public.inspection_responses(id) on delete cascade,
  item_id          uuid references public.checklist_items(id) on delete set null,
  kind             text not null default 'evidence' check (kind in ('evidence','before','after','photo','document')),
  storage_path     text not null unique,
  mime_type        text not null,
  size_bytes       int not null check (size_bytes > 0 and size_bytes <= 10485760),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  uploaded_by      uuid not null references public.profiles(id) on delete restrict,
  created_at       timestamptz not null default now()
);
create index attachments_entity_idx on public.attachments(entity_type, entity_id);

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  type           text not null,
  title          text not null,
  body           text,
  link           text,
  entity_type    text,
  entity_id      uuid,
  dedupe_key     text not null,           -- ป้องกันการแจ้งเตือนซ้ำ
  read_at        timestamptz,
  email_status   text not null default 'pending' check (email_status in ('pending','sent','skipped','failed','not_required')),
  email_attempts int not null default 0,
  email_error    text,
  created_at     timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_email_idx on public.notifications(email_status) where email_status = 'pending';

-- ตั้งค่าการแจ้งเตือน (organization_id null = ค่าตั้งต้นของมหาวิทยาลัย)
create table public.notification_settings (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid unique references public.organizations(id) on delete cascade,
  due_soon_days          int not null default 3 check (due_soon_days between 0 and 60),
  escalate_after_days    int not null default 7 check (escalate_after_days between 1 and 365),
  escalation_roles       public.app_role[] not null default '{org_admin,safety_coordinator}',
  email_enabled          boolean not null default true,
  notify_on_assignment   boolean not null default true,
  notify_on_urgent       boolean not null default true,
  notify_on_verification boolean not null default true,
  updated_at             timestamptz not null default now()
);
create unique index notification_settings_default_uq on public.notification_settings((organization_id is null)) where organization_id is null;

-- ---------------------------------------------------------------------
-- Application settings (branding — ค่ากลางที่ผู้ดูแลเปลี่ยนได้)
-- ---------------------------------------------------------------------
create table public.app_settings (
  id                  int primary key default 1 check (id = 1),
  app_name            text not null default 'NU Safety Inspection',
  university_name_th  text not null default 'มหาวิทยาลัยนเรศวร',
  university_name_en  text not null default 'Naresuan University',
  primary_color       text not null default '#F26F21' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  dark_color          text not null default '#2F3337' check (dark_color ~ '^#[0-9A-Fa-f]{6}$'),
  -- ตรามหาวิทยาลัย: ต้องอัปโหลดไฟล์ทางการโดยผู้ดูแล ระบบไม่สร้างตราขึ้นเอง
  logo_url            text,
  sso_note            text,
  updated_at          timestamptz not null default now()
);
insert into public.app_settings (id) values (1);
insert into public.notification_settings (organization_id) values (null);

-- ---------------------------------------------------------------------
-- Audit log (append only)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id               bigint generated always as identity primary key,
  actor_id         uuid,
  action           text not null,
  table_name       text not null,
  record_id        text,
  organization_id  uuid,
  old_data         jsonb,
  new_data         jsonb,
  created_at       timestamptz not null default now()
);
create index audit_logs_record_idx on public.audit_logs(table_name, record_id);
create index audit_logs_created_idx on public.audit_logs(created_at desc);
create index audit_logs_org_idx on public.audit_logs(organization_id, created_at desc);

create or replace function app.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  if tg_op = 'UPDATE' and v_old = v_new then return null; end if;
  insert into public.audit_logs (actor_id, action, table_name, record_id, organization_id, old_data, new_data)
  values (auth.uid(), tg_op, tg_table_name, v_row->>'id',
          nullif(coalesce(v_row->>'organization_id', ''), '')::uuid, v_old, v_new);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['organizations','buildings','floors','locations','profiles','role_assignments',
    'checklist_templates','checklist_versions','checklist_items','asset_types','assets','inspection_plans',
    'inspection_tasks','inspections','findings','work_orders','attachments','notification_settings','app_settings']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function app.audit_trigger()', t || '_audit', t);
  end loop;
end $$;
