export type AppRole =
  | "system_admin" | "safety_coordinator" | "org_admin" | "inspector"
  | "responsible" | "verifier" | "executive";
export type ItemResult = "pass" | "fail" | "na";
export type Severity = "low" | "medium" | "high" | "critical";
export type FindingStatus = "open" | "assigned" | "in_progress" | "pending_verification" | "closed";
export type TaskDisplayStatus = "upcoming" | "pending" | "done" | "overdue" | "cancelled";
export type Frequency = "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "custom";
export type AssetStatus = "active" | "inactive" | "relocated" | "disposed";

export interface RoleAssignment { role: AppRole; organization_id: string; organization_name: string; is_root: boolean }
export interface Profile {
  id: string; email: string | null; full_name: string; phone: string | null; position: string | null;
  organization_id: string | null; is_active: boolean;
}
export interface SessionContext { profile: Profile | null; roles: RoleAssignment[]; unread_notifications: number }

export interface Organization { id: string; parent_id: string | null; code: string; name_th: string; name_en: string | null; org_type: string; ancestors: string[]; is_active: boolean }
export interface Building { id: string; organization_id: string; code: string; name: string; description: string | null; is_active: boolean }
export interface Floor { id: string; building_id: string; name: string; level: number }
export interface Location { id: string; floor_id: string; name: string; room_no: string | null; location_type: string | null }
export interface AssetType { id: string; code: string; name: string; category: string; default_template_id: string | null; default_frequency: Frequency; tracks_expiry: boolean }

export interface AssetRow {
  id: string; code: string; name: string; asset_type_id: string; organization_id: string; building_id: string;
  floor_id: string | null; location_id: string | null; location_detail: string | null; responsible_user_id: string | null;
  brand_model: string | null; serial_no: string | null; installed_on: string | null; expires_on: string | null;
  frequency: Frequency; custom_interval_days: number | null; last_inspected_at: string | null; next_due_on: string | null;
  status: AssetStatus; qr_token: string; photo_path: string | null; notes: string | null;
  asset_type_name: string; category: string; tracks_expiry: boolean; building_name: string; floor_name: string | null;
  location_name: string | null; organization_name: string; responsible_name: string | null; open_findings: number;
}

export interface TaskRow {
  id: string; plan_id: string | null; asset_id: string; organization_id: string; template_id: string; assignee_id: string | null;
  period_start: string; due_on: string; status: string; completed_inspection_id: string | null; completed_at: string | null;
  asset_code: string; asset_name: string; building_id: string; location_detail: string | null; category: string;
  asset_type_name: string; building_name: string; organization_name: string; assignee_name: string | null; template_name: string;
  overall_result: string | null; fail_count: number | null; score_pct: number | null;
  display_status: TaskDisplayStatus; completed_late: boolean;
}

export interface FindingRow {
  id: string; finding_no: string; inspection_id: string; response_id: string; checklist_item_id: string; asset_id: string;
  organization_id: string; title: string; description: string; severity: Severity; initial_measure: string | null;
  status: FindingStatus; assignee_id: string | null; responsible_org_id: string | null; due_on: string | null;
  assigned_at: string | null; progress_pct: number; fix_submitted_by: string | null; fix_submitted_at: string | null;
  verified_by: string | null; verified_at: string | null; closed_at: string | null; rework_count: number;
  recurrence_of: string | null; recurrence_count: number; created_at: string;
  asset_code: string; asset_name: string; building_id: string; location_detail: string | null; category: string;
  asset_type_name: string; building_name: string; organization_name: string; assignee_name: string | null;
  responsible_org_name: string | null; remediation_group: string; is_overdue: boolean; is_urgent_open: boolean;
}

export interface ChecklistItem {
  id: string; version_id: string; seq: number; section: string | null; title: string; description: string | null;
  method: string | null; severity: Severity; allow_na: boolean; photo_required_on_fail: boolean;
}

export interface LegalReference { source: string; edition: string; checked_on: string; checked_by?: string }

export interface DashboardKpis {
  generated_at: string;
  period: { from: string; to: string };
  assets_active: number;
  tasks: { due: number; done: number; done_late: number; not_done: number; upcoming: number; pending: number; overdue: number; coverage_pct: number | null };
  results: { pass: number; fail: number; na: number; pass_rate_pct: number | null; inspections: number; inspections_with_findings: number };
  findings: { open: number; urgent_open: number; overdue: number; waiting: number; unassigned: number; in_progress: number; pending_verification: number; recurring_open: number; new_in_period: number };
  closure: { closed: number; closed_with_due: number; closed_on_time: number; on_time_pct: number | null };
}
