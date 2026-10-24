import "server-only";
import QRCode from "qrcode";

/** URL ใน QR ใช้รหัสอ้างอิงถาวรแบบสุ่ม (qr_token) — ไม่มีข้อมูลส่วนบุคคลหรือข้อมูลลับ */
export function qrUrl(base: string, token: string) {
  return `${base}/q/${token}`;
}

export async function qrSvg(base: string, token: string, size = 160) {
  return QRCode.toString(qrUrl(base, token), { type: "svg", margin: 1, width: size, errorCorrectionLevel: "M" });
}
