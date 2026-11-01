from html.parser import HTMLParser
from pathlib import Path
import subprocess
import tempfile
import re

class InlineScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inline = []
        self.ids = set()
        self.current = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids.add(attrs["id"])
        if tag.lower() == "script" and not attrs.get("src"):
            self.current = []

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "script" and self.current is not None:
            self.inline.append("".join(self.current))
            self.current = None

parser = InlineScripts()
parser.feed(Path("index.html").read_text(encoding="utf-8"))
if not parser.inline:
    raise SystemExit("No inline JavaScript found in index.html")

with tempfile.TemporaryDirectory() as tmp:
    for index, source in enumerate(parser.inline, start=1):
        path = Path(tmp) / f"inline-{index}.js"
        path.write_text(source, encoding="utf-8")
        subprocess.run(["node", "--check", str(path)], check=True)

combined = "\n".join(parser.inline)
referenced = set(re.findall(r"""getElementById\(\s*['"]([^'"]+)['"]\s*\)""", combined))
missing = sorted(referenced - parser.ids)
if missing:
    raise SystemExit("Missing HTML IDs referenced by JavaScript: " + ", ".join(missing))
print(f"JavaScript syntax and DOM ID checks passed for {len(parser.inline)} inline script(s).")

# Guard key offline/sync behaviours against accidental removal.
required_behaviours = {
    "stock edits create an audit entry": "Stock quantity changed while editing product",
    "stock adjustments are queued for cloud sync": "item.type==='stock_adjustment'",
    "stock adjustments are loaded from the cloud": "from('stock_adjustments').select(",
    "offline navigation falls back to the cached app": "return (await cache.match('./index.html'))",
    "reconnection triggers pending sync": "window.addEventListener('online'",
    "failed sync keeps pending changes": "Your local copies are kept.",
}
missing_behaviours = [
    label for label, marker in required_behaviours.items()
    if marker not in combined and marker not in Path("sw.js").read_text(encoding="utf-8")
]
if missing_behaviours:
    raise SystemExit("Missing critical behaviours: " + ", ".join(missing_behaviours))
print(f"Critical offline/sync behaviour checks passed ({len(required_behaviours)} checks).")

# Guard marketplace publishing, accessibility and security configuration.
index_html = Path("index.html").read_text(encoding="utf-8")
required_markers = {
    "Buybook images require an active listing": "eq('is_active',true).maybeSingle()",
    "failed Buybook image publishing cleans up the uploaded file": "Could not clean up an unpublished marketplace image",
    "keyboard users can skip to main content": 'href="#mainContent"',
    "reduced-motion preference is respected": "prefers-reduced-motion:reduce",
}
missing_markers = [label for label, marker in required_markers.items() if marker not in index_html]
if missing_markers:
    raise SystemExit("Missing marketplace/accessibility safeguards: " + ", ".join(missing_markers))

# A browser-delivered app must never contain a Supabase service-role or secret key.
if re.search(r"service_role|sb_secret_[A-Za-z0-9_]+", index_html, re.IGNORECASE):
    raise SystemExit("A privileged Supabase key must never be included in the browser app.")

# Verify baseline response headers remain configured in Vercel.
import json
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
print(f"Marketplace, accessibility and security checks passed ({len(required_markers) + len(required_headers) + 1} checks).")
