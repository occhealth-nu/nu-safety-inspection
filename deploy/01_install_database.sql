-- =====================================================================
-- NU Safety Inspection — ติดตั้งฐานข้อมูลทั้งหมด (รวม migrations)
-- วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run (รันครั้งเดียว)
-- =====================================================================

-- >>>>>>>>>> 20261023000001_core_schema.sql >>>>>>>>>>
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

-- >>>>>>>>>> 20261023000002_rls_policies.sql >>>>>>>>>>
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

-- >>>>>>>>>> 20261023000003_workflow_functions.sql >>>>>>>>>>
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

-- >>>>>>>>>> 20261023000004_dashboard.sql >>>>>>>>>>
-- =====================================================================
-- Views & dashboard functions
-- ทุก view/ฟังก์ชันในไฟล์นี้เป็น security invoker → ผลลัพธ์ถูกกรองด้วย RLS ตามสิทธิ์ผู้เรียกเสมอ
-- =====================================================================

create or replace view public.v_inspection_tasks with (security_invoker = true) as
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
       (t.status = 'completed' and (t.completed_at at time zone 'Asia/Bangkok')::date > t.due_on) as completed_late
  from public.inspection_tasks t
  join public.assets a on a.id = t.asset_id
  join public.asset_types aty on aty.id = a.asset_type_id
  join public.buildings b on b.id = a.building_id
  join public.organizations o on o.id = t.organization_id
  join public.checklist_templates ct on ct.id = t.template_id
  left join public.profiles p on p.id = t.assignee_id
  left join public.inspections i on i.id = t.completed_inspection_id;

create or replace view public.v_findings with (security_invoker = true) as
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
       (f.status <> 'closed' and f.severity in ('high','critical')) as is_urgent_open
  from public.findings f
  join public.assets a on a.id = f.asset_id
  join public.asset_types aty on aty.id = a.asset_type_id
  join public.buildings b on b.id = a.building_id
  join public.organizations o on o.id = f.organization_id
  left join public.profiles p on p.id = f.assignee_id
  left join public.organizations ro on ro.id = f.responsible_org_id;

create or replace view public.v_assets with (security_invoker = true) as
select a.*, aty.name as asset_type_name, aty.category, aty.tracks_expiry,
       b.name as building_name, fl.name as floor_name, l.name as location_name,
       o.name_th as organization_name, o.ancestors as org_ancestors, p.full_name as responsible_name,
       (select count(*) from public.findings f where f.asset_id = a.id and f.status <> 'closed') as open_findings
  from public.assets a
  join public.asset_types aty on aty.id = a.asset_type_id
  join public.buildings b on b.id = a.building_id
  join public.organizations o on o.id = a.organization_id
  left join public.floors fl on fl.id = a.floor_id
  left join public.locations l on l.id = a.location_id
  left join public.profiles p on p.id = a.responsible_user_id;

create or replace view public.v_inspections with (security_invoker = true) as
select i.*, a.code as asset_code, a.name as asset_name, a.building_id, aty.category,
       b.name as building_name, o.name_th as organization_name, o.ancestors as org_ancestors,
       p.full_name as inspector_name, ct.name as template_name, cv.version_no, cv.is_expert_review_draft
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
-- KPI หลัก (นิยามสูตรอยู่ใน docs/KPI_DEFINITIONS.md)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_kpis(
  p_from date, p_to date,
  p_org uuid default null, p_building uuid default null, p_category text default null, p_assignee uuid default null)
returns jsonb
language sql stable security invoker set search_path = public as $$
with
tasks as (
  select * from public.v_inspection_tasks t
   where t.status <> 'cancelled' and t.due_on between p_from and p_to
     and (p_org is null or p_org = any(t.org_ancestors))
     and (p_building is null or t.building_id = p_building)
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
     and (p_category is null or i.category = p_category)
     and (p_assignee is null or i.inspector_id = p_assignee)
),
fnd as (
  select * from public.v_findings f
   where (p_org is null or p_org = any(f.org_ancestors))
     and (p_building is null or f.building_id = p_building)
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
  p_org uuid default null, p_building uuid default null, p_category text default null, p_assignee uuid default null)
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
     and (p_category is null or t.category = p_category)
     and (p_assignee is null or t.assignee_id = p_assignee)
   group by 1, 2, 3
   order by 2, 3
$$;

-- แนวโน้มรายเดือน
create or replace function public.dashboard_trend(
  p_from date, p_to date,
  p_org uuid default null, p_building uuid default null, p_category text default null, p_assignee uuid default null)
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
       and (p_category is null or category = p_category) and (p_assignee is null or assignee_id = p_assignee)
     group by 1
  ),
  f as (
    select date_trunc('month', (created_at at time zone 'Asia/Bangkok'))::date m, count(*) n
      from public.v_findings
     where (p_org is null or p_org = any(org_ancestors)) and (p_building is null or building_id = p_building)
       and (p_category is null or category = p_category) and (p_assignee is null or assignee_id = p_assignee)
     group by 1
  ),
  c as (
    select date_trunc('month', (closed_at at time zone 'Asia/Bangkok'))::date m, count(*) n
      from public.v_findings
     where status = 'closed'
       and (p_org is null or p_org = any(org_ancestors)) and (p_building is null or building_id = p_building)
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
  p_org uuid default null, p_building uuid default null, p_category text default null, p_assignee uuid default null)
returns table (category text, total bigint, open bigint, closed bigint, urgent bigint)
language sql stable security invoker set search_path = public as $$
  select category, count(*), count(*) filter (where status <> 'closed'), count(*) filter (where status = 'closed'),
         count(*) filter (where severity in ('high','critical'))
    from public.v_findings
   where (created_at at time zone 'Asia/Bangkok')::date between p_from and p_to
     and (p_org is null or p_org = any(org_ancestors)) and (p_building is null or building_id = p_building)
     and (p_category is null or category = p_category) and (p_assignee is null or assignee_id = p_assignee)
   group by category
   order by count(*) desc
$$;

-- กิจกรรมล่าสุด (ผ่าน RLS)
create or replace function public.dashboard_recent_activity(p_limit int default 15, p_org uuid default null)
returns table (at timestamptz, kind text, title text, detail text, link text, actor text)
language sql stable security invoker set search_path = public as $$
  (select i.submitted_at, 'inspection',
          'ส่งผลตรวจ ' || i.asset_code || ' ' || i.asset_name,
          case when i.fail_count > 0 then 'พบข้อบกพร่อง ' || i.fail_count || ' ข้อ' else 'ผ่านทุกข้อที่เกี่ยวข้อง' end,
          '/inspections/' || i.id, i.inspector_name
     from public.v_inspections i
    where i.status = 'submitted' and (p_org is null or p_org = any(i.org_ancestors))
    order by i.submitted_at desc limit p_limit)
  union all
  (select ca.created_at, 'finding_' || ca.action_type, f.finding_no || ' ' || f.title,
          coalesce(ca.note, ''), '/findings/' || f.id, p.full_name
     from public.corrective_actions ca
     join public.v_findings f on f.id = ca.finding_id
     left join public.profiles p on p.id = ca.actor_id
    where ca.action_type <> 'created' and (p_org is null or p_org = any(f.org_ancestors))
    order by ca.created_at desc limit p_limit)
  order by 1 desc
  limit p_limit
$$;

grant execute on function public.dashboard_kpis(date, date, uuid, uuid, text, uuid),
  public.dashboard_annual(int, text, uuid, uuid, text, uuid),
  public.dashboard_trend(date, date, uuid, uuid, text, uuid),
  public.dashboard_findings_by_category(date, date, uuid, uuid, text, uuid),
  public.dashboard_recent_activity(int, uuid) to authenticated;
revoke execute on function public.dashboard_kpis(date, date, uuid, uuid, text, uuid),
  public.dashboard_annual(int, text, uuid, uuid, text, uuid),
  public.dashboard_trend(date, date, uuid, uuid, text, uuid),
  public.dashboard_findings_by_category(date, date, uuid, uuid, text, uuid),
  public.dashboard_recent_activity(int, uuid) from public, anon;

-- >>>>>>>>>> 20261023000005_storage.sql >>>>>>>>>>
-- =====================================================================
-- Storage: bucket "attachments" แบบ private (เข้าถึงผ่าน signed URL อายุจำกัดเท่านั้น)
-- โครงสร้าง path: {entity_type}/{entity_id}/{uuid}.{ext}
-- bucket "branding" แบบ public สำหรับตรามหาวิทยาลัยที่ผู้ดูแลอัปโหลด (ไม่ใช่ข้อมูลลับ)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 2097152, array['image/png','image/svg+xml','image/webp','image/jpeg'])
on conflict (id) do nothing;

create or replace function app.storage_path_parts(p_name text, out entity_type text, out entity_id uuid)
language plpgsql immutable as $$
declare parts text[] := string_to_array(p_name, '/');
begin
  entity_type := parts[1];
  begin
    entity_id := parts[2]::uuid;
  exception when others then
    entity_id := null;
  end;
end $$;

create or replace function app.storage_can_read(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  v := app.storage_path_parts(p_name);
  if v.entity_id is null then return false; end if;
  return app.can_view_attachment(v.entity_type, v.entity_id);
end $$;

create or replace function app.storage_can_upload(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  v := app.storage_path_parts(p_name);
  if v.entity_id is null or p_name like '%..%' then return false; end if;
  perform app.attachment_target(v.entity_type, v.entity_id,
    case v.entity_type when 'inspection' then 'evidence' when 'finding' then 'after' else 'photo' end, true);
  return true;
exception when others then
  return false;
end $$;

grant execute on function app.storage_path_parts(text), app.storage_can_read(text), app.storage_can_upload(text) to authenticated;

drop policy if exists "nu_attachments_read" on storage.objects;
drop policy if exists "nu_attachments_insert" on storage.objects;
drop policy if exists "nu_attachments_delete" on storage.objects;
drop policy if exists "nu_branding_write" on storage.objects;

create policy "nu_attachments_read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and app.storage_can_read(name));
create policy "nu_attachments_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and app.storage_can_upload(name));
-- ลบได้เฉพาะไฟล์ของตนที่ไม่มีการอ้างอิงในตาราง attachments แล้ว (ลบผ่าน remove_attachment ก่อน)
create policy "nu_attachments_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and owner_id = (select auth.uid())::text
         and not exists (select 1 from public.attachments a where a.storage_path = name));
create policy "nu_branding_write" on storage.objects for all to authenticated
  using (bucket_id = 'branding' and app.is_system_admin())
  with check (bucket_id = 'branding' and app.is_system_admin());

-- >>>>>>>>>> 20261023000006_admin_helpers.sql >>>>>>>>>>
-- =====================================================================
-- RPC ช่วยงานผู้ดูแล: ตรวจสิทธิ์ก่อนเรียก Auth Admin API ฝั่งเซิร์ฟเวอร์
-- =====================================================================
create or replace function public.i_can_manage_org(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and app.can_manage_org(p_org)
$$;

create or replace function public.i_am_system_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and app.is_system_admin()
$$;

-- ผู้ดูแลหน่วยงานเปิด/ระงับบัญชี และย้ายผู้ใช้ภายในขอบเขตของตน
create or replace function public.set_profile_admin(p_user uuid, p_organization_id uuid, p_is_active boolean,
                                                    p_full_name text default null, p_position text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login(); v_old uuid;
begin
  select organization_id into v_old from public.profiles where id = p_user;
  if not found then perform app.fail('NOT_FOUND', 'ไม่พบผู้ใช้'); end if;
  if not app.is_system_admin() then
    if (v_old is not null and not app.can_manage_org(v_old))
       or (p_organization_id is null or not app.can_manage_org(p_organization_id)) then
      perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์จัดการผู้ใช้นอกหน่วยงานของตน');
    end if;
  end if;
  if p_user = v_me and not p_is_active then perform app.fail('FORBIDDEN', 'ไม่สามารถระงับบัญชีของตนเองได้'); end if;
  update public.profiles set organization_id = p_organization_id, is_active = p_is_active,
         full_name = coalesce(nullif(trim(p_full_name), ''), full_name), position = coalesce(p_position, position)
   where id = p_user;
end $$;

-- ผู้ใช้ที่สร้างใหม่ (ยังไม่มีหน่วยงาน) — กำหนดหน่วยงานครั้งแรกโดยผู้มีสิทธิ์จัดการหน่วยงานปลายทาง
create or replace function public.claim_new_profile(p_user uuid, p_organization_id uuid, p_full_name text, p_position text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := app.require_login();
begin
  if not app.can_manage_org(p_organization_id) then perform app.fail('FORBIDDEN', 'ไม่มีสิทธิ์เพิ่มผู้ใช้ในหน่วยงานนี้'); end if;
  update public.profiles set organization_id = p_organization_id, full_name = coalesce(nullif(trim(p_full_name), ''), full_name), position = p_position
   where id = p_user and organization_id is null and created_at > now() - interval '1 hour';
  if not found then perform app.fail('INVALID_STATE', 'ผู้ใช้นี้ถูกกำหนดหน่วยงานไปแล้ว'); end if;
end $$;

revoke execute on function public.i_can_manage_org(uuid), public.i_am_system_admin(),
  public.set_profile_admin(uuid, uuid, boolean, text, text), public.claim_new_profile(uuid, uuid, text, text) from public, anon;
grant execute on function public.i_can_manage_org(uuid), public.i_am_system_admin(),
  public.set_profile_admin(uuid, uuid, boolean, text, text), public.claim_new_profile(uuid, uuid, text, text) to authenticated;

-- >>>>>>>>>> 20261023000007_google_sso.sql >>>>>>>>>>
-- =====================================================================
-- เข้าสู่ระบบด้วยบัญชี Google ของมหาวิทยาลัย — จำกัดเฉพาะโดเมนที่อนุญาต (ค่าเริ่มต้น nu.ac.th)
-- ป้องกัน 3 ชั้น:
--   1) ปุ่ม Google ส่ง hd=nu.ac.th (เป็นเพียงคำแนะนำให้ Google แสดงบัญชีมหาวิทยาลัย)
--   2) ฐานข้อมูลปฏิเสธการสร้าง/เชื่อมบัญชีจากผู้ให้บริการภายนอกที่อีเมลไม่อยู่ในโดเมนที่อนุญาต (trigger นี้)
--   3) /auth/callback ตรวจซ้ำและออกจากระบบทันทีหากไม่ผ่าน
-- และแม้ผ่านทั้งหมด ผู้ใช้ใหม่จะยังไม่เห็นข้อมูลใดจนกว่าผู้ดูแลกำหนดบทบาทให้ (RLS)
-- =====================================================================

alter table public.app_settings
  add column if not exists allowed_email_domains text[] not null default '{nu.ac.th}'
  check (cardinality(allowed_email_domains) >= 1);

create or replace function app.email_domain_allowed(p_email text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select lower(split_part(coalesce(p_email, ''), '@', 2)) = any(select lower(trim(d)) from unnest(s.allowed_email_domains) d)
      from public.app_settings s where s.id = 1), false)
$$;

create or replace function public.email_domain_allowed(p_email text) returns boolean
language sql stable security definer set search_path = public as $$ select app.email_domain_allowed(p_email) $$;
revoke execute on function public.email_domain_allowed(text) from public, anon;
grant execute on function public.email_domain_allowed(text) to authenticated, service_role;

-- ตรวจทุกครั้งที่มีการสร้าง/เชื่อมตัวตนจากผู้ให้บริการภายนอก (Google ฯลฯ)
create or replace function app.guard_external_identity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text; v_hd text; v_verified text;
begin
  if new.provider in ('email', 'phone') then return new; end if;
  v_email := lower(coalesce(new.identity_data->>'email', ''));
  v_hd := lower(nullif(new.identity_data->'custom_claims'->>'hd', ''));
  v_verified := coalesce(new.identity_data->>'email_verified', 'true');
  if not app.email_domain_allowed(v_email) then
    raise exception using errcode = 'P0001', message = 'อนุญาตเฉพาะบัญชีอีเมลของมหาวิทยาลัย', hint = 'DOMAIN_NOT_ALLOWED';
  end if;
  -- บัญชี Google Workspace จะมี hd = โดเมนองค์กร; ถ้ามีต้องตรงกับโดเมนที่อนุญาต
  if v_hd is not null and not app.email_domain_allowed('x@' || v_hd) then
    raise exception using errcode = 'P0001', message = 'อนุญาตเฉพาะบัญชี Google ขององค์กรมหาวิทยาลัย', hint = 'DOMAIN_NOT_ALLOWED';
  end if;
  if v_verified = 'false' then
    raise exception using errcode = 'P0001', message = 'อีเมลยังไม่ได้รับการยืนยัน', hint = 'EMAIL_NOT_VERIFIED';
  end if;
  return new;
end $$;

-- หากแพลตฟอร์มไม่อนุญาตสร้าง trigger บน auth.identities จะแจ้งเตือนแต่ไม่หยุดการติดตั้ง
-- (ยังมีการตรวจที่ /auth/callback และผู้ใช้ที่ไม่มีบทบาทมองไม่เห็นข้อมูลใด)
do $$ begin
  drop trigger if exists nu_guard_external_identity on auth.identities;
  create trigger nu_guard_external_identity before insert or update of identity_data on auth.identities
    for each row execute function app.guard_external_identity();
exception when insufficient_privilege then
  raise warning 'ไม่สามารถสร้าง trigger จำกัดโดเมนบน auth.identities (ไม่มีสิทธิ์) — ระบบยังตรวจโดเมนที่ /auth/callback';
end $$;

-- แจ้งผู้ดูแลส่วนกลางเมื่อมีบุคลากรเข้าสู่ระบบด้วย Google ครั้งแรกและยังไม่มีบทบาท
create or replace function app.notify_new_external_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_root uuid; v_name text;
begin
  if new.provider in ('email', 'phone') then return null; end if;
  if exists (select 1 from public.role_assignments where user_id = new.user_id) then return null; end if;
  select id into v_root from public.organizations where parent_id is null limit 1;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = new.user_id;
  perform app.notify_roles('{system_admin,safety_coordinator}', v_root, 'user_pending', 'ผู้ใช้ใหม่รอกำหนดสิทธิ์',
    format('%s (%s) เข้าสู่ระบบด้วยบัญชี Google ครั้งแรก — กรุณากำหนดหน่วยงานและบทบาท', coalesce(v_name, ''), new.identity_data->>'email'),
    '/settings/users?pending=1', 'profile', new.user_id, 'user_pending:' || new.user_id);
  return null;
end $$;

do $$ begin
  drop trigger if exists nu_notify_new_external_user on auth.identities;
  create trigger nu_notify_new_external_user after insert on auth.identities
    for each row execute function app.notify_new_external_user();
exception when insufficient_privilege then
  raise warning 'ไม่สามารถสร้าง trigger แจ้งผู้ใช้ใหม่บน auth.identities (ไม่มีสิทธิ์)';
end $$;

-- ชื่อจากบัญชี Google (full_name / name) สำหรับโปรไฟล์ที่สร้างอัตโนมัติ
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), nullif(new.raw_user_meta_data->>'name', ''),
                                      split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
