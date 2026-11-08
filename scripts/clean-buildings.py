#!/usr/bin/env python3
"""ตรวจและทำความสะอาดข้อมูลอาคารจาก Excel ต้นฉบับ (แผ่น "file CAD อาคาร")
ผลลัพธ์: data/nu-buildings.csv (ข้อมูลสะอาด) และ data/nu-buildings-changes.csv (บันทึกทุกการแก้ไข)
ใช้:  python3 scripts/clean-buildings.py [data/source/ข้อมูลอาคาร-มน-ต้นฉบับ.xlsx]"""
import csv, re, sys, warnings
from collections import Counter
from pathlib import Path
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data/source/ข้อมูลอาคาร-มน-ต้นฉบับ.xlsx"

# ชื่อหน่วยงานในไฟล์ → ชื่อมาตรฐานตามรายชื่อหน่วยงาน 43 หน่วยงาน (NU-Inspections-Users_3.csv)
ORG_FIX = {
    "คณะเกษตรศาสตร์": ("คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติและสิ่งแวดล้อม", "ใช้ชื่อเต็มตามรายชื่อหน่วยงาน"),
    "คณะแพทย์ศาสตร์": ("คณะแพทยศาสตร์", "สะกดผิด (แพทย์ศาสตร์ → แพทยศาสตร์)"),
    "คณะสถาปัตยกรรมศาสตร์ศิลปะและการออกแบบ": ("คณะสถาปัตยกรรมศาสตร์ ศิลปะและการออกแบบ", "เว้นวรรคให้ตรงรายชื่อหน่วยงาน"),
    "คณะบริหารธุรกิจเศรษฐศาสตร์และการสื่อสาร": ("คณะบริหารธุรกิจ เศรษฐศาสตร์และการสื่อสาร", "เว้นวรรคให้ตรงรายชื่อหน่วยงาน"),
    "ส่วนกลาง": ("กองอาคารสถานที่", "\"ส่วนกลาง\" ไม่ใช่หน่วยงาน — กำหนดให้กองอาคารสถานที่ดูแลชั่วคราว (ต้องยืนยัน)"),
}
# คำสะกดผิดในชื่ออาคาร
NAME_FIX = [
    ("ทัตแพทยศาสตร์", "ทันตแพทยศาสตร์"), ("ปฎิบัติการ", "ปฏิบัติการ"), ("อาคารรสถาน", "อาคารสถาน"),
    ("SQURE", "SQUARE"), ("อุตสาหรรม", "อุตสาหกรรม"), ("สถานีสูน้ำ", "สถานีสูบน้ำ"), ("ํา", "ำ"),
]
# รหัสอาคารซ้ำ (ลำดับในไฟล์ → รหัสใหม่)
CODE_FIX = {194: "WTP12", 203: "TSI01", 204: "TSI02"}
# จำนวนชั้นที่ทราบ (จาก Excel "อาคารในคณะสาธารณสุข") + ชื่อเรียกเดิม
KNOWN_FLOORS = {"PHP01": (4, "อาคารบริหาร คณะสาธารณสุขศาสตร์ (PH3 เดิม)"),
                "PHP02": (4, "อาคารสุขวิทยาสถิตย์ (PH2 เดิม — ต้องยืนยันว่าเป็นอาคารเดียวกัน)"),
                "PHP03": (4, "อาคารเรียนรวม คณะสาธารณสุขศาสตร์ (PH1 เดิม)")}
# ประเด็นที่ต้องให้หน่วยงานยืนยัน (ไม่แก้ข้อมูลอัตโนมัติ)
CONFIRM = {
    "NEW01": "หน่วยงานเดิมระบุ \"ส่วนกลาง\" — ระบบกำหนดให้กองอาคารสถานที่ชั่วคราว กรุณาระบุหน่วยงานเจ้าของจริง",
    "NIC": "อาคารวิทยาลัยนานาชาติ แต่หน่วยงานเจ้าของระบุคณะมนุษยศาสตร์ — ถูกต้องหรือควรเป็นวิทยาลัยนานาชาติ",
    "NUDS01": "อาคารโรงเรียนสาธิต แต่หน่วยงานเจ้าของระบุคณะศึกษาศาสตร์ — ระบบมีหน่วยงานโรงเรียนสาธิตแยกไว้แล้ว",
    "NUDS02": "อาคารโรงเรียนสาธิต แต่หน่วยงานเจ้าของระบุคณะศึกษาศาสตร์ — ระบบมีหน่วยงานโรงเรียนสาธิตแยกไว้แล้ว",
    "PHP02": "จับคู่กับ \"อาคารสุขวิทยาสถิตย์\" จากไฟล์ก่อนหน้า — กรุณายืนยัน",
}


def clean_text(s):
    s = re.sub(r"\s+", " ", str(s)).strip()
    s = re.sub(r"\(\s+", "(", s); s = re.sub(r"\s+\)", ")", s)
    return s


def main():
    warnings.simplefilter("ignore")
    ws = load_workbook(SRC, data_only=True).active
    rows = [r for r in ws.iter_rows(min_row=2, values_only=True) if r[0] is not None]
    out, log = [], []

    def note(seq, code, field, before, after, why):
        log.append({"ลำดับ": seq, "รหัสอาคาร": code, "ช่อง": field, "ค่าเดิม": before, "ค่าใหม่": after, "เหตุผล": why})

    for seq, code, zone, org, name, btype, no in rows:
        raw_code, code = code, clean_text(code).upper()
        if seq in CODE_FIX:
            note(seq, code, "รหัสอาคาร", raw_code, CODE_FIX[seq], "รหัสซ้ำกับอาคารอื่น — ตั้งรหัสใหม่ไม่ให้ซ้ำ")
            code = CODE_FIX[seq]
        n = clean_text(name)
        if n != name:
            note(seq, code, "ชื่ออาคาร", name, n, "ตัดช่องว่าง/ขึ้นบรรทัดเกิน")
        fixed = n
        for a, b in NAME_FIX:
            fixed = fixed.replace(a, b)
        if fixed != n:
            note(seq, code, "ชื่ออาคาร", n, fixed, "แก้คำสะกดผิด")
        o = clean_text(org)
        if o in ORG_FIX:
            note(seq, code, "หน่วยงาน", o, ORG_FIX[o][0], ORG_FIX[o][1]); o = ORG_FIX[o][0]
        floors, alias = KNOWN_FLOORS.get(code, ("", ""))
        out.append({"ลำดับ": seq, "รหัสอาคาร": code, "เลขอาคาร": int(no), "ชื่ออาคาร": fixed, "หน่วยงาน": o,
                    "ประเภทอาคาร": clean_text(btype), "โซน (อ้างอิง)": clean_text(zone), "จำนวนชั้น": floors,
                    "ชื่อเรียกอื่น": alias, "ต้องยืนยัน": CONFIRM.get(code, "")})

    # ตรวจความสมบูรณ์หลังทำความสะอาด
    for k in ("รหัสอาคาร", "เลขอาคาร", "ชื่ออาคาร"):
        d = [v for v, c in Counter(r[k] for r in out).items() if c > 1]
        assert not d, f"ยังมี{k}ซ้ำ: {d}"
    assert all(re.fullmatch(r"[A-Z0-9]+", r["รหัสอาคาร"]) for r in out)
    data = ROOT / "data"; data.mkdir(exist_ok=True)
    with open(data / "nu-buildings.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0])); w.writeheader(); w.writerows(out)
    with open(data / "nu-buildings-changes.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(log[0])); w.writeheader(); w.writerows(log)
    print(f"อาคาร {len(out)} หลัง · แก้ไข {len(log)} จุด · ต้องยืนยัน {sum(1 for r in out if r['ต้องยืนยัน'])} อาคาร "
          f"· ยังไม่ระบุจำนวนชั้น {sum(1 for r in out if not r['จำนวนชั้น'])} อาคาร")


if __name__ == "__main__":
    main()
