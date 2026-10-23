import { requireSession, hasRole, MANAGER_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, NoAccess, PageHeader, Table, Td, Th, inputClass, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "ประวัติการใช้งาน" };
const TABLES: Record<string, string> = { assets: "จุดตรวจ", inspections: "ผลตรวจ", findings: "ข้อบกพร่อง", inspection_tasks: "งานตรวจ", inspection_plans: "แผนการตรวจ", role_assignments: "สิทธิ์ผู้ใช้", profiles: "ผู้ใช้", checklist_versions: "เวอร์ชันแบบตรวจ", checklist_items: "รายการตรวจ", organizations: "หน่วยงาน", buildings: "อาคาร", app_settings: "ตั้งค่าระบบ", attachments: "ไฟล์แนบ", work_orders: "ใบงาน" };
const ACT: Record<string, string> = { INSERT: "เพิ่ม", UPDATE: "แก้ไข", DELETE: "ลบ" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ table?: string }> }) {
  const s = await requireSession();
  if (!hasRole(s, MANAGER_ROLES)) return <NoAccess />;
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("audit_logs").select("id, actor_id, action, table_name, record_id, created_at, new_data, old_data").order("created_at", { ascending: false }).limit(200);
  if (sp.table) q = q.eq("table_name", sp.table);
  const { data } = await q;
  const actorIds = Array.from(new Set((data ?? []).map((d) => d.actor_id).filter(Boolean)));
  const { data: people } = actorIds.length ? await supabase.from("profiles").select("id, full_name").in("id", actorIds) : { data: [] };
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const changed = (o: Record<string, unknown> | null, n: Record<string, unknown> | null) =>
    o && n ? Object.keys(n).filter((k) => !["updated_at"].includes(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k])).join(", ") : "";
  return (
    <>
      <PageHeader title="ประวัติการใช้งาน (Audit log)" back={{ href: "/settings", label: "ตั้งค่าระบบ" }} subtitle="200 รายการล่าสุดในขอบเขตสิทธิ์ — บันทึกแบบเพิ่มอย่างเดียว แก้ไข/ลบไม่ได้" />
      <form className="mb-3 flex gap-2"><select name="table" defaultValue={sp.table ?? ""} className={inputClass + " sm:w-60"}><option value="">ทุกตาราง</option>{Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><button className={buttonClass("secondary")}>กรอง</button></form>
      {(data ?? []).length === 0 ? <EmptyState title="ไม่มีรายการ" /> : (
        <Table>
          <thead><tr><Th>เวลา</Th><Th>ผู้ดำเนินการ</Th><Th>การกระทำ</Th><Th>ข้อมูล</Th><Th>ฟิลด์ที่เปลี่ยน</Th></tr></thead>
          <tbody className="divide-y divide-gray-100">{(data ?? []).map((d) => (
            <tr key={d.id}><Td className="whitespace-nowrap text-xs">{formatDateTime(d.created_at)}</Td><Td className="text-xs">{d.actor_id ? name.get(d.actor_id) ?? d.actor_id.slice(0, 8) : "ระบบ"}</Td>
              <Td className="text-xs">{ACT[d.action] ?? d.action}</Td><Td className="text-xs">{TABLES[d.table_name] ?? d.table_name} <span className="font-mono text-gray-400">{d.record_id?.slice(0, 8)}</span></Td>
              <Td className="max-w-xs truncate text-xs text-gray-600">{changed(d.old_data, d.new_data)}</Td></tr>
          ))}</tbody>
        </Table>
      )}
    </>
  );
}
