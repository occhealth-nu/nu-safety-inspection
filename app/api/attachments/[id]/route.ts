import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("remove_attachment", { p_attachment_id: id });
  if (error) return NextResponse.json({ ok: false, message: error.hint ? error.message : "ลบไฟล์ไม่สำเร็จ" }, { status: 400 });
  await supabase.storage.from("attachments").remove([data as string]);
  return NextResponse.json({ ok: true });
}
