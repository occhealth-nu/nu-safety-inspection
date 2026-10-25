# คู่มือการใช้งาน (ฉบับมีภาพประกอบ)

- `คู่มือการใช้งาน-NU-Safety-Inspection.pdf` — คู่มือฉบับสมบูรณ์สำหรับพิมพ์/แจก
- `manual.html` — ต้นฉบับเนื้อหา (แก้ข้อความที่ไฟล์นี้)
- `img/` — ภาพหน้าจอ (ข้อมูลสมมติจากระบบทดสอบ)

## สร้างใหม่หลังแก้ไขระบบ
```bash
bash scripts/e2e-stack.sh                      # ระบบทดสอบพร้อมข้อมูลสาธิต
set -a; . ./.env.e2e; set +a; npx next build && npx next start -p 3000 &
node tests/manual/capture.mjs                  # ถ่ายภาพหน้าจอใหม่ทั้งหมด
node tests/manual/build-pdf.mjs                # สร้าง PDF พร้อมสารบัญและเลขหน้า
```
ต้องมีฟอนต์ Sarabun ติดตั้งในเครื่อง (สำหรับท้ายกระดาษ), `pdftotext`/`pdfinfo` และ Python `pypdf`, `Pillow`
