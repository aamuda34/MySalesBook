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
# Keep the production marketplace access-control changes reproducible in Git.
reservation_migration = Path("supabase/migrations/20261101101455_tighten_marketplace_reservation_access.sql").read_text(encoding="utf-8")
reservation_columns_migration = Path("supabase/migrations/20261101101525_limit_reservation_update_columns.sql").read_text(encoding="utf-8")
if "marketplace_reservations_owner_update" not in reservation_migration or "marketplace_reservation_items_buyer_insert" not in reservation_migration:
    raise SystemExit("Marketplace reservation RLS migration is incomplete.")
if "grant update (status, updated_at)" not in reservation_columns_migration:
    raise SystemExit("Marketplace reservation column-level update migration is incomplete.")
print(f"Marketplace, accessibility, security and asset-cache checks passed ({len(required_markers) + len(required_headers) + 5} checks).")

# Priority 3 product and stock integrity regression guards.
priority3_sql = Path("supabase/migrations/20261101010000_restock_stock_history_and_bounds.sql").read_text(encoding="utf-8")
priority3_checks = {
    "product creation enforces stock and monetary bounds": "stock>2000000000" in app_js and "enteredCost>MAX_MONEY" in app_js,
    "product editing enforces stock and monetary bounds": "stock>2000000000||cost>MAX_MONEY" in app_js,
    "sales enforce safe base-unit quantities": "baseQty>2000000000" in app_js,
    "restock prevents multiplication overflow before calculation": "purchaseQuantity>Math.floor(2000000000/unitsPerPurchase)" in app_js,
    "stock adjustment has a bounded quantity": "next>2000000000" in app_js,
    "restock history fetches persisted stock snapshots": "previous_stock,new_stock,restocked_at" in app_js,
    "restock history maps persisted before/after values": "previousStock:row.previous_stock" in app_js,
    "offline restocks remain in the durable queue": "item.type==='stock_restock'" in app_js and "enqueueChange('stock_restock'" in app_js,
    "multi-device product edits detect stale versions": "product changed on another phone" in app_js,
    "low-stock warnings use the saved threshold": "Number(p.stock)<=lowStockThreshold" in app_js,
    "product search and category filters are combined": "normalizeCategory(p.category)===selectedCategory" in app_js,
    "product photos load lazily": 'loading="lazy"' in app_js,
    "restock RPC uses bigint multiplication": "p_purchase_quantity::bigint * p_units_per_purchase::bigint" in priority3_sql,
    "restock history persists stock before and after": "previous_stock,new_stock" in priority3_sql,
    "restock RPC checks authenticated ownership": "auth.uid()" in priority3_sql and "user_id=v_user_id" in priority3_sql,
    "restock RPC execution is restricted to authenticated users": "to authenticated" in priority3_sql and "from public, anon" in priority3_sql,
}
failed_priority3 = [label for label, passed in priority3_checks.items() if not passed]
if failed_priority3:
    raise SystemExit("Priority 3 product/stock checks failed: " + "; ".join(failed_priority3))
if "'./stock-history-tabs.js'" not in service_worker:
    raise SystemExit("Stock history tabs controller is missing from the offline app shell.")
print(f"Priority 3 product, stock, history, offline, conflict and security checks passed ({len(priority3_checks) + 1} checks).")

# Priority 4 loading and background-request regression guards.
priority4_checks = {
    "product photo URLs are requested in bulk batches": "createSignedUrls(paths,3600)" in app_js,
    "product photo signing is bounded to batches of 100": "offset+=100" in app_js and "slice(offset,offset+100)" in app_js,
    "messenger polling is reduced without disabling refresh": "},12000);" in app_js and "refreshSelected:true" in app_js,
    "Buybook activity polling is reduced": "}},15000);" in app_js and "currentPage()==='settings-buybook'" in app_js,
    "admin chat polling is reduced": "currentPage()==='admin'" in app_js and "}},15000);" in app_js,
    "background unread polling is less frequent": "},30000);" in app_js and "updateUnreadBadges();" in app_js,
    "product images remain compressed before storage": "canvas.toDataURL('image/jpeg',0.68)" in app_js,
    "cached workspace is revealed before cloud refresh": "restoreCloudCache(user.id)" in app_js and "Showing your saved records while Sellbook checks" in app_js,
}
failed_priority4 = [label for label, passed in priority4_checks.items() if not passed]
if failed_priority4:
    raise SystemExit("Priority 4 loading/performance checks failed: " + "; ".join(failed_priority4))
print(f"Priority 4 loading and background-request checks passed ({len(priority4_checks)} checks).")



# Cloud history must be paged so Supabase's per-request row cap cannot hide older records.
history_paging_checks = {
    "cloud history uses a reusable paged loader": "async function fetchAllCloudRows(buildQuery,pageSize=500)" in app_js,
    "paged loader advances through complete pages": ".range(offset,offset+pageSize-1)" in app_js and "if(page.length<pageSize)break;" in app_js,
    "sales use deterministic paged ordering": ".order('sold_at').order('id')" in app_js,
    "expenses use deterministic paged ordering": ".order('spent_at').order('id')" in app_js,
    "stock adjustments use deterministic paged ordering": ".order('adjusted_at',{ascending:false}).order('id',{ascending:false})" in app_js,
    "restock history uses deterministic paged ordering": ".order('restocked_at',{ascending:false}).order('id',{ascending:false})" in app_js,
}
failed_history_paging = [label for label, passed in history_paging_checks.items() if not passed]
if failed_history_paging:
    raise SystemExit("Cloud history pagination checks failed: " + "; ".join(failed_history_paging))
print(f"Complete cloud history pagination checks passed ({len(history_paging_checks)} checks).")

# Date-only values (for example, YYYY-MM-DD expense dates) must remain
# calendar dates in the seller's local timezone, not shift through UTC parsing.
if "if(/^\\d{4}-\\d{2}-\\d{2}$/.test(raw))" not in app_js:
    raise SystemExit("Date-only report values must be parsed without a UTC day shift.")
print("Local date-only report boundary regression check passed.")

# Priority 4/6 database lookup indexes are kept as a versioned migration.
fk_index_migration = Path("supabase/migrations/20261101200000_add_marketplace_and_stock_fk_indexes.sql").read_text(encoding="utf-8")
required_fk_indexes = [
    "marketplace_listings_owner_id_idx",
    "marketplace_messages_buyer_id_idx",
    "marketplace_reservation_items_product_id_idx",
    "marketplace_reservation_items_reservation_id_idx",
    "marketplace_reservations_buyer_id_idx",
    "marketplace_reservations_owner_id_idx",
    "stock_purchases_product_id_idx",
    "stock_purchases_user_id_idx",
]
missing_fk_indexes = [name for name in required_fk_indexes if name not in fk_index_migration]
if missing_fk_indexes:
    raise SystemExit("Missing foreign-key performance indexes: " + ", ".join(missing_fk_indexes))
print(f"Marketplace and stock foreign-key index migration checks passed ({len(required_fk_indexes)} indexes).")

# Reservation and message histories must not silently stop at arbitrary row limits.
messaging_history_checks = {
    "reservation history is fully paginated": "fetchAllCloudRows(()=>supabaseClient.from('marketplace_reservations')" in app_js,
    "reservation item lookups are chunked safely": "reservationIds.slice(offset,offset+100)" in app_js,
    "support conversation history is fully paginated": "fetchAllCloudRows(()=>supabaseClient.from('support_messages')" in app_js,
    "subscriber messenger history is fully paginated": "fetchAllCloudRows(()=>supabaseClient.from('marketplace_messages')" in app_js,
    "message pagination uses stable tie-break ordering": ".order('created_at',{ascending:true}).order('id',{ascending:true})" in app_js,
}
failed_messaging_history = [label for label, passed in messaging_history_checks.items() if not passed]
if failed_messaging_history:
    raise SystemExit("Reservation/messaging history checks failed: " + "; ".join(failed_messaging_history))
print(f"Reservation and messaging history pagination checks passed ({len(messaging_history_checks)} checks).")
# Reservation decision notification retries must be idempotent.
reservation_notification_migration = Path("supabase/migrations/20261101203000_make_reservation_notifications_idempotent.sql").read_text(encoding="utf-8")
reservation_notification_function = Path("supabase/functions/notify-reservation-decision/index.ts").read_text(encoding="utf-8")
if "app_notifications_reservation_kind_uidx" not in reservation_notification_migration or "reservation_id, kind" not in reservation_notification_migration:
    raise SystemExit("Reservation notification idempotency index is missing.")
if 'onConflict: "reservation_id,kind"' not in reservation_notification_function or "ignoreDuplicates: true" not in reservation_notification_function:
    raise SystemExit("Reservation notification function must safely ignore duplicate retries.")
print("Retry-safe reservation notification checks passed.")
