import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Building, Organization } from "@/lib/types";

export async function getFilterOptions() {
  const supabase = await createClient();
  const [orgs, buildings, people] = await Promise.all([
    supabase.from("organizations").select("*").eq("is_active", true).order("code"),
    supabase.from("buildings").select("*").eq("is_active", true).order("name"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name").limit(500),
  ]);
  const list = (orgs.data ?? []) as Organization[];
  // เรียงตามลำดับชั้น
  const sorted = [...list].sort((a, b) => a.ancestors.length - b.ancestors.length || a.code.localeCompare(b.code));
  const tree: Organization[] = [];
  const add = (parent: string | null) => sorted.filter((o) => o.parent_id === parent).forEach((o) => { tree.push(o); add(o.id); });
  add(null);
  return { orgs: tree, buildings: (buildings.data ?? []) as Building[], people: (people.data ?? []) as { id: string; full_name: string }[] };
}

/** สร้าง signed URL อายุจำกัดสำหรับไฟล์ private (สิทธิ์ตรวจด้วย storage policy ในนามผู้ใช้) */
export async function signedUrls(paths: string[], expiresIn = 600): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const supabase = await createClient();
  const { data } = await supabase.storage.from("attachments").createSignedUrls(paths, expiresIn);
  const out: Record<string, string> = {};
  (data ?? []).forEach((d) => { if (d.signedUrl && d.path) out[d.path] = d.signedUrl; });
  return out;
}
