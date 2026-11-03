// ตัวช่วยด้านตำแหน่ง (ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และหน้าจอ)

/** สถานะหมุดบนผัง: ใช้สีคู่กับข้อความ/สัญลักษณ์เสมอ (ไม่สื่อความหมายด้วยสีอย่างเดียว) */
export type PinTone = "danger" | "warning" | "ok" | "muted" | "finding";

export const PIN_TONE_LABELS: Record<PinTone, string> = {
  danger: "เร่งด่วน / เกินกำหนด",
  warning: "มีข้อบกพร่องค้าง",
  ok: "ปกติ",
  muted: "ไม่ได้ใช้งาน",
  finding: "ตำแหน่งข้อบกพร่อง",
};

export function assetPinTone(a: { status: string; urgent_findings?: number | null; overdue_tasks?: number | null; open_findings?: number | null }): PinTone {
  if (a.status !== "active") return "muted";
  if ((a.urgent_findings ?? 0) > 0 || (a.overdue_tasks ?? 0) > 0) return "danger";
  if ((a.open_findings ?? 0) > 0) return "warning";
  return "ok";
}

/** สถานะรวมของอาคาร (การ์ดภาพรวม) */
export function buildingTone(b: { assets_active: number; tasks_overdue: number; findings_urgent: number; findings_open: number }): PinTone {
  if (b.assets_active === 0) return "muted";
  if (b.findings_urgent > 0 || b.tasks_overdue > 0) return "danger";
  if (b.findings_open > 0) return "warning";
  return "ok";
}

/** จำกัดค่าหมุดให้อยู่ในช่วง 0–100 ทศนิยม 2 ตำแหน่ง */
export function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.min(100, Math.max(0, v)) * 100) / 100;
}

export function isLatLng(lat: unknown, lng: unknown): boolean {
  const a = Number(lat), b = Number(lng);
  return lat !== null && lng !== null && lat !== "" && lng !== "" && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180;
}

/** ลิงก์เปิดแผนที่/นำทาง (Google Maps) — ไม่ต้องใช้ API key */
export function mapsUrl(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (!isLatLng(lat, lng)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
}

/** ระยะทาง (เมตร) แบบ haversine — สูตรเดียวกับ app.distance_m ในฐานข้อมูล */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

export function formatDistance(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(Number(m))) return "—";
  const v = Number(m);
  return v >= 1000 ? `${(v / 1000).toLocaleString("th-TH", { maximumFractionDigits: 1 })} กม.` : `${Math.round(v).toLocaleString("th-TH")} ม.`;
}

export const GEO_STATUS_LABELS: Record<string, string> = {
  ok: "อยู่ในพื้นที่ตรวจ",
  far: "อยู่นอกรัศมีของอาคาร — ควรสอบถามผู้ตรวจ",
  no_reference: "บันทึกพิกัดแล้ว (อาคารยังไม่ได้ระบุพิกัด จึงยังเทียบระยะไม่ได้)",
  denied: "ผู้ตรวจไม่อนุญาตให้เข้าถึงตำแหน่ง",
  unavailable: "อุปกรณ์ระบุตำแหน่งไม่ได้ขณะส่งผล",
  disabled: "ปิดการบันทึกตำแหน่งในระบบ",
};

/** ลำดับสโคปพื้นที่ (ใหญ่ → เล็ก) สำหรับแสดงเส้นทาง เช่น วิทยาเขต › โซน › อาคาร › ชั้น › ห้อง */
export function scopePath(parts: (string | null | undefined)[]): string {
  return parts.filter((p) => p && p.trim()).join(" › ");
}
