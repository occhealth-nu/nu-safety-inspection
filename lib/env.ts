// ค่าตั้งระบบที่อ่านจาก environment (ไม่มีค่าลับฝังในโค้ด)
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  ssoProvider: process.env.NEXT_PUBLIC_SSO_PROVIDER ?? "",
  // google = เข้าสู่ระบบด้วยบัญชี Google Workspace ของมหาวิทยาลัย; azure / saml = ทางเลือกอื่น
  ssoDomain: process.env.NEXT_PUBLIC_SSO_DOMAIN || (process.env.NEXT_PUBLIC_SSO_PROVIDER === "google" ? "nu.ac.th" : ""),
};

export function assertSupabaseEnv() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("ยังไม่ได้ตั้งค่า NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (ดู .env.example)");
  }
}
