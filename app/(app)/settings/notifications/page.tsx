import { requireSession, hasRole, isCentral, MANAGER_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFilterOptions } from "@/lib/queries";
import { SimpleForm } from "@/components/simple-form";
import { Card, Field, NoAccess, NotConnected, PageHeader, inputClass } from "@/components/ui";
import { ROLE_LABELS, ROLES } from "@/lib/labels";

export const metadata = { title: "การแจ้งเตือน" };

type NS = { id: string; organization_id: string | null; due_soon_days: number; escalate_after_days: number; escalation_roles: string[]; email_enabled: boolean; notify_on_assignment: boolean; notify_on_urgent: boolean; notify_on_verification: boolean };

function SettingsForm({ ns, orgId }: { ns?: NS; orgId?: string }) {
  return (
    <SimpleForm action="saveNotificationSettings">
      {ns && <input type="hidden" name="id" value={ns.id} />}
      {!ns && orgId && <input type="hidden" name="organization_id" value={orgId} />}
      <div className="grid grid-cols-2 gap-2">
        <Field label="เตือนล่วงหน้าก่อนครบกำหนด (วัน)"><input type="number" name="due_soon_days" min={0} max={60} defaultValue={ns?.due_soon_days ?? 3} className={inputClass} /></Field>
        <Field label="ยกระดับเมื่อเกินกำหนด (วัน)"><input type="number" name="escalate_after_days" min={1} max={365} defaultValue={ns?.escalate_after_days ?? 7} className={inputClass} /></Field>
      </div>
      <fieldset><legend className="mb-1 text-sm font-medium">ผู้รับการยกระดับเรื่อง</legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{ROLES.map((r) => <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" name="escalation_roles" value={r} defaultChecked={(ns?.escalation_roles ?? ["org_admin", "safety_coordinator"]).includes(r)} />{ROLE_LABELS[r]}</label>)}</div>
      </fieldset>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {([["email_enabled", "ส่งอีเมลด้วย"], ["notify_on_assignment", "แจ้งเมื่อได้รับมอบหมาย"], ["notify_on_urgent", "แจ้งเมื่อพบข้อบกพร่องเร่งด่วน"], ["notify_on_verification", "แจ้งเมื่อส่งผลแก้ไข/มีผลตรวจยืนยัน"]] as const).map(([k, l]) => (
          <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name={k} defaultChecked={ns ? ns[k] : true} />{l}</label>
        ))}
      </div>
    </SimpleForm>
  );
}

export default async function NotificationSettingsPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const s = await requireSession();
  if (!hasRole(s, MANAGER_ROLES)) return <NoAccess />;
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data }, opts] = await Promise.all([supabase.from("notification_settings").select("*"), getFilterOptions()]);
  const all = (data ?? []) as NS[];
  const def = all.find((x) => !x.organization_id);
  const manageable = opts.orgs.filter((o) => o.parent_id && s.roles.some((r) => MANAGER_ROLES.includes(r.role) && o.ancestors.includes(r.organization_id)));
  const sel = sp.org ?? manageable[0]?.id;
  return (
    <>
      <PageHeader title="การแจ้งเตือน" back={{ href: "/settings", label: "ตั้งค่าระบบ" }} subtitle="ระบบป้องกันการแจ้งเตือนซ้ำด้วยรหัสเหตุการณ์ (1 เหตุการณ์ต่อผู้รับ 1 ครั้ง)" />
      {!process.env.SMTP_HOST && <div className="mb-4"><NotConnected>ยังไม่ได้ตั้งค่า SMTP — ระบบบันทึกการแจ้งเตือนในระบบเท่านั้น อีเมลจะถูกทำเครื่องหมาย “ข้าม” จนกว่าจะตั้งค่า</NotConnected></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="ค่าตั้งต้นของมหาวิทยาลัย">{isCentral(s) ? <SettingsForm ns={def} /> : <p className="text-sm text-gray-600">เฉพาะผู้ดูแลส่วนกลางแก้ไขได้ — เตือนล่วงหน้า {def?.due_soon_days} วัน, ยกระดับเมื่อเกิน {def?.escalate_after_days} วัน</p>}</Card>
        <Card title="ค่าเฉพาะหน่วยงาน (แทนค่าตั้งต้น)">
          <form className="mb-3"><select name="org" defaultValue={sel} className={inputClass}>{manageable.map((o) => <option key={o.id} value={o.id}>{o.name_th}</option>)}</select><button className="mt-1 text-sm text-brand underline">เลือกหน่วยงาน</button></form>
          {sel && <SettingsForm key={sel} ns={all.find((x) => x.organization_id === sel)} orgId={sel} />}
        </Card>
      </div>
    </>
  );
}
