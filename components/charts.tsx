import Link from "next/link";
import { MONTHS_TH, toBE, formatNumber } from "@/lib/format";

// สีชุดข้อมูล (categorical slot 1–2 จาก palette ที่ผ่านการตรวจ CVD) — สีสถานะสงวนไว้สำหรับสถานะเท่านั้น
const SERIES_1 = "#2a78d6";
const SERIES_2 = "#eb6834";
const TRACK = "#e5e7eb";

export interface TrendPoint { month_start: string; tasks_due: number; tasks_done: number; findings_opened: number; findings_closed: number }

function monthLabel(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS_TH[m - 1]} ${String(toBE(y)).slice(2)}`;
}
// ป้ายแกนแบบย่อ: แสดงปี (พ.ศ. 2 หลัก) เฉพาะเดือน ม.ค. หรือจุดแรก
function axisLabel(iso: string, i: number) {
  const [y, m] = iso.split("-").map(Number);
  return m === 1 || i === 0 ? `${MONTHS_TH[m - 1]}${String(toBE(y)).slice(2)}` : MONTHS_TH[m - 1];
}
function niceMax(v: number) {
  if (v <= 5) return 5;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / p) * p;
}

/** ความครอบคลุมการตรวจรายเดือน: แท่งพื้นหลัง = ถึงกำหนด, แท่งสี = ตรวจแล้ว (แกนเดียว) */
export function CoverageTrend({ data, linkFor }: { data: TrendPoint[]; linkFor: (p: TrendPoint) => string }) {
  const max = niceMax(Math.max(1, ...data.map((d) => d.tasks_due)));
  return (
    <figure>
      <div className="flex items-center gap-4 text-xs text-gray-600" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: TRACK }} />งานถึงกำหนด</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: SERIES_1 }} />ตรวจแล้ว</span>
      </div>
      <div className="mt-3 flex h-48 items-end gap-1.5 border-b border-gray-300 sm:gap-2" role="img"
        aria-label="กราฟความครอบคลุมการตรวจรายเดือน (ดูตารางข้อมูลด้านล่าง)">
        {data.map((d) => {
          const pct = d.tasks_due ? Math.round((d.tasks_done / d.tasks_due) * 100) : null;
          return (
            <Link key={d.month_start} href={linkFor(d)} className="group relative flex h-full flex-1 flex-col justify-end focus:outline-none">
              <div className="relative w-full rounded-t-[4px]" style={{ height: `${(d.tasks_due / max) * 100}%`, background: TRACK, minHeight: d.tasks_due ? 2 : 0 }}>
                <div className="absolute inset-x-0 bottom-0 rounded-t-[4px] transition group-hover:brightness-110"
                  style={{ height: d.tasks_due ? `${(d.tasks_done / d.tasks_due) * 100}%` : 0, background: SERIES_1 }} />
              </div>
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-40 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-xs text-white shadow-lg group-hover:block group-focus:block">
                <p className="font-semibold">{monthLabel(d.month_start)}</p>
                <p>ตรวจแล้ว {formatNumber(d.tasks_done)} / ถึงกำหนด {formatNumber(d.tasks_due)}</p>
                <p>ความครอบคลุม {pct === null ? "—" : `${pct}%`}</p>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5 sm:gap-2">
        {data.map((d, i) => <span key={d.month_start} title={monthLabel(d.month_start)} className="flex-1 overflow-hidden whitespace-nowrap text-center text-[10px] text-gray-500 sm:text-[11px]">{axisLabel(d.month_start, i)}</span>)}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-gray-600">ดูเป็นตาราง</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead><tr className="text-gray-500"><th className="py-1">เดือน</th><th>ถึงกำหนด</th><th>ตรวจแล้ว</th><th>ข้อบกพร่องใหม่</th><th>ปิดงาน</th></tr></thead>
          <tbody>{data.map((d) => (
            <tr key={d.month_start} className="border-t border-gray-100"><td className="py-1">{monthLabel(d.month_start)}</td><td>{d.tasks_due}</td><td>{d.tasks_done}</td><td>{d.findings_opened}</td><td>{d.findings_closed}</td></tr>
          ))}</tbody>
        </table>
      </details>
    </figure>
  );
}

/** ข้อบกพร่องใหม่เทียบกับที่ปิดงาน รายเดือน (แท่งคู่ แกนเดียว) */
export function FindingsTrend({ data }: { data: TrendPoint[] }) {
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.findings_opened, d.findings_closed))));
  return (
    <figure>
      <div className="flex items-center gap-4 text-xs text-gray-600" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: SERIES_2 }} />พบใหม่</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: SERIES_1 }} />ปิดงาน</span>
      </div>
      <div className="mt-3 flex h-40 items-end gap-1.5 border-b border-gray-300 sm:gap-2" role="img" aria-label="กราฟข้อบกพร่องที่พบใหม่และที่ปิดงานรายเดือน">
        {data.map((d) => (
          <div key={d.month_start} className="group relative flex h-full flex-1 items-end justify-center gap-[2px]">
            <div className="w-1/2 max-w-[14px] rounded-t-[4px]" style={{ height: `${(d.findings_opened / max) * 100}%`, background: SERIES_2 }} />
            <div className="w-1/2 max-w-[14px] rounded-t-[4px]" style={{ height: `${(d.findings_closed / max) * 100}%`, background: SERIES_1 }} />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-32 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-xs text-white shadow-lg group-hover:block">
              <p className="font-semibold">{monthLabel(d.month_start)}</p><p>พบใหม่ {d.findings_opened}</p><p>ปิดงาน {d.findings_closed}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 sm:gap-2">
        {data.map((d, i) => <span key={d.month_start} title={monthLabel(d.month_start)} className="flex-1 overflow-hidden whitespace-nowrap text-center text-[10px] text-gray-500 sm:text-[11px]">{axisLabel(d.month_start, i)}</span>)}
      </div>
    </figure>
  );
}

/** แท่งแนวนอนแบบซ้อน: ยังเปิดอยู่ + ปิดแล้ว ต่อหมวด */
export function CategoryBars({ rows }: { rows: { key: string; label: string; open: number; closed: number; urgent: number; href: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.open + r.closed));
  return (
    <figure>
      <div className="mb-3 flex items-center gap-4 text-xs text-gray-600" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: SERIES_2 }} />ยังเปิดอยู่</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: SERIES_1 }} />ปิดงานแล้ว</span>
      </div>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.key}>
            <Link href={r.href} className="group block rounded-md hover:bg-gray-50">
              <div className="flex justify-between gap-2 text-xs"><span className="truncate text-gray-700">{r.label}</span>
                <span className="shrink-0 text-gray-600">{r.open + r.closed} รายการ{r.urgent ? ` · เร่งด่วน ${r.urgent}` : ""}</span></div>
              <div className="mt-1 flex h-3 w-full gap-[2px]">
                {r.open > 0 && <div className="h-full rounded-l-[4px]" style={{ width: `${(r.open / max) * 100}%`, background: SERIES_2 }} title={`ยังเปิดอยู่ ${r.open}`} />}
                {r.closed > 0 && <div className={"h-full " + (r.open ? "" : "rounded-l-[4px]") + " rounded-r-[4px]"} style={{ width: `${(r.closed / max) * 100}%`, background: SERIES_1 }} title={`ปิดงานแล้ว ${r.closed}`} />}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** แถบสัดส่วนสถานะ (มีข้อความ + จำนวนกำกับทุกส่วน) */
export function StatusMeter({ items }: { items: { label: string; value: number; color: string; href?: string; icon?: React.ReactNode }[] }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-[4px] bg-gray-100" aria-hidden>
        {items.filter((i) => i.value > 0).map((i) => <div key={i.label} style={{ width: `${(i.value / Math.max(total, 1)) * 100}%`, background: i.color }} />)}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
        {items.map((i) => {
          const body = (
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: i.color }} aria-hidden />{i.icon}
              <span className="text-gray-700">{i.label}</span><span className="ml-auto font-semibold text-ink">{formatNumber(i.value)}</span></span>
          );
          return <li key={i.label}>{i.href ? <Link href={i.href} className="block rounded-md px-1 py-0.5 hover:bg-gray-50">{body}</Link> : <div className="px-1 py-0.5">{body}</div>}</li>;
        })}
      </ul>
    </div>
  );
}
