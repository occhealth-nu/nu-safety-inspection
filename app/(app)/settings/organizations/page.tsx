import { requireSession, isCentral, isSystemAdmin } from "@/lib/auth";
import { getFilterOptions } from "@/lib/queries";
import { SimpleForm } from "@/components/simple-form";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, Field, NoAccess, PageHeader, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import type { Organization } from "@/lib/types";

export const metadata = { title: "หน่วยงาน" };
const TYPES: Record<string, string> = { university: "มหาวิทยาลัย", faculty: "คณะ", office: "กอง/สำนักงาน", center: "ศูนย์/สถาบัน", unit: "หน่วยย่อย" };

export default async function OrgsPage() {
  const s = await requireSession();
  if (!isCentral(s)) return <NoAccess />;
  const supabase = await createClient();
  const { data } = await supabase.from("organizations").select("*").order("code");
  const opts = await getFilterOptions();
  const all = (data ?? []) as Organization[];
  const tree: Organization[] = [];
  const add = (p: string | null) => all.filter((o) => o.parent_id === p).forEach((o) => { tree.push(o); add(o.id); });
  add(null);
  const admin = isSystemAdmin(s);
  return (
    <>
      <PageHeader title="หน่วยงาน" back={{ href: "/settings", label: "ตั้งค่าระบบ" }} subtitle="สิทธิ์ที่กำหนดให้หน่วยงานมีผลกับหน่วยงานย่อยทั้งหมด" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="โครงสร้างหน่วยงาน">
          <ul className="divide-y divide-gray-100">
            {tree.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 py-2" style={{ paddingLeft: (o.ancestors.length - 1) * 20 }}>
                <span><span className="font-mono text-xs text-gray-500">{o.code}</span> {o.name_th} <Badge icon={false}>{TYPES[o.org_type]}</Badge>{!o.is_active && <Badge tone="neutral" className="ml-1">ปิดใช้งาน</Badge>}</span>
                {admin && o.parent_id && <ActionButton action="toggleOrganization" args={[o.id, !o.is_active]} variant="ghost">{o.is_active ? "ปิดใช้งาน" : "เปิดใช้งาน"}</ActionButton>}
              </li>
            ))}
          </ul>
        </Card>
        {admin ? (
          <Card title="เพิ่มหน่วยงาน">
            <SimpleForm action="createOrganization" submitLabel="เพิ่มหน่วยงาน" resetOnSuccess>
              <Field label="สังกัด" required><select name="parent_id" required className={inputClass}>{opts.orgs.map((o) => <option key={o.id} value={o.id}>{"— ".repeat(o.ancestors.length - 1)}{o.name_th}</option>)}</select></Field>
              <Field label="รหัส" required><input name="code" required className={inputClass} /></Field>
              <Field label="ชื่อ (ไทย)" required><input name="name_th" required className={inputClass} /></Field>
              <Field label="ชื่อ (อังกฤษ)"><input name="name_en" className={inputClass} /></Field>
              <Field label="ประเภท"><select name="org_type" className={inputClass}>{Object.entries(TYPES).filter(([k]) => k !== "university").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            </SimpleForm>
          </Card>
        ) : <Card><p className="text-sm text-gray-600">เพิ่ม/แก้ไขหน่วยงานได้เฉพาะผู้ดูแลระบบมหาวิทยาลัย</p></Card>}
      </div>
    </>
  );
}
