/* Buybook live shop location sharing. Location is private to the selected shop owner. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TILE_URL = window.BUYBOOK_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  // performance.now() is monotonic and is not affected by device clock changes.
  function monotonicNow() {
    return window.performance && typeof window.performance.now === "function"
      ? window.performance.now()
      : Date.now();
  }
  let client = null;
  let sessionId = null;
  let watchId = null;
  let heartbeatId = null;
  let latestPosition = null;
  let lastSentAt = 0;
  let lastSentPosition = null;
  let map = null;
  let buyerMarker = null;
  let shopMarker = null;
  let routeLine = null;
  let accuracyCircle = null;
  let shopAccuracyCircle = null;
  let mapTilesReady = false;
  const MAX_SHARE_GPS_ACCURACY_METRES = 100;
  let routeMode = "foot";
  let routeRequestSequence = 0;
  let lastRoutedPosition = null;
  let lastRouteRequestedAt = 0;
  let lastRouteDistanceMetres = null;
  let activeContext = null;
  let startInProgress = false;
  let previewInProgress = false;
  let sessionExpiresAt = null;
  let lastPersistedUpdateAt = 0;

  function setStatus(message, isError) {
    const status = $("locate-status");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", !!isError);
  }

  function setBanner(visible, shopName) {
    const banner = $("location-sharing-banner");
    const label = $("location-sharing-label");
    if (!banner) return;
    banner.hidden = !visible;
    if (label) label.textContent = visible
      ? "Live location is being shared privately with " + (shopName || "one shop") + "."
      : "";
    const startButton = $("locate-start");
    const previewButton = $("locate-preview");
    const stopButton = $("locate-stop");
    if (startButton) startButton.hidden = visible;
    if (previewButton) previewButton.hidden = visible;
    if (stopButton) stopButton.hidden = !visible;
  }

  function getPosition(options) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("This browser cannot access GPS location. Please use a phone browser with location services enabled."));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, (error) => {
        const messages = {
          1: "Location permission was denied. Allow location access in your browser settings to locate this shop.",
          2: "Your phone could not determine its location. Turn on device location and try again.",
          3: "Getting your location took too long. Move to an open area and try again."
        };
        reject(new Error(messages[error.code] || "Your current location is unavailable."));
      }, options || { enableHighAccuracy: true, timeout: 18000, maximumAge: 3000 });
    });
  }

  function distanceMetres(a, b) {
    if (!a || !b) return Infinity;
    const radians = (value) => value * Math.PI / 180;
    const dLat = radians(b.lat - a.lat);
    const dLng = radians(b.lng - a.lng);
    const lat1 = radians(a.lat);
    const lat2 = radians(b.lat);
    const x = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function coordFromPosition(position) {
    const c = position.coords;
    return {
      lat: Number(c.latitude),
      lng: Number(c.longitude),
      accuracy: Number.isFinite(Number(c.accuracy)) ? Number(c.accuracy) : null,
      heading: c.heading != null && Number.isFinite(Number(c.heading)) &&
        Number(c.heading) >= 0 && Number(c.heading) < 360 ? Number(c.heading) : null,
      speed: c.speed != null && Number.isFinite(Number(c.speed)) &&
        Number(c.speed) >= 0 ? Number(c.speed) : null
    };
  }

  function formatDistance(metres) {
    if (!Number.isFinite(metres) || metres < 0) return "Distance unavailable";
    if (metres < 1000) {
      const rounded = metres < 100 ? Math.max(5, Math.round(metres / 5) * 5) : Math.round(metres / 10) * 10;
      return rounded + " m";
    }
    const km = metres / 1000;
    return (km < 10 ? km.toFixed(1) : Math.round(km).toString()) + " km";
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "";
    const minutes = Math.max(1, Math.round(seconds / 60));
    return "About " + minutes + " min " + (routeMode === "foot" ? "walk" : "drive");
  }

  function setRouteState(message, isError) {
    const node = $("location-route-state");
    if (node) {
      node.textContent = message || "";
      node.classList.toggle("is-error", Boolean(isError));
    }
  }

  function setRouteNote(message, isError) {
    const node = $("location-route-note");
    if (node) {
      node.textContent = message || "";
      node.classList.toggle("is-error", Boolean(isError));
    }
  }

  function updateDirectionsLink(position) {
    const directions = $("locate-directions");
    if (!directions || !activeContext) return;
    const lat = Number(activeContext.latitude);
    const lng = Number(activeContext.longitude);
    const destination = Number.isFinite(lat) && Number.isFinite(lng)
      ? lat + "," + lng
      : (activeContext.address || "");
    if (!destination) {
      directions.hidden = true;
      return;
    }
    if (!position || !Number.isFinite(Number(position.lat)) || !Number.isFinite(Number(position.lng))) {
      directions.hidden = true;
      return;
    }
    const origin = Number(position.lat) + "," + Number(position.lng);
    const mode = routeMode === "foot" ? "walking" : "driving";
    directions.href = "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(origin) +
      "&destination=" + encodeURIComponent(destination) + "&travelmode=" + mode;
    directions.hidden = false;
  }

  function updateRouteModeButtons() {
    document.querySelectorAll("[data-route-mode]").forEach((button) => {
      const selected = button.getAttribute("data-route-mode") === routeMode;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  function renderRouteSteps(steps, context) {
    const list = $("location-route-steps");
    if (!list) return;
    list.textContent = "";
    const useful = (Array.isArray(steps) ? steps : [])
      .filter((step) => step && step.maneuver && Number(step.distance || 0) >= 3)
      .slice(0, 6);
    if (!useful.length) {
      const item = document.createElement("li");
      item.textContent = "Follow the highlighted route towards " + (context.shopName || "the shop") + ".";
      list.appendChild(item);
      return;
    }
    useful.forEach((step, index) => {
      const maneuver = step.maneuver || {};
      const type = String(maneuver.type || "").toLowerCase();
      const modifier = String(maneuver.modifier || "").toLowerCase();
      const road = String(step.name || "").trim();
      let instruction;
      if (type === "depart") {
        instruction = "Start towards " + (road || "the highlighted route");
      } else if (type === "arrive") {
        instruction = "The route ends near the seller’s saved pin. Check the shop photo and entrance before stopping";
      } else if (type === "roundabout" || type === "rotary" || type === "roundabout turn") {
        instruction = "At the roundabout, take the " + (maneuver.exit ? "exit " + maneuver.exit : "appropriate exit");
        if (road) instruction += " onto " + road;
      } else if (type === "turn" || type === "continue" || type === "fork" || type === "merge" || type === "on ramp" || type === "off ramp" || type === "end of road" || type === "new name") {
        const action = modifier ? modifier.replace(/-/g," ") : "straight ahead";
        instruction = (type === "continue" ? "Continue " : type === "fork" ? "Keep " : "Turn ") + action;
        if (road) instruction += " onto " + road;
      } else {
        instruction = road ? "Continue on " + road : "Continue along the highlighted route";
      }
      const item = document.createElement("li");
      const distance = Number(step.distance);
      item.textContent = instruction + (Number.isFinite(distance) && distance > 0 ? " · " + formatDistance(distance) : "");
      list.appendChild(item);
    });
  }

  function fitMapToRoute(routeDistance) {
    if (!map) return;
    if (!Number.isFinite(Number(routeDistance))) routeDistance = lastRouteDistanceMetres == null ? 0 : lastRouteDistanceMetres;
    let bounds = null;
    if (routeLine && typeof routeLine.getBounds === "function") bounds = routeLine.getBounds();
    if ((!bounds || !bounds.isValid()) && buyerMarker && shopMarker) {
      bounds = L.latLngBounds([buyerMarker.getLatLng(), shopMarker.getLatLng()]);
    }
    if (bounds && bounds.isValid()) {
      const maxZoom = routeDistance < 120 ? 19 : routeDistance < 450 ? 18 : routeDistance < 1800 ? 17 : routeDistance < 5000 ? 16 : 14;
      map.fitBounds(bounds.pad(0.22), { maxZoom, animate: true });
    }
  }

  async function loadRoadRoute(position, force) {
    if (!map || !mapTilesReady || !position || !activeContext) {
      setRouteState("Map tiles are not ready", true);
      setRouteNote("The map has not loaded fully. Check your connection before requesting a route.", true);
      return false;
    }
    const shop = { lat: Number(activeContext.latitude), lng: Number(activeContext.longitude) };
    if (!Number.isFinite(shop.lat) || !Number.isFinite(shop.lng)) {
      setRouteState("Shop pin unavailable", true);
      setRouteNote("The seller has not saved a usable shop location. Contact the seller for directions.", true);
      return;
    }
    const now = Date.now();
    if (!force && lastRoutedPosition && distanceMetres(lastRoutedPosition, position) < 35 &&
        now - lastRouteRequestedAt < 30000) return;
    if (now - lastRouteRequestedAt < 1100) {
      window.setTimeout(() => loadRoadRoute(position, true), 1150 - (now - lastRouteRequestedAt));
      return;
    }

    const requestId = ++routeRequestSequence;
    lastRouteRequestedAt = Date.now();
    lastRoutedPosition = { lat: position.lat, lng: position.lng };
    setRouteState("Finding road route…");
    const distanceNode = $("location-route-distance");
    const etaNode = $("location-route-eta");
    if (distanceNode && !routeLine) distanceNode.textContent = "Calculating road distance…";
    if (etaNode) etaNode.textContent = "";

    const server = routeMode === "foot" ? "routed-foot" : "routed-car";
    const coordinates = position.lng.toFixed(6) + "," + position.lat.toFixed(6) + ";" +
      shop.lng.toFixed(6) + "," + shop.lat.toFixed(6);
    const url = "https://routing.openstreetmap.de/" + server +
      "/route/v1/driving/" + coordinates + "?overview=full&geometries=geojson&steps=true";
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        headers: { "Accept": "application/json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error("route_http_" + response.status);
      const payload = await response.json();
      if (requestId !== routeRequestSequence) return;
      const route = payload && payload.code === "Ok" && Array.isArray(payload.routes) ? payload.routes[0] : null;
      const coordinatesList = route && route.geometry && route.geometry.coordinates;
      if (!route || !Array.isArray(coordinatesList) || coordinatesList.length < 2) {
        throw new Error("route_not_found");
      }
      const latLngs = coordinatesList
        .filter((point) => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
        .map((point) => [Number(point[1]), Number(point[0])]);
      if (latLngs.length < 2) throw new Error("route_geometry_invalid");

      if (routeLine && map) map.removeLayer(routeLine);
      routeLine = L.polyline(latLngs, {
        color: "#6a3f9b",
        weight: 5,
        opacity: 0.92,
        lineCap: "round",
        lineJoin: "round"
      }).addTo(map);
      if (shopMarker) shopMarker.setZIndexOffset(700);
      if (buyerMarker) buyerMarker.setZIndexOffset(1000);

      const routeDistance = Number(route.distance);
      const duration = Number(route.duration);
      lastRouteDistanceMetres = routeDistance;
      if (distanceNode) distanceNode.textContent = formatDistance(routeDistance) + " (estimated road route)";
      if (etaNode) etaNode.textContent = formatDuration(duration) + " (estimate)";
      setRouteState("Estimated road route ready");
      const accuracyNode = $("location-route-accuracy");
      if (accuracyNode) {
        const accuracy = Number(position.accuracy);
        accuracyNode.textContent = Number.isFinite(accuracy)
          ? "Your GPS accuracy is about ±" + Math.round(accuracy) + " m. The blue dot can drift by this amount."
          : "Your blue dot shows your current GPS position.";
      }
      const legs = Array.isArray(route.legs) ? route.legs : [];
      const steps = legs.flatMap((leg) => Array.isArray(leg.steps) ? leg.steps : []);
      renderRouteSteps(steps, activeContext);
      const arrivalDistance = Math.max(20, Number(position.accuracy) || 0);
      if (routeDistance <= arrivalDistance) {
        setRouteNote("You are near the seller’s saved pin. GPS and map data can drift; check the shop-front photo, signboard and entrance before stopping.");
      } else {
        setRouteNote("Follow the estimated route. The destination is the seller’s saved pin, not an independently verified entrance. Check the shop photo when you get close.");
      }
      updateDirectionsLink(position);
      fitMapToRoute(routeDistance);
      return true;
    } catch (error) {
      if (requestId !== routeRequestSequence) return;
      console.warn("Buybook road route unavailable", error);
      setRouteState("Road route unavailable", true);
      if (routeLine && map) map.removeLayer(routeLine);
      routeLine = L.polyline([[position.lat, position.lng], [shop.lat, shop.lng]], {
        color: "#a69ab6",
        weight: 3,
        opacity: 0.75,
        dashArray: "4 8"
      }).addTo(map);
      lastRouteDistanceMetres = distanceMetres(position, shop);
      if (distanceNode) distanceNode.textContent = formatDistance(lastRouteDistanceMetres) + " straight-line only";
      if (etaNode) etaNode.textContent = "Unavailable";
      const steps = $("location-route-steps");
      if (steps) steps.innerHTML = "<li>No road directions are available from the inbuilt map right now.</li>";
      setRouteNote("The road route could not be calculated. This line and distance are straight-line only, not a road route. You can try Google Maps for an external route.", true);
      updateDirectionsLink(position);
      fitMapToRoute(distanceMetres(position, shop));
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function initMap(context, position) {
    const node = $("locate-map");
    const lat = Number(context.latitude);
    const lng = Number(context.longitude);
    if (!node || !window.L) {
      setStatus("The map could not load. Check your connection and try again.", true);
      return false;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setStatus("The seller has not saved a valid shop pin.", true);
      return false;
    }
    node.textContent = "";
    if (map) {
      map.remove();
      map = null;
    }
    buyerMarker = null;
    shopMarker = null;
    routeLine = null;
    accuracyCircle = null;
    shopAccuracyCircle = null;
    routeRequestSequence++;
    map = L.map(node, { zoomControl: true, scrollWheelZoom: false, dragging: true });
    mapTilesReady = false;
    const tileLayer=L.tileLayer(TILE_URL, {
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    });
    tileLayer.on("tileload",()=>{
      mapTilesReady=true;
      const getRoute=$("location-get-route");
      if(getRoute&&(getRoute.textContent==="Loading map…"||getRoute.textContent==="Map unavailable")){
        getRoute.disabled=false;
        getRoute.textContent="Get route from my location";
        setStatus("Shop map loaded. Your GPS will be requested only when you tap Get route.");
      }
    });
    tileLayer.addTo(map);
    const shopIcon = L.divIcon({
      className: "buybook-live-pin buybook-live-pin-shop",
      html: '<span class="buybook-shop-pin"><span></span></span>',
      iconSize: [24, 30],
      iconAnchor: [12, 30]
    });
    shopMarker = L.marker([lat, lng], { icon: shopIcon, riseOnHover: true })
      .addTo(map).bindPopup(context.shopName || "Seller’s saved shop pin").openPopup();
    const shopAccuracy = Number(context.locationAccuracy);
    if (Number.isFinite(shopAccuracy) && shopAccuracy > 0 && shopAccuracy <= 10000) {
      shopAccuracyCircle = L.circle([lat, lng], { radius: shopAccuracy, color: "#6a3f9b", weight: 1, opacity: 0.45, fillColor: "#6a3f9b", fillOpacity: 0.08, interactive: false }).addTo(map);
    }
    map.setView([lat, lng], 17);
    window.setTimeout(() => map && map.invalidateSize(), 120);
    return true;
  }

  function updateMap(position) {
    if (!map || !position) return;
    const buyerLatLng = [position.lat, position.lng];
    if (buyerMarker) buyerMarker.setLatLng(buyerLatLng);
    else if (window.L) {
      const icon = L.divIcon({
        className: "buybook-live-pin buybook-live-pin-buyer",
        html: '<span class="buybook-live-pin-dot"></span>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });
      buyerMarker = L.marker(buyerLatLng, { icon }).addTo(map).bindPopup("You are here");
    }
    if (accuracyCircle && map) {
      accuracyCircle.setLatLng(buyerLatLng);
      accuracyCircle.setRadius(Number(position.accuracy) || 0);
    } else if (map && window.L && Number(position.accuracy) > 0) {
      accuracyCircle = L.circle(buyerLatLng, {
        radius: Number(position.accuracy),
        color: "#2868d7",
        weight: 1,
        opacity: 0.45,
        fillColor: "#2868d7",
        fillOpacity: 0.09,
        interactive: false
      }).addTo(map);
    }
    if (buyerMarker) buyerMarker.setZIndexOffset(1000);
    updateDirectionsLink(position);
    const accuracyNode = $("location-route-accuracy");
    if (accuracyNode && Number.isFinite(Number(position.accuracy))) {
      accuracyNode.textContent = "Your GPS accuracy is about ±" + Math.round(Number(position.accuracy)) + " m. The blue dot can drift by this amount.";
    }
    // Showing a GPS fix does not calculate or send a route. The buyer must tap Get route.
  }

  document.addEventListener("click", async (event) => {
    const getRoute = event.target.closest("#location-get-route");
    if (getRoute) {
      if (!activeContext || previewInProgress || startInProgress) {
        setStatus("The shop pin is not ready yet. Please try again.", true);
        return;
      }
      if(!mapTilesReady){setStatus("The map is not ready yet. Check your connection and wait for the map to appear.",true);return;}
      getRoute.disabled = true;
      getRoute.textContent = "Getting your location…";
      setStatus("Requesting your current GPS location for this route only…");
      try {
        const position = await getPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
        const candidate = coordFromPosition(position);
        if (!Number.isFinite(candidate.accuracy) || candidate.accuracy <= 0 || candidate.accuracy > 100) {
          const results = $("location-route-results");
          if (results) results.hidden = false;
          const accuracyNode = $("location-route-accuracy");
          if (accuracyNode) accuracyNode.textContent = "GPS accuracy is too low for a trustworthy route: " +
            (Number.isFinite(candidate.accuracy) ? "±" + Math.round(candidate.accuracy) + " m." : "not available.");
          setStatus("Your GPS fix is not accurate enough. Move to an open area and try again.", true);
          getRoute.disabled = false;
          getRoute.textContent = "Try getting route again";
          return;
        }
        latestPosition = candidate;
        updateMap(latestPosition);
        updateDirectionsLink(latestPosition);
        const results = $("location-route-results");
        if (results) results.hidden = false;
        getRoute.hidden = false;
        getRoute.textContent = "Update route from my location";
        const routeReady=await loadRoadRoute(latestPosition, true);
        getRoute.disabled=false;
        setStatus(routeReady
          ? "Estimated route ready. Your GPS fix is not shared with the seller. Confirm the shop photo and entrance when you arrive."
          : "Road route unavailable. The map shows a straight-line estimate only; use Google Maps for an external route.",!routeReady);
      } catch (error) {
        setStatus(error && error.message ? error.message : "Could not get your current location. Check permission and try again.", true);
        getRoute.disabled = false;
        getRoute.textContent = "Try getting route again";
      }
      return;
    }
    const recenter = event.target.closest("#location-map-recenter");
    if (recenter && map) {
      fitMapToRoute(lastRouteDistanceMetres == null ? 0 : lastRouteDistanceMetres);
      return;
    }
    const modeButton = event.target.closest("[data-route-mode]");
    if (modeButton) {
      const nextMode = modeButton.getAttribute("data-route-mode");
      if (nextMode !== "foot" && nextMode !== "car") return;
      if (nextMode === routeMode) return;
      routeMode = nextMode;
      updateRouteModeButtons();
      updateDirectionsLink(latestPosition);
      setRouteState(latestPosition ? "Updating estimated route…" : "Get a route from your location first.");
      if (latestPosition) loadRoadRoute(latestPosition, true);
      return;
    }
  });

  async function pushPosition(position, force) {
    if (!client || !sessionId || !position) return;
    const now = monotonicNow();
    const moved = distanceMetres(lastSentPosition, position);
    if (!force && now - lastSentAt < 9000 && moved < 18) return;
    const { data, error } = await client.rpc("update_marketplace_location", {
      p_session_id: sessionId,
      p_latitude: position.lat,
      p_longitude: position.lng,
      p_accuracy_m: position.accuracy,
      p_heading_deg: position.heading,
      p_speed_mps: position.speed
    });
    if (error) {
      setStatus("Live updates were interrupted. Check your connection; the last position remains private to this shop.", true);
      return;
    }
    if (data === true) {
      lastSentAt = now;
      lastSentPosition = position;
      lastPersistedUpdateAt = monotonicNow();
      return;
    }
    if (data === false) {
      const check = await client.from("marketplace_location_sessions")
        .select("id,status,expires_at")
        .eq("id", sessionId)
        .maybeSingle();
      if (!check.error && !check.data) {
        await stop();
        setStatus("This location session has ended. Start sharing again only when you are ready.");
      }
    }
  }

  function onLocation(position, forcePersist) {
    latestPosition = coordFromPosition(position);
    updateMap(latestPosition);
    const accuracy = Number(latestPosition.accuracy);
    if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > MAX_SHARE_GPS_ACCURACY_METRES) {
      setStatus("Your live GPS is currently " +
        (Number.isFinite(accuracy) && accuracy > 0 ? "about ±" + Math.round(accuracy) + " m" : "unavailable") +
        ". This reading is not being sent to the shop. Buybook will wait for a fix of ±" +
        MAX_SHARE_GPS_ACCURACY_METRES + " m or better.", true);
      return Promise.resolve(false);
    }
    const accuracyText = " · GPS accuracy about ±" + Math.round(accuracy) + " m";
    setStatus("Sharing your live position only with " + (activeContext?.shopName || "this shop") +
      ". Keep Buybook open for the freshest updates. You can stop sharing at any time." + accuracyText);
    return pushPosition(latestPosition, Boolean(forcePersist)).catch((error) => console.warn("Buybook location update failed", error));
  }

  function onLocationError(error) {
    const message = error && error.code === 1
      ? "Location permission was denied. Change the permission in your browser settings to continue."
      : "GPS updates are temporarily unavailable. The seller can see the last update time; move to an open area or check your connection.";
    setStatus(message, true);
  }

  function startWatching() {
    if (!navigator.geolocation || watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(onLocation, onLocationError, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 5000
    });
    // Refresh from the device instead of replaying a cached coordinate.
    // If GPS cannot provide a fresh fix, the seller's last-update age advances
    // and the normal stale-session protections hide and eventually clear it.
    let heartbeatInProgress = false;
    heartbeatId = window.setInterval(async () => {
      if (!sessionId) return;
      const now = monotonicNow();
      if (sessionExpiresAt && now >= sessionExpiresAt) {
        const stopped = await stop();
        if (stopped) setStatus("Your 30-minute location-sharing session has expired. Start a new session when needed.");
        return;
      }
      // The database expires sessions after three minutes without a successful update.
      // Stop locally a little earlier so an expired session cannot block a new request.
      if (lastPersistedUpdateAt && now - lastPersistedUpdateAt >= 175000) {
        const stopped = await stop();
        if (stopped) setStatus("Location sharing ended because fresh updates could not reach the server. Start again when your connection is stable.", true);
        return;
      }
      if (document.visibilityState !== "visible" || !latestPosition || heartbeatInProgress) return;
      heartbeatInProgress = true;
      try {
        const freshPosition = await getPosition({
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 5000
        });
        if (sessionId) await onLocation(freshPosition, true);
      } catch (error) {
        onLocationError(error);
      } finally {
        heartbeatInProgress = false;
      }
    }, 25000);
  }

  const TURNSTILE_SITE_KEY = "0x4AAAAAAF11p80pOUEc98LD";
  let turnstileScriptPromise = null;

  function loadTurnstile() {
    if (window.turnstile && typeof window.turnstile.render === "function") return Promise.resolve();
    if (turnstileScriptPromise) return turnstileScriptPromise;
    turnstileScriptPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById("buybook-turnstile-script");
      const script = existing || document.createElement("script");
      const timeout = window.setTimeout(() => reject(new Error("The security check could not load. Check your connection and try again.")), 15000);
      const finish = (error) => {
        window.clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      script.addEventListener("load", () => finish(
        window.turnstile && typeof window.turnstile.render === "function"
          ? null
          : new Error("The security check did not initialise. Please try again.")
      ), { once: true });
      script.addEventListener("error", () => finish(new Error("The security check could not load. Check your connection and try again.")), { once: true });
      if (!existing) {
        script.id = "buybook-turnstile-script";
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
    }).catch((error) => {
      turnstileScriptPromise = null;
      throw error;
    });
    return turnstileScriptPromise;
  }

  async function requestGuestCaptchaToken() {
    const container = $("buybook-location-captcha");
    if (!container) throw new Error("The guest security check is unavailable. Please refresh Buybook and try again.");
    container.hidden = false;
    container.setAttribute("aria-live", "polite");
    container.textContent = "Loading a quick security check…";
    try {
      await loadTurnstile();
    } catch (error) {
      container.hidden = true;
      container.textContent = "";
      throw error;
    }
    container.textContent = "";

    return new Promise((resolve, reject) => {
      let settled = false;
      let widgetId = null;
      const timeout = window.setTimeout(() => finish(new Error("The security check timed out. Please try again.")), 120000);
      const finish = (error, token) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (widgetId !== null && window.turnstile) {
          try { window.turnstile.remove(widgetId); } catch (_) {}
        }
        container.hidden = true;
        container.textContent = "";
        if (error) reject(error);
        else resolve(token);
      };
      try {
        widgetId = window.turnstile.render(container, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token) => finish(null, token),
          "expired-callback": () => finish(new Error("The security check expired. Please try again.")),
          "error-callback": () => finish(new Error("The security check could not be completed. Check your connection and try again.")),
          "timeout-callback": () => finish(new Error("The security check timed out. Please try again.")),
          action: "buybook_guest_location"
        });
      } catch (_) {
        finish(new Error("The security check could not start. Please refresh Buybook and try again."));
      }
    });
  }

  async function ensureAuth(supabase) {
    const current = await supabase.auth.getSession();
    if (current.error) throw current.error;
    if (current.data && current.data.session && current.data.session.user) return current.data.session.user;

    const captchaToken = await requestGuestCaptchaToken();
    const result = await supabase.auth.signInAnonymously({ options: { captchaToken } });
    if (result.error) {
      const error = new Error(
        "Guest location sign-in could not be completed. Enable Anonymous Sign-Ins and Cloudflare Turnstile CAPTCHA in the Buybook Supabase Auth settings, then try again."
      );
      error.cause = result.error;
      throw error;
    }
    return result.data.user;
  }

  function resetPreview() {
    if (sessionId) return false;
    routeRequestSequence++;
    lastRoutedPosition = null;
    lastRouteRequestedAt = 0;
    lastRouteDistanceMetres = null;
    if (map) {
      map.remove();
      map = null;
    }
    buyerMarker = null;
    shopMarker = null;
    routeLine = null;
    accuracyCircle = null;
    shopAccuracyCircle = null;
    activeContext = null;
    latestPosition = null;
    mapTilesReady = false;
    const node = $("locate-map");
    if (node) {
      node.innerHTML = '<div class="location-map-placeholder" id="location-map-placeholder"><strong>Seller’s saved shop pin</strong><span>Tap Get route from my location when you are ready. Your position is not shared with the seller.</span></div>';
    }
    const distanceNode = $("location-route-distance");
    const etaNode = $("location-route-eta");
    if (distanceNode) distanceNode.textContent = "—";
    if (etaNode) etaNode.textContent = "—";
    const results = $("location-route-results");
    if (results) results.hidden = true;
    const getRoute = $("location-get-route");
    if (getRoute) { getRoute.hidden = false; getRoute.disabled = false; getRoute.textContent = "Get route from my location"; }
    setRouteState("Route not requested");
    const steps = $("location-route-steps");
    if (steps) steps.innerHTML = "<li>Directions will appear here after you get a route.</li>";
    setRouteNote("Your one-time route request is separate from live sharing.");
    const directions = $("locate-directions");
    if (directions) directions.hidden = true;
    routeMode = "foot";
    updateRouteModeButtons();
    const pinNote=$("location-shop-pin-note");
    if(pinNote)pinNote.textContent="";
    return true;
  }

  async function preview(context) {
    if (previewInProgress || startInProgress) throw new Error("Please wait while the shop location loads.");
    if (!context || !context.ownerId) throw new Error("The shop details are missing.");
    client = context.supabase || window.buybookSupabaseClient || client;
    if (!client) throw new Error("Buybook is still connecting. Please try again.");
    previewInProgress = true;
    try {
      setStatus("Loading the seller’s saved shop pin…");
      await ensureAuth(client);
      const { data: selectedShop, error } = await client.from("marketplace_shops")
        .select("owner_id,name,address,latitude,longitude,location_accuracy_m,location_captured_at,location_confirmed_at,location_source,is_connected,is_active")
        .eq("owner_id", context.ownerId)
        .maybeSingle();
      if (error) throw new Error("Could not load this shop’s location. Check your connection and try again.");
      if (!selectedShop || !selectedShop.is_connected || !selectedShop.is_active) {
        throw new Error("This shop is no longer connected or active on Buybook.");
      }
      const lat = Number(selectedShop.latitude), lng = Number(selectedShop.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new Error("This seller has not saved a usable shop pin yet. Contact the seller for directions.");
      }
      activeContext = {
        ...context,
        shopName: selectedShop.name || context.shopName || "Local shop",
        address: selectedShop.address || "",
        latitude: String(lat),
        longitude: String(lng),
        locationAccuracy: selectedShop.location_accuracy_m == null ? null : Number(selectedShop.location_accuracy_m),
        locationConfirmedAt: selectedShop.location_confirmed_at || null,
        locationSource: selectedShop.location_source || "legacy-saved-location"
      };
      latestPosition = null;
      lastRoutedPosition = null;
      lastRouteRequestedAt = 0;
      lastRouteDistanceMetres = null;
      routeMode = "foot";
      updateRouteModeButtons();
      const node = $("locate-shop-label");
      if (node) node.textContent = activeContext.shopName + (activeContext.address ? " · " + activeContext.address : "");
      const pinNote = $("location-shop-pin-note");
      if (pinNote) {
        if (!activeContext.locationConfirmedAt) {
          pinNote.textContent = "Seller’s saved pin · entrance confirmation and GPS accuracy not recorded.";
        } else if (activeContext.locationSource === "manual-map-pin") {
          pinNote.textContent = "Seller-confirmed entrance pin · manually placed; GPS accuracy is not available.";
        } else {
          pinNote.textContent = "Seller-confirmed pin · " +
            (Number.isFinite(activeContext.locationAccuracy) ? "device GPS was ±" + Math.round(activeContext.locationAccuracy) + " m when captured." : "GPS accuracy was not recorded.");
        }
      }
      const getRoute = $("location-get-route");
      if (getRoute) { getRoute.hidden = false; getRoute.disabled = true; getRoute.textContent = "Loading map…"; }
      const mapReady=initMap(activeContext, null);
      const results = $("location-route-results");
      if (results) results.hidden = true;
      if (!mapReady) {
        if (getRoute) { getRoute.disabled=true; getRoute.textContent="Map unavailable"; }
        setStatus("The map could not load. Do not rely on this pin for directions yet. Check your connection and try again.", true);
        return false;
      }
      window.setTimeout(()=>{
        if(!mapTilesReady&&activeContext&&activeContext.ownerId===context.ownerId){
          if(getRoute){getRoute.disabled=true;getRoute.textContent="Map unavailable";}
          setStatus("Map tiles did not load. The pin cannot be checked on the map yet. Try again when your connection is stable.",true);
        }
      },9000);
      const distanceNode = $("location-route-distance"), etaNode = $("location-route-eta");
      if (distanceNode) distanceNode.textContent = "—";
      if (etaNode) etaNode.textContent = "—";
      setRouteState("Route not requested");
      const steps = $("location-route-steps");
      if (steps) steps.innerHTML = "<li>Directions will appear after you request a route.</li>";
      setRouteNote("Your GPS is requested only when you tap Get route. This one-time route does not share your location with the seller.");
      const directions = $("locate-directions");
      if (directions) directions.hidden = true;
      if(mapTilesReady){
        if(getRoute){getRoute.disabled=false;getRoute.textContent="Get route from my location";}
        setStatus("Shop pin shown. Tap Get route from my location when ready. Your position is not shared with the seller.");
      }else setStatus("Loading the shop map. Your GPS has not been requested.");
      return true;
    } finally {
      previewInProgress = false;
    }
  }

  async function start(context) {
    if (startInProgress) throw new Error("Your location request is already processing. Please wait.");
    if (sessionId) {
      setStatus("You are already sharing your location with " + (activeContext?.shopName || "this shop") + ". Stop the current session before locating another shop.");
      return true;
    }
    if (!context || !context.ownerId) throw new Error("The shop details are missing.");
    if (!window.isSecureContext) throw new Error("Live location requires the secure HTTPS Buybook address.");
    if (!navigator.geolocation) throw new Error("Your browser does not support GPS location.");
    client = context.supabase || window.buybookSupabaseClient || client;
    if (!client) throw new Error("Buybook is still connecting. Please try again.");

    startInProgress = true;
    try {
      activeContext = context;
      latestPosition = null;
      lastSentPosition = null;
      lastSentAt = 0;
      setStatus("Getting your current location. Your position is not shared until the shop session is created…");
      // Confirm GPS permission before creating a temporary guest account.
      await getPosition();
      await ensureAuth(client);

      // Seller coordinates are deliberately absent from normal catalogue data.
      // Resolve them only after the buyer explicitly opens Locate seller and
      // confirms Start sharing live location.
      const { data: selectedShop, error: shopLookupError } = await client.from("marketplace_shops")
        .select("owner_id,name,address,latitude,longitude,is_connected,is_active")
        .eq("owner_id", context.ownerId)
        .maybeSingle();
      if (shopLookupError) throw new Error("Could not load this shop's location. Check your connection and try again.");
      if (!selectedShop || !selectedShop.is_connected || !selectedShop.is_active) {
        throw new Error("This shop is no longer connected or active on Buybook.");
      }
      const shopLatitude = Number(selectedShop.latitude);
      const shopLongitude = Number(selectedShop.longitude);
      if (!Number.isFinite(shopLatitude) || !Number.isFinite(shopLongitude) ||
          Math.abs(shopLatitude) > 90 || Math.abs(shopLongitude) > 180) {
        throw new Error("This shop has not registered a usable location yet. You can still contact the seller.");
      }
      context.shopName = selectedShop.name || context.shopName || "Local shop";
      context.address = selectedShop.address || "";
      context.latitude = String(shopLatitude);
      context.longitude = String(shopLongitude);
      activeContext = context;

      // CAPTCHA or authentication may take time; use a new GPS fix for the session.
      const position = await getPosition({
        enableHighAccuracy: true,
        timeout: 18000,
        maximumAge: 3000
      });
      const initial = coordFromPosition(position);
      if (!Number.isFinite(initial.lat) || !Number.isFinite(initial.lng) ||
          !Number.isFinite(initial.accuracy) || initial.accuracy <= 0 ||
          initial.accuracy > MAX_SHARE_GPS_ACCURACY_METRES) {
        throw new Error("Your GPS accuracy is " +
          (Number.isFinite(initial.accuracy) ? "about ±" + Math.round(initial.accuracy) + " m" : "unavailable") +
          ". Buybook needs a reading of ±" + MAX_SHARE_GPS_ACCURACY_METRES +
          " m or better before sharing. Move to an open area and try again.");
      }

      const { data, error } = await client.rpc("start_marketplace_location", {
        p_owner_id: context.ownerId,
        p_product_id: context.productId || null,
        p_latitude: initial.lat,
        p_longitude: initial.lng,
        p_accuracy_m: initial.accuracy,
        p_heading_deg: initial.heading,
        p_speed_mps: initial.speed
      });
      if (error) throw new Error(error.message || "Could not start live location sharing.");
      sessionId = data;
      if (!sessionId) throw new Error("The location session could not be created. Please try again.");

      // Read the authoritative expiry. A resumed database session may have less
      // than 30 minutes remaining, so do not assume a new full window client-side.
      const sessionCheckStartedAt = monotonicNow();
      const { data: sessionState, error: sessionReadError } = await client.from("marketplace_location_sessions")
        .select("expires_at,updated_at")
        .eq("id", sessionId)
        .maybeSingle();
      const sessionCheckCompletedAt = monotonicNow();
      const expiresAt = sessionState ? new Date(sessionState.expires_at).getTime() : NaN;
      const updatedAt = sessionState ? new Date(sessionState.updated_at).getTime() : NaN;
      const remainingUntilExpiry = expiresAt - updatedAt - (sessionCheckCompletedAt - sessionCheckStartedAt);
      if (sessionReadError || !sessionState || !Number.isFinite(expiresAt) ||
          !Number.isFinite(updatedAt) || !Number.isFinite(remainingUntilExpiry) || remainingUntilExpiry <= 0) {
        const stopped = await stop();
        throw new Error(stopped
          ? "The location session could not be confirmed. Please start again."
          : "The location session could not be confirmed or stopped. Reconnect and tap Stop sharing.");
      }

      latestPosition = initial;
      lastSentPosition = initial;
      lastSentAt = sessionCheckCompletedAt;
      // Use a duration derived from two server timestamps, not the device clock.
      sessionExpiresAt = sessionCheckCompletedAt + remainingUntilExpiry;
      lastPersistedUpdateAt = sessionCheckCompletedAt;
      try {
        sessionStorage.setItem("buybook-location-session-id", sessionId);
        sessionStorage.setItem("buybook-location-shop-name", context.shopName || "this shop");
      } catch (_) {}
      setBanner(true, context.shopName);
      const mapReady = initMap(context, initial);
      startWatching();
      const accuracy = initial.accuracy == null ? "" : " GPS accuracy is about ±" + Math.round(initial.accuracy) + " m.";
      setStatus("Your live location is now visible only to " + (context.shopName || "this shop") +
        ". Keep Buybook open for live movement updates. You can stop sharing at any time." + accuracy +
        (mapReady ? "" : " The inbuilt map is unavailable right now; use Open directions for the route."));
      return true;
    } finally {
      startInProgress = false;
    }
  }

  async function stop() {
    const savedId = sessionId || (() => {
      try { return sessionStorage.getItem("buybook-location-session-id"); } catch (_) { return null; }
    })();
    const supabase = client || window.buybookSupabaseClient;
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    if (heartbeatId !== null) window.clearInterval(heartbeatId);
    watchId = null;
    heartbeatId = null;

    let message = "Live location sharing stopped. Your last precise location has been cleared from the seller map.";
    if (savedId && supabase) {
      const { error } = await supabase.rpc("stop_marketplace_location", { p_session_id: savedId });
      if (error) {
        message = "Could not confirm that sharing has stopped. Reconnect to the internet and tap Stop sharing again.";
        setStatus(message, true);
        return false;
      }
    }
    sessionId = null;
    latestPosition = null;
    lastSentPosition = null;
    activeContext = null;
    sessionExpiresAt = null;
    lastPersistedUpdateAt = 0;
    try {
      sessionStorage.removeItem("buybook-location-session-id");
      sessionStorage.removeItem("buybook-location-shop-name");
    } catch (_) {}
    setBanner(false);
    if (buyerMarker && map) map.removeLayer(buyerMarker);
    if (routeLine && map) map.removeLayer(routeLine);
    buyerMarker = null;
    routeLine = null;
    setStatus(message);
    return true;
  }

  function isActive() {
    if (sessionId) return true;
    try { return !!sessionStorage.getItem("buybook-location-session-id"); } catch (_) { return false; }
  }

  async function restoreBanner() {
    client = window.buybookSupabaseClient || client;
    if (!client) return;
    let id = null;
    let savedName = "this shop";
    try {
      id = sessionStorage.getItem("buybook-location-session-id");
      savedName = sessionStorage.getItem("buybook-location-shop-name") || savedName;
    } catch (_) {}
    if (!id) return;

    const { data: authData, error: authError } = await client.auth.getSession();
    if (authError) {
      console.warn("Buybook could not verify the saved location session", authError);
      return;
    }
    const buyerId = authData && authData.session && authData.session.user
      ? authData.session.user.id
      : null;
    if (!buyerId) {
      try {
        sessionStorage.removeItem("buybook-location-session-id");
        sessionStorage.removeItem("buybook-location-shop-name");
      } catch (_) {}
      return;
    }

    const sessionCheckStartedAt = Date.now();
    const { data, error } = await client.from("marketplace_location_sessions")
      .select("id,owner_id,buyer_id,product_id,latitude,longitude,accuracy_m,heading_deg,speed_mps,updated_at,expires_at,status")
      .eq("id", id)
      .eq("buyer_id", buyerId)
      .maybeSingle();
    const sessionCheckCompletedAt = Date.now();
    if (error) {
      console.warn("Buybook could not restore the saved location session", error);
      setStatus("Your saved location session could not be checked. Reconnect and try again.");
      return;
    }
    const expiresAt = data && new Date(data.expires_at).getTime();
    const updatedAt = data && new Date(data.updated_at).getTime();
    if (!data || data.buyer_id !== buyerId || data.status !== "active" ||
        !Number.isFinite(expiresAt) || !Number.isFinite(updatedAt)) {
      try {
        sessionStorage.removeItem("buybook-location-session-id");
        sessionStorage.removeItem("buybook-location-shop-name");
      } catch (_) {}
      return;
    }

    const { data: shop, error: shopError } = await client.from("marketplace_shops")
      .select("owner_id,name,address,latitude,longitude,is_connected,is_active")
      .eq("owner_id", data.owner_id)
      .maybeSingle();
    if (!shopError && (!shop || !shop.is_connected || !shop.is_active)) {
      sessionId = data.id;
      await stop();
      setStatus("This shop is no longer active on Buybook. Your live location has been stopped.");
      return;
    }

    const shopName = shop && shop.name ? shop.name : savedName;
    activeContext = {
      ownerId: data.owner_id,
      productId: data.product_id || null,
      shopName,
      address: shop && shop.address ? shop.address : "",
      latitude: shop && shop.latitude != null ? String(shop.latitude) : "",
      longitude: shop && shop.longitude != null ? String(shop.longitude) : ""
    };
    latestPosition = {
      lat: Number(data.latitude),
      lng: Number(data.longitude),
      accuracy: data.accuracy_m == null ? null : Number(data.accuracy_m),
      heading: data.heading_deg == null ? null : Number(data.heading_deg),
      speed: data.speed_mps == null ? null : Number(data.speed_mps)
    };
    if (!Number.isFinite(latestPosition.lat) || !Number.isFinite(latestPosition.lng) ||
        Math.abs(latestPosition.lat) > 90 || Math.abs(latestPosition.lng) > 180) {
      sessionId = data.id;
      setBanner(true, shopName);
      await stop();
      return;
    }

    const remainingUntilExpiry = Math.min(
      30 * 60 * 1000,
      expiresAt - updatedAt - (sessionCheckCompletedAt - sessionCheckStartedAt)
    );
    if (!Number.isFinite(remainingUntilExpiry) || remainingUntilExpiry <= 0) {
      sessionId = data.id;
      setBanner(true, savedName);
      const stopped = await stop();
      if (stopped) setStatus("Your saved location session has expired. Start sharing again when ready.");
      else setStatus("Your saved location session may have expired. Reconnect and tap Stop sharing to close it.", true);
      return;
    }
    sessionId = data.id;
    // The row is visible under the buyer's RLS freshness policy. Start a
    // local elapsed-time watchdog now; the database remains authoritative.
    sessionExpiresAt = sessionCheckCompletedAt + remainingUntilExpiry;
    lastPersistedUpdateAt = sessionCheckCompletedAt;
    lastSentAt = 0;
    lastSentPosition = null;
    setBanner(true, shopName);
    if (navigator.geolocation) {
      startWatching();
      setStatus("Live location sharing has resumed with " + shopName + ". Keep Buybook open for fresh GPS updates. You can stop sharing at any time.");
    } else {
      setStatus("Your sharing session is active, but this browser cannot provide GPS updates. Stop sharing or reopen Buybook in a supported phone browser.", true);
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-stop-location-sharing]");
    if (!button) return;
    button.disabled = true;
    stop().then((stopped) => {
      button.disabled = false;
      if (stopped && typeof window.BuybookNotify === "function") {
        window.BuybookNotify("Location sharing stopped.");
      }
    }).catch((error) => {
      button.disabled = false;
      console.error("Could not stop Buybook location sharing", error);
    });
  });

  window.addEventListener("buybook:supabase-ready", () => {
    client = window.buybookSupabaseClient || client;
    if (!client) return;
    client.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return;
      // An explicit in-app sign-out stops the session before auth is cleared.
      // For a sign-out from another tab, stop local GPS immediately; server cleanup
      // scrubs the last stored coordinate once the session becomes stale.
      if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
      if (heartbeatId !== null) window.clearInterval(heartbeatId);
      watchId = null;
      heartbeatId = null;
      sessionId = null;
      latestPosition = null;
      lastSentPosition = null;
      activeContext = null;
      sessionExpiresAt = null;
      lastPersistedUpdateAt = 0;
      try {
        sessionStorage.removeItem("buybook-location-session-id");
        sessionStorage.removeItem("buybook-location-shop-name");
      } catch (_) {}
      setBanner(false);
    });
    restoreBanner().catch((error) => console.warn("Could not restore location sharing status", error));
  });

  window.BuybookLocator = { preview, resetPreview, start, stop, isActive };
})();
