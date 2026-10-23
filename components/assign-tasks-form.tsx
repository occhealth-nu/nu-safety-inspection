"use client";
import { buttonClass, inputClass } from "@/components/ui";
import { FormMessage, useActionForm } from "@/components/action-button";

export function AssignTasksForm({ children, inspectors }: { children: React.ReactNode; inspectors: { id: string; full_name: string }[] }) {
  const { state, pending, onSubmit } = useActionForm("assignTasks");
  return (
    <form onSubmit={onSubmit}>
      {inspectors.length > 0 && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-white p-3">
          <label className="text-xs text-gray-600">มอบหมายงานที่เลือกให้
            <select name="assignee_id" className={inputClass + " sm:w-64"} defaultValue="">
              <option value="">— ไม่ระบุผู้ตรวจ —</option>
              {inspectors.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </label>
          <button disabled={pending} className={buttonClass("primary")}>{pending ? "กำลังบันทึก…" : "มอบหมาย"}</button>
          <div className="w-full"><FormMessage state={state} /></div>
        </div>
      )}
      {children}
    </form>
  );
}
