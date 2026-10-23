import { getAppSettings } from "@/lib/settings";
import { env } from "@/lib/env";
import { LoginForm } from "./login-form";
import { signInSso } from "./actions";
import { NotConnected, buttonClass } from "@/components/ui";

export const metadata = { title: "เข้าสู่ระบบ" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const s = await getAppSettings();
  const ssoReady = env.ssoProvider === "google" || env.ssoProvider === "azure" || (env.ssoProvider === "saml" && !!env.ssoDomain);
  const ssoLabel = env.ssoProvider === "google" ? `เข้าสู่ระบบด้วยบัญชี Google ของมหาวิทยาลัย (@${env.ssoDomain})` : "เข้าสู่ระบบด้วยบัญชีมหาวิทยาลัย (SSO)";
  const errors: Record<string, string> = {
    sso: "เข้าสู่ระบบด้วยบัญชีมหาวิทยาลัยไม่สำเร็จ กรุณาลองใหม่",
    domain: `ระบบนี้สำหรับบุคลากรเท่านั้น — กรุณาใช้บัญชี @${env.ssoDomain || "nu.ac.th"} (ไม่รองรับบัญชี Google ส่วนตัว)`,
    disabled: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
  };
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white to-gray-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          {s.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.logo_url} alt={s.university_name_th} className="mx-auto mb-3 h-16 w-16 object-contain" />
          ) : (
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-lg font-bold text-white" aria-hidden>NU</div>
          )}
          <h1 className="text-2xl font-bold text-ink">{s.app_name}</h1>
          <p className="text-sm text-gray-600">ระบบการตรวจความปลอดภัย {s.university_name_th}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          {sp.error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{errors[sp.error] ?? errors.sso}</p>}
          {ssoReady ? (
            <form action={signInSso} className="mb-5">
              <input type="hidden" name="next" value={sp.next ?? "/"} />
              <button className={buttonClass("primary", "lg") + " w-full"}>{ssoLabel}</button>
              <p className="mt-2 text-center text-xs text-gray-500">สำหรับบุคลากรมหาวิทยาลัยเท่านั้น — ผู้ใช้ใหม่ต้องรอผู้ดูแลกำหนดสิทธิ์ก่อนใช้งาน</p>
            </form>
          ) : (
            <div className="mb-5">
              <NotConnected>การเข้าสู่ระบบด้วยบัญชีมหาวิทยาลัย (SSO) <b>ยังไม่ได้เชื่อมต่อ</b> — รอข้อมูลผู้ให้บริการจริง ใช้บัญชีอีเมลที่ผู้ดูแลสร้างให้ไปก่อน</NotConnected>
            </div>
          )}
          {ssoReady ? (
            <details className="border-t border-gray-100 pt-4">
              <summary className="cursor-pointer text-sm text-gray-600">เข้าสู่ระบบด้วยอีเมลและรหัสผ่าน (สำหรับบัญชีที่ผู้ดูแลสร้างให้)</summary>
              <div className="mt-4"><LoginForm next={sp.next ?? "/"} /></div>
            </details>
          ) : <LoginForm next={sp.next ?? "/"} />}
        </div>
      </div>
    </main>
  );
}
