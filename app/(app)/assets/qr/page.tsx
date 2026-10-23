import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { qrSvg } from "@/lib/qr";
import { getAppSettings } from "@/lib/settings";
import { EmptyState, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "พิมพ์ QR Code" };

// พิมพ์ป้าย QR รายชิ้นหรือแบบชุด (?id=..&id=..) หรือทั้งอาคาร (?building=)
export default async function QrPrint({ searchParams }: { searchParams: Promise<{ id?: string | string[]; building?: string; size?: string }> }) {
  await requireSession();
  const sp = await searchParams;
  const ids = ([] as string[]).concat(sp.id ?? []).filter(Boolean).slice(0, 300);
  const supabase = await createClient();
  let q = supabase.from("v_assets").select("id, code, name, qr_token, building_name, floor_name, location_detail, organization_name").order("code").limit(300);
  if (ids.length) q = q.in("id", ids);
  else if (sp.building) q = q.eq("building_id", sp.building);
  else q = q.eq("id", "00000000-0000-0000-0000-000000000000");
  const { data } = await q;
  const settings = await getAppSettings();
  const labels = await Promise.all((data ?? []).map(async (a) => ({ ...a, svg: await qrSvg(a.qr_token, 150) })));
  const large = sp.size === "large";
  return (
    <>
      <div className="print:hidden">
        <PageHeader title="พิมพ์ป้าย QR Code" subtitle={`${labels.length} ป้าย — ใช้ปุ่มพิมพ์ของเบราว์เซอร์ (เลือก A4 และปิด “หัวกระดาษ/ท้ายกระดาษ”)`}
          back={{ href: "/assets", label: "ทะเบียนจุดตรวจ" }}
          actions={<><a href={`?${new URLSearchParams([...ids.map((i) => ["id", i]), ...(sp.building ? [["building", sp.building]] : []), ["size", large ? "small" : "large"]]).toString()}`} className="text-sm text-brand underline">{large ? "ป้ายเล็ก (3 คอลัมน์)" : "ป้ายใหญ่ (2 คอลัมน์)"}</a><PrintButton /></>} />
      </div>
      {labels.length === 0 ? <EmptyState title="ยังไม่ได้เลือกจุดตรวจ" description="เลือกจุดตรวจจากหน้าทะเบียน แล้วกด “พิมพ์ QR ที่เลือก”" /> : (
        <div className={"grid gap-3 print:gap-2 " + (large ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
          {labels.map((a) => (
            <div key={a.id} className="flex break-inside-avoid flex-col items-center rounded-lg border-2 border-dashed border-gray-300 bg-white p-3 text-center">
              <p className="text-[11px] font-semibold text-brand">{settings.app_name}</p>
              <div className={large ? "w-[190px]" : "w-[140px]"} dangerouslySetInnerHTML={{ __html: a.svg }} />
              <p className="font-mono text-base font-bold leading-tight">{a.code}</p>
              <p className="text-xs leading-tight">{a.name}</p>
              <p className="mt-0.5 text-[10px] text-gray-600">{a.building_name}{a.floor_name ? ` · ${a.floor_name}` : ""}</p>
              <p className="mt-1 text-[10px] text-gray-500">สแกนเพื่อบันทึกผลตรวจ (ต้องเข้าสู่ระบบ)</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
