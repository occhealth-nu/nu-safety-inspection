#!/usr/bin/env bash
# เปิด stack ทดสอบในเครื่อง (ไม่ต้องใช้ Docker): PostgreSQL + Supabase Auth + PostgREST + Storage emulator
# ต้องมี: PostgreSQL 15+ ที่ :54322 (superuser postgres, trust), ไบนารี auth & postgrest ใน tests/e2e/stack/bin
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=tests/e2e/stack/bin
DATA="$(pwd)/tests/e2e/.data"
mkdir -p "$DATA"
# ความลับสำหรับ JWT ของ stack ทดสอบ (สุ่มครั้งแรกแล้วเก็บไว้ในเครื่อง — ไม่ใช่ค่าที่ใช้กับระบบจริง)
[ -f "$DATA/jwt_secret" ] || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$DATA/jwt_secret"
export JWT_SECRET="e2e-only-$(cat "$DATA/jwt_secret")"
PG="postgres://postgres@127.0.0.1:54322"
DB=nu_e2e
for p in "$DATA"/*.pid; do [ -f "$p" ] && kill "$(cat "$p")" 2>/dev/null || true; rm -f "$p"; done
pkill -x auth 2>/dev/null || true; pkill -x postgrest 2>/dev/null || true
sleep 1
psql "$PG/postgres" -qX -c "drop database if exists $DB with (force)" -c "create database $DB"
psql "$PG/$DB" -qX -v ON_ERROR_STOP=1 -f tests/db/shim/00_roles.sql >/dev/null 2>&1
psql "$PG/$DB" -qX -c "alter role supabase_auth_admin set search_path = auth" -c "grant all on database $DB to supabase_auth_admin" >/dev/null

# Supabase Auth (GoTrue) — สร้าง schema auth ด้วย migration ของตัวเอง
( cd $BIN && GOTRUE_API_HOST=127.0.0.1 PORT=9999 API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1 \
  GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin:auth_admin@127.0.0.1:54322/$DB" \
  GOTRUE_SITE_URL=http://localhost:3000 GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
  GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
  GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_DISABLE_SIGNUP=true GOTRUE_LOG_LEVEL=warn \
  GOTRUE_EXTERNAL_GOOGLE_ENABLED=true GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=e2e-dummy-client GOTRUE_EXTERNAL_GOOGLE_SECRET=e2e-dummy-secret \
  GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=http://127.0.0.1:54321/auth/v1/callback GOTRUE_URI_ALLOW_LIST="http://localhost:3000/**" \
  nohup ./auth > "$DATA/auth.log" 2>&1 & echo $! > "$DATA/auth.pid" )
for i in $(seq 1 40); do curl -sf http://127.0.0.1:9999/health >/dev/null && break; sleep 0.5; done
curl -sf http://127.0.0.1:9999/health >/dev/null || { echo "auth failed"; tail -20 $DATA/auth.log; exit 1; }
# รอให้ migration ของ Auth สร้างตาราง auth.users เสร็จ
for i in $(seq 1 60); do [ "$(psql "$PG/$DB" -XtAc "select to_regclass('auth.users') is not null")" = "t" ] && break; sleep 0.5; done
psql "$PG/$DB" -qX -c "grant usage on schema auth to postgres; grant select on auth.users to postgres" >/dev/null

psql "$PG/$DB" -qX -v ON_ERROR_STOP=1 -f tests/db/shim/02_storage.sql >/dev/null
for f in supabase/migrations/*.sql supabase/seed.sql; do psql "$PG/$DB" -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
echo "• database migrated + seeded"

PGRST_DB_URI="postgres://authenticator:authenticator@127.0.0.1:54322/$DB" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_PORT=3010 PGRST_SERVER_HOST=127.0.0.1 PGRST_DB_PRE_REQUEST= \
  nohup $BIN/postgrest > $DATA/postgrest.log 2>&1 &
echo $! > $DATA/postgrest.pid
DB_URL="postgres://authenticator:authenticator@127.0.0.1:54322/$DB" JWT_SECRET="$JWT_SECRET" STORAGE_DIR="$DATA/storage" \
  nohup node tests/e2e/stack/gateway.mjs > $DATA/gateway.log 2>&1 &
echo $! > $DATA/gateway.pid
for i in $(seq 1 40); do curl -s http://127.0.0.1:3010/ >/dev/null && curl -s http://127.0.0.1:54321/ >/dev/null && break; sleep 0.5; done

mk() { node -e '
const c=require("crypto");const s=process.argv[1];const b=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"}),p=b({role:process.argv[2],iss:"supabase",iat:1700000000,exp:2000000000});
console.log(h+"."+p+"."+c.createHmac("sha256",s).update(h+"."+p).digest("base64url"))' "$JWT_SECRET" "$1"; }
ANON=$(mk anon); SERVICE=$(mk service_role)
cat > .env.e2e <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=e2e-cron-secret
NEXT_PUBLIC_SSO_PROVIDER=google
ENV
echo "• stack up (gateway :54321) — keys in .env.e2e"
set -a; . ./.env.e2e; set +a
DEMO_PASSWORD="${DEMO_PASSWORD:-Demo-Only-Pass-2569}" node scripts/seed-demo.mjs
