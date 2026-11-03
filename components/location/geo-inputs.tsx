"use client";
import { useState } from "react";
import { LocateFixed, Loader2 } from "lucide-react";
import { Field, buttonClass, inputClass } from "@/components/ui";
import { mapsUrl } from "@/lib/location";

/** ช่องกรอกพิกัด GPS พร้อมปุ่ม “ใช้ตำแหน่งปัจจุบัน” (ต้องยืนอยู่ที่อาคาร/จุดนั้น และอนุญาตตำแหน่งในเบราว์เซอร์) */
export function GeoInputs({ lat, lng, label = "พิกัด GPS", hint }: { lat?: number | null; lng?: number | null; label?: string; hint?: string }) {
  const [la, setLa] = useState(lat != null ? String(lat) : "");
  const [ln, setLn] = useState(lng != null ? String(lng) : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  function locate() {
    if (!("geolocation" in navigator)) { setMsg("อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง"); return; }
    setBusy(true); setMsg(null);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLa(p.coords.latitude.toFixed(6)); setLn(p.coords.longitude.toFixed(6)); setBusy(false); setMsg(`ความแม่นยำประมาณ ±${Math.round(p.coords.accuracy)} ม.`); },
      (e) => { setBusy(false); setMsg(e.code === 1 ? "ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง — เปิดสิทธิ์ตำแหน่งในการตั้งค่าเบราว์เซอร์" : "ระบุตำแหน่งไม่ได้ ลองใหม่ในที่โล่ง"); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }
  const link = mapsUrl(la === "" ? null : Number(la), ln === "" ? null : Number(ln));
  return (
    <Field label={label} hint={hint ?? "ละติจูด, ลองจิจูด (เช่น 16.746900, 100.195000) — คัดลอกจาก Google Maps ได้"}>
      <div className="grid grid-cols-2 gap-2">
        <input name="latitude" value={la} onChange={(e) => setLa(e.target.value)} inputMode="decimal" placeholder="ละติจูด" aria-label="ละติจูด" className={inputClass} />
        <input name="longitude" value={ln} onChange={(e) => setLn(e.target.value)} inputMode="decimal" placeholder="ลองจิจูด" aria-label="ลองจิจูด" className={inputClass} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button type="button" onClick={locate} disabled={busy} className={buttonClass("secondary", "sm")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}ใช้ตำแหน่งปัจจุบัน
        </button>
        {link && <a href={link} target="_blank" rel="noreferrer" className="text-xs text-brand underline">ตรวจดูบนแผนที่</a>}
        {msg && <span className="text-xs text-gray-600">{msg}</span>}
      </div>
    </Field>
  );
}
