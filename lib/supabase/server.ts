import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env, assertSupabaseEnv } from "@/lib/env";

/** Supabase client ที่ทำงานในนามผู้ใช้ที่เข้าสู่ระบบ (RLS มีผลทุกคำสั่ง) */
export async function createClient() {
  assertSupabaseEnv();
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // เรียกจาก Server Component: middleware เป็นผู้ต่ออายุ session แทน
        }
      },
    },
  });
}
