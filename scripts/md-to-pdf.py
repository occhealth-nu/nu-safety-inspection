#!/usr/bin/env python3
"""แปลงคู่มือ Markdown ภาษาไทยเป็น PDF (ฟอนต์ Sarabun) — ใช้: python3 scripts/md-to-pdf.py docs/X.md docs/X.pdf"""
import subprocess, sys, tempfile, json
from pathlib import Path
import markdown

src, out = Path(sys.argv[1]), Path(sys.argv[2])
body = markdown.markdown(src.read_text(encoding="utf-8"), extensions=["tables", "fenced_code", "sane_lists"])
html = f"""<!doctype html><html lang="th"><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 16mm 14mm 18mm; }}
body {{ font-family: 'SarabunAll', 'Sarabun', sans-serif; font-size: 11.5pt; line-height: 1.65; color: #1f2933; }}
h1 {{ color: #F26F21; font-size: 21pt; line-height: 1.6; border-bottom: 3px solid #F26F21; padding-bottom: 4px; }}
h2 {{ color: #2F3337; font-size: 15pt; line-height: 1.6; margin-top: 18px; padding: 4px 10px; background: #FFF1E8; border-left: 5px solid #F26F21; break-after: avoid; }}
h3 {{ font-size: 12.5pt; line-height: 1.6; margin-bottom: 2px; break-after: avoid; }}
table {{ border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 10.5pt; break-inside: auto; }}
th, td {{ border: 1px solid #c9ced4; padding: 4px 7px; vertical-align: top; }}
th {{ background: #2F3337; color: #fff; text-align: left; }}
tr {{ break-inside: avoid; }}
code {{ font-family: 'DejaVu Sans Mono', monospace; font-size: 9.5pt; background: #f2f4f6; padding: 0 3px; border-radius: 3px; }}
pre {{ background: #f2f4f6; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; break-inside: avoid; }}
pre code {{ background: none; }}
blockquote {{ margin: 8px 0; padding: 6px 12px; background: #FFF8E1; border-left: 4px solid #F2B705; }}
hr {{ border: none; border-top: 1px solid #e3e6ea; margin: 14px 0; }}
li {{ margin: 2px 0; }}
</style></head><body>{body}</body></html>"""
with tempfile.TemporaryDirectory() as d:
    h = Path(d) / "doc.html"; h.write_text(html, encoding="utf-8")
    js = f"""const {{ chromium }} = require('playwright');
(async () => {{ const b = await chromium.launch(); const p = await b.newPage();
  await p.goto({json.dumps(h.as_uri())}); await p.waitForLoadState('networkidle');
  await p.pdf({{ path: {json.dumps(str(out.resolve()))}, format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-size:8px;color:#777;padding:0 14mm;display:flex;justify-content:space-between;font-family:SarabunAll"><span>NU Safety Inspection — {src.stem}</span><span><span class=pageNumber></span>/<span class=totalPages></span></span></div>',
    margin: {{ top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' }} }});
  await b.close(); }})();"""
    subprocess.run(["node", "-e", js], check=True)
print("สร้าง", out)
