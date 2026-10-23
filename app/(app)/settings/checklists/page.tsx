import Link from "next/link";
import { requireSession, hasRole, isCentral, MANAGER_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFilterOptions } from "@/lib/queries";
import { SimpleForm } from "@/components/simple-form";
import { Badge, Card, ExpertDraftBadge, Field, NoAccess, PageHeader, inputClass } from "@/components/ui";
import { CATEGORY_LABELS } from "@/lib/labels";

export const metadata = { title: "แบบตรวจ" };

export default async function ChecklistsPage() {
  const s = await requireSession();
  if (!hasRole(s, MANAGER_ROLES)) return <NoAccess />;
  const supabase = await createClient();
  const [{ data: templates }, { data: versions }, opts] = await Promise.all([
    supabase.from("checklist_templates").select("*, organizations(name_th)").order("code"),
    supabase.from("checklist_versions").select("template_id, version_no, status, is_expert_review_draft"),
    getFilterOptions(),
  ]);
  const manageable = opts.orgs.filter((o) => s.roles.some((r) => MANAGER_ROLES.includes(r.role) && o.ancestors.includes(r.organization_id)));
  return (
    <>
      <PageHeader title="แบบตรวจ" back={{ href: "/settings", label: "ตั้งค่าระบบ" }}
        subtitle="แบบตรวจมีเวอร์ชัน — เวอร์ชันที่เผยแพร่แล้วแก้ไขไม่ได้ เพื่อให้ประวัติแสดงเกณฑ์ที่ใช้ในวันตรวจได้ถูกต้อง" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-2 lg:col-span-2">
          {(templates ?? []).map((t) => {
            const vs = (versions ?? []).filter((v) => v.template_id === t.id);
            const pub = vs.find((v) => v.status === "published");
            const draft = vs.find((v) => v.status === "draft");
            return (
              <Link key={t.id} href={`/settings/checklists/${t.id}`} className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-brand">
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-gray-500">{t.code}</span><span className="font-semibold">{t.name}</span>
                  {pub ? <Badge tone="good">ใช้งาน v{pub.version_no}</Badge> : <Badge tone="warning">ยังไม่เผยแพร่</Badge>}
                  {draft && <Badge tone="info">มีร่าง v{draft.version_no}</Badge>}{pub?.is_expert_review_draft && <ExpertDraftBadge />}</div>
                <p className="text-sm text-gray-600">{CATEGORY_LABELS[t.category]} · {(t as { organizations?: { name_th: string } | null }).organizations?.name_th ?? "แบบตรวจกลางของมหาวิทยาลัย"}</p>
              </Link>
            );
          })}
        </div>
        <Card title="สร้างแบบตรวจใหม่">
          <SimpleForm action="createTemplate" submitLabel="สร้างและแก้ไขรายการ">
            <Field label="รหัส" required><input name="code" required className={inputClass} /></Field>
            <Field label="ชื่อแบบตรวจ" required><input name="name" required className={inputClass} /></Field>
            <Field label="หมวด" required><select name="category" className={inputClass}>{Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="ใช้กับ"><select name="organization_id" className={inputClass}>
              {isCentral(s) && <option value="">ทั้งมหาวิทยาลัย (แบบตรวจกลาง)</option>}
              {manageable.filter((o) => o.parent_id).map((o) => <option key={o.id} value={o.id}>{o.name_th}</option>)}
            </select></Field>
            <Field label="คำอธิบาย"><textarea name="description" rows={2} className={inputClass} /></Field>
          </SimpleForm>
        </Card>
      </div>
    </>
  );
}
