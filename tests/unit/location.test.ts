import { describe, expect, it } from "vitest";
import { assetPinTone, buildingTone, clampPct, distanceM, formatDistance, isLatLng, mapsUrl, scopePath } from "@/lib/location";

describe("ตำแหน่งและหมุดบนผัง", () => {
  it("ระยะทาง haversine ตรงกับฐานข้อมูล (~40 ม.)", () => {
    const d = distanceM(16.7453, 100.1972, 16.745, 100.197);
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(50);
    expect(distanceM(16.7, 100.1, 16.7, 100.1)).toBe(0);
  });
  it("จัดรูปแบบระยะทาง", () => {
    expect(formatDistance(42.4)).toBe("42 ม.");
    expect(formatDistance(2500)).toBe("2.5 กม.");
    expect(formatDistance(null)).toBe("—");
  });
  it("หมุดอยู่ในช่วง 0–100%", () => {
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(150)).toBe(100);
    expect(clampPct(33.3333)).toBe(33.33);
    expect(clampPct(Number.NaN)).toBe(0);
  });
  it("ตรวจพิกัดและสร้างลิงก์แผนที่", () => {
    expect(isLatLng(16.7, 100.1)).toBe(true);
    expect(isLatLng(null, 100)).toBe(false);
    expect(isLatLng(91, 100)).toBe(false);
    expect(mapsUrl(16.7453, 100.1974)).toBe("https://www.google.com/maps/search/?api=1&query=16.745300,100.197400");
    expect(mapsUrl(null, null)).toBeNull();
  });
  it("สีหมุดสื่อสถานะ (เร่งด่วน > ค้าง > ปกติ)", () => {
    expect(assetPinTone({ status: "active", urgent_findings: 1, open_findings: 1 })).toBe("danger");
    expect(assetPinTone({ status: "active", overdue_tasks: 2 })).toBe("danger");
    expect(assetPinTone({ status: "active", open_findings: 1 })).toBe("warning");
    expect(assetPinTone({ status: "active" })).toBe("ok");
    expect(assetPinTone({ status: "disposed", urgent_findings: 3 })).toBe("muted");
    expect(buildingTone({ assets_active: 0, tasks_overdue: 0, findings_urgent: 0, findings_open: 0 })).toBe("muted");
    expect(buildingTone({ assets_active: 5, tasks_overdue: 1, findings_urgent: 0, findings_open: 0 })).toBe("danger");
  });
  it("เส้นทางพื้นที่จากใหญ่ไปเล็ก", () => {
    expect(scopePath(["อาคาร EN1", null, "ชั้น 2", "ทางเดินหลัก", ""])).toBe("อาคาร EN1 › ชั้น 2 › ทางเดินหลัก");
  });
});
