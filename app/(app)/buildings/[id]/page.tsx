import Link from "next/link";
import { MapPin, Settings2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSession, hasRole, MANAGER_ROLES } from "@/lib/auth";
import { floorPlanUrls } from "@/lib/queries";
import { Badge, Card, LinkButton, NoAccess, PageHeader } from "@/components/ui";
import { FloorPlan, PinLegend, TONE_GLYPH, type PlanPin } from "@/components/location/floor-plan";
import { assetPinTone, mapsUrl, PIN_TONE_LABELS, type PinTone } from "@/lib/location";
import { CATEGORY_LABELS, SEVERITY_LABELS, SEVERITY_TONE, type Tone } from "@/lib/labels";
import { formatDate, formatPct, presetRange } from "@/lib/format";
import type { AssetRow, Building, DashboardKpis, FindingRow, Floor } from "@/lib/types";

export const metadata = { title: "ผังอาคารและจุดตรวจ" };

const TONE_BADGE: Record<PinTone, Tone> = { danger: "critical", warning: "warning", ok: "good", muted: "neutral", finding: "serious" };

// อาคาร → ชั้น → ผังชั้นพร้อมหมุดจุดตรวจ/ข้อบกพร่อง → ห้อง/พื้นที่ → จุดตรวจ
export default async function BuildingDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ floor?: string; focus?: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: b } = await supabase.from("buildings").select("*, organizations(name_th, ancestors)").eq("id", id).maybeSingle();
  if (!b) return <NoAccess message="ไม่พบอาคาร" />;
  const bld = b as Building & { organizations: { name_th: string; ancestors: string[] } };
  const { from, to } = presetRange("ytd");
  const [floorsRes, assetsRes, findingsRes, kpiRes] = await Promise.all([
    supabase.from("floors").select("*").eq("building_id", id).order("level"),
    supabase.from("v_assets").select("*").eq("building_id", id).neq("status", "disposed").order("code"),
    supabase.from("v_findings").select("*").eq("building_id", id).neq("status", "closed").order("created_at", { ascending: false }),
    supabase.rpc("dashboard_kpis", { p_from: from, p_to: to, p_building: id }),
  ]);
  const floors = (floorsRes.data ?? []) as Floor[];
  const assets = (assetsRes.data ?? []) as AssetRow[];
  const findings = (findingsRes.data ?? []) as FindingRow[];
  const canManage = hasRole(s, MANAGER_ROLES, bld.organization_id, bld.organizations?.ancestors);
  if (!assets.length && !hasRole(s, ["system_admin", "safety_coordinator", "org_admin", "inspector", "responsible", "verifier", "executive"], bld.organization_id, bld.organizations?.ancestors)) {
    return <NoAccess message="อาคารนี้อยู่นอกขอบเขตสิทธิ์ของคุณ" />;
  }
  const k = kpiRes.data as DashboardKpis | null;

  const perFloor = new Map<string, { n: number; danger: number }>();
  assets.forEach((a) => {
    if (!a.floor_id) return;
    const v = perFloor.get(a.floor_id) ?? { n: 0, danger: 0 };
    v.n++; if (assetPinTone(a) === "danger") v.danger++;
    perFloor.set(a.floor_id, v);
  });
  const focusAsset = assets.find((a) => a.id === sp.focus);
  const floor = floors.find((f) => f.id === (sp.floor ?? focusAsset?.floor_id)) ?? floors.find((f) => perFloor.has(f.id)) ?? floors[0];
  const urls = await floorPlanUrls([floor?.plan_path]);
  const planUrl = floor?.plan_path ? urls[floor.plan_path] ?? null : null;

  const onFloor = assets.filter((a) => a.floor_id === floor?.id);
  const findingsOnFloor = findings.filter((f) => f.floor_id === floor?.id);
  const pins: PlanPin[] = [
    ...onFloor.filter((a) => a.plan_x != null && a.plan_y != null).map((a) => ({
      id: a.id, x: Number(a.plan_x), y: Number(a.plan_y), tone: assetPinTone(a), label: `${a.code} ${a.name}`, href: `/assets/${a.id}`, highlight: a.id === sp.focus,
    })),
    ...findingsOnFloor.filter((f) => f.plan_x != null && f.plan_y != null && (f.plan_x !== f.asset_plan_x || f.plan_y !== f.asset_plan_y)).map((f) => ({
      id: f.id, x: Number(f.plan_x), y: Number(f.plan_y), tone: "finding" as const, label: `${f.finding_no} ${f.title}`, href: `/findings/${f.id}`,
    })),
  ];
  const byRoom = new Map<string, AssetRow[]>();
  onFloor.forEach((a) => { const key = a.location_name ?? "ไม่ระบุห้อง/พื้นที่"; byRoom.set(key, [...(byRoom.get(key) ?? []), a]); });
  const noFloor = assets.filter((a) => !a.floor_id);
  const map = mapsUrl(bld.latitude, bld.longitude);

  return (
    <>
      <PageHeader title={`${bld.code} — ${bld.name}`}
        subtitle={<>เจ้าของ: {bld.organizations?.name_th}{bld.address ? ` · ${bld.address}` : ""}</>}
        back={{ href: "/buildings", label: "อาคารและพื้นที่" }}
        actions={<>
          {map && <a href={map} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50"><MapPin className="h-4 w-4" />แผนที่/นำทาง</a>}
          {canManage && <LinkButton href={`/settings/locations?building=${id}`} variant="secondary"><Settings2 className="h-4 w-4" />จัดการผังชั้นและตำแหน่ง</LinkButton>}
        </>} />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["ความครอบคลุมการตรวจ (ต้นปีถึงวันนี้)", formatPct(k?.tasks.coverage_pct ?? null)], ["งานตรวจเกินกำหนด", k?.tasks.overdue ?? 0],
          ["ข้อบกพร่องค้าง", k?.findings.open ?? 0], ["ข้อบกพร่องเร่งด่วนค้าง", k?.findings.urgent_open ?? 0]].map(([l, v]) => (
          <div key={String(l)} className="rounded-xl border border-gray-200 bg-white p-3"><div className="text-xs text-gray-600">{l}</div><div className="text-2xl font-bold text-ink">{v}</div></div>
        ))}
      </div>

      {floors.length === 0 ? <Card><p className="text-sm text-gray-600">อาคารนี้ยังไม่มีข้อมูลชั้น — ผู้ดูแลเพิ่มได้ที่ ตั้งค่าระบบ › สถานที่</p></Card> : (
        <>
          <nav aria-label="เลือกชั้น" className="mb-3 flex flex-wrap gap-2">
            {floors.map((f) => {
              const c = perFloor.get(f.id);
              return (
                <Link key={f.id} href={`?floor=${f.id}`} aria-current={f.id === floor?.id ? "page" : undefined}
                  className={"rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset " + (f.id === floor?.id ? "bg-brand text-white ring-brand" : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50")}>
                  {f.name} <span className="opacity-80">({c?.n ?? 0})</span>{c?.danger ? <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">! {c.danger}</span> : null}
                </Link>
              );
            })}
          </nav>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2" title={`ผัง${floor?.name ?? ""}`}
              actions={floor?.plan_updated_at ? <span className="text-xs text-gray-500">อัปเดตผัง {formatDate(floor.plan_updated_at)}</span> : undefined}>
              <FloorPlan planUrl={planUrl} pins={pins} caption={planUrl ? "แตะหมุดเพื่อเปิดจุดตรวจ/ข้อบกพร่อง" : "ยังไม่มีภาพผังชั้น — หมุดแสดงบนตารางอ้างอิง"} />
              <div className="mt-3"><PinLegend /></div>
              {onFloor.some((a) => a.plan_x == null) && (
                <p className="mt-2 text-xs text-amber-700">มี {onFloor.filter((a) => a.plan_x == null).length} จุดตรวจบนชั้นนี้ที่ยังไม่ปักหมุด{canManage ? " — แก้ไขจุดตรวจเพื่อปักหมุด" : ""}</p>
              )}
            </Card>
            <Card title={`ห้อง/พื้นที่ และจุดตรวจ (${onFloor.length})`}>
              {onFloor.length === 0 ? <p className="text-sm text-gray-600">ไม่มีจุดตรวจบนชั้นนี้</p> : (
                <div className="max-h-[560px] space-y-3 overflow-y-auto" data-testid="floor-asset-list">
                  {Array.from(byRoom.entries()).map(([room, list]) => (
                    <div key={room}>
                      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{room}</h3>
                      <ul className="space-y-1">
                        {list.map((a) => {
                          const t = assetPinTone(a);
                          return (
                            <li key={a.id} className={"flex items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-sm " + (a.id === sp.focus ? "bg-brand/10" : "hover:bg-gray-50")}>
                              <Link href={`/assets/${a.id}`} className="min-w-0">
                                <span className="font-mono text-xs text-gray-500">{a.code}</span>
                                <span className="block truncate">{CATEGORY_LABELS[a.category] ?? a.asset_type_name}</span>
                                {a.plan_x == null && <span className="text-[11px] text-amber-700">ยังไม่ปักหมุด</span>}
                              </Link>
                              <Badge tone={TONE_BADGE[t]} icon={false}>{TONE_GLYPH[t]} {PIN_TONE_LABELS[t]}</Badge>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      {findingsOnFloor.length > 0 && (
        <Card className="mt-4" title={`ข้อบกพร่องที่ยังไม่ปิดบน${floor?.name ?? ""} (${findingsOnFloor.length})`}>
          <ul className="divide-y divide-gray-100 text-sm">
            {findingsOnFloor.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/findings/${f.id}`} className="text-brand underline">{f.finding_no} {f.title}</Link>
                <span className="flex items-center gap-2 text-xs text-gray-600">{f.location_name ?? ""}{f.location_note ? ` · ${f.location_note}` : ""}
                  <Badge tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABELS[f.severity]}</Badge></span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {noFloor.length > 0 && (
        <Card className="mt-4" title={`จุดตรวจที่ยังไม่ระบุชั้น (${noFloor.length})`}>
          <ul className="flex flex-wrap gap-2 text-sm">{noFloor.map((a) => <li key={a.id}><Link href={`/assets/${a.id}`} className="text-brand underline">{a.code}</Link></li>)}</ul>
        </Card>
      )}
    </>
  );
}
