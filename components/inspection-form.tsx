"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import clsx from "clsx";
import { Check, X, Minus, Save, Send, AlertTriangle, CloudOff, CheckCircle2 } from "lucide-react";
import type { ResponseInput } from "@/lib/actions/inspection";
import { callAction } from "@/components/action-button";
import { PhotoUploader, type UploadedPhoto } from "@/components/photo-uploader";
import { buttonClass, inputClass, Notice } from "@/components/ui";
import { useOnline } from "@/components/pwa";
import { SEVERITY_LABELS } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import type { ChecklistItem, ItemResult, Severity } from "@/lib/types";

type Resp = { item_id: string; result: ItemResult | null; note: string | null; na_reason: string | null; urgency: Severity | null; photo_exempt_reason: string | null };

const RESULT_BTN: { v: ItemResult; label: string; icon: typeof Check; on: string }[] = [
  { v: "pass", label: "ผ่าน", icon: Check, on: "bg-emerald-600 text-white ring-emerald-600" },
  { v: "fail", label: "ไม่ผ่าน", icon: X, on: "bg-red-600 text-white ring-red-600" },
  { v: "na", label: "ไม่เกี่ยวข้อง", icon: Minus, on: "bg-gray-600 text-white ring-gray-600" },
];

function localKey(id: string) { return `nu-insp-draft:${id}`; }

export function InspectionForm({ inspectionId, items, initial, initialSummary, initialPhotos }: {
  inspectionId: string; items: ChecklistItem[]; initial: Resp[]; initialSummary: string;
  initialPhotos: Record<string, UploadedPhoto[]>;
}) {
  const online = useOnline();
  const [resp, setResp] = useState<Record<string, Resp>>(() => {
    const m: Record<string, Resp> = {};
    items.forEach((it) => { m[it.id] = { item_id: it.id, result: null, note: null, na_reason: null, urgency: null, photo_exempt_reason: null }; });
    initial.forEach((r) => { if (m[r.item_id]) m[r.item_id] = { ...m[r.item_id], ...r }; });
    return m;
  });
  const [summary, setSummary] = useState(initialSummary);
  const [photos, setPhotos] = useState(initialPhotos);
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState<{ tone: "info" | "success" | "error" | "warning"; text: string } | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [localRestored, setLocalRestored] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, startSave] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);

  // รหัสคำขอส่งผล (คงที่ต่อฉบับร่าง) — กดซ้ำ/เครือข่ายหลุดแล้วส่งใหม่ จะไม่เกิดผลตรวจซ้ำ
  const clientSubmissionId = useMemo(() => {
    if (typeof window === "undefined") return "";
    const k = `nu-insp-submit:${inspectionId}`;
    let v = localStorage.getItem(k);
    if (!v) { v = crypto.randomUUID(); localStorage.setItem(k, v); }
    return v;
  }, [inspectionId]);

  // กู้คืนฉบับร่างที่เก็บในเครื่อง (กรณีบันทึกเข้าระบบไม่ทันหรือออฟไลน์)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(localKey(inspectionId));
      if (!raw) return;
      const saved = JSON.parse(raw) as { resp: Record<string, Resp>; summary: string; at: string };
      setResp((cur) => {
        const merged = { ...cur };
        Object.values(saved.resp).forEach((r) => { if (merged[r.item_id]) merged[r.item_id] = r; });
        return merged;
      });
      setSummary(saved.summary ?? "");
      setLocalRestored(true);
      setDirty(true);
    } catch { /* ignore */ }
  }, [inspectionId]);

  const list = useMemo(() => items.map((it) => resp[it.id]), [items, resp]);

  const update = useCallback((itemId: string, patch: Partial<Resp>) => {
    setResp((cur) => ({ ...cur, [itemId]: { ...cur[itemId], ...patch } }));
    setDirty(true);
    setServerErrors((e) => { const n = { ...e }; delete n[itemId]; return n; });
  }, []);

  // เก็บสำเนาในเครื่องทุกครั้งที่แก้ไข (ป้องกันข้อมูลหายเมื่อเครือข่ายหลุด/ปิดหน้าจอ)
  useEffect(() => {
    if (!dirty) return;
    try { localStorage.setItem(localKey(inspectionId), JSON.stringify({ resp, summary, at: new Date().toISOString() })); } catch { /* quota */ }
  }, [dirty, resp, summary, inspectionId]);

  const payload = (): ResponseInput[] => list.map((r) => ({ ...r }));

  const saveDraft = useCallback((silent = false) => {
    if (!navigator.onLine) {
      if (!silent) setStatus({ tone: "warning", text: "ไม่มีเครือข่าย — เก็บฉบับร่างไว้ในเครื่องนี้แล้ว แต่ยังไม่ได้บันทึกเข้าระบบ" });
      return;
    }
    startSave(async () => {
      try {
        const r = await callAction<{ saved_at: string }>("saveInspectionDraft", [inspectionId, payload(), summary]);
        if (r.code === "NETWORK") { if (!silent) setStatus({ tone: "warning", text: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ฉบับร่างยังอยู่ในเครื่องนี้ และยังไม่ได้บันทึกเข้าระบบ" }); return; }
        if (r.ok) { setSavedAt(r.data!.saved_at); setDirty(false); try { localStorage.removeItem(localKey(inspectionId)); } catch { /* ignore */ } if (!silent) setStatus({ tone: "success", text: "บันทึกฉบับร่างในระบบแล้ว (ยังไม่ได้ส่งผลตรวจ)" }); }
        else if (!silent) setStatus({ tone: "error", text: r.message ?? "บันทึกไม่สำเร็จ" });
      } catch { if (!silent) setStatus({ tone: "warning", text: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ฉบับร่างยังอยู่ในเครื่องนี้" }); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectionId, summary, list]);

  // บันทึกฉบับร่างเข้าระบบอัตโนมัติทุก 20 วินาทีเมื่อมีการเปลี่ยนแปลง
  useEffect(() => {
    if (!dirty || submitting) return;
    const t = setTimeout(() => saveDraft(true), 20000);
    return () => clearTimeout(t);
  }, [dirty, submitting, saveDraft]);

  // ตรวจความครบถ้วนฝั่งผู้ใช้ (ฐานข้อมูลตรวจซ้ำอีกครั้งเสมอ)
  const clientErrors = useMemo(() => {
    const errs: Record<string, string[]> = {};
    items.forEach((it) => {
      const r = resp[it.id]; const e: string[] = [];
      if (!r.result) e.push("ยังไม่ได้เลือกผลตรวจ");
      if (r.result === "na" && !r.na_reason?.trim()) e.push("ระบุเหตุผลที่ไม่เกี่ยวข้อง");
      if (r.result === "fail") {
        if (!r.note?.trim()) e.push("ระบุรายละเอียดข้อบกพร่อง");
        if (!r.urgency) e.push("เลือกระดับความเร่งด่วน");
        if (it.photo_required_on_fail && !(photos[it.id]?.length) && !r.photo_exempt_reason?.trim()) e.push("แนบภาพ หรือระบุเหตุผลที่ถ่ายภาพไม่ได้");
      }
      if (e.length) errs[it.id] = e;
    });
    return errs;
  }, [items, resp, photos]);

  // ล้างข้อความ "กรอกไม่ครบ" เมื่อผู้ใช้กรอกครบแล้ว
  const errorCount = Object.keys(clientErrors).length;
  useEffect(() => {
    if (errorCount === 0) setStatus((st) => (st?.tone === "error" && st.text.startsWith("ยังกรอกข้อมูลไม่ครบ") ? null : st));
  }, [errorCount]);

  const answered = list.filter((r) => r.result).length;
  const counts = { pass: list.filter((r) => r.result === "pass").length, fail: list.filter((r) => r.result === "fail").length, na: list.filter((r) => r.result === "na").length };
  const score = counts.pass + counts.fail > 0 ? Math.round((counts.pass / (counts.pass + counts.fail)) * 1000) / 10 : null;

  async function submit() {
    if (submitLock.current) return;            // กันกดซ้ำ
    if (Object.keys(clientErrors).length) {
      setStatus({ tone: "error", text: `ยังกรอกข้อมูลไม่ครบ ${Object.keys(clientErrors).length} ข้อ` });
      document.getElementById(`item-${Object.keys(clientErrors)[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!navigator.onLine) { setStatus({ tone: "warning", text: "ไม่มีเครือข่าย — ยังไม่ได้ส่งผลตรวจ ข้อมูลถูกเก็บเป็นฉบับร่างในเครื่องนี้ กรุณาส่งอีกครั้งเมื่อเชื่อมต่อแล้ว" }); return; }
    submitLock.current = true; setSubmitting(true);
    setStatus({ tone: "info", text: "กำลังส่งผลตรวจ… กรุณารอการยืนยันจากระบบ" });
    try {
      const r = await callAction<{ findings: { id: string }[] }>("submitInspection", [inspectionId, payload(), summary, clientSubmissionId]);
      if (r.code === "NETWORK") throw new Error("network");
      if (r.ok) {
        localStorage.removeItem(localKey(inspectionId));
        localStorage.removeItem(`nu-insp-submit:${inspectionId}`);
        const n = r.data?.findings?.length ?? 0;
        window.location.replace(`/inspections/${inspectionId}?submitted=1${n ? `&findings=${n}` : ""}`);
        return;
      }
      if (r.details) {
        const m: Record<string, string[]> = {};
        r.details.forEach((d) => { if (d.item_id) (m[d.item_id] ??= []).push(d.message); });
        setServerErrors(m);
      }
      setStatus({ tone: "error", text: `ส่งไม่สำเร็จ: ${r.message}` });
    } catch {
      setStatus({ tone: "warning", text: "ไม่ทราบผลการส่งเนื่องจากเครือข่ายขัดข้อง — กด “ส่งผลตรวจ” อีกครั้งได้อย่างปลอดภัย ระบบจะไม่บันทึกซ้ำ" });
    }
    submitLock.current = false; setSubmitting(false);
  }

  return (
    <div className="mx-auto max-w-3xl pb-32">
      {localRestored && <div className="mb-3"><Notice tone="info">กู้คืนข้อมูลที่กรอกค้างไว้ในเครื่องนี้แล้ว — ข้อมูลยังไม่ถูกส่ง</Notice></div>}
      <ol className="space-y-3">
        {items.map((it) => {
          const r = resp[it.id];
          const errs = serverErrors[it.id] ?? [];
          return (
            <li key={it.id} id={`item-${it.id}`} className={clsx("rounded-xl border bg-white p-4 shadow-sm", errs.length ? "border-red-400" : "border-gray-200")}>
              <div className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-700">{it.seq}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{it.title}</p>
                  {it.description && <p className="text-sm text-gray-600">{it.description}</p>}
                  {it.method && <p className="mt-0.5 text-xs text-gray-500">วิธีตรวจ: {it.method}</p>}
                  <p className="mt-0.5 text-xs text-gray-500">ความสำคัญ: {SEVERITY_LABELS[it.severity]}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label={`ผลตรวจข้อ ${it.seq}`}>
                {RESULT_BTN.filter((b) => b.v !== "na" || it.allow_na).map((b) => {
                  const Icon = b.icon; const on = r.result === b.v;
                  return (
                    <button key={b.v} type="button" role="radio" aria-checked={on}
                      onClick={() => update(it.id, { result: b.v, urgency: b.v === "fail" ? (r.urgency ?? it.severity) : r.urgency })}
                      className={clsx("flex min-h-[52px] items-center justify-center gap-1 rounded-lg px-1 text-sm font-semibold leading-tight ring-1 ring-inset transition sm:gap-1.5 sm:text-base", on ? b.on : "bg-white text-gray-700 ring-gray-300 hover:bg-gray-50")}>
                      <Icon className="h-5 w-5 shrink-0" aria-hidden /><span>{b.label}</span>
                    </button>
                  );
                })}
              </div>
              {r.result === "na" && (
                <label className="mt-3 block text-sm">เหตุผลที่ไม่เกี่ยวข้อง <span className="text-red-600">*</span>
                  <input className={inputClass + " mt-1"} value={r.na_reason ?? ""} onChange={(e) => update(it.id, { na_reason: e.target.value })} placeholder="เช่น ถังชนิดนี้ไม่มีเกจวัด" />
                  <span className="text-xs text-gray-500">ข้อ “ไม่เกี่ยวข้อง” ไม่นับรวมในการคำนวณคะแนน</span>
                </label>
              )}
              {r.result === "fail" && (
                <div className="mt-3 space-y-3 rounded-lg bg-red-50/60 p-3">
                  <label className="block text-sm">รายละเอียดข้อบกพร่อง <span className="text-red-600">*</span>
                    <textarea rows={2} className={inputClass + " mt-1"} value={r.note ?? ""} onChange={(e) => update(it.id, { note: e.target.value })} placeholder="สิ่งที่พบ ตำแหน่ง และความเสี่ยง" />
                  </label>
                  <div className="text-sm">ระดับความเร่งด่วน <span className="text-red-600">*</span>
                    <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {(["low", "medium", "high", "critical"] as Severity[]).map((sv) => (
                        <button key={sv} type="button" aria-pressed={r.urgency === sv} onClick={() => update(it.id, { urgency: sv })}
                          className={clsx("min-h-[44px] rounded-lg px-2 text-sm font-medium ring-1 ring-inset",
                            r.urgency === sv ? (sv === "critical" || sv === "high" ? "bg-red-700 text-white ring-red-700" : "bg-amber-500 text-white ring-amber-500") : "bg-white ring-gray-300")}>
                          {SEVERITY_LABELS[sv]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="text-sm">
                    <p className="mb-1">ภาพหลักฐาน {it.photo_required_on_fail && <span className="text-red-600">*</span>}</p>
                    <PhotoUploader entityType="inspection" entityId={inspectionId} itemId={it.id} kind="evidence"
                      photos={photos[it.id] ?? []} onChange={(p) => setPhotos((cur) => ({ ...cur, [it.id]: p }))} />
                    {!(photos[it.id]?.length) && (
                      <label className="mt-2 block text-xs text-gray-700">ถ่ายภาพไม่ได้? ระบุเหตุผล (เช่น ไม่ปลอดภัย / พื้นที่ห้ามถ่ายภาพ)
                        <input className={inputClass + " mt-1"} value={r.photo_exempt_reason ?? ""} onChange={(e) => update(it.id, { photo_exempt_reason: e.target.value })} />
                      </label>
                    )}
                  </div>
                </div>
              )}
              {(r.result === "pass") && (
                <details className="mt-2 text-sm text-gray-600"><summary className="cursor-pointer">เพิ่มหมายเหตุ</summary>
                  <input className={inputClass + " mt-1"} value={r.note ?? ""} onChange={(e) => update(it.id, { note: e.target.value })} />
                </details>
              )}
              {errs.length > 0 && <ul role="alert" className="mt-2 list-disc pl-5 text-sm text-red-700">{errs.map((e, i) => <li key={i}>{e}</li>)}</ul>}
            </li>
          );
        })}
      </ol>

      <label className="mt-4 block rounded-xl border border-gray-200 bg-white p-4 text-sm shadow-sm">สรุป/หมายเหตุการตรวจ (ไม่บังคับ)
        <textarea rows={2} className={inputClass + " mt-1"} value={summary} onChange={(e) => { setSummary(e.target.value); setDirty(true); }} />
      </label>

      {/* แถบส่งผลด้านล่าง (ติดจอบนมือถือ) */}
      <div className="fixed inset-x-0 bottom-[60px] z-20 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:left-64">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {status && <Notice tone={status.tone}>{status.text}</Notice>}
          <div className="flex items-center justify-between gap-2 text-xs text-gray-600">
            <span>ตอบแล้ว {answered}/{items.length} · ผ่าน {counts.pass} · ไม่ผ่าน {counts.fail} · ไม่เกี่ยวข้อง {counts.na} · คะแนน {score === null ? "—" : `${score}%`}</span>
            <span className="flex items-center gap-1">
              {!online ? <><CloudOff className="h-3.5 w-3.5 text-red-600" aria-hidden />ออฟไลน์</> :
                saving ? "กำลังบันทึกร่าง…" : savedAt && !dirty ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />ร่างบันทึก {formatDateTime(savedAt)}</> :
                dirty ? <><AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />มีการแก้ไขที่ยังไม่บันทึกเข้าระบบ</> : null}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => saveDraft(false)} disabled={saving || submitting} className={buttonClass("secondary", "lg")}><Save className="h-5 w-5" /><span className="hidden sm:inline">บันทึกร่าง</span></button>
            <button type="button" onClick={submit} disabled={submitting} className={buttonClass("primary", "lg") + " col-span-2"}>
              <Send className="h-5 w-5" />{submitting ? "กำลังส่ง…" : "ส่งผลตรวจ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
