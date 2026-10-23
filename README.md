# NU Safety Inspection — ระบบการตรวจความปลอดภัย มหาวิทยาลัยนเรศวร

ระบบส่วนกลางสำหรับทะเบียนจุดตรวจ, วางแผนและตรวจหน้างานด้วย QR Code, ติดตามแก้ไขจนตรวจยืนยันปิดงาน และ Dashboard/รายงานตามสิทธิ์ของแต่ละหน่วยงาน

**เทคโนโลยี:** Next.js 15 (App Router) · TypeScript · Tailwind CSS · Supabase (PostgreSQL + Row Level Security, Auth, Storage)

> สถานะ: **MVP ใช้งานได้ครบวงจรและผ่านการทดสอบ** (DB 106 / Unit 8 / E2E 19) — ยังมีรายการที่ต้องทำก่อนใช้งานจริง เช่น ผู้เชี่ยวชาญรับรองแบบตรวจ, SSO, API ระบบแจ้งซ่อม, SMTP ดู [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md)

## ความสามารถหลัก

- โครงสร้าง มหาวิทยาลัย → คณะ/หน่วยงาน → อาคาร → ชั้น → ห้อง → จุดตรวจ, 7 บทบาท, สิทธิ์ตามขอบเขตหน่วยงาน (ตรวจที่ฐานข้อมูลทุกคำสั่ง)
- 8 หมวดแบบตรวจตัวอย่าง (*ร่างสำหรับผู้เชี่ยวชาญตรวจรับรอง*), สร้าง/แก้แบบตรวจเองได้, มีเวอร์ชัน + แหล่งอ้างอิงกฎหมาย (บังคับระบุฉบับและวันที่ตรวจสอบ)
- ทะเบียนอุปกรณ์ (รุ่น, S/N, วันติดตั้ง/หมดอายุ, สถานะ), QR Code ถาวรไม่มีข้อมูลส่วนบุคคล พิมพ์รายชิ้น/ชุด
- แผนตรวจ รายวัน/สัปดาห์/เดือน/ไตรมาส/ปี/กำหนดเอง → สร้างงานและมอบหมายผู้ตรวจ
- ตรวจหน้างานบนมือถือ: สแกน QR, ผ่าน/ไม่ผ่าน/ไม่เกี่ยวข้อง (ต้องมีเหตุผล, ไม่นับในตัวหาร), ภาพหลักฐานหรือเหตุผลยกเว้น, ฉบับร่าง (ในเครื่อง + ในระบบ), กันส่งซ้ำ, แจ้งผลหลัง Backend ยืนยันเท่านั้น
- ติดตามแก้ไข: พบข้อบกพร่อง → มอบหมาย → กำลังแก้ไข → รอตรวจยืนยัน → ปิดงาน, ส่งกลับพร้อมเหตุผล, ประวัติทุกขั้น, ภาพก่อน–หลัง, ตรวจจับเกิดซ้ำ, ใบงานถึงกองอาคารสถานที่ (พิมพ์/PDF — ยังไม่เชื่อม API)
- Dashboard: 8 KPI พร้อมสูตร, สถานะการตรวจ/ผลตรวจ/สถานะแก้ไข, แนวโน้ม 12 เดือน, ข้อบกพร่องแยกหมวด, กิจกรรมล่าสุด, ตารางรายปี ม.ค.–ธ.ค. (ตรวจแล้ว/ถึงกำหนด) — คลิกดูรายการต้นทางได้
- แจ้งเตือนในระบบ + อีเมล (ตั้งค่าระยะเวลา/ผู้รับ/การยกระดับ, กันซ้ำ), รายงาน Excel/PDF 5 ชนิด, ปี พ.ศ., Asia/Bangkok
- Audit log ทุกตารางสำคัญ, ไฟล์แนบ private + signed URL อายุจำกัด, PWA แบบจำกัดขอบเขต

## เริ่มต้นอย่างย่อ

```bash
npm install
cp .env.example .env.local       # ใส่ค่า Supabase ของคุณ
npx supabase db reset            # หรือ supabase db push (โปรเจกต์ Cloud)
npm run dev
```
รายละเอียดสำหรับนักพัฒนา: [`docs/INSTALL.md`](docs/INSTALL.md) · ผู้ไม่มีพื้นฐาน: [`docs/DEPLOY_GUIDE.md`](docs/DEPLOY_GUIDE.md) (ใช้ไฟล์ใน `deploy/` คัดลอก–วางใน Supabase SQL Editor)

## เอกสาร

| เอกสาร | เนื้อหา |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | สรุปความเข้าใจ, สมมติฐาน, สถาปัตยกรรม, แผนผังหน้า, ER Diagram, RPC, ขอบเขต PWA |
| [docs/KPI_DEFINITIONS.md](docs/KPI_DEFINITIONS.md) | สูตรและตัวหารของทุก KPI |
| **[docs/GOOGLE_LOGIN.md](docs/GOOGLE_LOGIN.md)** | **เข้าสู่ระบบด้วยบัญชี Google @nu.ac.th + หน้าเว็บกลางบน Google Sites** |
| **[docs/DEPLOY_GUIDE.md](docs/DEPLOY_GUIDE.md)** | **คู่มือขึ้นระบบจริงทีละขั้น สำหรับผู้ไม่มีพื้นฐาน (Supabase + GitHub + Vercel, คัดลอก–วาง)** |
| [docs/INSTALL.md](docs/INSTALL.md) | ติดตั้ง ตั้งค่า ผู้ใช้คนแรก Cron SMTP SSO และ checklist ก่อนใช้งานจริง |
| [docs/MANUAL_ADMIN.md](docs/MANUAL_ADMIN.md) | คู่มือผู้ดูแล |
| [docs/MANUAL_INSPECTOR.md](docs/MANUAL_INSPECTOR.md) | คู่มือผู้ตรวจ |
| [docs/MANUAL_RESPONSIBLE.md](docs/MANUAL_RESPONSIBLE.md) | คู่มือผู้รับผิดชอบแก้ไข / ผู้ตรวจยืนยัน / ผู้บริหาร |
| [docs/TEST_REPORT.md](docs/TEST_REPORT.md) | ผลการทดสอบ และรายการที่ยังไม่พร้อมใช้งานจริง |
| [docs/screenshots/](docs/screenshots) | ภาพหน้าจอจากการทดสอบ E2E |

## โครงสร้างโครงการ

```
app/
  (app)/                 หน้าที่ต้องเข้าสู่ระบบ: แดชบอร์ด, tasks, plans, inspect, inspections, q, assets, findings, reports, settings, notifications
  api/actions/[name]     คำสั่งเปลี่ยนแปลงข้อมูล (JSON, ตรวจ Origin, ทำงานในนามผู้ใช้)
  api/attachments        อัปโหลด/ลบไฟล์แนบ (Storage private)
  api/reports/[type]     ส่งออก Excel
  api/cron/notifications งานแจ้งเตือนตามเวลา + อีเมล
  login, auth/           เข้าสู่ระบบ / SSO callback / ออกจากระบบ
components/              UI (ภาษาไทย), แบบบันทึกผลตรวจ, สแกน QR, กราฟ, ฟอร์ม
lib/                     Supabase clients, สิทธิ์ (เพื่อแสดงเมนู), รูปแบบวันที่ พ.ศ., label, actions ฝั่งเซิร์ฟเวอร์, รายงาน
supabase/migrations/     schema, RLS, RPC workflow, dashboard, storage, admin helpers
supabase/seed.sql        ข้อมูลตัวอย่าง (DEMO) + demo_seed_activity()
scripts/                 seed-demo, test-db, e2e-stack, e2e
tests/db/                ทดสอบฐานข้อมูล (SQL) + shim จำลองบทบาท Supabase
tests/unit/              vitest
tests/e2e/               Playwright + stack ทดสอบในเครื่อง (gateway/storage emulator)
public/                  manifest, service worker, offline.html, ไอคอนทั่วไป (ไม่ใช่ตรามหาวิทยาลัย)
```
