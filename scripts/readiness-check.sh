#!/usr/bin/env bash
# ตรวจความพร้อมใช้ทั้งระบบ (ต้องมี PostgreSQL ทดสอบที่ :54322 และ stack ทดสอบ — ดู scripts/e2e-stack.sh)
# ใช้: bash scripts/readiness-check.sh  → สรุปผลที่ท้ายไฟล์ log
set -uo pipefail
cd "$(dirname "$0")/.."
PG="postgres://postgres@127.0.0.1:54322"
T="$(mktemp -d)"; RESULTS=()
pass() { RESULTS+=("PASS | $1 | $2"); echo "PASS  $1 — $2"; }
fail() { RESULTS+=("FAIL | $1 | $2"); echo "FAIL  $1 — $2"; }
newdb() { psql "$PG/postgres" -qX -c "drop database if exists $1 with (force)" -c "create database $1" >/dev/null 2>&1
          for f in tests/db/shim/*.sql; do psql "$PG/$1" -qX -f "$f" >/dev/null 2>&1; done; }
run() { psql "$PG/$1" -qX -v ON_ERROR_STOP=1 -f "$2" >"$T/out" 2>"$T/err"; }
checks8() { psql "$PG/$1" -qXAt -f deploy/00_check_database.sql | grep -c "✅"; }
sed "s/v_confirm text := 'ไม่ลบ'/v_confirm text := 'ลบทั้งหมด'/" deploy/RESET_delete_all_data.sql > "$T/reset.sql"

echo "== 1. โค้ด"
npx tsc --noEmit -p . >"$T/tsc" 2>&1 && pass "TypeScript" "ไม่มีข้อผิดพลาดชนิดข้อมูล" || fail "TypeScript" "$(head -3 "$T/tsc")"
npx vitest run >"$T/unit" 2>&1 && pass "Unit tests" "$(grep -oE 'Tests +[0-9]+ passed' "$T/unit")" || fail "Unit tests" "$(grep -E 'failed' "$T/unit" | head -2)"
bash scripts/test-db.sh >"$T/db" 2>&1 && pass "Database tests (RLS/workflow)" "$(grep -oE 'ALL [0-9]+ DATABASE TESTS PASSED' "$T/db")" || fail "Database tests" "$(grep -E 'not ok|ERROR' "$T/db" | head -3)"

echo "== 2. ไฟล์ติดตั้ง"
missing=$(for f in supabase/migrations/*.sql; do grep -q ">>>>>>>>>> $(basename "$f")" deploy/01_install_database.sql || basename "$f"; done)
[ -z "$missing" ] && pass "ไฟล์ติดตั้งรวม migration ครบ" "$(ls supabase/migrations/*.sql | wc -l) ไฟล์" || fail "ไฟล์ติดตั้งขาด migration" "$missing"

newdb rc_fresh; ok=1
for f in deploy/01_install_database.sql deploy/02_starter_data.sql deploy/06_import_nu_data.sql deploy/07_ready_public_health.sql; do run rc_fresh "$f" || { ok=0; fail "ติดตั้งใหม่ ($f)" "$(grep ERROR "$T/err" | head -1)"; }; done
sed "s/'ชื่อผู้ใช้@nu.ac.th'/'ready.check@nu.ac.th'/" deploy/10_first_admin_google.sql > "$T/admin.sql"; run rc_fresh "$T/admin.sql" || ok=0
run rc_fresh deploy/11_create_import_key.sql || ok=0
n=$(checks8 rc_fresh); [ $ok = 1 ] && [ "$n" = 8 ] && pass "ติดตั้งใหม่ด้วย SQL (01→02→06→07→ผู้ดูแล→รหัสนำเข้า)" "ตรวจผล ✅ $n/8 · อาคาร $(psql "$PG/rc_fresh" -qXAt -c 'select count(*) from buildings')" || fail "ติดตั้งใหม่ด้วย SQL" "✅ $n/8"
for f in deploy/06_import_nu_data.sql deploy/07_ready_public_health.sql; do run rc_fresh "$f" || ok=0; done
a=$(psql "$PG/rc_fresh" -qXAt -c "select count(*)||'/'||count(distinct code) from assets"); [ $ok = 1 ] && [ "$a" = "60/60" ] && pass "รันไฟล์ข้อมูลซ้ำไม่เกิดข้อมูลซ้ำ" "จุดตรวจ $a" || fail "รันซ้ำ" "$a"

run rc_fresh "$T/reset.sql" && r=$(psql "$PG/rc_fresh" -qXAt -c "select count(*) from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind in ('r','S','v')") && [ "$r" = 0 ] \
  && pass "ไฟล์ RESET ลบหมด" "เหลือตาราง $r" || fail "ไฟล์ RESET" "$(grep ERROR "$T/err" | head -1)"
ok=1; for f in deploy/01_install_database.sql deploy/02_starter_data.sql deploy/06_import_nu_data.sql deploy/07_ready_public_health.sql; do run rc_fresh "$f" || ok=0; done
[ $ok = 1 ] && pass "ลบแล้วติดตั้งใหม่ซ้ำได้" "✅ $(checks8 rc_fresh)/8" || fail "ลบแล้วติดตั้งใหม่" "$(grep ERROR "$T/err" | head -1)"

newdb rc_old; for f in supabase/migrations/2026102*.sql deploy/02_starter_data.sql supabase/seed.sql; do run rc_old "$f"; done
ok=1; run rc_old deploy/12_upgrade_existing_system.sql || ok=0; run rc_old deploy/12_upgrade_existing_system.sql || ok=0
run rc_old deploy/08_remove_demo_data.sql || ok=0
[ $ok = 1 ] && pass "อัปเกรดระบบรุ่นเก่า + ลบ Demo (12 ×2 → 08)" "✅ $(checks8 rc_old)/8 (ข้อ 7 ต้องส่งจุดตรวจจากชีตหรือไฟล์ 07)" || fail "อัปเกรดระบบเก่า" "$(grep ERROR "$T/err" | head -1)"

echo "== 3. เว็บ (E2E ทุกบทบาท)"
bash scripts/e2e.sh --trace off --reporter=line >"$T/e2e" 2>&1 && pass "E2E เว็บ" "$(grep -aoE '[0-9]+ passed' "$T/e2e" | tail -1)" || fail "E2E เว็บ" "$(grep -aoE '[0-9]+ (passed|failed)' "$T/e2e" | tr '\n' ' ')"

echo "== 4. Google Sheets / Apps Script"
run nu_e2e "$T/reset.sql"; ok=1
for f in deploy/01_install_database.sql deploy/02_starter_data.sql; do run nu_e2e "$f" || ok=0; done
KEY=$(psql "$PG/nu_e2e" -qXAt -f deploy/11_create_import_key.sql | tail -1); psql "$PG/nu_e2e" -qX -c "notify pgrst, 'reload schema'" >/dev/null; sleep 2
set -a; . ./.env.e2e; set +a
node tests/apps-script/harness.mjs apps-script/NU-Safety-Sheets-Template.xlsx "$NEXT_PUBLIC_SUPABASE_URL" "$NEXT_PUBLIC_SUPABASE_ANON_KEY" "$KEY" >"$T/gs" 2>&1 \
  && pass "Apps Script (ติดตั้ง 01→02 แล้วส่งทุกอย่างจากชีต)" "$(grep -c '^ok' "$T/gs") ข้อผ่าน · ✅ $(checks8 nu_e2e)/8" || fail "Apps Script" "$(grep FAIL "$T/gs" | head -3)"

echo "== 5. ความปลอดภัยและไฟล์"
s=$(git grep -nIE "eyJhbGciOiJIUzI1NiIs[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}|sb_secret_[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{10,}|nuimp_[0-9a-f]{48}" | wc -l)
[ "$s" = 0 ] && pass "ไม่มีคีย์ลับในโค้ด" "สแกน git ทั้งหมด" || fail "พบคีย์ลับ" "$s จุด"
[ -z "$(git ls-files | grep -E '(^|/)\.env($|\.local|\.production)')" ] && pass "ไม่มีไฟล์ .env ใน git" "-" || fail ".env ใน git" "-"
npm audit --omit=dev --json >"$T/audit" 2>/dev/null; v=$(python3 -c "import json;d=json.load(open('$T/audit'));m=d.get('metadata',{}).get('vulnerabilities',{});print(f\"critical {m.get('critical',0)} · high {m.get('high',0)} · moderate {m.get('moderate',0)}\")" 2>/dev/null || echo "ตรวจไม่ได้")
case "$v" in "critical 0 · high 0"*) pass "npm audit (production)" "$v";; *) fail "npm audit (production)" "$v";; esac

echo; echo "===== สรุป ====="; printf '%s\n' "${RESULTS[@]}"
echo "$(printf '%s\n' "${RESULTS[@]}" | grep -c '^PASS') ผ่าน · $(printf '%s\n' "${RESULTS[@]}" | grep -c '^FAIL') ไม่ผ่าน"
rm -rf "$T"
