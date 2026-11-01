from html.parser import HTMLParser
from pathlib import Path
import subprocess
import tempfile
import re
import json

class AppAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inline = []
        self.external = []
        self.ids = set()
        self.current = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        if tag.lower() == "script":
            if attrs.get("src"):
                self.external.append(attrs["src"])
            else:
                self.current = []

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "script" and self.current is not None:
            self.inline.append("".join(self.current))
            self.current = None

index_path = Path("index.html")
index_html = index_path.read_text(encoding="utf-8")
parser = AppAssets()
parser.feed(index_html)

if parser.inline:
    raise SystemExit("Application JavaScript should be maintained in app.js, not inline in index.html.")

local_scripts = []
for src in parser.external:
    if src.startswith(("http://", "https://", "//")):
        continue
    path = Path(src.removeprefix("./"))
    if not path.is_file():
        raise SystemExit(f"Referenced local script is missing: {src}")
    local_scripts.append((src, path.read_text(encoding="utf-8"), path))

if not local_scripts or not any(src.endswith("/app.js") or src == "./app.js" for src, _, _ in local_scripts):
    raise SystemExit("index.html must load the extracted ./app.js file.")

with tempfile.TemporaryDirectory() as tmp:
    for index, (src, source, path) in enumerate(local_scripts, start=1):
        check_path = Path(tmp) / f"script-{index}.js"
        check_path.write_text(source, encoding="utf-8")
        subprocess.run(["node", "--check", str(check_path)], check=True)

combined = "\n".join(source for _, source, _ in local_scripts)
referenced = set(re.findall(r"""getElementById\(\s*['"]([^'"]+)['"]\s*\)""", combined))
missing = sorted(referenced - parser.ids)
if missing:
    raise SystemExit("Missing HTML IDs referenced by JavaScript: " + ", ".join(missing))
print(f"External JavaScript syntax and DOM ID checks passed for {len(local_scripts)} local script(s).")

# Guard key offline/sync behaviours against accidental removal.
service_worker = Path("sw.js").read_text(encoding="utf-8")
required_behaviours = {
    "stock edits create an audit entry": "Stock quantity changed while editing product",
    "stock adjustments are queued for cloud sync": "item.type==='stock_adjustment'",
    "stock adjustments are loaded from the cloud": "from('stock_adjustments').select(",
    "offline navigation falls back to the cached app": "const cached = await cache.match('./index.html') || await cache.match('./')",
    "reconnection triggers pending sync": "window.addEventListener('online'",
    "failed sync keeps pending changes": "Your local copies are kept.",
}
missing_behaviours = [
    label for label, marker in required_behaviours.items()
    if marker not in combined and marker not in service_worker
]
if missing_behaviours:
    raise SystemExit("Missing critical behaviours: " + ", ".join(missing_behaviours))
print(f"Critical offline/sync behaviour checks passed ({len(required_behaviours)} checks).")

# Guard marketplace publishing, accessibility and security configuration.
styles = Path("styles.css").read_text(encoding="utf-8")
app_js = Path("app.js").read_text(encoding="utf-8")
required_markers = {
    "Buybook images require an active listing": "eq('is_active',true).maybeSingle()",
    "failed Buybook image publishing cleans up the uploaded file": "Could not clean up an unpublished marketplace image",
    "keyboard users can skip to main content": 'href="#mainContent"',
    "reduced-motion preference is respected": "prefers-reduced-motion:reduce",
}
asset_text = index_html + app_js + styles
missing_markers = [label for label, marker in required_markers.items() if marker not in asset_text]
if missing_markers:
    raise SystemExit("Missing marketplace/accessibility safeguards: " + ", ".join(missing_markers))

# A browser-delivered app must never contain a Supabase service-role or secret key.
config_text = Path("supabase-config.js").read_text(encoding="utf-8")
if re.search(r"service_role|sb_secret_[A-Za-z0-9_]+", index_html + app_js + config_text, re.IGNORECASE):
    raise SystemExit("A privileged Supabase key must never be included in the browser app.")

# Verify baseline response headers and offline caching of the extracted assets.
vercel_config = json.loads(Path("vercel.json").read_text(encoding="utf-8"))
header_text = json.dumps(vercel_config.get("headers", []))
required_headers = [
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Strict-Transport-Security",
    "Permissions-Policy",
]
missing_headers = [name for name in required_headers if name not in header_text]
if missing_headers:
    raise SystemExit("Missing required security headers: " + ", ".join(missing_headers))
for asset in ("'./app.js'", "'./styles.css'"):
    if asset not in service_worker:
        raise SystemExit(f"Extracted app asset is not included in the offline core shell: {asset}")
print(f"Marketplace, accessibility, security and asset-cache checks passed ({len(required_markers) + len(required_headers) + 3} checks).")
