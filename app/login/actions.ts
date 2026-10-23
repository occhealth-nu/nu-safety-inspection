"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

function safeNext(v: FormDataEntryValue | null) {
  const s = typeof v === "string" ? v : "/";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}

export async function signIn(_: unknown, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "กรุณากรอกอีเมลและรหัสผ่าน" };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.status === 400 ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : "ไม่สามารถเข้าสู่ระบบได้ในขณะนี้ กรุณาลองใหม่" };
  }
  redirect(safeNext(form.get("next")));
}

/** SSO มหาวิทยาลัย — ใช้งานได้เมื่อกำหนดผู้ให้บริการจริงใน Supabase และ .env แล้วเท่านั้น */
export async function signInSso(form: FormData) {
  const supabase = await createClient();
  const next = safeNext(form.get("next"));
  const redirectTo = `${env.appUrl}/auth/callback?next=${encodeURIComponent(next)}`;
  if (env.ssoProvider === "google") {
    // hd = แนะนำให้ Google แสดงเฉพาะบัญชีองค์กร (ฐานข้อมูลและ /auth/callback ตรวจโดเมนซ้ำเสมอ)
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, queryParams: { hd: env.ssoDomain || "nu.ac.th", prompt: "select_account" } },
    });
    if (!error && data?.url) redirect(data.url);
  } else if (env.ssoProvider === "saml" && env.ssoDomain) {
    const { data, error } = await supabase.auth.signInWithSSO({ domain: env.ssoDomain, options: { redirectTo } });
    if (!error && data?.url) redirect(data.url);
  } else if (env.ssoProvider === "azure") {
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: "azure", options: { redirectTo, scopes: "email" } });
    if (!error && data?.url) redirect(data.url);
  }
  redirect("/login?error=sso");
}
