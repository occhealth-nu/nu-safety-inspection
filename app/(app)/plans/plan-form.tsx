"use client";
import { useState } from "react";
import { Field, buttonClass, inputClass } from "@/components/ui";
import { FormMessage, useActionForm } from "@/components/action-button";
import { FREQUENCY_LABELS } from "@/lib/labels";
import type { Building, Organization } from "@/lib/types";

export function PlanForm({ orgs, buildings, templates, types, people }: {
  orgs: Organization[]; buildings: Building[]; templates: { id: string; name: string }[];
  types: { id: string; name: string; default_template_id: string | null }[]; people: { id: string; full_name: string }[];
}) {
  const { state, pending, onSubmit } = useActionForm("createPlan");
  const [freq, setFreq] = useState("monthly");
  const [tpl, setTpl] = useState("");
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="ชื่อแผน" required><input name="name" required className={inputClass} placeholder="เช่น ตรวจถังดับเพลิงรายเดือน อาคาร EN1" /></Field>
      <Field label="หน่วยงาน" required hint="ครอบคลุมหน่วยงานย่อยด้วย">
        <select name="organization_id" required className={inputClass}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name_th}</option>)}</select>
      </Field>
      <Field label="อาคาร"><select name="building_id" className={inputClass}><option value="">ทุกอาคาร</option>{buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <Field label="ประเภทอุปกรณ์">
        <select name="asset_type_id" className={inputClass} onChange={(e) => { const t = types.find((x) => x.id === e.target.value); if (t?.default_template_id) setTpl(t.default_template_id); }}>
          <option value="">ทุกประเภท</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <Field label="แบบตรวจ" required>
        <select name="template_id" required className={inputClass} value={tpl} onChange={(e) => setTpl(e.target.value)}>
          <option value="">— เลือก —</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="รอบการตรวจ" required>
          <select name="frequency" className={inputClass} value={freq} onChange={(e) => setFreq(e.target.value)}>
            {Object.entries(FREQUENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {freq === "custom" && <Field label="ทุก (วัน)" required><input name="custom_interval_days" type="number" min={1} className={inputClass} /></Field>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="วันเริ่ม" required><input name="start_on" type="date" required className={inputClass} /></Field>
        <Field label="วันสิ้นสุด"><input name="end_on" type="date" className={inputClass} /></Field>
      </div>
      <Field label="ต้องตรวจภายใน (วัน นับจากเริ่มรอบ)" hint="เว้นว่าง = ภายในรอบนั้น"><input name="due_within_days" type="number" min={1} className={inputClass} /></Field>
      <Field label="ผู้ตรวจตั้งต้น"><select name="default_inspector_id" className={inputClass}><option value="">— ไม่ระบุ —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
      <FormMessage state={state} />
      <button disabled={pending} className={buttonClass("primary") + " w-full"}>{pending ? "กำลังบันทึก…" : "บันทึกแผนและสร้างงานตรวจ"}</button>
    </form>
  );
}
