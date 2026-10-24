import "server-only";
import { headers } from "next/headers";
import { cleanValue, isValidHttpUrl } from "@/lib/env";

/** โดเมนที่ผู้ใช้เปิดเว็บอยู่จริง (เช่น https://xxx.vercel.app) */
export async function currentOrigin(): Promise<string | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** ที่อยู่หลักของระบบ: ใช้ NEXT_PUBLIC_APP_URL ถ้าตั้งไว้ ไม่เช่นนั้นใช้โดเมนที่เปิดอยู่ */
export async function appBaseUrl(): Promise<string> {
  const configured = cleanValue(process.env.NEXT_PUBLIC_APP_URL).replace(/\/+$/, "");
  if (configured && isValidHttpUrl(configured)) return configured;
  return (await currentOrigin()) ?? "http://localhost:3000";
}
