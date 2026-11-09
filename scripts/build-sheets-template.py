#!/usr/bin/env python3
"""สร้างแม่แบบ Google Sheet สำหรับ Apps Script (หัวคอลัมน์แถวที่ 1 ทุกแท็บ — ห้ามเปลี่ยนชื่อหัวคอลัมน์)
ผลลัพธ์: apps-script/NU-Safety-Sheets-Template.xlsx  (อัปโหลดขึ้น Google Drive แล้วเปิดด้วย Google Sheets)
ใช้:  python3 scripts/build-sheets-template.py"""
import importlib.util
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("imp", ROOT / "scripts/build-import-data.py")
imp = importlib.util.module_from_spec(spec); spec.loader.exec_module(imp)

ASSET_TYPES = [("FE", "ถังดับเพลิง"), ("FH", "ตู้สายฉีดน้ำดับเพลิง"), ("EL", "ไฟฉุกเฉิน/ป้ายทางออก"), ("EX", "ทางหนีไฟ/ประตูหนีไฟ"),
               ("FA", "ระบบแจ้งเหตุเพลิงไหม้"), ("EE", "ตู้ไฟ/เต้ารับ/ปลั๊กพ่วง"), ("SP", "พื้นที่ Safety Patrol"),
               ("LAB", "ห้องปฏิบัติการ/ที่เก็บสารเคมี")]
FREQ = ["รายวัน", "รายสัปดาห์", "รายเดือน", "รายไตรมาส", "รายปี"]
FREQ_TH = {"daily": "รายวัน", "weekly": "รายสัปดาห์", "monthly": "รายเดือน", "quarterly": "รายไตรมาส", "yearly": "รายปี"}
STATUS, SENT = "สถานะการส่ง", "ส่งเมื่อ"

FONT = "Arial"
HEAD = PatternFill("solid", fgColor="F26F21"); OUT = PatternFill("solid", fgColor="EEF1F4"); HINT = PatternFill("solid", fgColor="FDE2E1")
thin = Side(style="thin", color="C9CED4"); BOX = Border(left=thin, right=thin, top=thin, bottom=thin)


def sheet(wb, name, cols, widths, rows, out_cols=(STATUS, SENT)):
    ws = wb.create_sheet(name)
    headers = cols + list(out_cols)
    for i, (h, w) in enumerate(zip(headers, widths + [52, 16]), 1):
        c = ws.cell(1, i, h); c.font = Font(name=FONT, bold=True, color="FFFFFF")
        c.fill = HEAD if h not in out_cols else PatternFill("solid", fgColor="2F3337"); c.border = BOX
        c.alignment = Alignment(vertical="center", wrap_text=True)
        ws.column_dimensions[c.column_letter].width = w
    ws.row_dimensions[1].height = 30
    for r, row in enumerate(rows, 2):
        for i, v in enumerate(row, 1):
            ws.cell(r, i, v).font = Font(name=FONT)
        for j in range(len(cols) + 1, len(headers) + 1):
            ws.cell(r, j).fill = OUT
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{ws.cell(1, len(headers)).column_letter}{max(2, len(rows) + 1)}"
    return ws


def dv_list(ws, col_letter, formula, n=2000):
    d = DataValidation(type="list", formula1=formula, allow_blank=True, showErrorMessage=False)
    ws.add_data_validation(d); d.add(f"{col_letter}2:{col_letter}{n}")


def main():
    wb = Workbook()
    guide = wb.active; guide.title = "คำแนะนำ"
    guide.column_dimensions["A"].width = 120
    lines = [
        ("NU Safety Inspection — จัดการข้อมูลผ่าน Google Sheets", True),
        ("", False),
        ("ติดตั้งครั้งแรก (ดูรายละเอียดในคู่มือ APPS_SCRIPT_GUIDE_TH.pdf)", True),
        ("1) อัปโหลดไฟล์นี้ขึ้น Google Drive → คลิกขวา → Open with → Google Sheets → File → Save as Google Sheets", False),
        ("2) Extensions → Apps Script → ลบโค้ดเดิม → วางโค้ดจากไฟล์ Code.gs → กด Save (ไอคอนแผ่นดิสก์) → ปิดแท็บ Apps Script → รีเฟรชชีต", False),
        ("3) เมนู NU Safety → ตั้งค่าการเชื่อมต่อ (Project URL, Publishable key, รหัสนำเข้า nuimp_…) → อนุญาตสิทธิ์ครั้งแรก", False),
        ("4) เมนู NU Safety → ส่งทุกแท็บ → ดูผลในคอลัมน์ “สถานะการส่ง” (✅ สำเร็จ / ❌ พร้อมเหตุผล)", False),
        ("", False),
        ("การใช้งานประจำวัน", True),
        ("• แก้หรือเพิ่มแถว → คอลัมน์สถานะจะขึ้น ✏️ รอส่ง → เมนู NU Safety → ส่งแท็บนี้ (เฉพาะแถวใหม่/ที่แก้ไข)", False),
        ("• ห้ามเปลี่ยนชื่อแท็บและหัวคอลัมน์แถวที่ 1 · คอลัมน์สีเทา (สถานะการส่ง, ส่งเมื่อ) ระบบเขียนให้", False),
        ("• ลำดับการส่ง: หน่วยงาน → อาคารและชั้น → ห้องและพื้นที่ → จุดตรวจ → แผนการตรวจ → ผู้ใช้งาน (เมนู “ส่งทุกแท็บ” ทำตามลำดับให้)", False),
        ("• ลบข้อมูลจากชีตไม่ได้ (ป้องกันลบผิด) — ปิดใช้งานอาคาร/จุดตรวจ/ผู้ใช้ได้ในเว็บ", False),
        ("• ดึงรายงาน: เมนู NU Safety → ดึงรายงาน → ได้แท็บ รายงาน-… (เขียนทับทุกครั้ง) · ตั้งดึงอัตโนมัติทุกเช้าได้", False),
        ("", False),
        ("ความปลอดภัย", True),
        ("• แชร์ชีตนี้เฉพาะผู้ดูแลระบบ · ห้ามใส่ Secret key ของ Supabase · รหัสนำเข้ายกเลิกได้ด้วย select app.revoke_import_keys();", False),
    ]
    for i, (t, b) in enumerate(lines, 1):
        guide.cell(i, 1, t).font = Font(name=FONT, bold=b, size=14 if i == 1 else 11, color="F26F21" if i == 1 else "1F2933")

    name_of = {c: n for c, n, _ in imp.ORGS}
    org_rows = [(c, n, imp.ORG_TYPE_TH[t]) for c, n, t in imp.ORGS]
    o = sheet(wb, "หน่วยงาน", ["รหัส", "ชื่อหน่วยงาน", "ประเภท (ระบบ)"], [10, 54, 24], org_rows)
    dv_list(o, "C", '"คณะ/วิทยาลัย,กอง/สำนักงาน,ศูนย์/สถาบัน/สำนัก,หน่วยงานย่อย/โรงเรียน"')

    b_rows = [(b["หน่วยงาน"], b["รหัสอาคาร"], b["ชื่ออาคาร"], int(b["เลขอาคาร"]), b["ประเภทอาคาร"],
               int(b["จำนวนชั้น"]) if b["จำนวนชั้น"] else None, b["ต้องยืนยัน"] or None) for b in imp.BUILDINGS]
    bs = sheet(wb, "อาคารและชั้น", ["หน่วยงานเจ้าของ", "รหัสอาคาร", "ชื่ออาคาร", "เลขอาคาร", "ประเภทอาคาร", "จำนวนชั้น", "ต้องยืนยัน (ไม่ส่ง)"],
               [40, 11, 52, 9, 24, 10, 44], b_rows)
    for r, b in enumerate(imp.BUILDINGS, 2):
        if b["ต้องยืนยัน"]: bs.cell(r, 7).fill = HINT
    dv_list(bs, "A", "='รายการเลือก'!$A$2:$A$45")
    dv_list(bs, "E", '"' + ",".join(sorted({b["ประเภทอาคาร"] for b in imp.BUILDINGS})) + '"')

    loc_th = {k: v for k, v in imp.LOC_TYPES}
    l_rows = []
    for b in imp.STARTER_BUILDINGS:
        for lv in range(1, imp.floors_of(b) + 1):
            for room, kind in imp.STARTER_ROOMS:
                l_rows.append((b["รหัสอาคาร"], f"ชั้น {lv}", room, None, loc_th[kind]))
    ls = sheet(wb, "ห้องและพื้นที่", ["รหัสอาคาร", "ชั้น", "ชื่อห้อง/พื้นที่", "เลขห้อง", "ประเภทพื้นที่"], [11, 10, 34, 10, 18], l_rows)
    dv_list(ls, "E", '"ทั่วไป,พื้นที่ส่วนกลาง,ห้องปฏิบัติการ,ห้องไฟฟ้า,ห้องเก็บของ"')

    a_rows = [(c, n, t, bcode, f, room, None, imp.STARTER_NOTE) for c, n, t, bcode, _, f, room in imp.starter_assets()]
    as_ = sheet(wb, "จุดตรวจ", ["รหัสจุดตรวจ", "ชื่อจุดตรวจ", "ประเภทจุดตรวจ", "รหัสอาคาร", "ชั้น", "ห้อง/พื้นที่", "รายละเอียดตำแหน่ง", "หมายเหตุ"],
                [16, 34, 12, 11, 9, 26, 28, 40], a_rows)
    dv_list(as_, "C", '"' + ",".join(c for c, _ in ASSET_TYPES) + '"')

    org_ph = name_of[imp.STARTER_ORG]
    p_rows = [(f"{n} — {org_ph}", org_ph, t, FREQ_TH[fq], d) for n, t, fq, d in imp.STARTER_PLANS]
    ps = sheet(wb, "แผนการตรวจ", ["ชื่อแผน", "หน่วยงาน", "ประเภทจุดตรวจ", "ความถี่", "ต้องเสร็จภายใน (วัน)"], [52, 30, 12, 12, 12], p_rows)
    dv_list(ps, "C", '"' + ",".join(c for c, _ in ASSET_TYPES) + '"'); dv_list(ps, "D", '"' + ",".join(FREQ) + '"')
    dv_list(ps, "B", "='รายการเลือก'!$A$2:$A$45")

    role_th = {c: th for c, th, _ in imp.ROLES}
    slots = imp.USER_SLOTS + [(n, "", "org_admin", "ผู้ดูแลของหน่วยงาน") for c, n, _ in imp.ORGS if n not in {x[0] for x in imp.USER_SLOTS}]
    u_rows = [(None, None, None, fac, unit or None, role_th[role], duty) for fac, unit, role, duty in slots]
    us = sheet(wb, "ผู้ใช้งาน", ["อีเมล (@nu.ac.th)", "ชื่อ-นามสกุล", "ตำแหน่ง", "สังกัด (faculty)", "หน่วยงานที่ได้รับสิทธิ์ (unit)", "บทบาท", "หน้าที่ (คำแนะนำ)"],
               [30, 26, 24, 40, 40, 32, 44], u_rows)
    for r in range(2, len(u_rows) + 2):
        us.cell(r, 1).fill = PatternFill("solid", fgColor="FFF6CC")
    dv_list(us, "D", "='รายการเลือก'!$A$2:$A$45"); dv_list(us, "E", "='รายการเลือก'!$A$2:$A$45")
    dv_list(us, "F", "='รายการเลือก'!$C$2:$C$8")

    ref = wb.create_sheet("รายการเลือก")
    cols = [("หน่วยงาน", ["มหาวิทยาลัยนเรศวร"] + [n for _, n, _ in imp.ORGS]),
            ("รหัสหน่วยงาน", ["NU"] + [c for c, _, _ in imp.ORGS]),
            ("บทบาท", [th for _, th, _ in imp.ROLES]),
            ("บทบาททำอะไรได้", [d for _, _, d in imp.ROLES]),
            ("ประเภทจุดตรวจ", [c for c, _ in ASSET_TYPES]),
            ("ชื่อประเภทจุดตรวจ", [n for _, n in ASSET_TYPES])]
    for ci, (h, vals) in enumerate(cols, 1):
        c = ref.cell(1, ci, h); c.font = Font(name=FONT, bold=True, color="FFFFFF"); c.fill = HEAD
        ref.column_dimensions[c.column_letter].width = 44 if ci in (1, 4) else 18
        for ri, v in enumerate(vals, 2): ref.cell(ri, ci, v).font = Font(name=FONT)

    out = ROOT / "apps-script/NU-Safety-Sheets-Template.xlsx"
    wb.save(out)
    print(f"สร้าง {out.relative_to(ROOT)} — อาคาร {len(b_rows)} · ห้อง {len(l_rows)} · จุดตรวจ {len(a_rows)} · แผน {len(p_rows)} · ช่องผู้ใช้ {len(u_rows)}")


if __name__ == "__main__":
    main()
