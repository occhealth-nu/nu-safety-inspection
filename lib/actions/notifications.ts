"use server";
import { createClient } from "@/lib/supabase/server";
import { toActionError, type ActionResult } from "@/lib/errors";

export async function markAllRead(): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user?.id ?? "").is("read_at", null);
  if (error) return toActionError(error);
  return { ok: true, message: "ทำเครื่องหมายอ่านแล้วทั้งหมด" };
}
