import "server-only";
import QRCode from "qrcode";
import { env } from "@/lib/env";

/** URL ใน QR ใช้รหัสอ้างอิงถาวรแบบสุ่ม (qr_token) — ไม่มีข้อมูลส่วนบุคคลหรือข้อมูลลับ */
export function qrUrl(token: string) {
  return `${env.appUrl}/q/${token}`;
}

export async function qrSvg(token: string, size = 160) {
  return QRCode.toString(qrUrl(token), { type: "svg", margin: 1, width: size, errorCorrectionLevel: "M" });
}
