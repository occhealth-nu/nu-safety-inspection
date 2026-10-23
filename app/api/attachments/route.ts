import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

const MAX = 10 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

// อัปโหลดไฟล์แนบ: Storage policy + register_attachment ตรวจสิทธิ์ในนามผู้ใช้ (ไม่ใช้ service role)
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, message: "คำขอไม่ถูกต้อง" }, { status: 400 });
  const file = form.get("file");
  const entityType = String(form.get("entity_type") ?? "");
  const entityId = String(form.get("entity_id") ?? "");
  const kind = String(form.get("kind") ?? "evidence");
  const itemId = form.get("item_id") ? String(form.get("item_id")) : null;
  if (!(file instanceof File) || !["inspection", "finding", "asset"].includes(entityType) || !/^[0-9a-f-]{36}$/.test(entityId)) {
    return NextResponse.json({ ok: false, message: "ข้อมูลไฟล์ไม่ครบถ้วน" }, { status: 400 });
  }
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ ok: false, message: "รองรับเฉพาะไฟล์ภาพ JPG/PNG/WebP หรือ PDF" }, { status: 415 });
  if (file.size <= 0 || file.size > MAX) return NextResponse.json({ ok: false, message: "ไฟล์ต้องมีขนาดไม่เกิน 10 MB" }, { status: 413 });

  const supabase = await createClient();
  const path = `${entityType}/${entityId}/${randomUUID()}.${ext}`;
  const up = await supabase.storage.from("attachments").upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) {
    return NextResponse.json({ ok: false, message: "อัปโหลดไม่สำเร็จ หรือไม่มีสิทธิ์แนบไฟล์กับรายการนี้" }, { status: 403 });
  }
  const { data, error } = await supabase.rpc("register_attachment", {
    p_entity_type: entityType, p_entity_id: entityId, p_storage_path: path, p_mime_type: file.type,
    p_size_bytes: file.size, p_kind: kind, p_item_id: itemId,
  });
  if (error) {
    await supabase.storage.from("attachments").remove([path]);
    return NextResponse.json({ ok: false, message: error.hint ? error.message : "บันทึกไฟล์แนบไม่สำเร็จ" }, { status: 400 });
  }
  const signed = await supabase.storage.from("attachments").createSignedUrl(path, 600);
  return NextResponse.json({ ok: true, id: data, path, url: signed.data?.signedUrl ?? null });
}
