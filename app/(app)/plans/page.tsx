import { createClient } from "@/lib/supabase/server";
import { requireSession, hasRole, MANAGER_ROLES } from "@/lib/auth";
import { getFilterOptions } from "@/lib/queries";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, EmptyState, NoAccess, PageHeader, Table, Td, Th } from "@/components/ui";
import { FREQUENCY_LABELS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { PlanForm } from "./plan-form";
import type { Frequency } from "@/lib/types";

export const metadata = { title: "แผนการตรวจ" };

export default async function PlansPage() {
  const s = await requireSession();
  if (!hasRole(s, MANAGER_ROLES)) return <NoAccess />;
  const supabase = await createClient();
  const [plans, templates, types, options, taskCounts] = await Promise.all([
    supabase.from("inspection_plans").select("*, organizations(name_th), buildings(name), asset_types(name), checklist_templates(name), profiles:default_inspector_id(full_name)").order("created_at"),
    supabase.from("checklist_templates").select("id, name, category").eq("is_active", true).order("name"),
    supabase.from("asset_types").select("id, name, default_template_id").order("name"),
    getFilterOptions(),
    supabase.from("inspection_tasks").select("plan_id, status"),
  ]);
  const counts = new Map<string, { total: number; done: number }>();
  (taskCounts.data ?? []).forEach((t) => {
    if (!t.plan_id) return;
    const c = counts.get(t.plan_id) ?? { total: 0, done: 0 };
    c.total++; if (t.status === "completed") c.done++;
    counts.set(t.plan_id, c);
  });
  const manageableOrgs = options.orgs.filter((o) => s.roles.some((r) => MANAGER_ROLES.includes(r.role) && o.ancestors.includes(r.organization_id)));

  type PlanRow = {
    id: string; name: string; frequency: Frequency; custom_interval_days: number | null; start_on: string; end_on: string | null; is_active: boolean;
    organizations: { name_th: string } | null; buildings: { name: string } | null; asset_types: { name: string } | null;
    checklist_templates: { name: string } | null; profiles: { full_name: string } | null;
  };
  const rows = (plans.data ?? []) as unknown as PlanRow[];

  return (
    <>
      <PageHeader title="แผนการตรวจ" back={{ href: "/tasks", label: "งานตรวจ" }}
        subtitle="กำหนดรอบตรวจ (รายวัน/สัปดาห์/เดือน/ไตรมาส/ปี/กำหนดเอง) ระบบจะสร้างงานตรวจให้อุปกรณ์ทุกชิ้นที่ตรงเงื่อนไข" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          {rows.length === 0 ? <EmptyState title="ยังไม่มีแผนการตรวจ" description="สร้างแผนแรกจากแบบฟอร์มด้านข้าง" /> : (
            <Table>
              <thead><tr><Th>แผน</Th><Th>ขอบเขต</Th><Th>รอบ</Th><Th>งาน (ส่งแล้ว/ทั้งหมด)</Th><Th></Th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((p) => {
                  const c = counts.get(p.id) ?? { total: 0, done: 0 };
                  return (
                    <tr key={p.id}>
                      <Td><p className="font-medium">{p.name}</p><p className="text-xs text-gray-500">แบบตรวจ: {p.checklist_templates?.name}</p>
                        {!p.is_active && <Badge tone="neutral">ปิดใช้งาน</Badge>}</Td>
                      <Td className="text-xs">{p.organizations?.name_th}<br />{p.buildings?.name ?? "ทุกอาคาร"} · {p.asset_types?.name ?? "ทุกประเภท"}<br />ผู้ตรวจตั้งต้น: {p.profiles?.full_name ?? "—"}</Td>
                      <Td className="text-xs">{FREQUENCY_LABELS[p.frequency]}{p.frequency === "custom" ? ` ${p.custom_interval_days} วัน` : ""}<br />เริ่ม {formatDate(p.start_on)}{p.end_on ? ` ถึง ${formatDate(p.end_on)}` : ""}</Td>
                      <Td className="text-xs">{c.done}/{c.total}</Td>
                      <Td className="space-y-1">
                        {p.is_active && <ActionButton action="generateTasks" args={[p.id]}>สร้างงานถึงสิ้นปี</ActionButton>}
                        <ActionButton action="togglePlan" args={[p.id, !p.is_active]} variant="ghost">{p.is_active ? "ปิดใช้แผน" : "เปิดใช้แผน"}</ActionButton>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </div>
        <Card title="สร้างแผนการตรวจใหม่">
          <PlanForm orgs={manageableOrgs} buildings={options.buildings} templates={templates.data ?? []} types={types.data ?? []} people={options.people} />
        </Card>
      </div>
    </>
  );
}
