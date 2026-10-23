import { requireSession, hasRole, isSystemAdmin, MANAGER_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFilterOptions } from "@/lib/queries";
import { SimpleForm } from "@/components/simple-form";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, Field, NoAccess, PageHeader, Table, Td, Th, inputClass } from "@/components/ui";
import { ROLE_LABELS, ROLES } from "@/lib/labels";
import type { AppRole, Profile } from "@/lib/types";

export const metadata = { title: "ผู้ใช้และสิทธิ์" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; pending?: string }> }) {
  const s = await requireSession();
  if (!hasRole(s, MANAGER_ROLES)) return <NoAccess />;
  const sp = await searchParams;
  const supabase = await createClient();
  let pq = supabase.from("profiles").select("*").order("full_name").limit(300);
  if (sp.q) pq = pq.or(`full_name.ilike.%${sp.q.replace(/[,()%]/g, "")}%,email.ilike.%${sp.q.replace(/[,()%]/g, "")}%`);
  const [profiles, roles, opts] = await Promise.all([
    pq, supabase.from("role_assignments").select("id, user_id, role, organization_id, organizations(name_th)"), getFilterOptions(),
  ]);
  const manageable = opts.orgs.filter((o) => s.roles.some((r) => MANAGER_ROLES.includes(r.role) && o.ancestors.includes(r.organization_id)));
  const grantable: AppRole[] = isSystemAdmin(s) ? ROLES : ROLES.filter((r) => !["system_admin", "safety_coordinator"].includes(r));
  type RA = { id: string; user_id: string; role: AppRole; organization_id: string; organizations: { name_th: string } | null };
  const byUser = new Map<string, RA[]>();
  ((roles.data ?? []) as unknown as RA[]).forEach((r) => byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]));
  const orgName = new Map(opts.orgs.map((o) => [o.id, o.name_th]));
  const all = (profiles.data ?? []) as Profile[];
  const pendingCount = all.filter((u) => !byUser.has(u.id)).length;
  const users = sp.pending ? all.filter((u) => !byUser.has(u.id)) : all;
  return (
    <>
      <PageHeader title="ผู้ใช้และสิทธิ์" back={{ href: "/settings", label: "ตั้งค่าระบบ" }}
        subtitle="บทบาทผูกกับหน่วยงาน และมีผลกับหน่วยงานย่อย — ระบบตรวจสิทธิ์ที่ฐานข้อมูลทุกครั้ง" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <form className="mb-3 flex gap-2"><input name="q" defaultValue={sp.q} placeholder="ค้นหาชื่อหรืออีเมล" className={inputClass} /><button className="rounded-lg bg-white px-4 ring-1 ring-gray-300">ค้นหา</button></form>
          <div className="mb-3 flex gap-2 text-sm">
            <a href="/settings/users" className={"rounded-full px-3 py-1 ring-1 ring-inset " + (!sp.pending ? "bg-brand text-white ring-brand" : "bg-white ring-gray-300")}>ทั้งหมด</a>
            <a href="/settings/users?pending=1" className={"rounded-full px-3 py-1 ring-1 ring-inset " + (sp.pending ? "bg-brand text-white ring-brand" : "bg-white ring-gray-300")}>รอกำหนดสิทธิ์ ({pendingCount})</a>
          </div>
          <Table>
            <thead><tr><Th>ผู้ใช้</Th><Th>หน่วยงาน</Th><Th>บทบาท</Th><Th></Th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr key={u.id}>
                  <Td><p className="font-medium">{u.full_name}</p><p className="text-xs text-gray-500">{u.email}</p>{!u.is_active && <Badge tone="neutral">ระงับบัญชี</Badge>}{!byUser.has(u.id) && <Badge tone="warning">รอกำหนดสิทธิ์</Badge>}</Td>
                  <Td className="text-xs">{u.organization_id ? orgName.get(u.organization_id) : "—"}<br />{u.position}</Td>
                  <Td className="space-y-1">
                    {(byUser.get(u.id) ?? []).map((r) => (
                      <div key={r.id} className="flex flex-wrap items-center gap-1 text-xs">
                        <Badge tone="info" icon={false}>{ROLE_LABELS[r.role]}</Badge><span className="text-gray-500">@ {r.organizations?.name_th}</span>
                        <ActionButton action="revokeRole" args={[r.id]} variant="ghost" confirm="ยืนยันถอนบทบาทนี้?">ถอน</ActionButton>
                      </div>
                    ))}
                    <details className="text-xs"><summary className="cursor-pointer text-brand">+ เพิ่มบทบาท</summary>
                      <SimpleForm action="grantRole" submitLabel="เพิ่ม" className="mt-1 space-y-1">
                        <input type="hidden" name="user_id" value={u.id} />
                        <select name="role" className={inputClass}>{grantable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
                        <select name="organization_id" className={inputClass}>{manageable.map((o) => <option key={o.id} value={o.id}>{o.name_th}</option>)}</select>
                      </SimpleForm>
                    </details>
                  </Td>
                  <Td>{u.organization_id && u.id !== s.profile?.id && (
                    <ActionButton action="setUserActive" args={[u.id, u.organization_id, !u.is_active]} variant="ghost" confirm={u.is_active ? "ยืนยันระงับบัญชีนี้?" : undefined}>{u.is_active ? "ระงับ" : "เปิดใช้"}</ActionButton>
                  )}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <Card title="เพิ่มผู้ใช้ใหม่">
          <SimpleForm action="createUser" submitLabel="สร้างบัญชี" resetOnSuccess>
            <Field label="อีเมลมหาวิทยาลัย" required hint="ลงทะเบียนล่วงหน้าได้ — เมื่อผู้ใช้เข้าด้วย Google ครั้งแรกจะได้สิทธิ์ทันที"><input name="email" type="email" required placeholder="name@nu.ac.th" className={inputClass} /></Field>
            <Field label="ชื่อ-สกุล" required><input name="full_name" required className={inputClass} /></Field>
            <Field label="ตำแหน่ง"><input name="position" className={inputClass} /></Field>
            <Field label="หน่วยงาน" required><select name="organization_id" className={inputClass}>{manageable.map((o) => <option key={o.id} value={o.id}>{o.name_th}</option>)}</select></Field>
            <Field label="บทบาทเริ่มต้น" required><select name="role" className={inputClass}>{grantable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></Field>
            <Field label="รหัสผ่านชั่วคราว (ไม่บังคับ)" hint="เว้นว่าง = ผู้ใช้เข้าสู่ระบบด้วยบัญชี Google ของมหาวิทยาลัย (แนะนำ) · ถ้ากรอก ต้องมีอย่างน้อย 10 ตัวอักษร"><input name="password" type="password" minLength={10} className={inputClass} autoComplete="new-password" /></Field>
          </SimpleForm>
        </Card>
      </div>
    </>
  );
}
