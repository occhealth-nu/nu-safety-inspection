# คู่มือติดตั้งและตั้งค่าระบบ

## 1. สิ่งที่ต้องมี

- Node.js 20+ (ทดสอบกับ 22)
- โปรเจกต์ Supabase (Cloud หรือ self-hosted) — หรือ Supabase CLI + Docker สำหรับพัฒนาในเครื่อง
- (ถ้าต้องการ) SMTP ของมหาวิทยาลัยสำหรับอีเมลแจ้งเตือน

## 2. ติดตั้งฐานข้อมูล

### ทางเลือก 0 — ไม่ใช้คำสั่ง (แนะนำสำหรับผู้ไม่มีพื้นฐาน)
วางไฟล์ `deploy/01_install_database.sql` → `02_starter_data.sql` → (ไม่บังคับ `03_demo_data_optional.sql`) → `04_make_first_admin.sql` ใน Supabase SQL Editor ตามลำดับ — ดูขั้นตอนเต็มใน `docs/DEPLOY_GUIDE.md` (หลังแก้ migration ให้รัน `bash scripts/build-deploy-sql.sh` เพื่อสร้างไฟล์ 01 ใหม่)

### ทางเลือก A — Supabase CLI (แนะนำสำหรับพัฒนา)
```bash
npm install
npx supabase init            # ถ้ายังไม่มี supabase/config.toml
npx supabase start           # ต้องมี Docker
npx supabase db reset        # รัน supabase/migrations/* แล้วตามด้วย supabase/seed.sql
```

### ทางเลือก B — Supabase Cloud
```bash
npx supabase link --project-ref <project-ref>
npx supabase db push         # รัน migrations
```
ข้อมูลตัวอย่าง (ถ้าต้องการ): เปิด SQL Editor แล้วรันเนื้อหา `supabase/seed.sql` — **อย่ารันบนระบบจริง**

Migrations (เรียงตามลำดับ):

| ไฟล์ | เนื้อหา |
|---|---|
| `…0001_core_schema.sql` | ตาราง, enum, FK, index, constraint, trigger ลำดับสถานะ/ล็อกเวอร์ชันแบบตรวจ, audit trigger |
| `…0002_rls_policies.sql` | ฟังก์ชันตรวจสิทธิ์ (`app.*`), RLS ทุกตาราง, revoke การเขียนตรง |
| `…0003_workflow_functions.sql` | RPC กระบวนการตรวจ/แก้ไข/แจ้งเตือน |
| `…0004_dashboard.sql` | views + ฟังก์ชัน KPI |
| `…0005_storage.sql` | bucket `attachments` (private) + `branding` (public) และ storage policies |
| `…0006_admin_helpers.sql` | RPC ช่วยงานผู้ดูแลผู้ใช้ |

## 3. ตั้งค่าแอป

```bash
cp .env.example .env.local
# แก้ค่าตามโปรเจกต์ Supabase (Settings → API)
npm run build && npm start      # หรือ npm run dev
```

| ตัวแปร | จำเป็น | คำอธิบาย |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✔ | เชื่อมต่อ Supabase (ค่าสาธารณะ) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✔ | ใช้เฉพาะฝั่งเซิร์ฟเวอร์: สร้างบัญชี และงานแจ้งเตือน — **ห้ามใส่ใน NEXT_PUBLIC_*** |
| `NEXT_PUBLIC_APP_URL` | ✔ | URL ถาวรของระบบ ใช้สร้าง QR Code — เปลี่ยนภายหลังต้องพิมพ์ QR ใหม่ |
| `CRON_SECRET` | ✔ | ความลับสำหรับเรียก `/api/cron/notifications` |
| `SMTP_*` | – | เว้นว่าง = ไม่ส่งอีเมล (ระบบทำเครื่องหมาย `skipped` ชัดเจน) |
| `NEXT_PUBLIC_SSO_PROVIDER`, `NEXT_PUBLIC_SSO_DOMAIN` | – | ยังไม่เชื่อมต่อ — ดูข้อ 6 |

> ค่า `NEXT_PUBLIC_*` ถูกฝังตอน build — เปลี่ยนแล้วต้อง build ใหม่

## 4. ผู้ใช้คนแรก (ผู้ดูแลระบบ)

1. Supabase Dashboard → Authentication → Add user (อีเมล + รหัสผ่าน, ยืนยันอีเมลแล้ว)
2. SQL Editor:
```sql
update public.profiles set organization_id = (select id from organizations where parent_id is null), full_name = 'ชื่อผู้ดูแล'
 where email = 'admin@example.ac.th';
insert into public.role_assignments (user_id, role, organization_id)
select id, 'system_admin', (select id from organizations where parent_id is null) from profiles where email = 'admin@example.ac.th';
```
(ถ้ายังไม่ได้รัน seed ให้สร้างหน่วยงานรากก่อน: `insert into organizations (code, name_th, org_type) values ('NU','มหาวิทยาลัยนเรศวร','university');`)
3. ผู้ใช้อื่นสร้างผ่านเมนู **ตั้งค่าระบบ › ผู้ใช้และสิทธิ์**

### ผู้ใช้สาธิต (เฉพาะสภาพแวดล้อมทดสอบ)
```bash
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… DEMO_PASSWORD='ตั้งรหัสผ่านเอง' node scripts/seed-demo.mjs
```
สร้างบัญชี `admin|coordinator|eng.admin|sci.admin|inspector.eng|inspector.sci|fixer|fixer.eng|verifier|executive @demo.example.com` และประวัติการตรวจ/แก้ไขจำลองของปีปัจจุบัน (ทุกรายการระบุ “ข้อมูลตัวอย่าง”)

## 5. งานแจ้งเตือนตามเวลา (Cron)

เรียกทุก 1 ชั่วโมง (หรือวันละครั้งตามต้องการ):
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/notifications
```
- Vercel: เพิ่ม Cron Job ใน `vercel.json` แล้วตั้ง `CRON_SECRET`
- เซิร์ฟเวอร์มหาวิทยาลัย: ใช้ `crontab` / systemd timer
ผลลัพธ์ JSON บอกจำนวนแจ้งเตือนใกล้ครบ/เกินกำหนด/ยกระดับ และอีเมลที่ส่ง/ล้มเหลว/ข้าม (ไม่ส่งซ้ำ เพราะ `unique(user_id, dedupe_key)`)

## 6. SSO บัญชีมหาวิทยาลัย (ยังไม่เชื่อมต่อ)

ระบบเตรียมโค้ดไว้ แต่ **ยังไม่ได้ทดสอบกับผู้ให้บริการจริง** ต้องได้ข้อมูลจากหน่วยงานไอทีก่อน:

- Microsoft Entra ID (OAuth): Supabase → Authentication → Providers → Azure (client id/secret/tenant URL) → ตั้ง `NEXT_PUBLIC_SSO_PROVIDER=azure`
- SAML 2.0: เปิด SAML ใน Supabase (แผน Pro ขึ้นไป) `supabase sso add --type saml --metadata-url … --domains nu.ac.th` → ตั้ง `NEXT_PUBLIC_SSO_PROVIDER=saml` และ `NEXT_PUBLIC_SSO_DOMAIN=nu.ac.th`
- Redirect URL: `https://<app>/auth/callback`
- ผู้ใช้ที่เข้าครั้งแรกผ่าน SSO จะมีโปรไฟล์อัตโนมัติแต่ **ยังไม่มีบทบาท** → ผู้ดูแลต้องกำหนดหน่วยงาน/บทบาท (หน้าจอแจ้งผู้ใช้ให้ติดต่อผู้ดูแล)

## 7. Storage

สร้างโดย migration อัตโนมัติ: `attachments` (private, ≤10 MB, JPG/PNG/WebP/PDF) และ `branding` (public, ≤2 MB) ตรวจใน Supabase Dashboard → Storage ว่ามี policy `nu_attachments_*`

## 8. การทดสอบ

```bash
npm test                 # unit (vitest)
npm run test:db          # ทดสอบฐานข้อมูล 92 กรณี (ต้องมี PostgreSQL ที่ TEST_DATABASE_URL, ค่าเริ่มต้น :54322)
npm run test:e2e         # E2E: เปิด stack ในเครื่อง (PostgreSQL + Supabase Auth + PostgREST + storage emulator) + Playwright
```
`test:e2e` ต้องมีไบนารี `auth` (supabase/auth) และ `postgrest` ใน `tests/e2e/stack/bin/` (ดาวน์โหลดจาก GitHub releases) — หรือชี้ `E2E_BASE_URL` ไปยังระบบทดสอบที่มีผู้ใช้สาธิตแล้วรัน `npx playwright test`

## 9. Checklist ก่อนใช้งานจริง

- [ ] ลบ/ไม่รัน `supabase/seed.sql` และ `scripts/seed-demo.mjs` บนระบบจริง (ฟังก์ชัน `demo_seed_activity` อยู่ใน seed เท่านั้น)
- [ ] ผู้เชี่ยวชาญตรวจรับรองแบบตรวจ, ระบุแหล่งอ้างอิง ฉบับ วันที่ตรวจสอบ แล้วเผยแพร่เวอร์ชันใหม่
- [ ] อัปโหลดตรามหาวิทยาลัยทางการ (ตั้งค่าระบบ › ภาพลักษณ์)
- [ ] ตั้ง `NEXT_PUBLIC_APP_URL` เป็นโดเมนถาวรก่อนพิมพ์ QR
- [ ] ตั้ง Cron + SMTP, ทดสอบอีเมลจริง
- [ ] เปิด Supabase Point-in-Time Recovery / สำรองข้อมูล และกำหนดนโยบายเก็บรักษาไฟล์ภาพ
- [ ] ทบทวนสิทธิ์ตาม `docs/ARCHITECTURE.md` §2 กับผู้รับผิดชอบด้านความปลอดภัยสารสนเทศ/PDPA
