// การแสดงวันเวลา: เขตเวลา Asia/Bangkok และปีพุทธศักราช (พ.ศ.)
export const TZ = "Asia/Bangkok";

export const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
export const MONTHS_TH_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

/** วันที่ปัจจุบันตามเวลาประเทศไทย รูปแบบ YYYY-MM-DD (ค.ศ. สำหรับส่งให้ฐานข้อมูล) */
export function todayBangkok(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function toBE(year: number): number {
  return year + 543;
}

/** แปลง "YYYY-MM-DD" (วันที่ตามปฏิทิน ไม่มีเวลา) เป็นข้อความไทย เช่น 23 ต.ค. 2569 */
export function formatDate(value: string | null | undefined, opts: { full?: boolean } = {}): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return "—";
  // ค่า timestamp เต็ม (มีเวลา) ต้องแปลงเขตเวลาก่อน
  if (value.length > 10 && value.includes("T")) return formatDateTime(value, { dateOnly: true, full: opts.full });
  const [, y, mo, d] = m;
  const months = opts.full ? MONTHS_TH_FULL : MONTHS_TH;
  return `${Number(d)} ${months[Number(mo) - 1]} ${toBE(Number(y))}`;
}

/** แสดง timestamptz ตามเวลาประเทศไทย เช่น 23 ต.ค. 2569 14:05 น. */
export function formatDateTime(value: string | Date | null | undefined, opts: { dateOnly?: boolean; full?: boolean } = {}): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const months = opts.full ? MONTHS_TH_FULL : MONTHS_TH;
  const d = `${Number(get("day"))} ${months[Number(get("month")) - 1]} ${toBE(Number(get("year")))}`;
  if (opts.dateOnly) return d;
  return `${d} ${get("hour")}:${get("minute")} น.`;
}

/** วันที่ตามปฏิทินไทยของ timestamp (YYYY-MM-DD) */
export function bangkokDateOf(value: string | Date): string {
  return todayBangkok(typeof value === "string" ? new Date(value) : value);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / 86400000);
}

export function startOfMonth(iso: string): string { return iso.slice(0, 8) + "01"; }
export function endOfMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

export function formatPct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${Number(v).toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`;
}

export function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return Number(v).toLocaleString("th-TH");
}

/** ช่วงเวลาสำเร็จรูปสำหรับตัวกรอง Dashboard */
export function presetRange(preset: string, today = todayBangkok()): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  switch (preset) {
    case "this_month": return { from: startOfMonth(today), to: endOfMonth(today) };
    case "last_month": {
      const lm = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
      return { from: lm, to: endOfMonth(lm) };
    }
    case "this_quarter": {
      const qs = Math.floor((m - 1) / 3) * 3;
      const from = new Date(Date.UTC(y, qs, 1)).toISOString().slice(0, 10);
      return { from, to: new Date(Date.UTC(y, qs + 3, 0)).toISOString().slice(0, 10) };
    }
    case "fiscal_year": {
      // ปีงบประมาณไทย: 1 ต.ค. – 30 ก.ย.
      const fyStart = m >= 10 ? y : y - 1;
      return { from: `${fyStart}-10-01`, to: `${fyStart + 1}-09-30` };
    }
    case "ytd":
    default:
      return { from: `${y}-01-01`, to: today };
  }
}
