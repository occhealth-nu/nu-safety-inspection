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
