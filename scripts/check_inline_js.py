from html.parser import HTMLParser
from pathlib import Path
import subprocess
import tempfile

class InlineScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inline = []
        self.current = None
    def handle_starttag(self, tag, attrs):
        if tag.lower() == "script" and not dict(attrs).get("src"):
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
print(f"JavaScript syntax check passed for {len(parser.inline)} inline script(s).")
