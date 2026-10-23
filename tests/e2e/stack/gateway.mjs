// Local Supabase-compatible gateway for E2E tests (NOT for production).
//   /auth/v1/*    → Supabase Auth (GoTrue) binary
//   /rest/v1/*    → PostgREST binary
//   /storage/v1/* → minimal Storage emulator: every object operation runs as the
//                   caller (role + JWT claims) so the real storage.objects RLS policies apply.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const AUTH = process.env.AUTH_UPSTREAM ?? "http://127.0.0.1:9999";
const REST = process.env.REST_UPSTREAM ?? "http://127.0.0.1:3010";
const SECRET = process.env.JWT_SECRET;
const DATA_DIR = process.env.STORAGE_DIR ?? path.resolve("tests/e2e/.data/storage");
const pool = new pg.Pool({ connectionString: process.env.DB_URL });
fs.mkdirSync(DATA_DIR, { recursive: true });

const b64url = (b) => Buffer.from(b).toString("base64url");
function verifyJwt(token) {
  const [h, p, s] = (token ?? "").split(".");
  if (!s) return null;
  const sig = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  if (sig !== s) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}
function sign(payload) {
  const h = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64url(JSON.stringify(payload));
  return `${h}.${p}.${crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}

function proxy(req, res, upstream, strip) {
  const target = new URL(upstream);
  const r = http.request({
    hostname: target.hostname, port: target.port, method: req.method,
    path: req.url.replace(strip, "") || "/", headers: { ...req.headers, host: target.host },
  }, (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); });
  r.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(r);
}

async function asUser(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const role = ["authenticated", "service_role", "anon"].includes(claims?.role) ? claims.role : "anon";
    await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? { role: "anon" })]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { const ch = []; req.on("data", (d) => ch.push(d)); req.on("end", () => ok(Buffer.concat(ch))); });
const file = (bucket, name) => path.join(DATA_DIR, bucket, name.replace(/\.\.+/g, ""));

async function storage(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname.replace(/^\/storage\/v1/, "");
  const claims = verifyJwt((req.headers.authorization ?? "").replace(/^Bearer /, ""));
  try {
    // public objects
    let m = /^\/object\/public\/([^/]+)\/(.+)$/.exec(p);
    if (req.method === "GET" && m) {
      const [, bucket, name] = m;
      const pub = await asUser({ role: "service_role" }, (c) => c.query("select public from storage.buckets where id = $1", [bucket]));
      if (!pub.rows[0]?.public || !fs.existsSync(file(bucket, name))) return send(res, 404, { error: "not found" });
      res.writeHead(200); return fs.createReadStream(file(bucket, name)).pipe(res);
    }
    // signed download
    m = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(p);
    if (req.method === "GET" && m) {
      const t = verifyJwt(url.searchParams.get("token"));
      const [, bucket, name] = m;
      if (!t || t.url !== `${bucket}/${decodeURIComponent(name)}`) return send(res, 400, { error: "invalid signature" });
      const f = file(bucket, decodeURIComponent(name));
      if (!fs.existsSync(f)) return send(res, 404, { error: "not found" });
      const meta = await asUser({ role: "service_role" }, (c) => c.query("select metadata from storage.objects where bucket_id=$1 and name=$2", [bucket, decodeURIComponent(name)]));
      res.writeHead(200, { "content-type": meta.rows[0]?.metadata?.mimetype ?? "application/octet-stream" });
      return fs.createReadStream(f).pipe(res);
    }
    if (!claims) return send(res, 400, { statusCode: "403", error: "Unauthorized", message: "invalid jwt" });
    // create signed url(s) — requires SELECT permission through RLS
    if (req.method === "POST" && (m = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(p))) {
      const [, bucket, name] = m;
      const { expiresIn } = JSON.parse((await readBody(req)).toString() || "{}");
      const ok = await asUser(claims, (c) => c.query("select 1 from storage.objects where bucket_id=$1 and name=$2", [bucket, name]));
      if (!ok.rowCount) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
      const token = sign({ url: `${bucket}/${name}`, exp: Math.floor(Date.now() / 1000) + (expiresIn ?? 60) });
      return send(res, 200, { signedURL: `/object/sign/${bucket}/${encodeURI(name)}?token=${token}` });
    }
    if (req.method === "POST" && (m = /^\/object\/sign\/([^/]+)$/.exec(p))) {
      const [, bucket] = m;
      const { expiresIn, paths } = JSON.parse((await readBody(req)).toString() || "{}");
      const rows = await asUser(claims, (c) => c.query("select name from storage.objects where bucket_id=$1 and name = any($2)", [bucket, paths]));
      const allowed = new Set(rows.rows.map((r) => r.name));
      return send(res, 200, paths.map((n) => allowed.has(n)
        ? { path: n, error: null, signedURL: `/object/sign/${bucket}/${encodeURI(n)}?token=${sign({ url: `${bucket}/${n}`, exp: Math.floor(Date.now() / 1000) + (expiresIn ?? 60) })}` }
        : { path: n, error: "Either the object does not exist or you do not have access to it", signedURL: null }));
    }
    // upload (multipart form or raw body)
    if (req.method === "POST" && (m = /^\/object\/([^/]+)\/(.+)$/.exec(p))) {
      const [, bucket, nameEnc] = m;
      const name = decodeURIComponent(nameEnc);
      const raw = await readBody(req);
      let data = raw, mime = req.headers["content-type"] ?? "application/octet-stream";
      if (mime.startsWith("multipart/form-data")) {
        const fd = await new Request("http://x", { method: "POST", headers: { "content-type": mime }, body: raw }).formData();
        const f = [...fd.values()].find((v) => typeof v === "object");
        data = Buffer.from(await f.arrayBuffer()); mime = f.type || "application/octet-stream";
      }
      const b = await asUser({ role: "service_role" }, (c) => c.query("select file_size_limit, allowed_mime_types from storage.buckets where id=$1", [bucket]));
      if (!b.rowCount) return send(res, 400, { statusCode: "404", error: "Bucket not found" });
      if (b.rows[0].file_size_limit && data.length > b.rows[0].file_size_limit) return send(res, 400, { statusCode: "413", error: "Payload too large" });
      if (b.rows[0].allowed_mime_types && !b.rows[0].allowed_mime_types.includes(mime)) return send(res, 400, { statusCode: "415", error: "invalid_mime_type" });
      const id = await asUser(claims, (c) => c.query(
        "insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1,$2,$3,$4,$5) returning id",
        [bucket, name, claims.sub ?? null, claims.sub ?? null, { mimetype: mime, size: data.length }]));
      fs.mkdirSync(path.dirname(file(bucket, name)), { recursive: true });
      fs.writeFileSync(file(bucket, name), data);
      return send(res, 200, { Id: id.rows[0].id, Key: `${bucket}/${name}` });
    }
    // remove
    if (req.method === "DELETE" && (m = /^\/object\/([^/]+)$/.exec(p))) {
      const [, bucket] = m;
      const { prefixes } = JSON.parse((await readBody(req)).toString() || "{}");
      const del = await asUser(claims, (c) => c.query("delete from storage.objects where bucket_id=$1 and name = any($2) returning name", [bucket, prefixes]));
      del.rows.forEach((r) => fs.rmSync(file(bucket, r.name), { force: true }));
      return send(res, 200, del.rows.map((r) => ({ name: r.name })));
    }
    return send(res, 404, { error: "not implemented in emulator", path: p });
  } catch (e) {
    const rls = /row-level security|permission denied/.test(String(e.message));
    return send(res, 400, { statusCode: rls ? "403" : "500", error: rls ? "Unauthorized" : "Error", message: e.message });
  }
}

http.createServer((req, res) => {
  if (req.url.startsWith("/auth/v1")) return proxy(req, res, AUTH, /^\/auth\/v1/);
  if (req.url.startsWith("/rest/v1")) return proxy(req, res, REST, /^\/rest\/v1/);
  if (req.url.startsWith("/storage/v1")) return storage(req, res);
  send(res, 404, { error: "unknown route" });
}).listen(PORT, "127.0.0.1", () => console.log(`gateway on :${PORT}`));

export { sign };
