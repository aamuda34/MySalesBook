/* Sellbook seller-side view of private Buybook location sessions. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TILE_URL = window.SELLBOOK_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  let client = null;
  let userId = null;
  let channel = null;
  let map = null;
  let shopMarker = null;
  let buyerMarkers = new Map();
  let focusedLocationId = null;
  let currentShop = null;
  let currentRows = [];
  let refreshTimer = null;

  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);

  function notify(message) {
    if (typeof showToast === "function") showToast(message, "info");
  }

  function distanceMetres(a, b) {
    if (!a || !b) return null;
    const rad = (v) => v * Math.PI / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function relativeTime(value) {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    if (!Number.isFinite(seconds)) return "time unavailable";
    if (seconds < 10) return "just now";
    if (seconds < 60) return seconds + " seconds ago";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
    const hours = Math.floor(minutes / 60);
    return hours + (hours === 1 ? " hour ago" : " hours ago");
  }

  function shopHasPin(shop) {
    return shop && Number.isFinite(Number(shop.latitude)) && Number.isFinite(Number(shop.longitude)) &&
      shop.latitude !== null && shop.longitude !== null &&
      Math.abs(Number(shop.latitude)) <= 90 && Math.abs(Number(shop.longitude)) <= 180;
  }

  function cardMessage(message, kind) {
    const el = $("sellbook-location-message");
    if (!el) return;
    el.textContent = message || "";
    el.dataset.kind = kind || "info";
  }

  function initialiseMap() {
    const node = $("sellbook-location-map");
    if (!node || !shopHasPin(currentShop)) return;
    if (!window.L) {
      $("sellbook-location-map-wrap").hidden = true;
      cardMessage("The map service is unavailable right now. Location notifications and session checks will continue; refresh Home to retry the map.", "error");
      return;
    }
    if (!map) {
      map = L.map(node, { zoomControl: true, scrollWheelZoom: false })
        .setView([Number(currentShop.latitude), Number(currentShop.longitude)], 14);
      L.tileLayer(TILE_URL, {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
      }).addTo(map);
    } else {
      map.setView([Number(currentShop.latitude), Number(currentShop.longitude)], 14);
    }
    const shopIcon = L.divIcon({
      className: "sellbook-location-pin sellbook-location-pin-shop",
      html: "<span>SHOP</span>",
      iconSize: [44, 30],
      iconAnchor: [22, 15]
    });
    if (shopMarker) shopMarker.setLatLng([Number(currentShop.latitude), Number(currentShop.longitude)]);
    else shopMarker = L.marker([Number(currentShop.latitude), Number(currentShop.longitude)], { icon: shopIcon }).addTo(map);
    shopMarker.bindPopup(esc(currentShop.name || "Your shop"));
    window.setTimeout(() => map && map.invalidateSize(), 150);
  }

  function renderRows() {
    const list = $("sellbook-location-list");
    const mapWrap = $("sellbook-location-map-wrap");
    const badge = $("sellbook-location-count");
    if (!list || !currentShop) return;
    const validRows = currentRows.filter((row) =>
      row.status === "active" && new Date(row.expires_at).getTime() > Date.now());
    const freshRows = validRows.filter((row) => Date.now() - new Date(row.updated_at).getTime() <= 90000);
    if (badge) badge.textContent = String(freshRows.length);

    const shopPoint = shopHasPin(currentShop)
      ? { lat: Number(currentShop.latitude), lng: Number(currentShop.longitude) }
      : null;

    if (!validRows.length) {
      cardMessage("No customers are sharing their live location with your shop right now.");
      list.innerHTML = '<div class="sellbook-location-empty">When a Buybook customer chooses Locate shop, their live position will appear here. Other shops cannot see it.</div>';
    } else {
      cardMessage(freshRows.length
        ? freshRows.length + (freshRows.length === 1 ? " customer is sharing a live location with your shop." : " customers are sharing live locations with your shop.")
        : "Location updates are paused or stale. Buyers may have closed Buybook or lost GPS/network signal.");
      list.innerHTML = validRows.map((row) => {
        const age = Date.now() - new Date(row.updated_at).getTime();
        const fresh = age <= 90000;
        const point = { lat: Number(row.latitude), lng: Number(row.longitude) };
        const distance = fresh && shopPoint ? distanceMetres(shopPoint, point) : null;
        const distanceLabel = distance == null ? "" : (distance < 1000
          ? "about " + Math.round(distance) + " m straight-line"
          : "about " + (distance / 1000).toFixed(1) + " km straight-line");
        const accuracy = fresh && row.accuracy_m != null ? "GPS ±" + Math.round(Number(row.accuracy_m)) + " m" : "";
        const details = fresh
          ? ["Live", relativeTime(row.updated_at), distanceLabel, accuracy].filter(Boolean).join(" · ")
          : ["Signal paused", "Last update " + relativeTime(row.updated_at)].join(" · ");
        return '<button type="button" class="sellbook-location-row" data-focus-location="' + esc(row.id) + '"' +
          (fresh ? "" : ' aria-disabled="true"') + '><span class="sellbook-location-avatar" aria-hidden="true">●</span>' +
          '<span class="sellbook-location-row-copy"><strong>' +
          (row.buyer_type === "guest" ? "Guest buyer" : "Buybook customer") +
          '</strong><small>' + esc(details) + '</small></span><span class="sellbook-location-row-action">View map ›</span></button>';
      }).join("");
    }

    if (mapWrap) mapWrap.hidden = !shopHasPin(currentShop);
    if (shopHasPin(currentShop)) {
      initialiseMap();
      const liveIds = new Set(freshRows.map((row) => String(row.id)));
      buyerMarkers.forEach((marker, id) => {
        if (!liveIds.has(id)) {
          if (map) map.removeLayer(marker);
          buyerMarkers.delete(id);
        }
      });
      freshRows.forEach((row) => {
        const id = String(row.id);
        const coords = [Number(row.latitude), Number(row.longitude)];
        let marker = buyerMarkers.get(id);
        if (!marker) {
          const icon = L.divIcon({
            className: "sellbook-location-pin sellbook-location-pin-buyer",
            html: '<span class="sellbook-location-pin-dot"></span>',
            iconSize: [28, 28],
            iconAnchor: [14, 14]
          });
          marker = L.marker(coords, { icon }).addTo(map);
          buyerMarkers.set(id, marker);
        } else {
          marker.setLatLng(coords);
        }
        const label = row.buyer_type === "guest" ? "Guest buyer" : "Buybook customer";
        marker.bindPopup("<strong>" + label + "</strong><br>Updated " + esc(relativeTime(row.updated_at)));
      });
      const focusedRow = focusedLocationId
        ? freshRows.find((row) => String(row.id) === String(focusedLocationId))
        : null;
      if (focusedRow) {
        map.setView([Number(focusedRow.latitude), Number(focusedRow.longitude)], Math.max(map.getZoom(), 16));
      } else {
        focusedLocationId = null;
        const points = [[Number(currentShop.latitude), Number(currentShop.longitude)]]
          .concat(freshRows.map((row) => [Number(row.latitude), Number(row.longitude)]));
        if (points.length > 1) map.fitBounds(L.latLngBounds(points).pad(0.18), { maxZoom: 15 });
        else map.setView(points[0], 14);
      }
    }
  }

  async function refreshSessions() {
    if (!client || !userId || !currentShop || !currentShop.is_connected || !currentShop.is_active) return;
    const { data, error } = await client.from("marketplace_location_sessions")
      .select("id,buyer_id,buyer_type,latitude,longitude,accuracy_m,heading_deg,speed_mps,started_at,updated_at,expires_at,status")
      .eq("owner_id", userId)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) {
      cardMessage("Live customer locations are temporarily unavailable. Check your connection and retry.", "error");
      console.warn("Sellbook could not load Buybook location sessions", error);
      return;
    }
    currentRows = data || [];
    renderRows();
  }

  function stopChannel() {
    if (channel && client) client.removeChannel(channel).catch(() => {});
    channel = null;
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = null;
  }

  async function setSeller(user) {
    const card = $("sellbook-live-location-card");
    if (!card) return;
    stopChannel();
    userId = user && !user.is_anonymous ? user.id : null;
    currentShop = null;
    currentRows = [];
    focusedLocationId = null;
    if (map) {
      map.remove();
      map = null;
      shopMarker = null;
      buyerMarkers.clear();
    }
    if (!userId) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    cardMessage("Checking your Buybook shop connection…");
    const { data, error } = await client.from("marketplace_shops")
      .select("owner_id,name,is_connected,is_active,latitude,longitude")
      .eq("owner_id", userId).maybeSingle();
    if (error) {
      cardMessage("Your shop connection could not be checked. Please retry.", "error");
      return;
    }
    currentShop = data || null;
    if (!currentShop || !currentShop.is_connected || !currentShop.is_active) {
      cardMessage("Connect or reconnect your shop to Buybook to receive private customer location updates.");
      $("sellbook-location-list").innerHTML = '<div class="sellbook-location-empty">Open Sellbook Settings → Connect to Buybook, confirm your shop details and save the shop location.</div>';
      $("sellbook-location-map-wrap").hidden = true;
      return;
    }
    if (!shopHasPin(currentShop)) {
      cardMessage("Your shop is connected, but its map pin is missing. Update the shop location in Connect to Buybook.");
      $("sellbook-location-map-wrap").hidden = true;
    } else {
      cardMessage("Customers who choose Locate shop in Buybook will appear only here, for your shop.");
      initialiseMap();
    }
    await refreshSessions();
    channel = client.channel("sellbook-shop-location-" + userId)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "marketplace_location_sessions",
        filter: "owner_id=eq." + userId
      }, () => {
        refreshSessions().catch((e) => console.warn("Sellbook live location refresh failed", e));
      })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "app_notifications",
        filter: "recipient_id=eq." + userId
      }, (payload) => {
        if (payload.new && payload.new.kind === "buyer_locating_shop") {
          notify("A customer is sharing their live location with your shop.");
          if (typeof updateUnreadBadges === "function") updateUnreadBadges().catch(() => {});
          if (typeof currentPage === "function" && currentPage() === "notifications") {
            loadUserNotifications({ quiet: true });
          }
        }
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          cardMessage("Live updates are temporarily disconnected. The map will refresh when the connection returns.", "error");
        }
      });
    refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshSessions().catch((e) => console.warn("Sellbook location refresh failed", e));
    }, 25000);
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-focus-location]");
    if (!button || !map) return;
    const row = currentRows.find((item) => String(item.id) === String(button.dataset.focusLocation));
    if (!row || Date.now() - new Date(row.updated_at).getTime() > 90000) {
      cardMessage("This customer’s location signal is paused. The last precise position is not shown as live.");
      return;
    }
    focusedLocationId = String(row.id);
    map.setView([Number(row.latitude), Number(row.longitude)], 17);
    const marker = buyerMarkers.get(String(row.id));
    if (marker) marker.openPopup();
  });

  function init() {
    if (typeof supabaseClient === "undefined" || !supabaseClient) return;
    client = supabaseClient;
    client.auth.getSession().then(({ data, error }) => {
      if (!error) setSeller(data.session ? data.session.user : null);
    }).catch((error) => console.warn("Sellbook location status could not be restored", error));
    client.auth.onAuthStateChange((_event, session) => {
      Promise.resolve().then(() => setSeller(session ? session.user : null))
        .catch((error) => console.warn("Sellbook location account update failed", error));
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshSessions().catch(() => {});
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
