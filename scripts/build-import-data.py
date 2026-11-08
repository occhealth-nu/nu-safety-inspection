#!/usr/bin/env python3
"""สร้าง deploy/06_import_nu_data.sql และ docs/import/แบบฟอร์มนำเข้าข้อมูล-NU-Safety.xlsx
จากข้อมูลหน่วยงาน (NU-Inspections-Users_3.csv) และอาคารคณะสาธารณสุขศาสตร์ (Excel ที่ผู้ใช้แนบ)
แก้ข้อมูลในลิสต์ด้านล่างแล้วรัน:  python3 scripts/build-import-data.py"""
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.comments import Comment

ROOT = Path(__file__).resolve().parent.parent

# (รหัส, ชื่อหน่วยงาน — ตรงตามไฟล์ CSV, ประเภท)
ORGS = [
    ("AGNRE", "คณะเกษตรศาสตร์ ทรัพยากรธรรมชาติและสิ่งแวดล้อม", "faculty"),
    ("PHAR", "คณะเภสัชศาสตร์", "faculty"),
    ("MED", "คณะแพทยศาสตร์", "faculty"),
    ("LDSC", "คณะโลจิสติกส์และดิจิทัลซัพพลายเชน", "faculty"),
    ("DENT", "คณะทันตแพทยศาสตร์", "faculty"),
    ("LAW", "คณะนิติศาสตร์", "faculty"),
    ("BEC", "คณะบริหารธุรกิจ เศรษฐศาสตร์และการสื่อสาร", "faculty"),
    ("NURS", "คณะพยาบาลศาสตร์", "faculty"),
    ("HUM", "คณะมนุษยศาสตร์", "faculty"),
    ("SC", "คณะวิทยาศาสตร์", "faculty"),
    ("MEDSCI", "คณะวิทยาศาสตร์การแพทย์", "faculty"),
    ("EN", "คณะวิศวกรรมศาสตร์", "faculty"),
    ("EDU", "คณะศึกษาศาสตร์", "faculty"),
    ("ARCH", "คณะสถาปัตยกรรมศาสตร์ ศิลปะและการออกแบบ", "faculty"),
    ("AHS", "คณะสหเวชศาสตร์", "faculty"),
    ("SOC", "คณะสังคมศาสตร์", "faculty"),
    ("PH", "คณะสาธารณสุขศาสตร์", "faculty"),
    ("GRAD", "บัณฑิตวิทยาลัย", "faculty"),
    ("CFR", "วิทยาลัยเพื่อการค้นคว้าระดับรากฐาน", "faculty"),
    ("NUIC", "วิทยาลัยนานาชาติ", "faculty"),
    ("SGT", "วิทยาลัยพลังงานทดแทนและสมาร์ตกริดเทคโนโลยี", "faculty"),
    ("PLAN", "กองแผนงาน", "office"),
    ("LEGAL", "กองกฎหมาย", "office"),
    ("GAD", "กองกลาง", "office"),
    ("IPTT", "กองการถ่ายทอดเทคโนโลยีและบริหารจัดการทรัพย์สินทางปัญญา", "office"),
    ("HRD", "กองการบริหารงานบุคคล", "office"),
    ("RDI", "กองการวิจัยและนวัตกรรม", "office"),
    ("STA", "กองกิจการนิสิต", "office"),
    ("FIN", "กองคลัง", "office"),
    ("ITC", "กองบริการเทคโนโลยีสารสนเทศและการสื่อสาร", "office"),
    ("ACS", "กองบริการการศึกษา", "office"),
    ("EQA", "กองพัฒนาคุณภาพการศึกษา", "office"),
    ("ILA", "กองพัฒนาภาษาและกิจการต่างประเทศ", "office"),
    ("ASV", "กองส่งเสริมการบริการวิชาการ", "office"),
    ("ACU", "กองส่งเสริมศิลปวัฒนธรรม", "office"),
    ("BLDG", "กองอาคารสถานที่", "office"),
    ("LAC", "สถานสัตว์ทดลองเพื่อการวิจัย", "center"),
    ("AUDIT", "สำนักงานตรวจสอบภายใน", "office"),
    ("PRES", "สำนักงานอธิการบดี", "office"),
    ("SCIPARK", "อุทยานวิทยาศาสตร์มหาวิทยาลัยนเรศวร", "center"),
    ("LIB", "สำนักหอสมุด", "center"),
    ("SSCH", "โรงเรียนมัธยมสาธิตมหาวิทยาลัยนเรศวร", "unit"),
    ("PSCH", "โรงเรียนอนุบาลและประถมสาธิตมหาวิทยาลัยนเรศวร", "unit"),
]
ORG_TYPE_TH = {"faculty": "คณะ/วิทยาลัย", "office": "กอง/สำนักงาน", "center": "ศูนย์/สถาบัน/สำนัก", "unit": "หน่วยงานย่อย/โรงเรียน"}

# อาคารทั้งหมดของมหาวิทยาลัย — ผ่านการตรวจ/ทำความสะอาดโดย scripts/clean-buildings.py
import csv as _csv
BUILDINGS = list(_csv.DictReader(open(ROOT / "data/nu-buildings.csv", encoding="utf-8-sig")))
DEFAULT_FLOORS = 1   # อาคารที่ยังไม่ระบุจำนวนชั้น: สร้าง "ชั้น 1" ไว้ก่อน แล้วเติมจำนวนชั้นจริงภายหลัง
CHANGES = list(_csv.DictReader(open(ROOT / "data/nu-buildings-changes.csv", encoding="utf-8-sig")))
# รหัสอาคารเดิม (ไฟล์ก่อนหน้า) → รหัสตามทะเบียนอาคารของมหาวิทยาลัย
RENAMES = [("PH1", "PHP03"), ("PH2", "PHP02"), ("PH3", "PHP01")]


def floors_of(b):
    return int(b["จำนวนชั้น"]) if b["จำนวนชั้น"] else DEFAULT_FLOORS


# ชุดเริ่มต้นพร้อมใช้ของคณะสาธารณสุขศาสตร์: พื้นที่มาตรฐานทุกชั้น + จุดตรวจพื้นฐานทุกชั้น + แผนการตรวจ
STARTER_ORG = "PH"
STARTER_BUILDINGS = [b for b in BUILDINGS if b["หน่วยงาน"] == "คณะสาธารณสุขศาสตร์"]
STARTER_ROOMS = [("โถงบันไดหนีไฟ", "common"), ("ทางเดินหลัก", "common"), ("ตู้ควบคุมไฟฟ้าประจำชั้น", "electrical")]
# (ประเภท, ชื่อ, ห้อง/พื้นที่)
STARTER_ASSETS = [
    ("FE", "ถังดับเพลิง", "ทางเดินหลัก"),
    ("EL", "ไฟฉุกเฉิน/ป้ายทางออก", "โถงบันไดหนีไฟ"),
    ("EX", "ทางหนีไฟ/ประตูหนีไฟ", "โถงบันไดหนีไฟ"),
    ("EE", "ตู้ไฟ/เต้ารับ/ปลั๊กพ่วง", "ตู้ควบคุมไฟฟ้าประจำชั้น"),
    ("SP", "พื้นที่ Safety Patrol", "ทางเดินหลัก"),
]
STARTER_NOTE = "ชุดเริ่มต้น — ยืนยันตำแหน่ง/จำนวนจริงที่หน้างาน"
# (ชื่อแผน, ประเภท, ความถี่, ต้องเสร็จภายใน (วัน))
STARTER_PLANS = [
    ("ตรวจถังดับเพลิงรายเดือน", "FE", "monthly", None),
    ("ตรวจไฟฉุกเฉินและป้ายทางออกรายเดือน", "EL", "monthly", None),
    ("ตรวจทางหนีไฟรายเดือน", "EX", "monthly", 14),
    ("ตรวจระบบไฟฟ้ารายไตรมาส", "EE", "quarterly", None),
    ("Safety Patrol รายเดือน", "SP", "monthly", None),
]
FREQ_TH = {"monthly": "รายเดือน", "quarterly": "รายไตรมาส"}

# ช่องผู้ใช้ที่เตรียมไว้ (เหลือกรอกอีเมล/ชื่อ): (หน่วยงาน faculty, unit, บทบาท, หน้าที่)
USER_SLOTS = [
    ("มหาวิทยาลัยนเรศวร", "", "system_admin", "ผู้ดูแลระบบหลัก (1–2 คน)"),
    ("กองอาคารสถานที่", "", "safety_coordinator", "ผู้ประสานงานความปลอดภัยส่วนกลาง ติดตามทุกคณะ"),
    ("กองอาคารสถานที่", "", "responsible", "ช่าง/ผู้แก้ไขงานซ่อมที่ส่งต่อมาส่วนกลาง"),
    ("คณะสาธารณสุขศาสตร์", "", "org_admin", "ผู้ดูแลอาคาร จุดตรวจ และผู้ใช้ของคณะ"),
    ("คณะสาธารณสุขศาสตร์", "", "inspector", "ผู้ตรวจประจำอาคาร PHP03 อาคารเรียนรวม"),
    ("คณะสาธารณสุขศาสตร์", "", "inspector", "ผู้ตรวจประจำอาคาร PHP02 อาคารปฏิบัติการ (สุขวิทยาสถิตย์)"),
    ("คณะสาธารณสุขศาสตร์", "", "inspector", "ผู้ตรวจประจำอาคาร PHP01 อาคารบริหาร"),
    ("คณะสาธารณสุขศาสตร์", "", "responsible", "ผู้รับผิดชอบแก้ไขข้อบกพร่องของคณะ"),
    ("คณะสาธารณสุขศาสตร์", "", "verifier", "ผู้ตรวจยืนยันผลการแก้ไข"),
    ("คณะสาธารณสุขศาสตร์", "", "executive", "ผู้บริหารคณะ (ดูแดชบอร์ด/รายงาน)"),
]

ROLES = [
    ("system_admin", "ผู้ดูแลระบบมหาวิทยาลัย", "ตั้งค่าทุกอย่าง เพิ่มหน่วยงาน/ผู้ใช้ทั้งมหาวิทยาลัย (ควรมีน้อยคน)"),
    ("safety_coordinator", "ผู้ประสานงานความปลอดภัยส่วนกลาง", "ดูและติดตามทุกหน่วยงาน วางแผนการตรวจ มอบหมายงาน"),
    ("org_admin", "ผู้ดูแลระดับคณะ/หน่วยงาน", "จัดการอาคาร จุดตรวจ ผู้ใช้ และแผนการตรวจในหน่วยงานของตน"),
    ("inspector", "ผู้ตรวจ", "สแกน QR ตรวจตามแบบตรวจ ถ่ายภาพ บันทึกข้อบกพร่อง"),
    ("responsible", "ผู้รับผิดชอบแก้ไข", "รับงานแก้ไขข้อบกพร่อง อัปโหลดหลักฐานการแก้ไข"),
    ("verifier", "ผู้ตรวจยืนยัน", "ตรวจยืนยันผลการแก้ไข แล้วปิดข้อบกพร่อง"),
    ("executive", "ผู้บริหาร/คณะกรรมการความปลอดภัย", "ดูแดชบอร์ดและรายงาน (อ่านอย่างเดียว)"),
]
LOC_TYPES = [("", "ทั่วไป"), ("common", "พื้นที่ส่วนกลาง"), ("laboratory", "ห้องปฏิบัติการ"),
             ("electrical", "ห้องไฟฟ้า"), ("storage", "ห้องเก็บของ")]


def q(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


# ------------------------------------------------------------------ SQL
def build_sql():
    mig = (ROOT / "supabase/migrations/20261108000009_bulk_import.sql").read_text()
    mig += "\n\n" + (ROOT / "supabase/migrations/20261109000011_building_details.sql").read_text()
    out = [
        "-- =====================================================================",
        f"-- NU Safety Inspection — นำเข้าหน่วยงาน {len(ORGS)} หน่วยงาน + อาคารทั้งมหาวิทยาลัย {len(BUILDINGS)} อาคาร",
        "--   (เลขอาคาร ประเภทอาคาร หน่วยงานเจ้าของ — ตรวจและแก้ข้อมูลแล้ว ดู data/nu-buildings-changes.csv)",
        "-- และติดตั้งเครื่องมือนำเข้าผู้ใช้/ห้อง จากแบบฟอร์ม Excel",
        "-- วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run  (รันหลังไฟล์ 01–02 และ 05)",
        "-- รันซ้ำได้: หน่วยงาน/อาคารที่มีอยู่แล้ว (รหัสหรือชื่อตรงกัน) จะไม่ถูกเพิ่มซ้ำ",
        "-- ไฟล์นี้สร้างอัตโนมัติจาก scripts/build-import-data.py — อย่าแก้ด้วยมือ",
        "-- =====================================================================",
        "",
        "-- ---------- ส่วนที่ 1: เครื่องมือนำเข้า (ตาราง user_preassignments + ฟังก์ชัน app.import_*) ----------",
        mig.strip(),
        "",
        "-- ---------- ส่วนที่ 2: หน่วยงาน (จากไฟล์ NU-Inspections-Users_3.csv) ----------",
        "select r as ผลการนำเข้าหน่วยงาน from (values",
    ]
    rows = [f"  (app.import_organization({q(c)}, {q(n)}, {q(t)}))" for c, n, t in ORGS]
    out.append(",\n".join(rows))
    out += [") v(r);", "",
            "-- ---------- ส่วนที่ 3: ปรับรหัสอาคารเดิมให้ตรงทะเบียนอาคาร (ถ้าเคยนำเข้า PH1–PH3) ----------",
            "select r as ผลการปรับรหัส from (values"]
    out.append(",\n".join(f"  (app.rename_building_code({q(a)}, {q(b)}))" for a, b in RENAMES))
    out += [") v(r);", "", f"-- ---------- ส่วนที่ 4: อาคาร {len(BUILDINGS)} อาคาร (จากทะเบียนอาคาร — file CAD อาคาร) ----------",
            "-- อาคารที่ไม่ทราบจำนวนชั้นสร้าง \"ชั้น 1\" ไว้ก่อน — เติมจำนวนชั้นจริงในแบบฟอร์ม Excel แล้วรันคำสั่งของแถวนั้นซ้ำ",
            "select r as ผลการนำเข้าอาคาร from (values"]
    out.append(",\n".join(
        f"  (app.import_building({q(b['หน่วยงาน'])}, {q(b['รหัสอาคาร'])}, {q(b['ชื่ออาคาร'])}, {floors_of(b)}, null, "
        f"{int(b['เลขอาคาร'])}, {q(b['ประเภทอาคาร'])}, {q(b['ชื่อเรียกอื่น'] and 'ชื่อเรียกอื่น: ' + b['ชื่อเรียกอื่น'] or None)}))"
        for b in BUILDINGS))
    out += [") v(r);", "",
            "-- ---------- ตรวจผล: จำนวนอาคารต่อหน่วยงาน (รวมต้องได้ " + str(len(BUILDINGS)) + " อาคาร) ----------",
            "select coalesce(o.name_th, 'รวมทั้งหมด') as หน่วยงานเจ้าของ, count(*) as จำนวนอาคาร",
            "  from public.buildings b join public.organizations o on o.id = b.organization_id",
            f" where b.code in ({', '.join(q(b['รหัสอาคาร']) for b in BUILDINGS)})",
            " group by rollup (o.name_th) order by o.name_th nulls last;", ""]
    (ROOT / "deploy/06_import_nu_data.sql").write_text("\n".join(out))


def starter_assets():
    for b in STARTER_BUILDINGS:
        bcode, bname, floors = b["รหัสอาคาร"], b["ชื่ออาคาร"], floors_of(b)
        for lv in range(1, floors + 1):
            for t, name, room in STARTER_ASSETS:
                yield (f"{t}-{bcode}-{lv}01", f"{name} {bcode} ชั้น {lv}", t, bcode, bname, f"ชั้น {lv}", room)


def build_sql_ready():
    mig = (ROOT / "supabase/migrations/20261108000010_ready_data_helpers.sql").read_text()
    org_name = {c: n for c, n, _ in ORGS}[STARTER_ORG]
    out = [
        "-- =====================================================================",
        f"-- NU Safety Inspection — ชุดข้อมูลพร้อมใช้: {org_name} (อาคาร {', '.join(b['รหัสอาคาร'] for b in STARTER_BUILDINGS)})",
        "--   • ห้อง/พื้นที่มาตรฐานทุกชั้น: " + ", ".join(r for r, _ in STARTER_ROOMS),
        f"--   • จุดตรวจพื้นฐานทุกชั้น {len(STARTER_ASSETS)} ประเภท รวม {len(list(starter_assets()))} จุด (พิมพ์ QR ได้ทันที)",
        f"--   • แผนการตรวจ {len(STARTER_PLANS)} แผน + งานตรวจตั้งแต่เดือนนี้ถึงสิ้นปี",
        "-- วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run  (รันหลังไฟล์ 06)",
        "-- รันซ้ำได้ ไม่เกิดข้อมูลซ้ำ | จุดตรวจเป็นชุดเริ่มต้น: เดินยืนยันที่หน้างานแล้วแก้ไข/เพิ่ม/ลบในเว็บ",
        "-- ไฟล์นี้สร้างอัตโนมัติจาก scripts/build-import-data.py — อย่าแก้ด้วยมือ",
        "-- =====================================================================",
        "",
        "-- ---------- ส่วนที่ 1: เครื่องมือ ----------",
        mig.strip(), "",
        "do $$ begin",
        "  if not exists (select 1 from public.buildings where code = 'PHP01') then",
        "    raise exception 'ยังไม่มีอาคาร PHP01 — กรุณารันไฟล์ 06_import_nu_data.sql (ฉบับอาคาร 204 หลัง) ก่อน';",
        "  end if;",
        "end $$;", "",
        "-- ---------- ส่วนที่ 2: ห้อง/พื้นที่มาตรฐาน ----------",
        "select r as ผลการนำเข้าห้อง from (values",
    ]
    rows = []
    for b in STARTER_BUILDINGS:
        bcode, floors = b["รหัสอาคาร"], floors_of(b)
        for lv in range(1, floors + 1):
            for room, kind in STARTER_ROOMS:
                rows.append(f"  (app.import_location({q(bcode)}, {q(f'ชั้น {lv}')}, {q(room)}, null, {q(kind)}))")
    out += [",\n".join(rows), ") v(r);", "", "-- ---------- ส่วนที่ 3: จุดตรวจ ----------",
            "select r as ผลการนำเข้าจุดตรวจ from (values"]
    out.append(",\n".join(f"  (app.import_asset({q(c)}, {q(n)}, {q(t)}, {q(b)}, {q(f)}, {q(room)}, null, {q(STARTER_NOTE)}))"
                          for c, n, t, b, _, f, room in starter_assets()))
    out += [") v(r);", "", "-- ---------- ส่วนที่ 4: แผนการตรวจ + งานตรวจ ----------",
            "select r as ผลการสร้างแผน from (values"]
    out.append(",\n".join(f"  (app.import_plan({q(n + ' — ' + org_name)}, {q(STARTER_ORG)}, {q(t)}, {q(fq)}, {d if d else 'null'}))"
                          for n, t, fq, d in STARTER_PLANS))
    out += [") v(r);", "", "-- ---------- ตรวจผล ----------",
            "select b.code as อาคาร, count(distinct l.id) as ห้องพื้นที่, count(distinct a.id) as จุดตรวจ,",
            "       count(distinct t.id) filter (where t.status = 'open') as งานตรวจที่รอ",
            "  from public.buildings b left join public.floors f on f.building_id = b.id",
            "  left join public.locations l on l.floor_id = f.id",
            "  left join public.assets a on a.building_id = b.id",
            "  left join public.inspection_tasks t on t.asset_id = a.id",
            f" where b.code in ({', '.join(q(b['รหัสอาคาร']) for b in STARTER_BUILDINGS)}) group by b.code order by b.code;", ""]
    (ROOT / "deploy/07_ready_public_health.sql").write_text("\n".join(out))


# ------------------------------------------------------------------ Excel
FONT = "Tahoma"
F = lambda **k: Font(name=FONT, size=k.pop("size", 10), **k)
HEAD = PatternFill("solid", fgColor="F26F21")
INPUT = PatternFill("solid", fgColor="FFF6CC")
CALC = PatternFill("solid", fgColor="EEF1F4")
EX = PatternFill("solid", fgColor="E8F4EA")
thin = Side(style="thin", color="C9CED4")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
WRAP = Alignment(wrap_text=True, vertical="top")


def header(ws, row, titles, widths):
    for i, (t, w) in enumerate(zip(titles, widths), 1):
        c = ws.cell(row, i, t)
        c.font = F(bold=True, color="FFFFFF"); c.fill = HEAD; c.alignment = Alignment(wrap_text=True, vertical="center"); c.border = BOX
        ws.column_dimensions[c.column_letter].width = w
    ws.row_dimensions[row].height = 32


def title(ws, text, sub):
    ws["A1"] = text; ws["A1"].font = F(bold=True, size=14, color="2F3337")
    ws["A2"] = sub; ws["A2"].font = F(size=9, color="5B6670")


def style_row(ws, r, ncols, fills):
    for col in range(1, ncols + 1):
        c = ws.cell(r, col); c.font = c.font if c.font and c.font.name == FONT else F(); c.border = BOX
        c.alignment = Alignment(vertical="top", wrap_text=col in fills.get("wrap", ()))
        for fill, cols in fills.items():
            if fill != "wrap" and col in cols: c.fill = fill


def build_xlsx():
    wb = Workbook()
    # ---- คำแนะนำ
    ws = wb.active; ws.title = "คำแนะนำ"
    ws.column_dimensions["A"].width = 4; ws.column_dimensions["B"].width = 110
    lines = [
        ("แบบฟอร์มนำเข้าข้อมูล — NU Safety Inspection", F(bold=True, size=16, color="F26F21")),
        ("ข้อมูลหน่วยงานจากไฟล์ NU-Inspections-Users_3.csv และอาคารจาก Excel อาคารในคณะสาธารณสุข", F(size=10, color="5B6670")),
        ("", None),
        ("สีของช่อง", F(bold=True, size=12)),
        ("■ สีเหลือง = ช่องที่ต้องกรอก/เลือก     ■ สีเทา = ระบบคำนวณให้ (ห้ามแก้)     ■ สีเขียว = แถวตัวอย่าง (ไม่ถูกนำเข้า)", F()),
        ("", None),
        ("ขั้นตอน (ทำครั้งแรกครั้งเดียว)", F(bold=True, size=12)),
        ("1. Supabase → SQL Editor → New query → วางไฟล์ deploy/06_import_nu_data.sql ทั้งไฟล์ → Run", F()),
        (f"     → ได้หน่วยงาน {len(ORGS)} หน่วยงาน + อาคารทั้งมหาวิทยาลัย {len(BUILDINGS)} อาคาร (เลขอาคาร ประเภท หน่วยงานเจ้าของ) + เครื่องมือนำเข้า", F(color="5B6670")),
        ("1.1 วางไฟล์ deploy/07_ready_public_health.sql ทั้งไฟล์ → Run", F()),
        ("     → คณะสาธารณสุขศาสตร์ (PHP01–PHP03): ห้อง/พื้นที่มาตรฐาน 36 แห่ง จุดตรวจ 60 จุด (พิมพ์ QR ได้ทันที) และแผนการตรวจ 5 แผนพร้อมงานตรวจถึงสิ้นปี", F(color="5B6670")),
        ("     → พิมพ์แท็บ “จุดตรวจเริ่มต้น” ไปเดินยืนยันที่หน้างาน แล้วแก้ไข/เพิ่ม/ลบในเว็บให้ตรงของจริง", F(color="5B6670")),
        ("", None),
        ("เพิ่มผู้ใช้งาน (แท็บ ผู้ใช้งาน)", F(bold=True, size=12)),
        ("2. แถวที่เตรียมไว้มีหน่วยงานและบทบาทแล้ว (ดูคอลัมน์ หน้าที่) — กรอกเพียงอีเมล @nu.ac.th ชื่อ และตำแหน่ง", F()),
        ("     แถวไหนยังไม่มีคน ปล่อยว่างไว้ได้ (ไม่ถูกนำเข้า) — เพิ่มคนอื่นต่อท้ายได้โดยเลือก faculty/unit/บทบาทเอง", F(color="5B6670")),
        ("2.1 กรอกอีเมล @nu.ac.th ชื่อ ตำแหน่ง แล้วเลือก faculty (สังกัด) unit (หน่วยงานที่ได้รับสิทธิ์ — เว้นว่าง = เท่ากับ faculty) และบทบาท", F()),
        ("     ผู้ใช้ 1 คนมีหลายบทบาทได้: กรอกหลายแถว อีเมลเดิม บทบาทต่างกัน", F(color="5B6670")),
        ("3. เลือกคอลัมน์ H (คำสั่ง SQL) เฉพาะแถวที่กรอก → คัดลอก → วางใน SQL Editor → Run", F()),
        ("4. ผู้ใช้กด “เข้าสู่ระบบด้วยบัญชี Google ของมหาวิทยาลัย” → ได้หน่วยงานและบทบาททันที ไม่ต้องรอผู้ดูแลอนุมัติ", F()),
        ("     ถ้าผู้ใช้เคยเข้าระบบแล้ว (อยู่ในรายการ “รอกำหนดสิทธิ์”) ระบบกำหนดสิทธิ์ให้ทันทีที่กด Run", F(color="5B6670")),
        ("", None),
        ("เพิ่มห้อง/พื้นที่ (แท็บ ห้องและพื้นที่)", F(bold=True, size=12)),
        ("5. เลือกรหัสอาคาร ชั้น แล้วกรอกชื่อห้อง/เลขห้อง/ประเภท → คัดลอกคอลัมน์ G → วางใน SQL Editor → Run", F()),
        ("", None),
        ("เติมจำนวนชั้น / แก้ข้อมูลอาคาร / เพิ่มอาคารใหม่ (แท็บ อาคารและชั้น)", F(bold=True, size=12)),
        ("6. เติมจำนวนชั้นจริงในคอลัมน์ F (ว่าง = ระบบสร้างชั้น 1 ไว้ก่อน) หรือกรอกอาคารใหม่ต่อท้าย → คัดลอกคอลัมน์ I ของแถวที่แก้ → วางใน SQL Editor → Run", F()),
        ("     รันซ้ำได้: ระบบเพิ่มชั้นที่ขาด และปรับชื่อ/หน่วยงาน/เลขอาคาร/ประเภทให้ตรงกับแถวนั้น · ดูผลตรวจข้อมูลที่แท็บ ผลตรวจข้อมูลอาคาร", F(color="5B6670")),
        ("     พิกัด GPS และผังชั้น: ตั้งในเว็บที่ ตั้งค่า › อาคารและพื้นที่ (ปุ่ม “ใช้ตำแหน่งปัจจุบัน” ขณะยืนที่อาคาร)", F(color="5B6670")),
        ("", None),
        ("ข้อควรรู้", F(bold=True, size=12)),
        ("• รันคำสั่งซ้ำได้ ไม่เกิดข้อมูลซ้ำ — ถ้ากรอกผิด ระบบแจ้งข้อความภาษาไทยว่าแถวใดผิด (เช่น ไม่พบหน่วยงาน, อีเมลไม่ใช่ @nu.ac.th)", F()),
        ("• รหัสหน่วยงานในแท็บ หน่วยงาน ตั้งขึ้นใหม่ (แก้ได้ในเว็บ ตั้งค่า › หน่วยงาน) — หน่วยงานทั้งหมดอยู่ใต้ มหาวิทยาลัยนเรศวร โดยตรง", F()),
        ("• ไม่ต้องใส่รหัสผ่าน และห้ามส่งไฟล์ที่มีรหัสผ่าน/คีย์ลับทางแชตหรืออีเมล", F()),
    ]
    for i, (t, f) in enumerate(lines, 1):
        c = ws.cell(i, 2, t)
        if f: c.font = f
    ws.sheet_view.showGridLines = False

    # ---- หน่วยงาน
    wo = wb.create_sheet("หน่วยงาน")
    title(wo, f"หน่วยงาน (มหาวิทยาลัย + {len(ORGS)})", "จากไฟล์ NU-Inspections-Users_3.csv — ใช้เป็นตัวเลือก faculty / unit ในแท็บอื่น")
    header(wo, 4, ["ลำดับ", "ชื่อหน่วยงาน", "รหัส", "ประเภท", "ประเภท (ระบบ)", "คำสั่ง SQL (สำหรับเพิ่มหน่วยงานใหม่)"], [7, 52, 11, 20, 14, 90])
    ORG_TYPE_TH["university"] = "มหาวิทยาลัย (หน่วยงานราก)"
    for i, (code, name, typ) in enumerate([("NU", "มหาวิทยาลัยนเรศวร", "university")] + ORGS, 1):
        r = 4 + i
        wo.cell(r, 1, i); wo.cell(r, 2, name); wo.cell(r, 3, code); wo.cell(r, 4, ORG_TYPE_TH[typ]); wo.cell(r, 5, typ)
        wo.cell(r, 6, f"=\"select app.import_organization('\"&SUBSTITUTE(C{r},\"'\",\"''\")&\"', '\"&SUBSTITUTE(B{r},\"'\",\"''\")&\"', '\"&E{r}&\"');\"")
        style_row(wo, r, 6, {CALC: (6,)})
    last_org = 5 + len(ORGS)
    wo.freeze_panes = "B5"
    org_range = f"'หน่วยงาน'!$B$5:$B${last_org}"

    # ---- บทบาท
    wr = wb.create_sheet("บทบาท")
    title(wr, "บทบาทในระบบ", "เลือกจากชื่อภาษาไทยในแท็บ ผู้ใช้งาน ระบบแปลงเป็นรหัสให้")
    header(wr, 4, ["ชื่อบทบาท", "รหัส (ระบบ)", "ทำอะไรได้"], [36, 22, 70])
    for i, (code, th, desc) in enumerate(ROLES):
        r = 5 + i
        wr.cell(r, 1, th); wr.cell(r, 2, code); wr.cell(r, 3, desc); style_row(wr, r, 3, {"wrap": (3,)})
    role_range = f"'บทบาท'!$A$5:$A${4 + len(ROLES)}"
    role_code = f"'บทบาท'!$B$5:$B${4 + len(ROLES)}"

    # ---- อาคารและชั้น
    wbld = wb.create_sheet("อาคารและชั้น", 2)
    title(wbld, f"อาคารและชั้น ({len(BUILDINGS)} อาคาร)",
          "จากทะเบียนอาคาร (file CAD อาคาร) ที่ตรวจแล้ว — ช่องจำนวนชั้นสีเหลืองว่าง = ยังไม่ทราบ (ระบบสร้างชั้น 1 ไว้ก่อน) · เพิ่มอาคารใหม่ต่อท้ายได้")
    header(wbld, 4, ["หน่วยงานเจ้าของ", "รหัสอาคาร", "ชื่ออาคาร", "เลขอาคาร", "ประเภทอาคาร", "จำนวนชั้น", "ชั้นที่สร้าง",
                     "ต้องยืนยัน", "คำสั่ง SQL"], [40, 11, 52, 9, 24, 10, 16, 46, 100])
    n_rows = len(BUILDINGS) + 50
    btypes = sorted({b["ประเภทอาคาร"] for b in BUILDINGS})
    for i in range(n_rows):
        r = 5 + i
        if i < len(BUILDINGS):
            b = BUILDINGS[i]
            for col, v in enumerate([b["หน่วยงาน"], b["รหัสอาคาร"], b["ชื่ออาคาร"], int(b["เลขอาคาร"]), b["ประเภทอาคาร"],
                                     int(b["จำนวนชั้น"]) if b["จำนวนชั้น"] else None], 1):
                wbld.cell(r, col, v)
            if b["ต้องยืนยัน"]:
                wbld.cell(r, 8, b["ต้องยืนยัน"])
        wbld.cell(r, 7, f'=IF(B{r}="","",IF(F{r}="","ชั้น 1 (ยังไม่ระบุ)",IF(F{r}=1,"ชั้น 1","ชั้น 1 – ชั้น "&F{r})))')
        wbld.cell(r, 9, f"=IF(OR(A{r}=\"\",B{r}=\"\",C{r}=\"\"),\"\",\"select app.import_building('\"&SUBSTITUTE(A{r},\"'\",\"''\")&\"', '\"&UPPER(B{r})&\"', '\"&SUBSTITUTE(C{r},\"'\",\"''\")&\"', \"&IF(F{r}=\"\",1,F{r})&\", null, \"&IF(D{r}=\"\",\"null\",D{r})&\", '\"&SUBSTITUTE(E{r},\"'\",\"''\")&\"');\")")
        style_row(wbld, r, 9, {INPUT: (1, 2, 3, 4, 5, 6), CALC: (7, 9), "wrap": (8,)})
        if i < len(BUILDINGS) and BUILDINGS[i]["ต้องยืนยัน"]:
            wbld.cell(r, 8).fill = PatternFill("solid", fgColor="FDE2E1")
    end_b = 4 + n_rows
    dv = DataValidation(type="list", formula1=org_range, allow_blank=True, showErrorMessage=True,
                        errorTitle="หน่วยงานไม่ถูกต้อง", error="เลือกจากรายการ (แท็บ หน่วยงาน)")
    wbld.add_data_validation(dv); dv.add(f"A5:A{end_b}")
    dvt = DataValidation(type="list", formula1='"' + ",".join(btypes) + '"', allow_blank=True)
    wbld.add_data_validation(dvt); dvt.add(f"E5:E{end_b}")
    dvn = DataValidation(type="whole", operator="between", formula1="1", formula2="60", allow_blank=True,
                         showErrorMessage=True, error="จำนวนชั้น 1–60")
    wbld.add_data_validation(dvn); dvn.add(f"F5:F{end_b}")
    wbld.auto_filter.ref = f"A4:H{4 + len(BUILDINGS)}"
    wbld.freeze_panes = "C5"

    # ---- ผลตรวจข้อมูลอาคาร
    wc = wb.create_sheet("ผลตรวจข้อมูลอาคาร", 3)
    title(wc, f"ผลตรวจความสมบูรณ์ข้อมูลอาคาร — แก้ไข {len(CHANGES)} จุด",
          "เปรียบเทียบไฟล์ต้นฉบับ (file CAD อาคาร) กับข้อมูลที่ใช้นำเข้า · แถวสีชมพูในแท็บ อาคารและชั้น = ต้องให้หน่วยงานยืนยัน")
    summary = [
        ("อาคารทั้งหมด", f"{len(BUILDINGS)} อาคาร · {len({b['หน่วยงาน'] for b in BUILDINGS})} หน่วยงานเจ้าของ"),
        ("ช่องว่างในไฟล์ต้นฉบับ", "ไม่มี (ลำดับ รหัส โซน หน่วยงาน ชื่อ ประเภท เลขอาคาร ครบทุกแถว)"),
        ("เลขอาคาร", "1–204 ครบ ไม่ซ้ำ"),
        ("รหัสอาคารซ้ำ", "WTP01 (2 อาคาร), TSI (2 อาคาร) → ตั้งรหัสใหม่ WTP12, TSI01, TSI02"),
        ("ชื่อหน่วยงานไม่ตรงรายชื่อ", "5 แบบ (23 แถว) → ปรับเป็นชื่อมาตรฐาน"),
        ("คำสะกดผิดในชื่ออาคาร", "20 อาคาร (ปฎิบัติการ, ทัตแพทย์, สูน้ำ, อุตสาหรรม, SQURE ฯลฯ)"),
        ("ช่องว่าง/ขึ้นบรรทัดเกินในชื่อ", "27 อาคาร"),
        ("ยังไม่มีในไฟล์", f"จำนวนชั้น ({sum(1 for b in BUILDINGS if not b['จำนวนชั้น'])} อาคาร), พิกัด GPS (ทุกอาคาร)"),
        ("โซน", "เก็บไว้อ้างอิงใน data/nu-buildings.csv — ไม่นำเข้า (ระบบยกเลิกโซนแล้ว)"),
    ]
    for i, (k, v) in enumerate(summary):
        wc.cell(4 + i, 1, k).font = F(bold=True); wc.cell(4 + i, 2, v).font = F()
    top = 5 + len(summary)
    header(wc, top, ["ลำดับในไฟล์", "รหัสอาคาร", "ช่อง", "ค่าเดิม", "ค่าใหม่", "เหตุผล"], [14, 12, 12, 60, 60, 52])
    wc.column_dimensions["A"].width = 26; wc.column_dimensions["B"].width = 70
    for i, c in enumerate(CHANGES):
        r = top + 1 + i
        for col, k in enumerate(["ลำดับ", "รหัสอาคาร", "ช่อง", "ค่าเดิม", "ค่าใหม่", "เหตุผล"], 1):
            wc.cell(r, col, int(c[k]) if k == "ลำดับ" else c[k])
        style_row(wc, r, 6, {"wrap": (4, 5, 6)})
    wc.freeze_panes = f"A{top + 1}"

    # ---- ห้องและพื้นที่
    wl = wb.create_sheet("ห้องและพื้นที่")
    title(wl, "ห้องและพื้นที่", "ยังไม่มีข้อมูลห้องในไฟล์ที่ได้รับ — กรอกเพิ่มได้ (แถวสีเขียวเป็นตัวอย่าง ไม่ถูกนำเข้า)")
    header(wl, 4, ["รหัสอาคาร", "ชั้น", "ชื่อห้อง/พื้นที่", "เลขห้อง", "ประเภท", "ประเภท (ระบบ)", "คำสั่ง SQL"], [12, 10, 36, 12, 18, 14, 110])
    wl["H4"] = None
    ex = ["PHP03", "ชั้น 1", "โถงบันไดหนีไฟ", "PHP03-100", "พื้นที่ส่วนกลาง"]
    loc_th = f"'บทบาท'!$E$5:$E${4 + len(LOC_TYPES)}"
    # ตารางประเภทพื้นที่เก็บไว้ในแท็บ บทบาท คอลัมน์ E:F (ซ่อนไว้ด้านขวา)
    wr.cell(4, 5, "ประเภทพื้นที่").font = F(bold=True, color="FFFFFF"); wr.cell(4, 5).fill = HEAD
    wr.cell(4, 6, "รหัส").font = F(bold=True, color="FFFFFF"); wr.cell(4, 6).fill = HEAD
    wr.column_dimensions["E"].width = 20; wr.column_dimensions["F"].width = 14
    for i, (code, th) in enumerate(LOC_TYPES):
        wr.cell(5 + i, 5, th).font = F(); wr.cell(5 + i, 6, code).font = F()
    loc_code = f"'บทบาท'!$F$5:$F${4 + len(LOC_TYPES)}"
    n_loc = 200
    for i in range(n_loc + 1):
        r = 5 + i
        if i == 0:
            for col, v in enumerate(ex, 1): wl.cell(r, col, v)
        wl.cell(r, 6, f'=IF(E{r}="","",IFERROR(INDEX({loc_code},MATCH(E{r},{loc_th},0)),"?"))')
        sql = (f"\"select app.import_location('\"&UPPER(A{r})&\"', '\"&SUBSTITUTE(B{r},\"'\",\"''\")&\"', '\"&SUBSTITUTE(C{r},\"'\",\"''\")"
               f"&\"', '\"&SUBSTITUTE(D{r},\"'\",\"''\")&\"', '\"&F{r}&\"');\"")
        wl.cell(r, 7, f'=IF(OR(A{r}="",B{r}="",C{r}=""),"",{"\"-- ตัวอย่าง: \"&" if i == 0 else ""}{sql})')
        style_row(wl, r, 7, {EX if i == 0 else INPUT: (1, 2, 3, 4, 5), CALC: (6, 7)})
    end_l = 5 + n_loc
    bl = DataValidation(type="list", formula1=f"'อาคารและชั้น'!$B$5:$B${end_b}", allow_blank=True)
    fl = DataValidation(type="list", formula1='"ชั้น 1,ชั้น 2,ชั้น 3,ชั้น 4,ชั้น 5,ชั้น 6,ชั้น 7,ชั้น 8,ชั้นใต้ดิน,ดาดฟ้า"', allow_blank=True, showErrorMessage=False)
    tl = DataValidation(type="list", formula1=loc_th, allow_blank=True)
    for d, rng in ((bl, f"A6:A{end_l}"), (fl, f"B6:B{end_l}"), (tl, f"E5:E{end_l}")):
        wl.add_data_validation(d); d.add(rng)
    wl.freeze_panes = "A5"

    # ---- ผู้ใช้งาน
    wu = wb.create_sheet("ผู้ใช้งาน", 1)
    title(wu, "ผู้ใช้งาน (ลงทะเบียนล่วงหน้า)", "อีเมล @nu.ac.th เท่านั้น — ไม่ต้องใส่รหัสผ่าน ผู้ใช้เข้าด้วย Google ของมหาวิทยาลัย (แถวสีเขียวเป็นตัวอย่าง ไม่ถูกนำเข้า)")
    header(wu, 4, ["อีเมล (@nu.ac.th)", "ชื่อ-นามสกุล", "ตำแหน่ง", "faculty (สังกัด)", "unit (หน่วยงานที่ได้รับสิทธิ์)\nเว้นว่าง = เท่ากับ faculty",
                   "บทบาท", "รหัสบทบาท", "คำสั่ง SQL", "ตรวจสอบ", "หน้าที่ (คำแนะนำ)"], [30, 26, 22, 40, 40, 32, 18, 120, 24, 44])
    exu = ["somchai.j@nu.ac.th", "สมชาย ใจดี", "นักวิชาการอาชีวอนามัยและความปลอดภัย", "คณะสาธารณสุขศาสตร์", "", "ผู้ตรวจ"]
    role_th = {c: th for c, th, _ in ROLES}
    slots = USER_SLOTS + [(n, "", "org_admin", "ผู้ดูแลของหน่วยงาน") for c, n, _ in ORGS if n not in {x[0] for x in USER_SLOTS}]
    n_users = max(300, len(slots) + 100)
    for i in range(n_users + 1):
        r = 5 + i
        if i == 0:
            for col, v in enumerate(exu, 1): wu.cell(r, col, v)
            wu.cell(r, 10, "แถวตัวอย่าง (ไม่ถูกนำเข้า)")
        elif i <= len(slots):
            fac, unit, role, duty = slots[i - 1]
            wu.cell(r, 4, fac); wu.cell(r, 5, unit or None); wu.cell(r, 6, role_th[role]); wu.cell(r, 10, duty)
        wu.cell(r, 7, f'=IF(F{r}="","",IFERROR(INDEX({role_code},MATCH(F{r},{role_range},0)),"?"))')
        sql = (f"\"select app.import_user('\"&LOWER(TRIM(A{r}))&\"', '\"&SUBSTITUTE(B{r},\"'\",\"''\")&\"', '\"&SUBSTITUTE(C{r},\"'\",\"''\")"
               f"&\"', '\"&SUBSTITUTE(D{r},\"'\",\"''\")&\"', '\"&SUBSTITUTE(E{r},\"'\",\"''\")&\"', '\"&G{r}&\"');\"")
        wu.cell(r, 8, f'=IF(OR(A{r}="",D{r}="",F{r}=""),"",{"\"-- ตัวอย่าง: \"&" if i == 0 else ""}{sql})')
        wu.cell(r, 9, f'=IF(A{r}="",IF(F{r}<>"","รอกรอกอีเมล",""),IF(ISERROR(SEARCH("@nu.ac.th",A{r})),"อีเมลต้องเป็น @nu.ac.th",'
                      f'IF(D{r}="","ยังไม่เลือก faculty",IF(F{r}="","ยังไม่เลือกบทบาท",IF(G{r}="?","บทบาทไม่ถูกต้อง","พร้อมนำเข้า")))))')
        style_row(wu, r, 10, {EX if i == 0 else INPUT: (1, 2, 3, 4, 5, 6), CALC: (7, 8, 9), "wrap": (10,)})
    end_u = 5 + n_users
    for rng, f1 in ((f"D5:E{end_u}", org_range), (f"F5:F{end_u}", role_range)):
        d = DataValidation(type="list", formula1=f1, allow_blank=True, showErrorMessage=True,
                           errorTitle="ค่าไม่ถูกต้อง", error="กรุณาเลือกจากรายการ")
        wu.add_data_validation(d); d.add(rng)
    wu["A4"].comment = Comment("ต้องเป็นอีเมลของมหาวิทยาลัย (@nu.ac.th) ที่ใช้เข้าสู่ระบบด้วย Google", "NU Safety")
    wu["E4"].comment = Comment("ใช้เมื่อสิทธิ์ต่างจากสังกัด เช่น สังกัดคณะสาธารณสุขศาสตร์ แต่เป็นผู้ประสานงานของกองอาคารสถานที่", "NU Safety")
    wu.freeze_panes = "B5"

    # ---- จุดตรวจเริ่มต้น (ใช้เดินยืนยันหน้างาน)
    wa = wb.create_sheet("จุดตรวจเริ่มต้น", 2)
    title(wa, f"จุดตรวจเริ่มต้น {len(list(starter_assets()))} จุด — คณะสาธารณสุขศาสตร์",
          "สร้างโดย deploy/07_ready_public_health.sql — พิมพ์แผ่นนี้ไปเดินยืนยันที่หน้างาน แล้วแก้ไขในเว็บ (จุดตรวจ › แก้ไข)")
    header(wa, 4, ["รหัสจุดตรวจ", "ชื่อ", "อาคาร", "ชั้น", "ห้อง/พื้นที่", "รอบตรวจ", "มีจริง (✓/✗)", "จำนวนจริง", "ตำแหน่งจริง / หมายเหตุ"],
           [16, 34, 34, 9, 24, 12, 12, 11, 44])
    freq_of = {t: f for _, t, f, _ in STARTER_PLANS}
    for i, (c, n, t, b, bname, f, room) in enumerate(starter_assets()):
        r = 5 + i
        for col, v in enumerate([c, n, f"{b} {bname}", f, room, FREQ_TH[freq_of[t]]], 1): wa.cell(r, col, v)
        style_row(wa, r, 9, {INPUT: (7, 8, 9)})
    yn = DataValidation(type="list", formula1='"✓,✗"', allow_blank=True)
    wa.add_data_validation(yn); yn.add(f"G5:G{4 + len(list(starter_assets()))}")
    wa.freeze_panes = "B5"
    wa.print_title_rows = "4:4"; wa.page_setup.orientation = "landscape"; wa.page_setup.fitToWidth = 1
    wa.sheet_properties.pageSetUpPr.fitToPage = True; wa.page_setup.fitToHeight = 0

    for sh in wb.worksheets:
        sh.sheet_properties.tabColor = {"คำแนะนำ": "2F3337", "ผู้ใช้งาน": "F26F21"}.get(sh.title, "F7A46B")
    out = ROOT / "docs/import/แบบฟอร์มนำเข้าข้อมูล-NU-Safety.xlsx"
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    return out


if __name__ == "__main__":
    build_sql()
    print("สร้าง deploy/06_import_nu_data.sql แล้ว")
    build_sql_ready()
    print("สร้าง deploy/07_ready_public_health.sql แล้ว")
    print("สร้าง", build_xlsx().relative_to(ROOT), "แล้ว")
