import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { configProblems, env } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/auth", "/manifest.webmanifest", "/sw.js", "/offline.html", "/icons", "/api/cron", "/api/health", "/setup-check"];

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // ขากลับจาก Google/Supabase ถูกส่งมาผิดหน้า (เช่น Site URL) แต่มีรหัสยืนยันติดมา → ส่งต่อไป /auth/callback
  const sp = request.nextUrl.searchParams;
  // เฉพาะรหัสรูปแบบ UUID ของ Supabase — ?code= อื่น ๆ เช่น ค้นหารหัสจุดตรวจ (/q/lookup?code=FE-EN1-101) ใช้งานได้ตามปกติ
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (path !== "/auth/callback" && path !== "/q/lookup" && (UUID.test(sp.get("code") ?? "") || (sp.has("error") && sp.has("error_description")))) {
    const cb = request.nextUrl.clone();
    cb.pathname = "/auth/callback";
    return NextResponse.redirect(cb);
  }
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));
  // ตั้งค่าไม่ครบ/ผิดรูปแบบ → พาไปหน้าตรวจการตั้งค่า (ไม่ปล่อยให้เข้าหน้าที่ต้องเข้าสู่ระบบ)
  if (configProblems().length) {
    if (isPublic) return NextResponse.next({ request });
    return NextResponse.redirect(new URL("/setup-check", request.url));
  }
  try {
    return await withSession(request, path, isPublic);
  } catch (e) {
    console.error("[middleware]", e);
    if (isPublic) return NextResponse.next({ request });
    if (path.startsWith("/api/")) return NextResponse.json({ ok: false, code: "AUTH_UNAVAILABLE", message: "ระบบยืนยันตัวตนไม่พร้อมใช้งานชั่วคราว" }, { status: 503 });
    return NextResponse.redirect(new URL("/setup-check?from=middleware", request.url));
  }
}

async function withSession(request: NextRequest, path: string, isPublic: boolean) {
  let response = NextResponse.next({ request });
  const url = env.supabaseUrl;
  const key = env.supabaseAnonKey;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // getUser() ตรวจ token กับ Auth server ทุกครั้ง (ไม่เชื่อ cookie อย่างเดียว)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && !isPublic) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ ok: false, code: "UNAUTHENTICATED", message: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    }
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|webp|woff2?)$).*)"],
};
