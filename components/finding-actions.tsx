"use client";
import { useState } from "react";
import { ActionButton, FormMessage, useActionForm } from "@/components/action-button";
import { PhotoUploader, type UploadedPhoto } from "@/components/photo-uploader";
import { Card, Field, buttonClass, inputClass, NotConnected } from "@/components/ui";
import type { FindingStatus } from "@/lib/types";

export function AssignPanel({ findingId, responsible, current, minDate }: {
  findingId: string; responsible: { id: string; label: string }[]; current: { assignee_id: string | null; due_on: string | null; initial_measure: string | null }; minDate: string;
}) {
  const { state, pending, onSubmit } = useActionForm("assignFinding");
  return (
    <Card title={current.assignee_id ? "เปลี่ยนผู้รับผิดชอบ / กำหนดเสร็จ" : "มอบหมายผู้รับผิดชอบแก้ไข"}>
      <form onSubmit={onSubmit} className="space-y-3">
        <input type="hidden" name="finding_id" value={findingId} />
        <Field label="ผู้รับผิดชอบแก้ไข" required>
          <select name="assignee_id" required defaultValue={current.assignee_id ?? ""} className={inputClass}>
            <option value="">— เลือก —</option>{responsible.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="กำหนดแล้วเสร็จ" required><input type="date" name="due_on" min={minDate} required defaultValue={current.due_on ?? ""} className={inputClass} /></Field>
        <Field label="มาตรการเบื้องต้น"><textarea name="initial_measure" rows={2} defaultValue={current.initial_measure ?? ""} className={inputClass} placeholder="เช่น กั้นพื้นที่ ติดป้ายเตือน งดใช้งานชั่วคราว" /></Field>
        <Field label="หมายเหตุ"><input name="note" className={inputClass} /></Field>
        <FormMessage state={state} />
        <button disabled={pending} className={buttonClass("primary")}>{pending ? "กำลังบันทึก…" : "บันทึกการมอบหมาย"}</button>
      </form>
    </Card>
  );
}

export function AssigneePanel({ findingId, status, afterPhotos }: { findingId: string; status: FindingStatus; afterPhotos: UploadedPhoto[] }) {
  const { state: pState, pending: pPending, onSubmit: pSubmit } = useActionForm("addProgress");
  const { state: sState, pending: sPending, onSubmit: sSubmit } = useActionForm("submitFix");
  const [photos, setPhotos] = useState(afterPhotos);
  return (
    <Card title="ดำเนินการแก้ไข (ผู้รับผิดชอบ)">
      {status === "assigned" && (
        <div className="mb-4"><ActionButton action="startWork" args={[findingId]} variant="primary" size="lg">รับงาน / เริ่มแก้ไข</ActionButton></div>
      )}
      <form onSubmit={pSubmit} className="space-y-2 border-b border-gray-100 pb-4">
        <input type="hidden" name="finding_id" value={findingId} />
        <Field label="รายงานความคืบหน้า"><textarea name="note" rows={2} required className={inputClass} placeholder="สิ่งที่ดำเนินการแล้ว / อุปสรรค" /></Field>
        <div className="flex items-end gap-2">
          <Field label="ร้อยละความคืบหน้า"><input type="number" name="progress_pct" min={0} max={100} className={inputClass + " w-28"} /></Field>
          <button disabled={pPending} className={buttonClass("secondary")}>{pPending ? "กำลังบันทึก…" : "บันทึกความคืบหน้า"}</button>
        </div>
        <FormMessage state={pState} />
      </form>
      <div className="mt-4">
        <p className="mb-1 text-sm font-medium">ภาพหลักฐานหลังแก้ไข</p>
        <PhotoUploader entityType="finding" entityId={findingId} kind="after" photos={photos} onChange={(p) => setPhotos(p)} label="แนบภาพหลังแก้ไข" />
      </div>
      <form onSubmit={sSubmit} className="mt-4 space-y-2">
        <input type="hidden" name="finding_id" value={findingId} />
        <Field label="สรุปการแก้ไข" required><textarea name="note" rows={2} required className={inputClass} /></Field>
        {photos.length === 0 && <Field label="เหตุผลที่ไม่แนบภาพ" hint="ใช้เฉพาะกรณีถ่ายภาพไม่ได้ เช่น ไม่ปลอดภัย หรือพื้นที่ห้ามถ่ายภาพ"><input name="no_photo_reason" className={inputClass} /></Field>}
        <FormMessage state={sState} />
        <button disabled={sPending} className={buttonClass("success", "lg")}>{sPending ? "กำลังส่ง…" : "ส่งผลแก้ไขให้ตรวจยืนยัน"}</button>
      </form>
    </Card>
  );
}

export function VerifyPanel({ findingId }: { findingId: string }) {
  const { state, pending, onSubmit } = useActionForm("verifyFinding");
  return (
    <Card title="ตรวจยืนยันผลการแก้ไข">
      <form onSubmit={onSubmit} className="space-y-3">
        <input type="hidden" name="finding_id" value={findingId} />
        <Field label="ความเห็น / เหตุผล" hint="จำเป็นเมื่อส่งกลับแก้ไข"><textarea name="note" rows={2} className={inputClass} /></Field>
        <FormMessage state={state} />
        <div className="grid grid-cols-2 gap-2">
          <button name="decision" value="reject" disabled={pending} className={buttonClass("danger", "lg")}>ส่งกลับแก้ไข</button>
          <button name="decision" value="approve" disabled={pending} className={buttonClass("success", "lg")}>ผ่าน — ปิดงาน</button>
        </div>
      </form>
    </Card>
  );
}

export function WorkOrderPanel({ findingId, defaultText }: { findingId: string; defaultText: string }) {
  const [wo, setWo] = useState<{ id: string; wo_no: string } | null>(null);
  const { state, pending, onSubmit } = useActionForm<{ id: string; wo_no: string }>("createWorkOrder", { onSuccess: (r) => setWo(r.data ?? null) });
  return (
    <Card title="ส่งใบงานไปยังหน่วยงานที่เกี่ยวข้อง">
      <NotConnected>ยังไม่ได้เชื่อมต่อ API ระบบแจ้งซ่อมของกองอาคารสถานที่ — ระบบจะออกใบงานในระบบและให้พิมพ์/บันทึก PDF เพื่อส่งต่อด้วยตนเอง</NotConnected>
      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <input type="hidden" name="finding_id" value={findingId} />
        <Field label="หน่วยงานปลายทาง" required><input name="target_unit" required defaultValue="กองอาคารสถานที่" className={inputClass} /></Field>
        <Field label="รายละเอียดงาน" required><textarea name="description" rows={3} required defaultValue={defaultText} className={inputClass} /></Field>
        <FormMessage state={state} />
        {wo && <a href={`/findings/${findingId}/work-order/${wo.id}`} className="text-sm text-brand underline">เปิดใบงาน {wo.wo_no} เพื่อพิมพ์</a>}
        <button disabled={pending} className={buttonClass("secondary")}>{pending ? "กำลังออกใบงาน…" : "ออกใบงาน"}</button>
      </form>
    </Card>
  );
}
