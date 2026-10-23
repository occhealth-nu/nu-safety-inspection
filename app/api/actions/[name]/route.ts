import { NextResponse, type NextRequest } from "next/server";
import * as findings from "@/lib/actions/findings";
import * as inspection from "@/lib/actions/inspection";
import * as plans from "@/lib/actions/plans";
import * as admin from "@/lib/actions/admin";
import * as checklists from "@/lib/actions/checklists";
import * as notifications from "@/lib/actions/notifications";
import * as assets from "@/lib/actions/assets";
import * as account from "@/lib/actions/account";
import type { ActionResult } from "@/lib/errors";

export const runtime = "nodejs";

/*
 * จุดเรียกคำสั่งเปลี่ยนแปลงข้อมูลจากหน้าจอ (JSON over HTTP)
 * - ทุกคำสั่งทำงานในนามผู้ใช้ (cookie session) และฐานข้อมูลตรวจสิทธิ์ซ้ำทุกครั้ง (RLS/RPC)
 * - ตอบกลับหลัง Backend ยืนยันผลเท่านั้น หน้าจอจึงไม่แสดงว่าสำเร็จก่อนบันทึกจริง
 * - ป้องกัน CSRF ด้วยการตรวจ Origin ให้ตรงกับโฮสต์ของระบบ
 */
type FormFn = (prev: unknown, form: FormData) => Promise<ActionResult<unknown>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ArgFn = (...args: any[]) => Promise<ActionResult<unknown>>;

const FORM_ACTIONS: Record<string, FormFn> = {
  assignFinding: findings.assignFinding, addProgress: findings.addProgress, submitFix: findings.submitFix,
  verifyFinding: findings.verifyFinding, createWorkOrder: findings.createWorkOrder,
  createPlan: plans.createPlan, assignTasks: plans.assignTasks,
  createOrganization: admin.createOrganization, createBuilding: admin.createBuilding, createFloor: admin.createFloor,
  createLocation: admin.createLocation, createUser: admin.createUser, grantRole: admin.grantRole,
  saveNotificationSettings: admin.saveNotificationSettings, saveBranding: admin.saveBranding,
  saveItem: checklists.saveItem, saveVersionMeta: checklists.saveVersionMeta, createTemplate: checklists.createTemplate,
  saveAsset: assets.saveAsset, changePassword: account.changePassword,
};
const ARG_ACTIONS: Record<string, ArgFn> = {
  startWork: findings.startWork, saveInspectionDraft: inspection.saveInspectionDraft, submitInspection: inspection.submitInspection,
  generateTasks: plans.generateTasks, togglePlan: plans.togglePlan, cancelTask: plans.cancelTask,
  toggleOrganization: admin.toggleOrganization, revokeRole: admin.revokeRole, setUserActive: admin.setUserActive,
  newVersion: checklists.newVersion, publishVersion: checklists.publishVersion, deleteItem: checklists.deleteItem,
  markAllRead: notifications.markAllRead,
};
export type ActionName = keyof typeof FORM_ACTIONS | keyof typeof ARG_ACTIONS;

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, code: "FORBIDDEN", message: "คำขอไม่ถูกต้อง" }, { status: 403 });
  try {
    let result: ActionResult<unknown>;
    if (FORM_ACTIONS[name]) {
      result = await FORM_ACTIONS[name](null, await req.formData());
    } else if (ARG_ACTIONS[name]) {
      const body = await req.json().catch(() => ({}));
      result = await ARG_ACTIONS[name](...(Array.isArray(body.args) ? body.args : []));
    } else {
      return NextResponse.json({ ok: false, message: "ไม่พบคำสั่ง" }, { status: 404 });
    }
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // redirect() จาก action เดิม → ส่งปลายทางให้หน้าจอนำทางเอง
    const digest = (e as { digest?: string })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      const url = digest.split(";")[2];
      return NextResponse.json({ ok: true, redirect: url });
    }
    console.error("[action]", name, e);
    return NextResponse.json({ ok: false, message: "เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ ข้อมูลอาจยังไม่ถูกบันทึก กรุณาตรวจสอบแล้วลองใหม่" }, { status: 500 });
  }
}
