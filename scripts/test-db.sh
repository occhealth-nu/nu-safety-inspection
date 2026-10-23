#!/usr/bin/env bash
# รันการทดสอบฐานข้อมูล (migration + RLS + workflow) กับ PostgreSQL ในเครื่อง
# ต้องมี PostgreSQL 15+ ที่เชื่อมต่อได้ผ่าน TEST_DATABASE_URL (ค่าตั้งต้น: postgres://postgres@127.0.0.1:54322)
set -euo pipefail
shopt -s lastpipe
cd "$(dirname "$0")/.."
BASE_URL="${TEST_DATABASE_URL:-postgres://postgres@127.0.0.1:54322}"
DB="nu_safety_test"
psql "$BASE_URL/postgres" -qX -v ON_ERROR_STOP=1 -c "drop database if exists $DB with (force)" -c "create database $DB"
URL="$BASE_URL/$DB"
run() { psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
for f in tests/db/shim/*.sql; do run "$f"; done
for f in supabase/migrations/*.sql; do echo "• migrate $(basename "$f")"; run "$f"; done
echo "• seed supabase/seed.sql"; run supabase/seed.sql
echo "• tests"
# แสดงเฉพาะผลการทดสอบ (NOTICE) และข้อผิดพลาด
psql "$URL" -qX -v ON_ERROR_STOP=1 -f tests/db/workflow_test.sql 2>&1 >/dev/null \
  | sed -E 's/^psql:[^ ]+ (NOTICE|ERROR): +/\1: /; s/^NOTICE: //'
test "${PIPESTATUS[0]}" -eq 0
