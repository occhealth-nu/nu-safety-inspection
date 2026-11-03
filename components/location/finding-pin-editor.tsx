"use client";
import { useState } from "react";
import { MapPin } from "lucide-react";
import { buttonClass, inputClass } from "@/components/ui";
import { callAction, reloadWithFlash } from "@/components/action-button";
import { PlanPicker } from "@/components/location/plan-picker";
import type { PlanPin } from "@/components/location/floor-plan";

/** ปักหมุดตำแหน่งที่พบข้อบกพร่องจริงบนผังชั้น (เช่น จุดรั่วซึม รอยแตก ปลั๊กพ่วงที่ใช้ผิดวิธี) */
export function FindingPinEditor({ findingId, planUrl, value, note, assetPin }: {
  findingId: string; planUrl: string | null; value: { x: number; y: number } | null; note: string | null; assetPin?: PlanPin | null;
}) {
  const [pin, setPin] = useState(value);
  const [text, setText] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    setBusy(true); setMsg(null);
    const r = await callAction("setFindingPin", [findingId, pin?.x ?? null, pin?.y ?? null, text]);
    if (r.ok) reloadWithFlash("บันทึกตำแหน่งข้อบกพร่องแล้ว"); else { setMsg(r.message ?? "บันทึกไม่สำเร็จ"); setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <PlanPicker planUrl={planUrl} value={value} onChange={setPin} nameX="_fx" nameY="_fy" otherPins={assetPin ? [assetPin] : []} label="ตำแหน่งข้อบกพร่อง" />
      <label className="block text-sm">รายละเอียดตำแหน่ง (ไม่บังคับ)
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="เช่น ผนังด้านทิศเหนือ ใกล้ประตูห้อง 105" className={inputClass + " mt-1"} maxLength={300} />
      </label>
      {msg && <p role="alert" className="text-sm text-red-700">{msg}</p>}
      <button type="button" onClick={save} disabled={busy} className={buttonClass("primary", "sm")}><MapPin className="h-4 w-4" />{busy ? "กำลังบันทึก…" : "บันทึกตำแหน่ง"}</button>
    </div>
  );
}
