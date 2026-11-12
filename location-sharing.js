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
  let shopAccuracyCircle = null;
  let buyerMarkers = new Map();
  let buyerAccuracyCircles = new Map();
  let focusedLocationId = null;
  let currentShop = null;
  let currentRows = [];
  let sellerSessionEpoch = 0;
  let locationRefreshRequestId = 0;
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

  function isFreshLocationTimestamp(value) {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return false;
    const age = Date.now() - timestamp;
    // Supabase timestamps are server-generated. Treat materially future-dated
    // values as clock skew rather than displaying them as live.
    return age >= -30000 && age <= 90000;
  }

  function relativeTime(value) {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp) || Date.now() - timestamp < -30000) return "time unavailable";
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
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

  function isLocationPageVisible() {
    const page = $("approaching-customers");
    return Boolean(page && !page.classList.contains("hidden"));
  }

  function setHomeApproachingCount(value) {
    const count = $("sellbook-approaching-count");
    if (count) count.textContent = String(value);
  }

  function initialiseMap() {
    const node = $("sellbook-location-map");
    if (!node || !shopHasPin(currentShop) || !isLocationPageVisible()) return;
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
    shopMarker.bindPopup(esc(currentShop.name || "Your shop") + (currentShop.location_confirmed_at ? " · seller-confirmed pin" : " · entrance not confirmed"));
    const shopAccuracy=Number(currentShop.location_accuracy_m);
    if(Number.isFinite(shopAccuracy)&&shopAccuracy>0&&shopAccuracy<=10000){
      if(shopAccuracyCircle)shopAccuracyCircle.setLatLng([Number(currentShop.latitude),Number(currentShop.longitude)]).setRadius(shopAccuracy);
      else shopAccuracyCircle=L.circle([Number(currentShop.latitude),Number(currentShop.longitude)],{
        radius:shopAccuracy,color:'#14532d',weight:1,opacity:.5,fillColor:'#14532d',fillOpacity:.07,interactive:false
      }).addTo(map);
    }else if(shopAccuracyCircle){
      map.removeLayer(shopAccuracyCircle);
      shopAccuracyCircle=null;
    }
    window.setTimeout(() => map && map.invalidateSize(), 150);
  }

  function renderRows() {
    const list = $("sellbook-location-list");
    const mapWrap = $("sellbook-location-map-wrap");
    const badge = $("sellbook-location-count");
    if (!list || !currentShop) return;
    const validRows = currentRows.filter((row) =>
      row.status === "active" && new Date(row.expires_at).getTime() > Date.now());
    const freshRows = validRows.filter((row) => isFreshLocationTimestamp(row.updated_at));
    if (badge) badge.textContent = String(freshRows.length);
    setHomeApproachingCount(freshRows.length);

    const shopPoint = shopHasPin(currentShop) && Boolean(currentShop.location_confirmed_at)
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
        const fresh = isFreshLocationTimestamp(row.updated_at);
        const point = { lat: Number(row.latitude), lng: Number(row.longitude) };
        const reportedAccuracy = Number(row.accuracy_m);
        const usefulAccuracy = Number.isFinite(reportedAccuracy) && reportedAccuracy > 0 && reportedAccuracy <= 100;
        const distance = fresh && shopPoint && usefulAccuracy ? distanceMetres(shopPoint, point) : null;
        const distanceLabel = distance == null
          ? (!shopPoint ? "distance hidden until the shop entrance pin is confirmed" : (usefulAccuracy ? "" : "distance unavailable · GPS accuracy too low or unknown"))
          : (distance < 1000 ? "about " + Math.round(distance) + " m straight-line" : "about " + (distance / 1000).toFixed(1) + " km straight-line");
        const accuracy = fresh
          ? (usefulAccuracy ? "GPS ±" + Math.round(reportedAccuracy) + " m" : (Number.isFinite(reportedAccuracy) && reportedAccuracy > 0 ? "GPS accuracy low · ±" + Math.round(reportedAccuracy) + " m" : "GPS accuracy unavailable"))
          : "";
        const details = fresh
          ? ["Live", relativeTime(row.updated_at), distanceLabel, accuracy].filter(Boolean).join(" · ")
          : ["Signal paused", "Last update " + relativeTime(row.updated_at)].join(" · ");
        const canFocus = fresh && usefulAccuracy && Boolean(window.L);
        return '<button type="button" class="sellbook-location-row" data-focus-location="' + esc(row.id) + '"' +
          (canFocus ? "" : ' disabled aria-disabled="true"') + '><span class="sellbook-location-avatar" aria-hidden="true">●</span>' +
          '<span class="sellbook-location-row-copy"><strong>' +
          (row.buyer_type === "guest" ? "Guest buyer" : "Buybook customer") +
          '</strong><small>' + esc(details) + '</small></span><span class="sellbook-location-row-action">' +
          (window.L ? "View map ›" : "Map unavailable") + '</span></button>';
      }).join("");
    }

    const mapAvailable = shopHasPin(currentShop) && Boolean(window.L);
    if (mapWrap) mapWrap.hidden = !mapAvailable;
    if (shopHasPin(currentShop) && !window.L) {
      cardMessage("The map service is unavailable right now. Customer location freshness and distance remain visible below; refresh Home to retry the map.", "error");
    }
    const mapNote=$("sellbook-location-map-note");
    if(mapNote){
      mapNote.textContent=(currentShop.location_confirmed_at
        ?"Green circle shows the shop pin’s recorded GPS accuracy; blue circles show buyer GPS accuracy. Distances are straight-line, not road distance."
        :"Caution: the saved shop pin has not been confirmed as the entrance. Customer distances are hidden. Circles show device-reported GPS accuracy.")+
        " Old or low-accuracy buyer readings are not plotted as precise positions.";
    }
    if (mapAvailable && isLocationPageVisible()) {
      initialiseMap();
      if (!map) return;
      const liveIds = new Set(freshRows.map((row) => String(row.id)));
      const mappableIds = new Set(freshRows.filter(row => Number.isFinite(Number(row.accuracy_m)) && Number(row.accuracy_m) > 0 && Number(row.accuracy_m) <= 100).map(row => String(row.id)));
      buyerMarkers.forEach((marker, id) => {
        if (!liveIds.has(id)) {
          if (map) map.removeLayer(marker);
          buyerMarkers.delete(id);
        }
      });
      buyerAccuracyCircles.forEach((circle,id)=>{
        if(!mappableIds.has(id)){
          if(map)map.removeLayer(circle);
          buyerAccuracyCircles.delete(id);
        }
      });
      freshRows.forEach((row) => {
        const id = String(row.id);
        const accuracy = Number(row.accuracy_m);
        if(!Number.isFinite(accuracy)||accuracy<=0||accuracy>100){
          const oldMarker=buyerMarkers.get(id);
          const oldCircle=buyerAccuracyCircles.get(id);
          if(oldMarker&&map)map.removeLayer(oldMarker);
          if(oldCircle&&map)map.removeLayer(oldCircle);
          buyerMarkers.delete(id);
          buyerAccuracyCircles.delete(id);
          return;
        }
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
        marker.bindPopup("<strong>" + label + "</strong><br>Updated " + esc(relativeTime(row.updated_at)) + "<br>GPS accuracy ±" + Math.round(accuracy) + " m");
        let circle=buyerAccuracyCircles.get(id);
        if(!circle){
          circle=L.circle(coords,{radius:accuracy,color:'#2872de',weight:1,opacity:.42,fillColor:'#2872de',fillOpacity:.08,interactive:false}).addTo(map);
          buyerAccuracyCircles.set(id,circle);
        }else circle.setLatLng(coords).setRadius(accuracy);
      });
      const focusedRow = focusedLocationId
        ? freshRows.find((row) => String(row.id) === String(focusedLocationId))
        : null;
      if (focusedRow) {
        map.setView([Number(focusedRow.latitude), Number(focusedRow.longitude)], Math.max(map.getZoom(), 16));
      } else {
        focusedLocationId = null;
        const accurateRows=freshRows.filter(row=>Number.isFinite(Number(row.accuracy_m))&&Number(row.accuracy_m)>0&&Number(row.accuracy_m)<=100);
        const points = [[Number(currentShop.latitude), Number(currentShop.longitude)]]
          .concat(accurateRows.map((row) => [Number(row.latitude), Number(row.longitude)]));
        if (points.length > 1) map.fitBounds(L.latLngBounds(points).pad(0.18), { maxZoom: 15 });
        else map.setView(points[0], 14);
      }
    }
  }

  async function refreshSessions() {
    if (!client || !userId || !currentShop || !currentShop.is_connected || !currentShop.is_active) return;
    const requestedUserId = userId;
    const requestEpoch = sellerSessionEpoch;
    const requestId = ++locationRefreshRequestId;
    if (!client || !requestedUserId || !currentShop || !currentShop.is_connected || !currentShop.is_active) return;
    const { data, error } = await client.from("marketplace_location_sessions")
      .select("id,buyer_id,buyer_type,latitude,longitude,accuracy_m,heading_deg,speed_mps,started_at,updated_at,expires_at,status")
      .eq("owner_id", requestedUserId)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("updated_at", { ascending: false })
      .limit(50);
    if (requestEpoch !== sellerSessionEpoch || requestedUserId !== userId ||
        requestId !== locationRefreshRequestId) return;
    if (error) {
      // Recompute freshness from the cached server timestamps even when the
      // network is down, so markers cannot remain live indefinitely.
      renderRows();
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
    const requestEpoch = ++sellerSessionEpoch;
    locationRefreshRequestId++;
    stopChannel();
    userId = user && !user.is_anonymous ? user.id : null;
    const requestedUserId = userId;
    currentShop = null;
    currentRows = [];
    focusedLocationId = null;
    setHomeApproachingCount("0");
    if ($("sellbook-location-list")) $("sellbook-location-list").innerHTML = "";
    if (map) {
      map.remove();
      map = null;
      shopMarker = null;
      shopAccuracyCircle = null;
      buyerMarkers.clear();
      buyerAccuracyCircles.clear();
    }
    if (!userId) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    cardMessage("Checking your Buybook shop connection…");
    const { data, error } = await client.from("marketplace_shops")
      .select("owner_id,name,is_connected,is_active,latitude,longitude,location_accuracy_m,location_captured_at,location_confirmed_at,location_source")
      .eq("owner_id", requestedUserId).maybeSingle();
    if (requestEpoch !== sellerSessionEpoch || requestedUserId !== userId) return;
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
      cardMessage(currentShop.location_confirmed_at
        ? "Customers who choose Locate shop in Buybook appear only here. Buyer distances are straight-line estimates."
        : "Customers who choose Locate shop in Buybook appear only here. Your saved pin is not yet confirmed as the entrance, so buyer distances are hidden.");
    }
    await refreshSessions();
    if (requestEpoch !== sellerSessionEpoch || requestedUserId !== userId) return;
    channel = client.channel("sellbook-shop-location-" + requestedUserId)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "marketplace_location_sessions",
        filter: "owner_id=eq." + requestedUserId
      }, () => {
        refreshSessions().catch((e) => console.warn("Sellbook live location refresh failed", e));
      })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "app_notifications",
        filter: "recipient_id=eq." + requestedUserId
      }, (payload) => {
        if (requestEpoch !== sellerSessionEpoch || requestedUserId !== userId) return;
        if (payload.new && payload.new.recipient_id === requestedUserId && payload.new.kind === "buyer_locating_shop") {
          notify("A customer is sharing their live location with your shop.");
          if (typeof updateUnreadBadges === "function") updateUnreadBadges().catch(() => {});
          if (typeof currentPage === "function" && currentPage() === "notifications") {
            loadUserNotifications({ quiet: true });
          }
        }
      })
      .subscribe((status) => {
        if (requestEpoch !== sellerSessionEpoch || requestedUserId !== userId) return;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          cardMessage("Live updates are temporarily disconnected. The map will refresh when the connection returns.", "error");
        }
      });
    refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshSessions().catch((e) => console.warn("Sellbook location refresh failed", e));
    }, 25000);
  }

  document.addEventListener("sellbook-page-shown", (event) => {
    if (event.detail && event.detail.page === "approaching-customers") {
      renderRows();
      if (map) window.setTimeout(() => map && map.invalidateSize(true), 180);
      refreshSessions().catch((error) => console.warn("Sellbook live location page refresh failed", error));
    }
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-focus-location]");
    if (!button || !map) return;
    const row = currentRows.find((item) => String(item.id) === String(button.dataset.focusLocation));
    if (!row || !isFreshLocationTimestamp(row.updated_at)) {
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
