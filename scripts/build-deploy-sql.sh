#!/usr/bin/env bash
# รวม supabase/migrations/*.sql เป็นไฟล์เดียว deploy/01_install_database.sql (สำหรับวางใน Supabase SQL Editor)
set -euo pipefail
cd "$(dirname "$0")/.."
{
  echo "-- ====================================================================="
  echo "-- NU Safety Inspection — ติดตั้งฐานข้อมูลทั้งหมด (รวม migrations)"
  echo "-- วิธีใช้: Supabase → SQL Editor → New query → วางทั้งไฟล์ → Run (รันครั้งเดียว)"
  echo "-- ====================================================================="
  for f in supabase/migrations/*.sql; do echo; echo "-- >>>>>>>>>> $(basename "$f") >>>>>>>>>>"; cat "$f"; done
} > deploy/01_install_database.sql
echo "สร้าง deploy/01_install_database.sql แล้ว"
