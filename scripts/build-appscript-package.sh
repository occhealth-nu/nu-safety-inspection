#!/usr/bin/env bash
# รวมชุด Google Sheets + Apps Script เป็น NU-Safety-AppsScript.zip — ใช้: bash scripts/build-appscript-package.sh <โฟลเดอร์ปลายทาง>
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-dist}"; P="$OUT/NU-Safety-AppsScript"
rm -rf "$P" "$OUT/NU-Safety-AppsScript.zip"; mkdir -p "$P/sql"
cp docs/APPS_SCRIPT_GUIDE_TH.pdf "$P/0_APPS_SCRIPT_GUIDE_TH.pdf"
cp docs/APPS_SCRIPT_GUIDE_TH.md  "$P/0_APPS_SCRIPT_GUIDE_TH.md"
cp apps-script/NU-Safety-Sheets-Template.xlsx apps-script/Code.gs "$P/"
cp deploy/RESET_delete_all_data.sql      "$P/sql/1_RESET_delete_all_data.sql"
cp deploy/01_install_database.sql        "$P/sql/2_install_database.sql"
cp deploy/02_starter_data.sql            "$P/sql/3_starter_data.sql"
cp deploy/10_first_admin_google.sql      "$P/sql/4_first_admin.sql"
cp deploy/11_create_import_key.sql       "$P/sql/5_create_import_key.sql"
cp deploy/00_check_database.sql          "$P/sql/6_check_database.sql"
cp deploy/12_upgrade_existing_system.sql "$P/sql/upgrade_existing_system.sql"
(cd "$OUT" && zip -qr NU-Safety-AppsScript.zip NU-Safety-AppsScript)
echo "สร้าง $OUT/NU-Safety-AppsScript.zip"
