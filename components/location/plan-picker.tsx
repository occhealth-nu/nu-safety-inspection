"use client";
import { useState } from "react";
import { Crosshair, X } from "lucide-react";
import { clampPct } from "@/lib/location";
import { buttonClass } from "@/components/ui";
import { FloorPlan, type PlanPin } from "@/components/location/floor-plan";

/**
 * แตะ/คลิกบนผังเพื่อปักหมุด — ค่าเก็บเป็นร้อยละ (0–100) ของภาพ
 * ใช้ในฟอร์ม (name กำหนด input ที่ส่งไปกับฟอร์ม) หรือควบคุมเองผ่าน onChange
 */
export function PlanPicker({ planUrl, value, onChange, nameX = "plan_x", nameY = "plan_y", otherPins = [], disabled, label = "ตำแหน่งที่เลือก" }: {
  planUrl: string | null; value?: { x: number; y: number } | null; onChange?: (v: { x: number; y: number } | null) => void;
  nameX?: string; nameY?: string; otherPins?: PlanPin[]; disabled?: boolean; label?: string;
}) {
  const [pin, setPin] = useState<{ x: number; y: number } | null>(value ?? null);
  const set = (v: { x: number; y: number } | null) => { setPin(v); onChange?.(v); };
  function pick(e: React.MouseEvent<HTMLDivElement>) {
    if (disabled) return;
    const r = e.currentTarget.getBoundingClientRect();
    set({ x: clampPct(((e.clientX - r.left) / r.width) * 100), y: clampPct(((e.clientY - r.top) / r.height) * 100) });
  }
  const pins: PlanPin[] = [...otherPins.map((p) => ({ ...p, href: undefined })),
    ...(pin ? [{ id: "picked", x: pin.x, y: pin.y, tone: "finding" as const, label, glyph: "◎", highlight: true }] : [])];
  return (
    <div>
      <div onClick={pick} className={disabled ? "" : "cursor-crosshair"} role="button" tabIndex={-1}
        aria-label="แตะบนผังเพื่อระบุตำแหน่ง" data-testid="plan-picker">
        <FloorPlan planUrl={planUrl} pins={pins} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
        <Crosshair className="h-3.5 w-3.5" aria-hidden />
        {pin ? <span>ปักหมุดที่ X {pin.x.toFixed(1)}% · Y {pin.y.toFixed(1)}%</span> : <span>แตะบนผังเพื่อปักหมุดตำแหน่ง</span>}
        {pin && !disabled && <button type="button" onClick={() => set(null)} className={buttonClass("ghost", "sm") + " !px-2 !py-0.5"}><X className="h-3.5 w-3.5" />ล้างหมุด</button>}
      </div>
      <input type="hidden" name={nameX} value={pin ? String(pin.x) : ""} />
      <input type="hidden" name={nameY} value={pin ? String(pin.y) : ""} />
    </div>
  );
}
