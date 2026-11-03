import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

const MAX = 10 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// อัปโหลดภาพผังชั้น: storage policy (floor-plans) + RPC set_floor_plan ตรวจสิทธิ์ในนามผู้ใช้ (ไม่ใช้ service role)
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const floorId = String(form?.get("floor_id") ?? "");
  if (!(file instanceof File) || !/^[0-9a-f-]{36}$/.test(floorId)) return NextResponse.json({ ok: false, message: "ข้อมูลไม่ครบถ้วน" }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ ok: false, message: "ผังชั้นต้องเป็นไฟล์ภาพ JPG, PNG หรือ WebP (ถ้ามีเป็น PDF ให้บันทึกเป็นภาพก่อน)" }, { status: 415 });
  if (file.size <= 0 || file.size > MAX) return NextResponse.json({ ok: false, message: "ไฟล์ต้องมีขนาดไม่เกิน 10 MB" }, { status: 413 });

  const supabase = await createClient();
  const path = `floor/${floorId}/${randomUUID()}.${ext}`;
  const up = await supabase.storage.from("floor-plans").upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) return NextResponse.json({ ok: false, message: "อัปโหลดไม่สำเร็จ หรือไม่มีสิทธิ์จัดการอาคารนี้" }, { status: 403 });
  const { error } = await supabase.rpc("set_floor_plan", { p_floor_id: floorId, p_path: path });
  if (error) {
    await supabase.storage.from("floor-plans").remove([path]);
    return NextResponse.json({ ok: false, message: error.hint ? error.message : "บันทึกผังชั้นไม่สำเร็จ" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, path });
}
