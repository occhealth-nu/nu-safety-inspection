"use client";
import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { callAction, reloadWithFlash } from "@/components/action-button";

/** อัปโหลด/ลบภาพผังชั้น (JPG/PNG/WebP ≤ 10 MB) — สิทธิ์ตรวจซ้ำที่ storage policy และ RPC set_floor_plan */
export function FloorPlanUpload({ floorId, hasPlan }: { floorId: string; hasPlan: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(f: File | undefined) {
    if (!f) return;
    setBusy(true); setError(null);
    const fd = new FormData(); fd.set("file", f); fd.set("floor_id", floorId);
    try {
      const r = await fetch("/api/floor-plans", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok || !j.ok) { setError(j.message ?? "อัปโหลดไม่สำเร็จ"); setBusy(false); return; }
      reloadWithFlash("บันทึกผังชั้นแล้ว");
    } catch { setError("อัปโหลดไม่สำเร็จ: เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"); setBusy(false); }
  }
  async function clear() {
    if (!confirm("นำภาพผังชั้นนี้ออก? (หมุดของจุดตรวจยังอยู่)")) return;
    setBusy(true);
    const r = await callAction("clearFloorPlan", [floorId]);
    if (r.ok) reloadWithFlash("นำผังชั้นออกแล้ว"); else { setError(r.message ?? "ไม่สำเร็จ"); setBusy(false); }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button type="button" onClick={() => input.current?.click()} disabled={busy} className={buttonClass("secondary", "sm")}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{hasPlan ? "เปลี่ยนผัง" : "อัปโหลดผังชั้น"}
      </button>
      {hasPlan && <button type="button" onClick={clear} disabled={busy} className={buttonClass("ghost", "sm")}>นำออก</button>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="ไฟล์ผังชั้น" onChange={(e) => upload(e.target.files?.[0])} />
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
