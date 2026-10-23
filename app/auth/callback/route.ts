import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// ปลายทางหลังเข้าสู่ระบบด้วย Google/SSO — ตรวจโดเมนซ้ำฝั่งเซิร์ฟเวอร์ (นอกเหนือจาก trigger ในฐานข้อมูล)
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const fail = (reason: string) => NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin));

  // Supabase ส่ง error กลับมา เช่น ฐานข้อมูลปฏิเสธบัญชีนอกโดเมน
  const err = `${url.searchParams.get("error") ?? ""} ${url.searchParams.get("error_description") ?? ""}`;
  if (err.trim()) return fail(/database error|domain|มหาวิทยาลัย/i.test(err) ? "domain" : "sso");
  if (!code) return fail("sso");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail("sso");

  const { data: { user } } = await supabase.auth.getUser();
  const { data: allowed } = await supabase.rpc("email_domain_allowed", { p_email: user?.email ?? "" });
  const hd = (user?.user_metadata?.custom_claims as { hd?: string } | undefined)?.hd;
  const { data: hdAllowed } = hd ? await supabase.rpc("email_domain_allowed", { p_email: `x@${hd}` }) : { data: true };
  if (!user || !allowed || !hdAllowed) {
    await supabase.auth.signOut();
    return fail("domain");
  }
  const { data: profile } = await supabase.from("profiles").select("is_active").eq("id", user.id).maybeSingle();
  if (profile && !profile.is_active) {
    await supabase.auth.signOut();
    return fail("disabled");
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
