import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// เปิด (หรือกลับไปยัง) ฉบับร่างผลตรวจ — start_inspection เป็น idempotent: คืนร่างเดิมหากมีอยู่แล้ว
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const asset = url.searchParams.get("asset");
  const task = url.searchParams.get("task");
  if (!asset) return NextResponse.redirect(new URL("/inspect", url.origin));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_inspection", { p_asset_id: asset, p_task_id: task || null });
  if (error || !data) {
    const msg = error?.hint ? error.message : "ไม่สามารถเริ่มการตรวจได้";
    return NextResponse.redirect(new URL(`/inspect?error=${encodeURIComponent(msg)}`, url.origin), { status: 303 });
  }
  return NextResponse.redirect(new URL(`/inspect/${data}`, url.origin), { status: 303 });
}
