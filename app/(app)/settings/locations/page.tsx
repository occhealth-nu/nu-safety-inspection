import { requireSession, hasRole, MANAGER_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFilterOptions } from "@/lib/queries";
import { SimpleForm } from "@/components/simple-form";
import { Card, Field, NoAccess, PageHeader, inputClass } from "@/components/ui";
import type { Floor, Location } from "@/lib/types";

export const metadata = { title: "อาคาร ชั้น และห้อง" };

export default async function LocationsPage({ searchParams }: { searchParams: Promise<{ building?: string }> }) {
  const s = await requireSession();
  if (!hasRole(s, MANAGER_ROLES)) return <NoAccess />;
  const sp = await searchParams;
  const supabase = await createClient();
  const opts = await getFilterOptions();
  const manageable = opts.orgs.filter((o) => s.roles.some((r) => MANAGER_ROLES.includes(r.role) && o.ancestors.includes(r.organization_id)));
  const sel = sp.building ?? opts.buildings[0]?.id;
  const [floors, locs] = await Promise.all([
    sel ? supabase.from("floors").select("*").eq("building_id", sel).order("level") : Promise.resolve({ data: [] }),
    sel ? supabase.from("locations").select("*, floors!inner(building_id)").eq("floors.building_id", sel).order("name") : Promise.resolve({ data: [] }),
  ]);
  const fl = (floors.data ?? []) as Floor[];
  const lc = (locs.data ?? []) as Location[];
  const orgName = new Map(opts.orgs.map((o) => [o.id, o.name_th]));
  return (
    <>
      <PageHeader title="อาคาร ชั้น และห้อง/พื้นที่" back={{ href: "/settings", label: "ตั้งค่าระบบ" }} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="อาคาร">
          <ul className="mb-4 max-h-80 space-y-1 overflow-y-auto">
            {opts.buildings.map((b) => (
              <li key={b.id}><a href={`?building=${b.id}`} className={"block rounded-lg px-2 py-1.5 text-sm " + (b.id === sel ? "bg-brand/10 font-semibold text-brand" : "hover:bg-gray-50")}>
                {b.code} — {b.name}<span className="block text-xs text-gray-500">{orgName.get(b.organization_id)}</span></a></li>
            ))}
          </ul>
          <details><summary className="cursor-pointer text-sm font-medium text-brand">+ เพิ่มอาคาร</summary>
            <SimpleForm action="createBuilding" submitLabel="เพิ่มอาคาร" resetOnSuccess className="mt-2 space-y-2">
              <Field label="หน่วยงานเจ้าของ" required><select name="organization_id" className={inputClass}>{manageable.map((o) => <option key={o.id} value={o.id}>{o.name_th}</option>)}</select></Field>
              <Field label="รหัสอาคาร" required><input name="code" required className={inputClass} /></Field>
              <Field label="ชื่ออาคาร" required><input name="name" required className={inputClass} /></Field>
              <Field label="จำนวนชั้น (สร้างอัตโนมัติ)"><input name="floors" type="number" min={0} max={60} className={inputClass} /></Field>
            </SimpleForm>
          </details>
        </Card>
        <Card title="ชั้น">
          <ul className="mb-4 space-y-1 text-sm">{fl.map((f) => <li key={f.id} className="rounded-lg bg-gray-50 px-2 py-1">{f.name} (ระดับ {f.level})</li>)}</ul>
          {sel && <SimpleForm action="createFloor" submitLabel="เพิ่มชั้น" resetOnSuccess className="space-y-2">
            <input type="hidden" name="building_id" value={sel} />
            <div className="grid grid-cols-2 gap-2"><Field label="ชื่อชั้น" required><input name="name" required className={inputClass} placeholder="เช่น ชั้นใต้ดิน" /></Field>
              <Field label="ระดับ"><input name="level" type="number" className={inputClass} /></Field></div>
          </SimpleForm>}
        </Card>
        <Card title="ห้อง/พื้นที่">
          <ul className="mb-4 max-h-80 space-y-1 overflow-y-auto text-sm">{lc.map((l) => <li key={l.id} className="rounded-lg bg-gray-50 px-2 py-1">{fl.find((f) => f.id === l.floor_id)?.name} · {l.name}{l.room_no ? ` (${l.room_no})` : ""}</li>)}</ul>
          {fl.length > 0 && <SimpleForm action="createLocation" submitLabel="เพิ่มห้อง/พื้นที่" resetOnSuccess className="space-y-2">
            <Field label="ชั้น" required><select name="floor_id" className={inputClass}>{fl.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
            <Field label="ชื่อห้อง/พื้นที่" required><input name="name" required className={inputClass} /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="เลขห้อง"><input name="room_no" className={inputClass} /></Field>
              <Field label="ประเภท"><select name="location_type" className={inputClass}><option value="">ทั่วไป</option><option value="laboratory">ห้องปฏิบัติการ</option><option value="electrical">ห้องไฟฟ้า</option><option value="common">พื้นที่ส่วนกลาง</option><option value="storage">ห้องเก็บของ</option></select></Field></div>
          </SimpleForm>}
        </Card>
      </div>
    </>
  );
}
