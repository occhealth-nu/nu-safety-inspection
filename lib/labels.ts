import type { AppRole, AssetStatus, FindingStatus, Frequency, ItemResult, Severity, TaskDisplayStatus } from "./types";

export const ROLE_LABELS: Record<AppRole, string> = {
  system_admin: "ผู้ดูแลระบบมหาวิทยาลัย",
  safety_coordinator: "ผู้ประสานงานความปลอดภัยส่วนกลาง",
  org_admin: "ผู้ดูแลระดับคณะ/หน่วยงาน",
  inspector: "ผู้ตรวจ",
  responsible: "ผู้รับผิดชอบแก้ไข",
  verifier: "ผู้ตรวจยืนยัน",
  executive: "ผู้บริหาร/คณะกรรมการความปลอดภัย",
};
export const ROLES = Object.keys(ROLE_LABELS) as AppRole[];

export const CATEGORY_LABELS: Record<string, string> = {
  fire_extinguisher: "ถังดับเพลิง",
  fire_hose: "ตู้สายฉีดน้ำดับเพลิงและอุปกรณ์ระงับเหตุ",
  emergency_light: "ไฟฉุกเฉินและป้ายทางออก",
  fire_exit: "ทางหนีไฟและประตูหนีไฟ",
  fire_alarm: "ระบบแจ้งเหตุเพลิงไหม้",
  electrical: "ตู้ไฟ เต้ารับ เต้าเสียบ และปลั๊กพ่วง",
  safety_patrol: "สภาพแวดล้อมการทำงาน / Safety Patrol",
  laboratory: "ห้องปฏิบัติการและการจัดเก็บสารเคมี",
  other: "อื่น ๆ",
};
export const CATEGORIES = Object.keys(CATEGORY_LABELS);

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: "รายวัน", weekly: "รายสัปดาห์", monthly: "รายเดือน", quarterly: "รายไตรมาส", yearly: "รายปี", custom: "กำหนดเอง (ทุก N วัน)",
};

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  active: "ใช้งานอยู่", inactive: "หยุดใช้งาน", relocated: "ย้ายตำแหน่ง", disposed: "จำหน่ายแล้ว",
};

export const RESULT_LABELS: Record<ItemResult, string> = { pass: "ผ่าน", fail: "ไม่ผ่าน", na: "ไม่เกี่ยวข้อง" };

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: "ต่ำ", medium: "ปานกลาง", high: "สูง (เร่งด่วน)", critical: "วิกฤต (เร่งด่วนมาก)",
};

export const FINDING_STATUS_LABELS: Record<FindingStatus, string> = {
  open: "พบข้อบกพร่อง (รอมอบหมาย)",
  assigned: "มอบหมายแล้ว (รอแก้ไข)",
  in_progress: "กำลังแก้ไข",
  pending_verification: "รอตรวจยืนยัน",
  closed: "ปิดงาน",
};
export const FINDING_FLOW: FindingStatus[] = ["open", "assigned", "in_progress", "pending_verification", "closed"];
export const FINDING_FLOW_SHORT: Record<FindingStatus, string> = {
  open: "พบข้อบกพร่อง", assigned: "มอบหมาย", in_progress: "กำลังแก้ไข", pending_verification: "รอตรวจยืนยัน", closed: "ปิดงาน",
};

export const TASK_STATUS_LABELS: Record<TaskDisplayStatus, string> = {
  upcoming: "ยังไม่ถึงกำหนด", pending: "รอตรวจ", done: "ตรวจแล้ว", overdue: "เกินกำหนด", cancelled: "ยกเลิก",
};

export const REMEDIATION_LABELS: Record<string, string> = {
  waiting: "รอแก้ไข", in_progress: "กำลังแก้ไข", pending_verification: "รอตรวจยืนยัน", closed: "ปิดงาน",
};

export const ACTION_LABELS: Record<string, string> = {
  created: "พบข้อบกพร่อง", assign: "มอบหมายงาน", reassign: "เปลี่ยนผู้รับผิดชอบ/กำหนดเสร็จ", start: "เริ่มแก้ไข",
  progress: "รายงานความคืบหน้า", submit_fix: "ส่งผลการแก้ไข", approve: "ตรวจยืนยัน: ผ่าน ปิดงาน",
  reject: "ตรวจยืนยัน: ส่งกลับแก้ไข", work_order: "ออกใบงาน", comment: "ความคิดเห็น",
};

/** โทนสถานะ (ใช้คู่กับไอคอนและข้อความเสมอ ไม่สื่อด้วยสีอย่างเดียว) */
export type Tone = "neutral" | "info" | "good" | "warning" | "serious" | "critical";

export const TASK_TONE: Record<TaskDisplayStatus, Tone> = {
  upcoming: "neutral", pending: "info", done: "good", overdue: "critical", cancelled: "neutral",
};
export const FINDING_TONE: Record<FindingStatus, Tone> = {
  open: "serious", assigned: "warning", in_progress: "info", pending_verification: "warning", closed: "good",
};
export const SEVERITY_TONE: Record<Severity, Tone> = { low: "neutral", medium: "warning", high: "serious", critical: "critical" };
export const RESULT_TONE: Record<ItemResult, Tone> = { pass: "good", fail: "critical", na: "neutral" };
