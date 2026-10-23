import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, SessionContext } from "@/lib/types";

/** ข้อมูลผู้ใช้ + บทบาท (โหลดครั้งเดียวต่อคำขอ) — ใช้แสดงเมนูเท่านั้น สิทธิ์จริงตรวจที่ฐานข้อมูล */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.rpc("my_context");
  if (error || !data) return { profile: null, roles: [], unread_notifications: 0 };
  return data as SessionContext;
});

export async function requireSession(): Promise<SessionContext> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export function hasRole(s: SessionContext | null, roles: AppRole[], orgId?: string, orgAncestors?: string[]) {
  if (!s) return false;
  return s.roles.some((r) => roles.includes(r.role) &&
    (!orgId || r.organization_id === orgId || (orgAncestors ?? []).includes(r.organization_id)));
}

export const isCentral = (s: SessionContext | null) => !!s?.roles.some((r) => r.is_root && (r.role === "system_admin" || r.role === "safety_coordinator"));
export const isSystemAdmin = (s: SessionContext | null) => !!s?.roles.some((r) => r.is_root && r.role === "system_admin");
export const MANAGER_ROLES: AppRole[] = ["system_admin", "safety_coordinator", "org_admin"];
export const INSPECT_ROLES: AppRole[] = ["system_admin", "safety_coordinator", "org_admin", "inspector"];
