import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, todayBangkok, presetRange, endOfMonth, formatPct, bangkokDateOf } from "@/lib/format";
import { toActionError } from "@/lib/errors";

describe("วันที่และปี พ.ศ. (Asia/Bangkok)", () => {
  it("แสดงวันที่ตามปฏิทินเป็น พ.ศ.", () => {
    expect(formatDate("2026-10-23")).toBe("23 ต.ค. 2569");
    expect(formatDate("2026-01-01", { full: true })).toBe("1 มกราคม 2569");
    expect(formatDate(null)).toBe("—");
  });
  it("แปลง timestamptz (UTC) เป็นเวลาประเทศไทย", () => {
    // 2026-10-23 18:30 UTC = 24 ต.ค. 2569 01:30 น. ตามเวลาไทย
    expect(formatDateTime("2026-10-23T18:30:00Z")).toBe("24 ต.ค. 2569 01:30 น.");
    expect(bangkokDateOf("2026-12-31T17:00:00Z")).toBe("2027-01-01");
  });
  it("วันนี้ตามเวลาไทย ไม่ใช่ UTC", () => {
    expect(todayBangkok(new Date("2026-10-23T20:00:00Z"))).toBe("2026-10-24");
  });
  it("ช่วงเวลาสำเร็จรูป รวมปีงบประมาณ ต.ค.–ก.ย.", () => {
    expect(presetRange("fiscal_year", "2026-10-23")).toEqual({ from: "2026-10-01", to: "2027-09-30" });
    expect(presetRange("fiscal_year", "2026-03-01")).toEqual({ from: "2025-10-01", to: "2026-09-30" });
    expect(presetRange("this_quarter", "2026-05-15")).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(presetRange("last_month", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
  });
  it("ร้อยละ", () => {
    expect(formatPct(null)).toBe("—");
    expect(formatPct(86.12)).toBe("86.1%");
  });
});

describe("แปลงข้อผิดพลาดจากฐานข้อมูล", () => {
  it("ใช้ข้อความไทยและรหัสจาก hint ของ RPC", () => {
    const r = toActionError({ message: "ผลตรวจนี้ถูกส่งแล้ว", hint: "ALREADY_SUBMITTED", code: "P0001" });
    expect(r).toMatchObject({ ok: false, code: "ALREADY_SUBMITTED", message: "ผลตรวจนี้ถูกส่งแล้ว" });
  });
  it("อ่านรายละเอียดรายข้อจาก details", () => {
    const r = toActionError({ message: "ข้อมูลยังไม่ครบ 1 รายการ", hint: "VALIDATION_FAILED", details: '[{"seq":2,"message":"ต้องระบุเหตุผลที่ไม่เกี่ยวข้อง"}]' });
    expect(r.details?.[0]).toEqual({ seq: 2, message: "ต้องระบุเหตุผลที่ไม่เกี่ยวข้อง" });
  });
  it("ไม่เปิดเผยข้อความภายในของ PostgreSQL", () => {
    const r = toActionError({ message: 'new row violates row-level security policy for table "assets"', code: "42501" });
    expect(r.message).toBe("ไม่มีสิทธิ์ดำเนินการนี้");
  });
});
