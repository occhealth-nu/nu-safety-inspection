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

# (หน่วยงานเจ้าของ, รหัสอาคาร, ชื่ออาคาร, จำนวนชั้น) — จาก Excel "อาคารในคณะสาธารณสุข"
BUILDINGS = [
    ("PH", "PH1", "อาคารเรียนรวม คณะสาธารณสุขศาสตร์", 4),
    ("PH", "PH2", "อาคารสุขวิทยาสถิตย์", 4),
    ("PH", "PH3", "อาคารบริหาร คณะสาธารณสุขศาสตร์", 4),
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
    out = [
        "-- =====================================================================",
        "-- NU Safety Inspection — นำเข้าหน่วยงาน 43 หน่วยงาน + อาคารคณะสาธารณสุขศาสตร์ 3 อาคาร (ชั้น 1–4)",
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
    out += [") v(r);", "", "-- ---------- ส่วนที่ 3: อาคารและชั้น (จาก Excel อาคารในคณะสาธารณสุข) ----------",
            "select r as ผลการนำเข้าอาคาร from (values"]
    out.append(",\n".join(f"  (app.import_building({q(o)}, {q(c)}, {q(n)}, {f}))" for o, c, n, f in BUILDINGS))
    out += [") v(r);", "",
            "-- ---------- ตรวจผล ----------",
            "select b.code as รหัสอาคาร, b.name as อาคาร, o.name_th as หน่วยงานเจ้าของ, count(f.id) as จำนวนชั้น",
            "  from public.buildings b join public.organizations o on o.id = b.organization_id",
            "  left join public.floors f on f.building_id = b.id",
            f" where b.code in ({', '.join(q(b[1]) for b in BUILDINGS)})",
            " group by b.code, b.name, o.name_th order by b.code;", ""]
    (ROOT / "deploy/06_import_nu_data.sql").write_text("\n".join(out))


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
        ("     → ได้หน่วยงาน 43 หน่วยงาน + อาคาร PH1–PH3 (ชั้น 1–4) + เครื่องมือนำเข้าผู้ใช้/ห้อง", F(color="5B6670")),
        ("", None),
        ("เพิ่มผู้ใช้งาน (แท็บ ผู้ใช้งาน)", F(bold=True, size=12)),
        ("2. กรอกอีเมล @nu.ac.th ชื่อ ตำแหน่ง แล้วเลือก faculty (สังกัด) unit (หน่วยงานที่ได้รับสิทธิ์ — เว้นว่าง = เท่ากับ faculty) และบทบาท", F()),
        ("     ผู้ใช้ 1 คนมีหลายบทบาทได้: กรอกหลายแถว อีเมลเดิม บทบาทต่างกัน", F(color="5B6670")),
        ("3. เลือกคอลัมน์ H (คำสั่ง SQL) เฉพาะแถวที่กรอก → คัดลอก → วางใน SQL Editor → Run", F()),
        ("4. ผู้ใช้กด “เข้าสู่ระบบด้วยบัญชี Google ของมหาวิทยาลัย” → ได้หน่วยงานและบทบาททันที ไม่ต้องรอผู้ดูแลอนุมัติ", F()),
        ("     ถ้าผู้ใช้เคยเข้าระบบแล้ว (อยู่ในรายการ “รอกำหนดสิทธิ์”) ระบบกำหนดสิทธิ์ให้ทันทีที่กด Run", F(color="5B6670")),
        ("", None),
        ("เพิ่มห้อง/พื้นที่ (แท็บ ห้องและพื้นที่)", F(bold=True, size=12)),
        ("5. เลือกรหัสอาคาร ชั้น แล้วกรอกชื่อห้อง/เลขห้อง/ประเภท → คัดลอกคอลัมน์ G → วางใน SQL Editor → Run", F()),
        ("", None),
        ("เพิ่มอาคารของหน่วยงานอื่น (แท็บ อาคารและชั้น)", F(bold=True, size=12)),
        ("6. กรอกต่อท้ายตาราง (หน่วยงาน รหัสอาคาร ชื่ออาคาร จำนวนชั้น) → คัดลอกคอลัมน์ F → วางใน SQL Editor → Run", F()),
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
    title(wo, "หน่วยงาน (43)", "จากไฟล์ NU-Inspections-Users_3.csv — ใช้เป็นตัวเลือก faculty / unit ในแท็บอื่น")
    header(wo, 4, ["ลำดับ", "ชื่อหน่วยงาน", "รหัส", "ประเภท", "ประเภท (ระบบ)", "คำสั่ง SQL (สำหรับเพิ่มหน่วยงานใหม่)"], [7, 52, 11, 20, 14, 90])
    for i, (code, name, typ) in enumerate(ORGS, 1):
        r = 4 + i
        wo.cell(r, 1, i); wo.cell(r, 2, name); wo.cell(r, 3, code); wo.cell(r, 4, ORG_TYPE_TH[typ]); wo.cell(r, 5, typ)
        wo.cell(r, 6, f"=\"select app.import_organization('\"&SUBSTITUTE(C{r},\"'\",\"''\")&\"', '\"&SUBSTITUTE(B{r},\"'\",\"''\")&\"', '\"&E{r}&\"');\"")
        style_row(wo, r, 6, {CALC: (6,)})
    last_org = 4 + len(ORGS)
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
    wbld = wb.create_sheet("อาคารและชั้น")
    title(wbld, "อาคารและชั้น", "จาก Excel อาคารในคณะสาธารณสุข — กรอกต่อท้ายเพื่อเพิ่มอาคารของหน่วยงานอื่น")
    header(wbld, 4, ["หน่วยงานเจ้าของ", "รหัสอาคาร", "ชื่ออาคาร", "จำนวนชั้น", "ชั้นที่สร้าง", "คำสั่ง SQL"], [44, 12, 44, 11, 22, 100])
    name_of = {c: n for c, n, _ in ORGS}
    n_rows = len(BUILDINGS) + 30
    for i in range(n_rows):
        r = 5 + i
        if i < len(BUILDINGS):
            o, c, n, f = BUILDINGS[i]
            wbld.cell(r, 1, name_of[o]); wbld.cell(r, 2, c); wbld.cell(r, 3, n); wbld.cell(r, 4, f)
        wbld.cell(r, 5, f'=IF(D{r}="","",IF(D{r}=1,"ชั้น 1","ชั้น 1 – ชั้น "&D{r}))')
        wbld.cell(r, 6, f"=IF(OR(A{r}=\"\",B{r}=\"\",C{r}=\"\"),\"\",\"select app.import_building('\"&SUBSTITUTE(A{r},\"'\",\"''\")&\"', '\"&UPPER(B{r})&\"', '\"&SUBSTITUTE(C{r},\"'\",\"''\")&\"', \"&N(D{r})&\");\")")
        style_row(wbld, r, 6, {INPUT: (1, 2, 3, 4), CALC: (5, 6)})
    end_b = 4 + n_rows
    dv = DataValidation(type="list", formula1=org_range, allow_blank=True, showErrorMessage=True,
                        errorTitle="หน่วยงานไม่ถูกต้อง", error="เลือกจากรายการ (แท็บ หน่วยงาน)")
    wbld.add_data_validation(dv); dv.add(f"A5:A{end_b}")
    dvn = DataValidation(type="whole", operator="between", formula1="0", formula2="60", allow_blank=True)
    wbld.add_data_validation(dvn); dvn.add(f"D5:D{end_b}")
    wbld.freeze_panes = "A5"

    # ---- ห้องและพื้นที่
    wl = wb.create_sheet("ห้องและพื้นที่")
    title(wl, "ห้องและพื้นที่", "ยังไม่มีข้อมูลห้องในไฟล์ที่ได้รับ — กรอกเพิ่มได้ (แถวสีเขียวเป็นตัวอย่าง ไม่ถูกนำเข้า)")
    header(wl, 4, ["รหัสอาคาร", "ชั้น", "ชื่อห้อง/พื้นที่", "เลขห้อง", "ประเภท", "ประเภท (ระบบ)", "คำสั่ง SQL"], [12, 10, 36, 12, 18, 14, 110])
    wl["H4"] = None
    ex = ["PH1", "ชั้น 1", "โถงบันไดหนีไฟ", "PH1-100", "พื้นที่ส่วนกลาง"]
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
                   "บทบาท", "รหัสบทบาท", "คำสั่ง SQL", "ตรวจสอบ"], [30, 26, 22, 40, 40, 32, 18, 120, 26])
    exu = ["somchai.j@nu.ac.th", "สมชาย ใจดี", "นักวิชาการอาชีวอนามัยและความปลอดภัย", "คณะสาธารณสุขศาสตร์", "", "ผู้ตรวจ"]
    n_users = 300
    for i in range(n_users + 1):
        r = 5 + i
        if i == 0:
            for col, v in enumerate(exu, 1): wu.cell(r, col, v)
        wu.cell(r, 7, f'=IF(F{r}="","",IFERROR(INDEX({role_code},MATCH(F{r},{role_range},0)),"?"))')
        sql = (f"\"select app.import_user('\"&LOWER(TRIM(A{r}))&\"', '\"&SUBSTITUTE(B{r},\"'\",\"''\")&\"', '\"&SUBSTITUTE(C{r},\"'\",\"''\")"
               f"&\"', '\"&SUBSTITUTE(D{r},\"'\",\"''\")&\"', '\"&SUBSTITUTE(E{r},\"'\",\"''\")&\"', '\"&G{r}&\"');\"")
        wu.cell(r, 8, f'=IF(OR(A{r}="",D{r}="",F{r}=""),"",{"\"-- ตัวอย่าง: \"&" if i == 0 else ""}{sql})')
        wu.cell(r, 9, f'=IF(A{r}="","",IF(ISERROR(SEARCH("@nu.ac.th",A{r})),"อีเมลต้องเป็น @nu.ac.th",'
                      f'IF(D{r}="","ยังไม่เลือก faculty",IF(F{r}="","ยังไม่เลือกบทบาท",IF(G{r}="?","บทบาทไม่ถูกต้อง","พร้อมนำเข้า")))))')
        style_row(wu, r, 9, {EX if i == 0 else INPUT: (1, 2, 3, 4, 5, 6), CALC: (7, 8, 9)})
    end_u = 5 + n_users
    for rng, f1 in ((f"D5:E{end_u}", org_range), (f"F5:F{end_u}", role_range)):
        d = DataValidation(type="list", formula1=f1, allow_blank=True, showErrorMessage=True,
                           errorTitle="ค่าไม่ถูกต้อง", error="กรุณาเลือกจากรายการ")
        wu.add_data_validation(d); d.add(rng)
    wu["A4"].comment = Comment("ต้องเป็นอีเมลของมหาวิทยาลัย (@nu.ac.th) ที่ใช้เข้าสู่ระบบด้วย Google", "NU Safety")
    wu["E4"].comment = Comment("ใช้เมื่อสิทธิ์ต่างจากสังกัด เช่น สังกัดคณะสาธารณสุขศาสตร์ แต่เป็นผู้ประสานงานของกองอาคารสถานที่", "NU Safety")
    wu.freeze_panes = "B5"

    for sh in wb.worksheets:
        sh.sheet_properties.tabColor = {"คำแนะนำ": "2F3337", "ผู้ใช้งาน": "F26F21"}.get(sh.title, "F7A46B")
    out = ROOT / "docs/import/แบบฟอร์มนำเข้าข้อมูล-NU-Safety.xlsx"
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    return out


if __name__ == "__main__":
    build_sql()
    print("สร้าง deploy/06_import_nu_data.sql แล้ว")
    print("สร้าง", build_xlsx().relative_to(ROOT), "แล้ว")
