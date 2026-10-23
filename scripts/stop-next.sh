#!/usr/bin/env bash
# หยุด Next.js ที่รันจากโฟลเดอร์นี้ (ใช้ในการทดสอบ)
for p in $(pgrep -x node; pgrep -f next-server); do
  if tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -qE "next (dev|start)|next-server"; then kill "$p" 2>/dev/null; fi
done
exit 0
