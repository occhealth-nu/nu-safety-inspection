import Link from "next/link";
import { requireSession, hasRole, isSystemAdmin, MANAGER_ROLES } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { floorPlanUrls, getFilterOptions } from "@/lib/queries";
import { getAppSettings } from "@/lib/settings";
import { SimpleForm } from "@/components/simple-form";
import { Card, Field, NoAccess, PageHeader, inputClass } from "@/components/ui";
import { GeoInputs } from "@/components/location/geo-inputs";
import { FloorPlanUpload } from "@/components/location/floor-plan-upload";
import { formatDate } from "@/lib/format";
import type { Floor, Location } from "@/lib/types";

export const metadata = { title: "สถานที่และผังชั้น" };

// สถานที่จากใหญ่ไปเล็ก: อาคาร (พิกัด) → ชั้น (ภาพผัง) → ห้อง/พื้นที่
export default async function LocationsPage({ searchParams }: { searchParams: Promise<{ building?: string }> }) {
  const s = await requireSession();
  if (!hasRole(s, MANAGER_ROLES)) return <NoAccess />;
  const sp = await searchParams;
  const supabase = await createClient();
  const [opts, settings] = await Promise.all([getFilterOptions(), getAppSettings()]);
  const manageable = opts.orgs.filter((o) => s.roles.some((r) => MANAGER_ROLES.includes(r.role) && o.ancestors.includes(r.organization_id)));
  const sel = sp.building ?? opts.buildings[0]?.id;
  const building = opts.buildings.find((b) => b.id === sel);
  const [floors, locs] = await Promise.all([
    sel ? supabase.from("floors").select("*").eq("building_id", sel).order("level") : Promise.resolve({ data: [] }),
    sel ? supabase.from("locations").select("*, floors!inner(building_id)").eq("floors.building_id", sel).order("name") : Promise.resolve({ data: [] }),
  ]);
  const fl = (floors.data ?? []) as Floor[];
  const lc = (locs.data ?? []) as Location[];
  const urls = await floorPlanUrls(fl.map((f) => f.plan_path));
  const orgName = new Map(opts.orgs.map((o) => [o.id, o.name_th]));
  const canEditBuilding = !!building && hasRole(s, MANAGER_ROLES, building.organization_id, opts.orgs.find((o) => o.id === building.organization_id)?.ancestors);

  return (
    <>
      <PageHeader title="สถานที่: อาคาร ชั้น ห้อง และผังชั้น" back={{ href: "/settings", label: "ตั้งค่าระบบ" }}
        subtitle="กำหนดสโคปพื้นที่จากใหญ่ไปเล็ก และข้อมูลตำแหน่งสำหรับระบบตรวจสอบความปลอดภัยอาคาร" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="1. อาคาร">
          <ul className="mb-4 max-h-80 space-y-1 overflow-y-auto">
            {opts.buildings.map((b) => (
              <li key={b.id}><a href={`?building=${b.id}`} className={"block rounded-lg px-2 py-1.5 text-sm " + (b.id === sel ? "bg-brand/10 font-semibold text-brand" : "hover:bg-gray-50")}>
                {b.code} — {b.name}
                <span className="block text-xs text-gray-500">{orgName.get(b.organization_id)}</span></a></li>
            ))}
          </ul>
          <details><summary className="cursor-pointer text-sm font-medium text-brand">+ เพิ่มอาคาร</summary>
            <SimpleForm action="createBuilding" submitLabel="เพิ่มอาคาร" resetOnSuccess className="mt-2 space-y-2">
              <Field label="หน่วยงานเจ้าของ" required><select name="organization_id" className={inputClass}>{manageable.map((o) => <option key={o.id} value={o.id}>{o.name_th}</option>)}</select></Field>
              <Field label="รหัสอาคาร" required><input name="code" required className={inputClass} /></Field>
              <Field label="ชื่ออาคาร" required><input name="name" required className={inputClass} /></Field>
              <Field label="จำนวนชั้น (สร้างอัตโนมัติ)"><input name="floors" type="number" min={0} max={60} className={inputClass} /></Field>
              <GeoInputs label="พิกัดอาคาร (ไม่บังคับ)" />
            </SimpleForm>
          </details>
        </Card>
        <Card title="2. ชั้น และผังชั้น">
          <ul className="mb-4 space-y-2 text-sm" data-testid="floor-list">
            {fl.map((f) => (
              <li key={f.id} className="rounded-lg bg-gray-50 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{f.name} <span className="text-xs text-gray-500">(ระดับ {f.level})</span></span>
                  {canEditBuilding && <FloorPlanUpload floorId={f.id} hasPlan={!!f.plan_path} />}
                </div>
                {f.plan_path && urls[f.plan_path] ? (
                  <a href={`/buildings/${sel}?floor=${f.id}`} className="mt-2 block" title="ดูผังพร้อมหมุด">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={urls[f.plan_path]} alt={`ผัง${f.name}`} className="max-h-28 rounded border border-gray-200 bg-white object-contain" />
                    <span className="text-[11px] text-gray-500">อัปเดต {formatDate(f.plan_updated_at)}</span>
                  </a>
                ) : <span className="mt-1 block text-xs text-amber-700">ยังไม่มีภาพผังชั้น</span>}
              </li>
            ))}
          </ul>
          {sel && <SimpleForm action="createFloor" submitLabel="เพิ่มชั้น" resetOnSuccess className="space-y-2">
            <input type="hidden" name="building_id" value={sel} />
            <div className="grid grid-cols-2 gap-2"><Field label="ชื่อชั้น" required><input name="name" required className={inputClass} placeholder="เช่น ชั้นใต้ดิน" /></Field>
              <Field label="ระดับ"><input name="level" type="number" className={inputClass} /></Field></div>
          </SimpleForm>}
        </Card>
        <Card title="3. ห้อง/พื้นที่">
          <ul className="mb-4 max-h-80 space-y-1 overflow-y-auto text-sm">{lc.map((l) => <li key={l.id} className="rounded-lg bg-gray-50 px-2 py-1">{fl.find((f) => f.id === l.floor_id)?.name} · {l.name}{l.room_no ? ` (${l.room_no})` : ""}</li>)}</ul>
          {fl.length > 0 && <SimpleForm action="createLocation" submitLabel="เพิ่มห้อง/พื้นที่" resetOnSuccess className="space-y-2">
            <Field label="ชั้น" required><select name="floor_id" className={inputClass}>{fl.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
            <Field label="ชื่อห้อง/พื้นที่" required><input name="name" required className={inputClass} /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="เลขห้อง"><input name="room_no" className={inputClass} /></Field>
              <Field label="ประเภท"><select name="location_type" className={inputClass}><option value="">ทั่วไป</option><option value="laboratory">ห้องปฏิบัติการ</option><option value="electrical">ห้องไฟฟ้า</option><option value="common">พื้นที่ส่วนกลาง</option><option value="storage">ห้องเก็บของ</option></select></Field></div>
          </SimpleForm>}
        </Card>
      </div>

      {building && canEditBuilding && (
        <Card title={`ตำแหน่งอาคาร ${building.code} — ${building.name}`} className="mt-4"
          actions={<Link href={`/buildings/${building.id}`} className="text-sm text-brand underline">ดูผังอาคารพร้อมหมุด</Link>}>
          <SimpleForm action="saveBuildingLocation" className="grid max-w-3xl grid-cols-1 gap-3">
            <input type="hidden" name="id" value={building.id} />
            <Field label="ชื่ออาคาร"><input name="name" defaultValue={building.name} className={inputClass} /></Field>
            <Field label="ที่อยู่/คำอธิบายตำแหน่ง"><input name="address" defaultValue={building.address ?? ""} className={inputClass} placeholder="เช่น ฝั่งทิศเหนือของถนนสายหลัก ใกล้ลานจอดรถ 3" /></Field>
            <GeoInputs lat={building.latitude} lng={building.longitude} label="พิกัดอาคาร (ใช้ตรวจว่าผู้ตรวจอยู่ที่อาคารจริงขณะส่งผล)"
              hint="ยืนที่หน้าอาคารแล้วกด “ใช้ตำแหน่งปัจจุบัน” หรือคัดลอกพิกัดจาก Google Maps (คลิกขวาที่อาคาร)" />
          </SimpleForm>
        </Card>
      )}

      <Card title="การยืนยันตำแหน่งผู้ตรวจขณะส่งผล" className="mt-4">
        <p className="mb-3 text-sm text-gray-600">เมื่อเปิดใช้ ระบบจะขอพิกัด GPS ของโทรศัพท์ <b>ครั้งเดียวขณะกด “ส่งผลตรวจ”</b> แล้วเทียบระยะกับพิกัดจุดตรวจ/อาคาร
          เพื่อยืนยันว่าตรวจหน้างานจริง ผู้ตรวจปฏิเสธได้ (ระบบบันทึกว่า “ไม่อนุญาต” และยังส่งผลได้) ข้อมูลพิกัดเห็นเฉพาะผู้มีสิทธิ์ดูผลตรวจนั้น</p>
        {isSystemAdmin(s) ? (
          <SimpleForm action="saveGeoSettings" className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="geo_capture_enabled" defaultChecked={settings.geo_capture_enabled} className="h-4 w-4" />บันทึกพิกัดผู้ตรวจขณะส่งผล</label>
            <Field label="รัศมีที่ถือว่าอยู่ในพื้นที่ (เมตร)"><input type="number" name="geo_radius_m" min={20} max={5000} defaultValue={settings.geo_radius_m} className={inputClass + " w-40"} /></Field>
          </SimpleForm>
        ) : <p className="text-sm">สถานะปัจจุบัน: {settings.geo_capture_enabled ? `เปิดใช้ (รัศมี ${settings.geo_radius_m} ม.)` : "ปิด"} — แก้ไขได้เฉพาะผู้ดูแลระบบ</p>}
      </Card>
    </>
  );
}
