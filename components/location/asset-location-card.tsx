import Link from "next/link";
import { MapPin, Navigation } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { floorPlanUrls } from "@/lib/queries";
import { Card } from "@/components/ui";
import { FloorPlan } from "@/components/location/floor-plan";
import { assetPinTone, mapsUrl, scopePath } from "@/lib/location";
import type { AssetRow } from "@/lib/types";

/** การ์ด “ตำแหน่ง”: เส้นทางพื้นที่ (อาคาร › ชั้น › ห้อง) + ผังชั้นพร้อมหมุด + ลิงก์นำทาง */
export async function AssetLocationCard({ asset, compact }: { asset: AssetRow; compact?: boolean }) {
  const supabase = await createClient();
  const [floor, building] = await Promise.all([
    asset.floor_id ? supabase.from("floors").select("plan_path").eq("id", asset.floor_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("buildings").select("latitude, longitude").eq("id", asset.building_id).maybeSingle(),
  ]);
  const path = (floor.data as { plan_path: string | null } | null)?.plan_path ?? null;
  const urls = await floorPlanUrls([path]);
  const b = building.data as { latitude: number | null; longitude: number | null } | null;
  const nav = mapsUrl(asset.latitude ?? b?.latitude, asset.longitude ?? b?.longitude);
  const pinned = asset.plan_x != null && asset.plan_y != null;
  return (
    <Card title="ตำแหน่ง" actions={<Link href={`/buildings/${asset.building_id}?floor=${asset.floor_id ?? ""}&focus=${asset.id}`} className="text-sm text-brand underline">ดูในผังอาคาร</Link>}>
      <p className="mb-2 flex items-start gap-1 text-sm"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        {scopePath([asset.building_name, asset.floor_name, asset.location_name])}{asset.location_detail ? ` — ${asset.location_detail}` : ""}</p>
      {asset.floor_id ? (
        <FloorPlan planUrl={path ? urls[path] ?? null : null} compact={compact}
          pins={pinned ? [{ id: asset.id, x: Number(asset.plan_x), y: Number(asset.plan_y), tone: assetPinTone(asset), label: `${asset.code} ${asset.name}`, highlight: true }] : []}
          caption={pinned ? "หมุดกะพริบ = ตำแหน่งของจุดตรวจนี้" : "ยังไม่ได้ปักหมุดตำแหน่งบนผังชั้น"} />
      ) : <p className="text-xs text-gray-500">ยังไม่ระบุชั้น จึงยังไม่มีผังชั้น</p>}
      {nav ? <a href={nav} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-brand underline"><Navigation className="h-4 w-4" />นำทางไปยัง{asset.latitude != null ? "จุดตรวจ" : "อาคาร"} (Google Maps)</a>
        : <p className="mt-2 text-xs text-gray-400">ยังไม่ระบุพิกัด GPS ของอาคาร</p>}
    </Card>
  );
}
