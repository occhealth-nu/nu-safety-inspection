import Link from "next/link";
import { Building2, MapPin, Map as MapIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { getFilterOptions } from "@/lib/queries";
import { FilterBar, qs, resolvePeriod, type FilterValues } from "@/components/filters";
import { Badge, EmptyState, ErrorState, Notice, PageHeader } from "@/components/ui";
import { PinLegend, TONE_GLYPH } from "@/components/location/floor-plan";
import { buildingTone, mapsUrl, PIN_TONE_LABELS, type PinTone } from "@/lib/location";
import { formatDate, formatDateTime, formatPct, presetRange } from "@/lib/format";
import type { Tone } from "@/lib/labels";

export const metadata = { title: "อาคารและพื้นที่" };

interface OverviewRow {
  building_id: string; building_code: string; building_name: string; organization_id: string;
  campus_id: string | null; campus_name: string | null; zone_id: string | null; zone_name: string | null;
  latitude: number | null; longitude: number | null; floors: number; floors_with_plan: number;
  assets_active: number; assets_pinned: number; tasks_due: number; tasks_done: number; tasks_overdue: number;
  findings_open: number; findings_urgent: number; last_inspected_at: string | null;
}

const TONE_CARD: Record<PinTone, string> = {
  danger: "border-red-300 bg-red-50/40", warning: "border-amber-300 bg-amber-50/40", ok: "border-emerald-200", muted: "border-gray-200", finding: "",
};
const TONE_BADGE: Record<PinTone, Tone> = { danger: "critical", warning: "warning", ok: "good", muted: "neutral", finding: "neutral" };

// ภาพรวมความปลอดภัยอาคาร: วิทยาเขต → โซน → อาคาร (เรียงจากใหญ่ไปเล็ก) — ตัวเลขทั้งหมดผ่าน RLS ตามสิทธิ์ผู้ดู
export default async function BuildingsPage({ searchParams }: { searchParams: Promise<FilterValues> }) {
  await requireSession();
  const f = await searchParams;
  const { from, to } = resolvePeriod(f, presetRange);
  const supabase = await createClient();
  const [res, options] = await Promise.all([
    supabase.rpc("building_safety_overview", { p_from: from, p_to: to, p_campus: f.campus || null, p_zone: f.zone || null, p_org: f.org || null }),
    getFilterOptions(),
  ]);
  if (res.error) return (<><PageHeader title="อาคารและพื้นที่" /><ErrorState retryHref="/buildings" /></>);
  const rows = (res.data ?? []) as OverviewRow[];

  // จัดกลุ่ม วิทยาเขต → โซน
  const groups = new Map<string, { campus: string; zones: Map<string, { zone: string; items: OverviewRow[] }> }>();
  for (const r of rows) {
    const ck = r.campus_id ?? "-", zk = r.zone_id ?? "-";
    if (!groups.has(ck)) groups.set(ck, { campus: r.campus_name ?? "ยังไม่ระบุวิทยาเขต", zones: new Map() });
    const g = groups.get(ck)!;
    if (!g.zones.has(zk)) g.zones.set(zk, { zone: r.zone_name ?? "ไม่ระบุโซน", items: [] });
    g.zones.get(zk)!.items.push(r);
  }
  const total = rows.reduce((a, r) => ({ b: a.b + 1, danger: a.danger + (buildingTone(r) === "danger" ? 1 : 0), pinned: a.pinned + r.assets_pinned, assets: a.assets + r.assets_active }), { b: 0, danger: 0, pinned: 0, assets: 0 });

  return (
    <>
      <PageHeader title="อาคารและพื้นที่" subtitle={`ภาพรวมความปลอดภัยรายอาคาร · ${formatDate(from)} – ${formatDate(to)} · วิทยาเขต › โซน › อาคาร › ชั้น › ห้อง › จุดตรวจ`} />
      <FilterBar action="/buildings" values={f} orgs={options.orgs} buildings={options.buildings} campuses={options.campuses} zones={options.zones}
        show={["period", "campus", "zone", "org"]} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["อาคาร", total.b], ["อาคารที่ต้องเร่งดำเนินการ", total.danger], ["จุดตรวจที่ใช้งาน", total.assets],
          ["จุดตรวจที่ปักหมุดบนผังแล้ว", total.assets ? `${total.pinned} (${Math.round((total.pinned * 100) / total.assets)}%)` : "0"]].map(([l, v]) => (
          <div key={String(l)} className="rounded-xl border border-gray-200 bg-white p-3"><div className="text-xs text-gray-600">{l}</div><div className="text-2xl font-bold text-ink">{v}</div></div>
        ))}
      </div>
      <div className="mb-4"><PinLegend tones={["danger", "warning", "ok", "muted"]} /></div>
      {rows.length === 0 ? (
        <EmptyState icon={<Building2 className="h-8 w-8" />} title="ไม่พบอาคารในขอบเขตสิทธิ์ของคุณ" description="ผู้ดูแลเพิ่มอาคารได้ที่ ตั้งค่าระบบ › สถานที่" />
      ) : Array.from(groups.entries()).map(([ck, g]) => (
        <section key={ck} className="mb-6" aria-label={g.campus}>
          <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-ink"><MapIcon className="h-5 w-5 text-brand" aria-hidden />{g.campus}</h2>
          {Array.from(g.zones.entries()).map(([zk, z]) => (
            <div key={zk} className="mb-4 border-l-2 border-gray-200 pl-3">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">{z.zone} <span className="font-normal text-gray-500">· {z.items.length} อาคาร</span></h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {z.items.map((b) => {
                  const tone = buildingTone(b);
                  const cov = b.tasks_due ? (b.tasks_done * 100) / b.tasks_due : null;
                  const map = mapsUrl(b.latitude, b.longitude);
                  return (
                    <article key={b.building_id} className={"rounded-xl border bg-white p-4 shadow-sm " + TONE_CARD[tone]} data-building={b.building_code}>
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/buildings/${b.building_id}`} className="min-w-0">
                          <span className="font-mono text-xs text-gray-500">{b.building_code}</span>
                          <span className="block font-semibold text-ink hover:text-brand">{b.building_name}</span>
                        </Link>
                        <Badge tone={TONE_BADGE[tone]} icon={false}>{TONE_GLYPH[tone]} {PIN_TONE_LABELS[tone]}</Badge>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                        <dt className="text-gray-600">ความครอบคลุมการตรวจ</dt><dd className="text-right font-medium">{formatPct(cov)}</dd>
                        <dt className="text-gray-600">งานตรวจเกินกำหนด</dt><dd className={"text-right font-medium " + (b.tasks_overdue ? "text-red-700" : "")}>{b.tasks_overdue}</dd>
                        <dt className="text-gray-600">ข้อบกพร่องค้าง (เร่งด่วน)</dt><dd className={"text-right font-medium " + (b.findings_urgent ? "text-red-700" : "")}>{b.findings_open} ({b.findings_urgent})</dd>
                        <dt className="text-gray-600">จุดตรวจ / ปักหมุดแล้ว</dt><dd className="text-right font-medium">{b.assets_active} / {b.assets_pinned}</dd>
                        <dt className="text-gray-600">ชั้น / มีผังชั้น</dt><dd className="text-right font-medium">{b.floors} / {b.floors_with_plan}</dd>
                      </dl>
                      <p className="mt-2 text-xs text-gray-500">ตรวจล่าสุด {b.last_inspected_at ? formatDateTime(b.last_inspected_at) : "—"}</p>
                      <div className="mt-3 flex flex-wrap gap-3 text-sm">
                        <Link href={`/buildings/${b.building_id}`} className="font-medium text-brand underline">ดูผังชั้นและจุดตรวจ</Link>
                        {map ? <a href={map} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gray-700 underline"><MapPin className="h-3.5 w-3.5" />แผนที่/นำทาง</a>
                          : <span className="text-xs text-gray-400">ยังไม่ระบุพิกัด</span>}
                        <Link href={"/" + qs({ building: b.building_id })} className="text-gray-700 underline">แดชบอร์ดอาคาร</Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ))}
      <Notice>ความครอบคลุม = งานตรวจที่ตรวจแล้ว ÷ งานตรวจที่ถึงกำหนดในช่วงเวลา × 100 · สถานะอาคาร: เร่งด่วน = มีข้อบกพร่องระดับสูง/วิกฤตค้าง หรือมีงานตรวจเกินกำหนด</Notice>
    </>
  );
}
