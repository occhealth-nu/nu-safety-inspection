import { requireSession } from "@/lib/auth";
import { SimpleForm } from "@/components/simple-form";
import { Card, Field, PageHeader, inputClass } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/labels";

export const metadata = { title: "บัญชีของฉัน" };

export default async function AccountPage() {
  const s = await requireSession();
  return (
    <>
      <PageHeader title="บัญชีของฉัน" />
      <div className="grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="ข้อมูลผู้ใช้">
          <dl className="space-y-2 text-sm">
            <div><dt className="text-gray-500">ชื่อ</dt><dd>{s.profile?.full_name}</dd></div>
            <div><dt className="text-gray-500">อีเมล</dt><dd>{s.profile?.email}</dd></div>
            <div><dt className="text-gray-500">บทบาท</dt><dd><ul className="list-disc pl-5">{s.roles.map((r, i) => <li key={i}>{ROLE_LABELS[r.role]} — {r.organization_name}</li>)}</ul></dd></div>
          </dl>
        </Card>
        <Card title="เปลี่ยนรหัสผ่าน">
          <SimpleForm action="changePassword" submitLabel="เปลี่ยนรหัสผ่าน">
            <Field label="รหัสผ่านเดิม" required><input type="password" name="current_password" required autoComplete="current-password" className={inputClass} /></Field>
            <Field label="รหัสผ่านใหม่" required hint="อย่างน้อย 10 ตัวอักษร"><input type="password" name="new_password" required minLength={10} autoComplete="new-password" className={inputClass} /></Field>
            <Field label="ยืนยันรหัสผ่านใหม่" required><input type="password" name="confirm_password" required minLength={10} autoComplete="new-password" className={inputClass} /></Field>
          </SimpleForm>
        </Card>
      </div>
    </>
  );
}
