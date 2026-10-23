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
