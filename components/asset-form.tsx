"use client";
import { useMemo, useState } from "react";
import { Field, buttonClass, inputClass } from "@/components/ui";
import { FormMessage, useActionForm } from "@/components/action-button";
import { ASSET_STATUS_LABELS, FREQUENCY_LABELS } from "@/lib/labels";
import type { AssetType, Building, Floor, Location, Organization } from "@/lib/types";

export interface AssetFormValues {
  id?: string; code?: string; name?: string; asset_type_id?: string; organization_id?: string; building_id?: string; floor_id?: string | null;
  location_id?: string | null; location_detail?: string | null; responsible_user_id?: string | null; brand_model?: string | null; serial_no?: string | null;
  installed_on?: string | null; expires_on?: string | null; frequency?: string; custom_interval_days?: number | null; status?: string; notes?: string | null;
}

export function AssetForm({ initial = {}, orgs, buildings, floors, locations, types, people }: {
  initial?: AssetFormValues; orgs: Organization[]; buildings: Building[]; floors: Floor[]; locations: Location[]; types: AssetType[];
  people: { id: string; full_name: string }[];
}) {
  const { state, pending, onSubmit } = useActionForm("saveAsset");
  const [building, setBuilding] = useState(initial.building_id ?? "");
  const [floor, setFloor] = useState(initial.floor_id ?? "");
  const [type, setType] = useState(initial.asset_type_id ?? "");
  const [freq, setFreq] = useState(initial.frequency ?? "monthly");
  const fl = useMemo(() => floors.filter((f) => f.building_id === building).sort((a, b) => a.level - b.level), [floors, building]);
  const lc = useMemo(() => locations.filter((l) => l.floor_id === floor), [locations, floor]);
  const t = types.find((x) => x.id === type);
  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <Field label="รหัสจุดตรวจ/อุปกรณ์" required hint="รหัสอ่านได้ด้วยตา พิมพ์ใต้ QR Code"><input name="code" defaultValue={initial.code} required className={inputClass + " font-mono"} /></Field>
      <Field label="ชื่อ" required><input name="name" defaultValue={initial.name} required className={inputClass} /></Field>
      <Field label="ประเภทอุปกรณ์" required>
        <select name="asset_type_id" required value={type} onChange={(e) => { setType(e.target.value); const nt = types.find((x) => x.id === e.target.value); if (nt && !initial.id) setFreq(nt.default_frequency); }} className={inputClass}>
          <option value="">— เลือก —</option>{types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </Field>
      <Field label="หน่วยงานเจ้าของ" required>
        <select name="organization_id" required defaultValue={initial.organization_id} className={inputClass}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name_th}</option>)}</select>
      </Field>
      <Field label="อาคาร" required>
        <select name="building_id" required value={building} onChange={(e) => { setBuilding(e.target.value); setFloor(""); }} className={inputClass}>
          <option value="">— เลือก —</option>{buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="ชั้น"><select name="floor_id" value={floor} onChange={(e) => setFloor(e.target.value)} className={inputClass}><option value="">—</option>{fl.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
        <Field label="ห้อง/พื้นที่"><select name="location_id" defaultValue={initial.location_id ?? ""} className={inputClass} key={floor}><option value="">—</option>{lc.map((l) => <option key={l.id} value={l.id}>{l.name}{l.room_no ? ` (${l.room_no})` : ""}</option>)}</select></Field>
      </div>
      <Field label="รายละเอียดตำแหน่ง" hint="เช่น ข้างประตูทางออกฝั่งทิศเหนือ"><input name="location_detail" defaultValue={initial.location_detail ?? ""} className={inputClass} /></Field>
      <Field label="ผู้รับผิดชอบ"><select name="responsible_user_id" defaultValue={initial.responsible_user_id ?? ""} className={inputClass}><option value="">—</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
      <Field label="ยี่ห้อ/รุ่น"><input name="brand_model" defaultValue={initial.brand_model ?? ""} className={inputClass} /></Field>
      <Field label="หมายเลขเครื่อง"><input name="serial_no" defaultValue={initial.serial_no ?? ""} className={inputClass} /></Field>
      <Field label="วันที่ติดตั้ง"><input type="date" name="installed_on" defaultValue={initial.installed_on ?? ""} className={inputClass} /></Field>
      <Field label="วันที่หมดอายุ" hint={t?.tracks_expiry ? "ประเภทนี้ควรระบุวันหมดอายุ" : "ระบุหากเกี่ยวข้อง"}><input type="date" name="expires_on" defaultValue={initial.expires_on ?? ""} className={inputClass} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="รอบตรวจ" required><select name="frequency" value={freq} onChange={(e) => setFreq(e.target.value)} className={inputClass}>{Object.entries(FREQUENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        {freq === "custom" && <Field label="ทุก (วัน)" required><input type="number" min={1} name="custom_interval_days" defaultValue={initial.custom_interval_days ?? ""} className={inputClass} /></Field>}
      </div>
      <Field label="สถานะ"><select name="status" defaultValue={initial.status ?? "active"} className={inputClass}>{Object.entries(ASSET_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <div className="md:col-span-2"><Field label="หมายเหตุ"><textarea name="notes" rows={2} defaultValue={initial.notes ?? ""} className={inputClass} /></Field></div>
      <div className="md:col-span-2 space-y-2"><FormMessage state={state} />
        <button disabled={pending} className={buttonClass("primary", "lg")}>{pending ? "กำลังบันทึก…" : "บันทึกจุดตรวจ"}</button></div>
    </form>
  );
}
