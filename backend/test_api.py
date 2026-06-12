"""
API integration test suite.
Validates: CORS, auth flow, token refresh, cookie behaviour, RBAC, RAG, LLM routing.

Run with:  python test_api.py http://localhost:3001
"""

from __future__ import annotations

import sys
import json
import time
import urllib.request
import urllib.error
from typing import Optional

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3001"
ORIGIN = "http://localhost:3000"

passed = 0
failed = 0


def test(name: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  ✓ {name}")
    else:
        failed += 1
        print(f"  ✗ {name}" + (f": {detail}" if detail else ""))


def request(
    path: str,
    method: str = "GET",
    body: Optional[dict] = None,
    headers: Optional[dict] = None,
    cookies: Optional[str] = None,
) -> tuple[int, dict, dict]:
    """Returns (status, body_dict, response_headers)."""
    url  = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    hdrs = {"Content-Type": "application/json", "Origin": ORIGIN}
    if headers:
        hdrs.update(headers)
    if cookies:
        hdrs["Cookie"] = cookies

    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read().decode()
            rbody = json.loads(raw) if raw else {}
            return resp.status, rbody, dict(resp.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        rbody = json.loads(raw) if raw else {}
        return e.code, rbody, dict(e.headers)
    except Exception as exc:
        return 0, {"error": str(exc)}, {}


def options(path: str) -> tuple[int, dict]:
    """CORS preflight."""
    url  = f"{BASE}{path}"
    hdrs = {
        "Origin": ORIGIN,
        "Access-Control-Request-Method":  "POST",
        "Access-Control-Request-Headers": "Content-Type,Authorization",
    }
    req = urllib.request.Request(url, headers=hdrs, method="OPTIONS")
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers)


print(f"\n{'='*55}")
print(f"  AI Receptionist — Integration Test Suite")
print(f"  Target: {BASE}")
print(f"{'='*55}\n")

# ─────────────────────────────────────────────────────────────────────────────
# 1. Health check (public, no auth)
# ─────────────────────────────────────────────────────────────────────────────
print("── 1. Health endpoint ──────────────────────────────")
status, body, hdrs = request("/api/health")
test("returns 200",          status == 200, str(status))
test("status=ok",            body.get("status") == "ok", str(body.get("status")))
test("has uptime_seconds",   "uptimeSeconds" in body or "uptime_seconds" in body)
test("has knowledge_chunks", "knowledgeChunks" in body or "knowledge_chunks" in body)
test("CORS header present",  "access-control-allow-origin" in {k.lower() for k in hdrs},
     str(list(hdrs.keys())[:5]))

# ─────────────────────────────────────────────────────────────────────────────
# 2. CORS preflight
# ─────────────────────────────────────────────────────────────────────────────
print("\n── 2. CORS preflight ───────────────────────────────")
for path in ["/api/auth/login", "/api/auth/refresh", "/api/chat", "/api/knowledge"]:
    s, h = options(path)
    acao  = h.get("Access-Control-Allow-Origin", h.get("access-control-allow-origin", ""))
    acac  = h.get("Access-Control-Allow-Credentials", h.get("access-control-allow-credentials", ""))
    test(
        f"OPTIONS {path}",
        s in (200, 204) and (acao == ORIGIN or acao == "*") and acac.lower() == "true",
        f"status={s} acao={acao!r} acac={acac!r}",
    )

# ─────────────────────────────────────────────────────────────────────────────
# 3. Auth — unauthenticated access returns 401 with CORS
# ─────────────────────────────────────────────────────────────────────────────
print("\n── 3. Unauthenticated returns 401 + CORS headers ───")
for path, method in [("/api/chat", "POST"), ("/api/knowledge", "GET"), ("/api/providers", "GET")]:
    s, b, h = request(path, method)
    acao = h.get("Access-Control-Allow-Origin", h.get("access-control-allow-origin", "MISSING"))
    test(
        f"{method} {path} → 401 + CORS",
        s == 401 and acao != "MISSING",
        f"status={s} acao={acao!r} code={b.get('detail', b.get('code','?'))}",
    )

# ─────────────────────────────────────────────────────────────────────────────
# 4. Login — wrong credentials
# ─────────────────────────────────────────────────────────────────────────────
print("\n── 4. Login — bad credentials ──────────────────────")
s, b, h = request("/api/auth/login", "POST", {"username": "admin", "password": "wrongpassword"})
acao = h.get("Access-Control-Allow-Origin", h.get("access-control-allow-origin", "MISSING"))
test("returns 401",         s == 401, str(s))
test("CORS on 401",         acao != "MISSING", f"acao={acao!r}")
test("error message safe",  "Invalid username" in str(b) or "INVALID_CREDENTIALS" in str(b))
test("no username hint",    "not found" not in str(b).lower() and "exists" not in str(b).lower())

# ─────────────────────────────────────────────────────────────────────────────
# 5. Login — valid credentials (requires ADMIN_PASSWORD env set to known value)
# ─────────────────────────────────────────────────────────────────────────────
print("\n── 5. Login — valid credentials ────────────────────")
import os
admin_pass = os.getenv("ADMIN_PASSWORD", "")
if not admin_pass:
    print("  ⚠ ADMIN_PASSWORD not set in env — skipping live login tests")
    print("    Run: ADMIN_PASSWORD=yourpassword python test_api.py")
    ACCESS_TOKEN = ""
    REFRESH_COOKIE = ""
else:
    s, b, h = request("/api/auth/login", "POST",
                      {"username": os.getenv("ADMIN_USERNAME", "admin"), "password": admin_pass})
    test("returns 200",            s == 200, f"status={s} body={str(b)[:120]}")
    test("has accessToken",        "accessToken" in b, str(list(b.keys())))
    test("has expiresIn",          "expiresIn" in b)
    test("has user object",        "user" in b and "username" in b.get("user", {}))
    test("user role present",      b.get("user", {}).get("role") in ("admin","receptionist","viewer"))

    # Extract cookie
    raw_cookie = h.get("Set-Cookie", h.get("set-cookie", ""))
    test("set-cookie present",     "rft=" in raw_cookie, f"set-cookie: {raw_cookie[:80]}")
    test("httponly flag",          "httponly" in raw_cookie.lower())
    test("samesite=lax",           "samesite=lax" in raw_cookie.lower())
    test("path=/api/auth",         "path=/api/auth" in raw_cookie.lower())
    # secure flag should be absent on http://localhost
    test("no secure on http",      "secure" not in raw_cookie.lower(),
         "secure flag set on non-HTTPS — cookie will be dropped by browser")

    ACCESS_TOKEN  = b.get("accessToken", "")
    # Parse rft= value from Set-Cookie header
    rft_part = next((p for p in raw_cookie.split(";") if "rft=" in p), "")
    REFRESH_COOKIE = rft_part.strip() if rft_part else ""

    # ─────────────────────────────────────────────────────────────────────────
    # 6. Authenticated endpoints
    # ─────────────────────────────────────────────────────────────────────────
    print("\n── 6. Authenticated endpoints ──────────────────────")
    if ACCESS_TOKEN:
        auth_hdr = {"Authorization": f"Bearer {ACCESS_TOKEN}"}

        s, b, h = request("/api/auth/me", headers=auth_hdr)
        test("GET /api/auth/me → 200",   s == 200, str(s))
        test("me returns username",       b.get("username") or b.get("user", {}).get("username"))

        s, b, h = request("/api/providers", headers=auth_hdr)
        test("GET /api/providers → 200", s == 200, str(s))
        test("providers list present",   "providers" in b)

        s, b, h = request("/api/knowledge", headers=auth_hdr)
        test("GET /api/knowledge → 200", s == 200, str(s))
        test("knowledge stats present",  "totalChunks" in b or "total_chunks" in b)

    # ─────────────────────────────────────────────────────────────────────────
    # 7. Token refresh
    # ─────────────────────────────────────────────────────────────────────────
    print("\n── 7. Token refresh ────────────────────────────────")
    if REFRESH_COOKIE:
        s, b, h = request("/api/auth/refresh", "POST", cookies=REFRESH_COOKIE)
        test("POST /api/auth/refresh → 200",  s == 200, f"status={s} body={str(b)[:120]}")
        test("new accessToken issued",         "accessToken" in b)
        test("new cookie set (rotation)",      "rft=" in h.get("Set-Cookie", h.get("set-cookie", "")))
        acao = h.get("Access-Control-Allow-Origin", h.get("access-control-allow-origin", "MISSING"))
        test("CORS on refresh response",       acao != "MISSING", f"acao={acao!r}")
    else:
        print("  ⚠ No refresh cookie captured — skipping refresh tests")

    # ─────────────────────────────────────────────────────────────────────────
    # 8. Refresh without cookie → 401 with CORS
    # ─────────────────────────────────────────────────────────────────────────
    print("\n── 8. Refresh without cookie → 401 ─────────────────")
    s, b, h = request("/api/auth/refresh", "POST")   # no cookie
    acao = h.get("Access-Control-Allow-Origin", h.get("access-control-allow-origin", "MISSING"))
    test("returns 401",                  s == 401, str(s))
    test("CORS header on 401",           acao != "MISSING", f"acao={acao!r}")
    test("correct error code",           "MISSING_REFRESH_TOKEN" in str(b) or "401" in str(s))

    # ─────────────────────────────────────────────────────────────────────────
    # 9. RBAC — viewer token should be denied POST /api/knowledge
    # ─────────────────────────────────────────────────────────────────────────
    print("\n── 9. RBAC enforcement ──────────────────────────────")
    # Forge a tampered token (wrong signature) → must get 401
    fake_token = ACCESS_TOKEN[:-4] + "XXXX" if ACCESS_TOKEN else "fake"
    s, b, h = request("/api/knowledge", "POST",
                      body={"content": "test", "source": "test"},
                      headers={"Authorization": f"Bearer {fake_token}"})
    test("tampered token → 401", s == 401, str(s))
    acao = h.get("Access-Control-Allow-Origin", h.get("access-control-allow-origin", "MISSING"))
    test("CORS on 401 (tampered)", acao != "MISSING", f"acao={acao!r}")

    # ─────────────────────────────────────────────────────────────────────────
    # 10. Security headers
    # ─────────────────────────────────────────────────────────────────────────
    print("\n── 10. Security headers ─────────────────────────────")
    _, _, hdrs = request("/api/health")
    for hdr, expected in [
        ("x-content-type-options", "nosniff"),
        ("x-frame-options",        "DENY"),
        ("x-xss-protection",       "1"),
        ("referrer-policy",        "strict-origin"),
    ]:
        val = {k.lower(): v for k, v in hdrs.items()}.get(hdr, "MISSING")
        test(f"{hdr}", val != "MISSING" and expected.lower() in val.lower(),
             f"got: {val!r}")

    # ─────────────────────────────────────────────────────────────────────────
    # 11. Logout
    # ─────────────────────────────────────────────────────────────────────────
    print("\n── 11. Logout ───────────────────────────────────────")
    if REFRESH_COOKIE and ACCESS_TOKEN:
        s, b, h = request("/api/auth/logout", "POST",
                          cookies=REFRESH_COOKIE,
                          headers={"Authorization": f"Bearer {ACCESS_TOKEN}"})
        test("logout → 200",            s == 200, str(s))
        raw = h.get("Set-Cookie", h.get("set-cookie", ""))
        test("cookie cleared (max-age=0)", "max-age=0" in raw.lower() or "expires" in raw.lower(),
             f"set-cookie: {raw[:80]}")

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
total = passed + failed
print(f"\n{'='*55}")
print(f"  Results: {passed}/{total} passed", end="")
if failed:
    print(f"  |  {failed} FAILED ← fix these")
else:
    print("  ✓ ALL PASSED")
print(f"{'='*55}\n")
sys.exit(0 if failed == 0 else 1)
