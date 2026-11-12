/* Buybook buyer-first application. Sellbook remains the source of truth for listings and shop operations. */
(function () {
  "use strict";

  const OAUTH_REDIRECT = window.location.origin + "/";
  const CATEGORIES = [
    { label: "Food & Groceries", emoji: "🛒", key: "food & groceries" },
    { label: "Drinks & Beverages", emoji: "🥤", key: "drinks & beverages" },
    { label: "Fruits & Vegetables", emoji: "🥬", key: "fruits & vegetables" },
    { label: "Health & Beauty", emoji: "🧴", key: "health & beauty" },
    { label: "Household Items", emoji: "🏠", key: "household items" },
    { label: "Clothing & Fashion", emoji: "👕", key: "clothing & fashion" },
    { label: "Electronics & Accessories", emoji: "📱", key: "electronics & accessories" },
    { label: "Building Materials", emoji: "🧱", key: "building materials" },
    { label: "Stationery & School Supplies", emoji: "✏️", key: "stationery & school supplies" },
    { label: "Other", emoji: "🛍️", key: "other" }
  ];
  const HOME_CATEGORY_KEYS = [
    "food & groceries", "drinks & beverages", "fruits & vegetables",
    "clothing & fashion", "electronics & accessories", "health & beauty"
  ];
  const HOME_CATEGORY_LABELS = Object.freeze({
    "food & groceries": "Groceries",
    "drinks & beverages": "Drinks",
    "fruits & vegetables": "Fruits & veg",
    "clothing & fashion": "Fashion",
    "electronics & accessories": "Electronics",
    "health & beauty": "Health & beauty"
  });

  const STATUS = {
    pending: "Awaiting shop decision",
    approved: "Approved",
    accepted: "Accepted",
    ready: "Ready for collection",
    collected: "Collected",
    rejected: "Declined",
    declined: "Declined",
    cancelled: "Cancelled",
    expired: "Expired"
  };

  const state = {
    supabase: null,
    realtimeChannel: null,
    user: null,
    authMode: "signin",
    products: [],
    shops: [],
    homeProducts: [],
    homeShops: [],
    homeCatalogLoaded: false,
    productHasMore: false,
    shopHasMore: false,
    productNextOffset: 0,
    shopNextOffset: 0,
    productLoadingMore: false,
    shopLoadingMore: false,
    catalogRequestId: 0,
    buyerPosition: null,
    distanceResultsLoaded: false,
    locationRequestVersion: 0,
    geolocationPermission: null,
    distanceScanLimited: false,
    lastStoresError: false,
    ownShop: null,
    meFollowingRows: [],
    meFollowingOffset: 0,
    meFollowingHasMore: false,
    meFollowingLoading: false,
    meFollowingError: false,
    meConnectionLoading: false,
    meConnectionLoaded: false,
    meConnectionError: false,
    mePanelRequestId: 0,
    mePanelLoadedAt: 0,
    mePanelLastReturnRefreshAt: 0,
    signingOut: false,
    followMutationIds: new Set(),
    buyerSubscriptions: [],
    sellerSubscriptions: [],
    subscribedShopIds: new Set(),
    shopNames: {},
    messages: [],
    messagesInboxHasMore: false,
    messagesInboxLoading: false,
    messagesInboxError: false,
    messagesInboxLoaded: false,
    socialPermissionsError: false,
    messagesInboxCursor: null,
    messagesInboxRequestId: 0,
    messageBlocks: [],
    pendingAttachmentFile: null,
    activeMessages: [],
    activeMessagesHasMore: false,
    activeMessagesLoadingOlder: false,
    activeMessagesRequestId: 0,
    socialLoadRequestId: 0,
    messagesUnread: 0,
    messageSendRequestId: 0,
    messageSending: false,
    pendingMessage: null,
    conversationFilter: "all",
    conversationSearch: "",
    conversations: [],
    reservations: [],
    reservationsHasMore: false,
    reservationsLoadingMore: false,
    reservationsRequestId: 0,
    reservationRequestKey: null,
    reservationSubmitting: false,
    notifications: [],
    notificationsUnread: 0,
    notificationsUnreadLoaded: false,
    notificationReads: new Set(),
    activeConversation: null,
    activeProductId: null,
    activeShopId: null,
    activeReservationId: null,
    pendingLocationContext: null,
    selectedCategory: "",
    reservationFilter: "all",
    notificationFilter: "all",
    notificationLoadRequestId: 0,
    pendingAction: null,
    returnAfterSignIn: "me",
    authReady: false,
    lastCatalogError: false,
    catalogLoading: false
  };

  const $ = (id) => document.getElementById(id);
  let catalogLoadPromise = null;
  let exploreSearchTimer = 0;
  const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function money(value, currency) {
    const amount = Number(value || 0);
    const code = currency || "NGN";
    try {
      return new Intl.NumberFormat("en-NG", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(amount);
    } catch (_) {
      return "₦" + amount.toLocaleString("en-NG", { maximumFractionDigits: 2 });
    }
  }

  function createReservationRequestKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
      .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  }

  function formatDate(value, includeTime) {
    if (!value) return "Date unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return date.toLocaleString("en-NG", includeTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" });
  }

  function initials(value) {
    const words = String(value || "Buybook").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "B";
  }

  function buyerDisplayName(userId) {
    const value = String(userId || "");
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const code = (hash >>> 0).toString(36).toUpperCase().padStart(7, "0");
    return "Customer " + code;
  }

  function formatConversationTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const today = new Date();
    const sameDay = (left, right) => left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
    if (sameDay(date, today)) {
      return date.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" });
    }
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (sameDay(date, yesterday)) return "Yesterday";
    const options = { day: "numeric", month: "short" };
    if (date.getFullYear() !== today.getFullYear()) options.year = "numeric";
    return date.toLocaleDateString("en-NG", options);
  }

  function categoryKey(value) {
    const raw = String(value || "").toLowerCase().trim();
    if (!raw) return "other";
    if (CATEGORIES.some((item) => item.key === raw)) return raw;
    if (/grocer|grocery|food|provision|supermarket/.test(raw)) return "food & groceries";
    if (/drink|beverage/.test(raw)) return "drinks & beverages";
    if (/fruit|vegetable|produce/.test(raw)) return "fruits & vegetables";
    if (/health|beauty|skin|cosmetic|personal care|pharmacy/.test(raw)) return "health & beauty";
    if (/household|home|furniture|kitchen|decor/.test(raw)) return "household items";
    if (/fashion|cloth|apparel|shoe|wear|accessor|watch/.test(raw)) return "clothing & fashion";
    if (/electronic|phone|computer|gadget|appliance/.test(raw)) return "electronics & accessories";
    if (/building|cement|nail|paint|plumbing|hardware/.test(raw)) return "building materials";
    if (/stationery|school|book|pen|exercise/.test(raw)) return "stationery & school supplies";
    return "other";
  }

  function categoryMatch(product, selected) {
    if (!selected) return true;
    return String(product.category || "").split("|").some((item) => categoryKey(item) === selected);
  }

  function setOfflineBanner() {
    const banner = $("offline-banner");
    if (banner) banner.hidden = navigator.onLine;
  }

  function notifyUser(message, isError) {
    const node = $("global-feedback");
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("is-error", Boolean(isError));
    node.hidden = !message;
    if (message) {
      window.clearTimeout(notifyUser.timer);
      notifyUser.timer = window.setTimeout(() => { node.hidden = true; }, 5000);
    }
  }

  function setFeedback(id, message, isError) {
    const node = $(id);
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("is-error", Boolean(isError));
  }

  function showEmpty(targetId, message, retryLabel) {
    const node = $(targetId);
    if (!node) return;
    node.innerHTML = '<div class="empty-state">' + escapeHtml(message) +
      (retryLabel ? ' <button type="button" class="text-button" data-retry-catalog>' + escapeHtml(retryLabel) + "</button>" : "") +
      "</div>";
  }

  function currentScreen() {
    const active = document.querySelector(".screen.is-active");
    return active ? active.id.replace("screen-", "") : "home";
  }

  function navigate(screen, options) {
    const settings = options || {};
    const target = $("screen-" + screen);
    if (!target) return;
    if (settings.push !== false && currentScreen() !== screen) {
      window.history.pushState({
        buybook: true,
        screen: screen,
        previousScreen: currentScreen()
      }, "", "#"+screen);
    } else if (!window.history.state || !window.history.state.buybook) {
      window.history.replaceState({ buybook: true, screen: screen }, "", "#"+screen);
    }
    renderScreen(screen);
    if (!settings.keepScroll) window.scrollTo({ top: 0, behavior: "auto" });
    const main = $("app-main");
    if (main) main.focus({ preventScroll: true });
  }

  function renderScreen(screen) {
    const appHeader = document.querySelector(".app-header");
    if (appHeader) appHeader.hidden = screen !== "home";
    document.querySelectorAll(".screen").forEach((node) => {
      const active = node.id === "screen-" + screen;
      node.classList.toggle("is-active", active);
      node.hidden = !active;
    });
    document.querySelectorAll("[data-nav-screen]").forEach((button) => {
      const active = button.dataset.navScreen === screen ||
        ((screen === "product" || screen === "shop") && button.dataset.navScreen === "explore") ||
        (screen === "reservation" && button.dataset.navScreen === "reservations") ||
        (screen === "chat" && button.dataset.navScreen === "messages");
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });

    if (screen === "reservations") loadReservations();
    if (screen === "messages") loadSocialData();
    if (screen === "me") {
      renderMe();
      loadMePanelData();
    }
    if (screen === "notifications") loadNotifications();
    if (screen === "explore") {
      renderExploreProducts();
      renderExploreShops();
      if (state.buyerPosition && (!state.distanceResultsLoaded || !state.products.length) && !state.catalogLoading) {
        refreshExploreResults().catch((error) => console.warn("Buybook could not load distance results", error));
      }
    }
    if (screen === "signin") setFeedback("signin-feedback", "");
  }

  function goBack() {
    const current = currentScreen();
    const fallback = {
      product: "explore",
      shop: "explore",
      locate: state.activeProductId ? "product" : "shop",
      reservation: "reservations",
      chat: "messages",
      notifications: "home",
      signin: state.returnAfterSignIn || "home"
    };
    const parent = fallback[current] || "home";
    const historyState = window.history.state;
    if (historyState && historyState.buybook && historyState.previousScreen &&
        $("screen-" + historyState.previousScreen)) {
      window.history.back();
      return;
    }
    navigate(parent, { push: false });
  }

  function renderCategoryChips() {
    const homeMarkup = HOME_CATEGORY_KEYS.map((key) => CATEGORIES.find((item) => item.key === key))
      .filter(Boolean)
      .map((item) =>
        '<button type="button" class="home-category-card' + (state.selectedCategory === item.key ? " is-selected" : "") +
        '" data-category-key="' + escapeHtml(item.key) + '" aria-label="Browse ' + escapeHtml(item.label) +
        '" aria-pressed="' + String(state.selectedCategory === item.key) + '">' +
        '<span class="home-category-emoji" aria-hidden="true">' + item.emoji + "</span>" +
        '<span class="home-category-label">' + escapeHtml(HOME_CATEGORY_LABELS[item.key] || item.label) + "</span></button>"
      ).join("");
    const exploreMarkup = CATEGORIES.map((item) =>
      '<button type="button" class="category-chip' + (state.selectedCategory === item.key ? " is-selected" : "") +
      '" data-category-key="' + escapeHtml(item.key) + '" aria-pressed="' + String(state.selectedCategory === item.key) + '">' +
      '<span class="category-emoji" aria-hidden="true">' + item.emoji + "</span>" + escapeHtml(item.label) + "</button>"
    ).join("");
    const home = $("home-categories");
    const explore = $("explore-categories");
    if (home) home.innerHTML = homeMarkup;
    if (explore) explore.innerHTML = exploreMarkup;
  }

  function shopById(id) {
    const key = String(id);
    return state.shops.find((shop) => String(shop.owner_id || shop.id) === key) ||
      state.homeShops.find((shop) => String(shop.owner_id || shop.id) === key) ||
      (() => {
        const product = [...state.products, ...state.homeProducts].find((item) => String(item.owner_id) === key);
        return product ? {
          id: key, owner_id: key, name: product.store_name || product.shop_name || "Local shop",
          description: product.store_description || "",
          city: product.store_city || "", state: product.store_state || "", country: product.store_country || "",
          distance_km: product.distance_km,
          phone: product.store_phone || "", shop_front_image_url: product.store_front_image_url || ""
        } : null;
      })();
  }

  function productById(id) {
    const key = String(id);
    return state.products.find((product) => String(product.id) === key) ||
      state.homeProducts.find((product) => String(product.id) === key) || null;
  }

  function distanceLabel(value) {
    if (value === null || value === undefined || value === "") {
      return state.buyerPosition ? "Distance unavailable" : "";
    }
    const kilometres = Number(value);
    if (!Number.isFinite(kilometres) || kilometres < 0) return state.buyerPosition ? "Distance unavailable" : "";
    if (kilometres < 1) {
      const metres = Math.max(1, Math.round(kilometres * 1000));
      return metres.toLocaleString("en-NG") + " m away";
    }
    return kilometres.toFixed(2) + " km away";
  }

  function shopLocality(shop) {
    return [shop && shop.city, shop && shop.state].filter(Boolean).join(", ");
  }

  function productCard(product) {
    const photo = product.image_url
      ? '<img src="' + escapeHtml(product.image_url) + '" alt="' + escapeHtml(product.name) + '" loading="lazy" decoding="async">'
      : '<span aria-hidden="true">🛍️</span>';
    const stock = String(product.stock_status || "available");
    const stockClass = stock === "out_of_stock" ? "is-out" : (stock === "low_stock" ? "is-low" : "");
    const stockLabel = stock === "out_of_stock" ? "Out of stock" : (stock === "low_stock" ? "Low stock" : "Available");
    const owner = product.owner_id || "";
    const shopName = product.store_name || product.shop_name || "Local shop";
    const locality = [product.store_city, product.store_state].filter(Boolean).join(", ");
    const distance = distanceLabel(product.distance_km);
    return '<article class="product-card">' +
      '<button type="button" class="product-open" data-product-id="' + escapeHtml(product.id) + '" aria-label="View ' + escapeHtml(product.name) + '">' +
        '<div class="product-photo">' + photo + "</div>" +
        '<div class="product-copy"><h3>' + escapeHtml(product.name) + "</h3>" +
        '<div class="product-price">' + money(product.price, product.currency) + ' <span class="muted-text">/ ' + escapeHtml(product.unit || "item") + "</span></div>" +
        '<p class="product-meta">' + escapeHtml(shopName) + (locality ? " · " + escapeHtml(locality) : "") + "</p>" +
        (distance ? '<p class="distance-meta">' + escapeHtml(distance) + "</p>" : "") +
        '<span class="stock-pill ' + stockClass + '">' + stockLabel + "</span></div></button>" +
      '<button type="button" class="text-button product-shop-link" data-shop-id="' + escapeHtml(owner) + '">View shop →</button></article>';
  }

  function shopCard(shop) {
    const id = shop.owner_id || shop.id;
    const location = shopLocality(shop);
    const distance = distanceLabel(shop.distance_km);
    const image = shop.shop_front_image_url
      ? '<img class="shop-photo" src="' + escapeHtml(shop.shop_front_image_url) + '" alt="Front of ' + escapeHtml(shop.name || "shop") + '" loading="lazy" decoding="async">'
      : '<div class="shop-photo shop-photo-placeholder" aria-hidden="true">🏪</div>';
    return '<article class="shop-card"><button type="button" class="shop-open" data-shop-id="' + escapeHtml(id) +
      '" aria-label="View ' + escapeHtml(shop.name || "local shop") + '">' +
      image + '<div class="shop-copy"><h3>' + escapeHtml(shop.name || "Local shop") + "</h3><p>" +
      escapeHtml(location || "Location not provided") + "</p>" +
      (distance ? '<small class="distance-meta">' + escapeHtml(distance) + "</small>" : "") +
      "</div></button></article>";
  }

  function retryNote(message) {
    return '<p class="catalog-status-note" role="status">' + escapeHtml(message) +
      ' <button type="button" class="text-button" data-retry-catalog>Retry</button></p>';
  }

  function renderCatalog() {
    renderCategoryChips();
    const homeProducts = $("home-products");
    const homeShops = $("home-shops");
    if (homeProducts) {
      const rows = state.homeProducts.slice(0, 4);
      homeProducts.innerHTML = rows.length
        ? rows.map(productCard).join("") + (state.lastCatalogError ? retryNote("Could not refresh products. Showing the last loaded listings.") : "")
        : (state.lastCatalogError
          ? '<div class="empty-state">Products could not be loaded. Check your connection and retry. <button type="button" class="text-button" data-retry-catalog>Retry</button></div>'
          : '<div class="empty-state">No products are listed by connected shops yet.</div>');
    }
    if (homeShops) {
      const rows = state.homeShops.slice(0, 3);
      homeShops.innerHTML = rows.length
        ? rows.map(shopCard).join("") + (state.lastStoresError ? retryNote("Could not refresh shops. Showing the last loaded shops.") : "")
        : (state.lastStoresError
          ? '<div class="empty-state">Shop information is temporarily unavailable. <button type="button" class="text-button" data-retry-catalog>Retry</button></div>'
          : '<div class="empty-state">No connected shops are available yet.</div>');
    }
    renderExploreProducts();
    renderExploreShops();
    renderExploreSummary();
  }

  function exploreFilters() {
    const requestedSort = $("explore-sort") ? $("explore-sort").value : "updated";
    return {
      q: ($("explore-query") && $("explore-query").value || "").trim(),
      location: ($("explore-location") && $("explore-location").value || "").trim(),
      category: state.selectedCategory || "",
      sort: requestedSort === "nearest" && state.buyerPosition ? "nearest" : "updated",
      buyerPosition: state.buyerPosition
    };
  }

  function catalogUrl(path, filters, offset, limit) {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    if (filters.q) params.set("q", filters.q);
    if (filters.location) params.set("location", filters.location);
    if (filters.category) params.set("category", filters.category);
    if (filters.sort) params.set("sort", filters.sort);
    return path + "?" + params.toString();
  }

  async function loadCatalogPage(path, filters, offset, limit) {
    const url = catalogUrl(path, filters, offset, limit);
    if (!filters.buyerPosition) return loadJson(url);
    // Buyer's coordinates travel only in the POST body and are never stored.
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        limit,
        offset,
        q: filters.q,
        location: filters.location,
        category: filters.category,
        sort: filters.sort,
        latitude: filters.buyerPosition.latitude,
        longitude: filters.buyerPosition.longitude
      })
    });
    let payload;
    try { payload = await response.json(); } catch (_) { payload = {}; }
    if (!response.ok) throw new Error(payload.error || "The catalogue could not be loaded.");
    return payload;
  }

  function updateDistanceControls(message, options) {
    const status = $("distance-location-status");
    const enabled = Boolean(state.buyerPosition);
    const statusText = typeof message === "string" ? message.trim() : "";
    if (status) {
      status.textContent = statusText;
      status.hidden = !statusText;
      status.classList.toggle("is-available", enabled);
      status.classList.toggle("is-unavailable", !enabled);
    }
    const settingsAction = $("distance-location-settings");
    const showDeviceSettings = Boolean(options && options.showDeviceSettings &&
      /Android/i.test(navigator.userAgent || ""));
    if (settingsAction) settingsAction.hidden = !showDeviceSettings;
    const nearest = $("explore-sort") && $("explore-sort").querySelector('option[value="nearest"]');
    if (nearest) {
      nearest.disabled = !enabled;
      if (!enabled && $("explore-sort").value === "nearest") $("explore-sort").value = "updated";
    }
  }

  function metresBetween(first, second) {
    if (!first || !second) return Infinity;
    const radians = (value) => value * Math.PI / 180;
    const dLat = radians(second.latitude - first.latitude);
    const dLng = radians(second.longitude - first.longitude);
    const lat1 = radians(first.latitude);
    const lat2 = radians(second.latitude);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  }

  function refreshHomeDistances(locationVersion) {
    const version = Number.isInteger(locationVersion) ? locationVersion : state.locationRequestVersion;
    const buyerPosition = state.buyerPosition;
    if (!buyerPosition) return Promise.resolve();
    const filters = { q: "", location: "", category: "", sort: "updated", buyerPosition };
    return Promise.allSettled([
      loadCatalogPage("/api/products", filters, 0, 4),
      loadCatalogPage("/api/stores", filters, 0, 3)
    ]).then((results) => {
      if (version !== state.locationRequestVersion || state.buyerPosition !== buyerPosition) return;
      if (results[0].status === "fulfilled") {
        state.homeProducts = Array.isArray(results[0].value.products) ? results[0].value.products : [];
      }
      if (results[1].status === "fulfilled") {
        state.homeShops = Array.isArray(results[1].value.stores) ? results[1].value.stores : [];
      }
      state.distanceResultsLoaded = results[0].status === "fulfilled";
      renderCatalog();
      if (currentScreen() === "product" && state.activeProductId) openProduct(state.activeProductId);
      if (currentScreen() === "shop" && state.activeShopId) openShop(state.activeShopId);
    }).catch((error) => console.warn("Buybook Home distance refresh failed", error));
  }

  function refreshCatalogueForLocation(locationVersion) {
    const version = Number.isInteger(locationVersion) ? locationVersion : state.locationRequestVersion;
    const screen = currentScreen();
    if (screen === "explore") {
      const filters = exploreFilters();
      return refreshExploreResults().then(() => {
        if (version !== state.locationRequestVersion) return;
        if (filters.q || filters.location || filters.category || filters.sort !== "updated") {
          return refreshHomeDistances(version);
        }
      }).catch((error) => {
        if (version !== state.locationRequestVersion) return;
        console.warn("Buybook distance results could not be refreshed", error);
        updateDistanceControls("Seller distances could not be refreshed. You can continue browsing.");
      });
    }
    if (screen === "product" || screen === "shop") {
      const activeProduct = state.activeProductId;
      const activeShop = state.activeShopId;
      return refreshExploreResults().then(() => {
        if (version !== state.locationRequestVersion) return;
        if (screen === "product" && activeProduct) openProduct(activeProduct);
        if (screen === "shop" && activeShop) openShop(activeShop);
        return refreshHomeDistances(version);
      }).catch((error) => {
        if (version === state.locationRequestVersion) console.warn("Buybook detail distance refresh failed", error);
      });
    }
    return refreshHomeDistances(version);
  }

  function handleBuyerLocation(position) {
    const coords = position && position.coords;
    const latitude = coords && Number(coords.latitude);
    const longitude = coords && Number(coords.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      handleBuyerLocationError({ code: 2 });
      return;
    }
    const next = { latitude, longitude };
    const moved = !state.buyerPosition || metresBetween(state.buyerPosition, next) >= 75;
    const needsDistanceRefresh = moved || !state.distanceResultsLoaded;
    if (!needsDistanceRefresh) {
      updateDistanceControls("");
      return;
    }
    state.buyerPosition = next;
    // A valid position is used silently; only errors should display a location notice.
    updateDistanceControls("");
    state.locationRequestVersion += 1;
    // Invalidate an earlier catalogue request that started before location became available.
    // Otherwise its location-free response could overwrite freshly calculated distances.
    state.catalogRequestId += 1;
    state.catalogLoading = false;
    state.productLoadingMore = false;
    state.shopLoadingMore = false;
    state.distanceResultsLoaded = false;
    refreshCatalogueForLocation(state.locationRequestVersion);
  }

  function handleBuyerLocationError(error) {
    const hadLocation = Boolean(state.buyerPosition);
    state.locationRequestVersion += 1;
    state.buyerPosition = null;
    state.distanceResultsLoaded = false;
    const code = error && error.code;
    if (code === 1) {
      updateDistanceControls("Buybook cannot use your location because this site does not have location permission. Allow location access for Buybook in your browser settings to see seller distances and sort by nearest.");
    } else if (code === 2) {
      updateDistanceControls("Buybook cannot get a location fix. Your phone's Location setting may be off. Turn it on and return to Buybook; nearby distances will update automatically.", { showDeviceSettings: true });
    } else if (code === 3) {
      updateDistanceControls("Location is taking longer than expected. You can still browse products and shops; nearby sorting will be available when a location fix is ready.");
    } else {
      updateDistanceControls("Location is unavailable in this browser. You can still browse all products and shops.");
    }
    if (hadLocation) {
      [state.products, state.shops, state.homeProducts, state.homeShops].forEach((items) => {
        items.forEach((item) => { delete item.distance_km; });
      });
      state.distanceScanLimited = false;
      renderCatalog();
      if (currentScreen() === "explore") {
        refreshExploreResults().catch((refreshError) => console.warn("Buybook could not clear stale distances", refreshError));
      } else if (currentScreen() === "product" && state.activeProductId) {
        openProduct(state.activeProductId);
      } else if (currentScreen() === "shop" && state.activeShopId) {
        openShop(state.activeShopId);
      }
    }
  }

  function getBrowserPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation || !window.isSecureContext) {
        reject({ code: 0, message: "Location is unavailable in this browser." });
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false, timeout: 20000, maximumAge: 120000
      });
    });
  }

  async function checkBuyerLocation() {
    try {
      const position = await getBrowserPosition();
      handleBuyerLocation(position);
    } catch (error) {
      handleBuyerLocationError(error);
    }
  }

  async function initBuyerLocation() {
    if (!navigator.geolocation || !window.isSecureContext) {
      handleBuyerLocationError({ code: 0 });
      return;
    }
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const permission = await navigator.permissions.query({ name: "geolocation" });
        state.geolocationPermission = permission;
        if (permission.state === "denied") {
          handleBuyerLocationError({ code: 1 });
        } else {
          // A previously granted permission is read without another prompt.
          // A first-time "prompt" state can only be approved through the browser's
          // required native consent dialog; websites cannot bypass that consent.
          await checkBuyerLocation();
        }
        const onPermissionChange = () => {
          if (permission.state === "granted") checkBuyerLocation();
          else if (permission.state === "denied") handleBuyerLocationError({ code: 1 });
        };
        if (typeof permission.addEventListener === "function") permission.addEventListener("change", onPermissionChange);
        else permission.onchange = onPermissionChange;
      } else {
        // Browsers without Permissions API use the browser's native consent flow
        // only when the page requests its first location fix.
        await checkBuyerLocation();
      }
    } catch (error) {
      console.warn("Buybook could not read the location permission state", error);
      await checkBuyerLocation();
    }
  }

  function refreshBuyerLocationWhenReturning() {
    if (document.visibilityState !== "visible") return;
    const permission = state.geolocationPermission;
    if (permission && permission.state === "denied") return;
    if (permission && permission.state === "granted") checkBuyerLocation();
  }

  function filteredProducts() {
    const query = ($("explore-query") && $("explore-query").value || "").trim().toLowerCase();
    const location = ($("explore-location") && $("explore-location").value || "").trim().toLowerCase();
    const rows = state.products.filter((product) => {
      const searchable = [
        product.name, product.description, product.category, product.store_name,
        product.store_city, product.store_state, product.store_country
      ].join(" ").toLowerCase();
      const locationText = [product.store_city, product.store_state, product.store_country].join(" ").toLowerCase();
      return searchable.includes(query) && locationText.includes(location) && categoryMatch(product, state.selectedCategory);
    });
    return rows;
  }

  function renderExploreSummary() {
    const target = $("explore-summary");
    if (!target) return;
    if (state.catalogLoading && !state.products.length && !state.shops.length) {
      target.textContent = "Searching products and shops…";
      return;
    }
    if (state.lastCatalogError && state.lastStoresError && !state.products.length && !state.shops.length) {
      target.textContent = "The catalogue could not be loaded. Check your connection and retry.";
      return;
    }
    const productCount = filteredProducts().length + (state.productHasMore ? "+" : "");
    const shopCount = filteredShops().length + (state.shopHasMore ? "+" : "");
    target.textContent = "Showing " + productCount + " products and " + shopCount + " shops" +
      (state.distanceScanLimited ? " · Add a search word to narrow the nearest results." : "");
  }

  function renderExploreProducts() {
    const target = $("explore-products");
    const count = $("product-count");
    if (!target) return;
    const rows = filteredProducts();
    if (count) count.textContent = rows.length + (state.productHasMore ? "+" : "") + (rows.length === 1 ? " product" : " products");
    if (state.catalogLoading && !state.products.length) {
      target.innerHTML = '<div class="loading-card">Finding products…</div>';
      return;
    }
    if (rows.length) {
      target.innerHTML = rows.map(productCard).join("") +
        (state.lastCatalogError ? retryNote("Could not refresh products.") : "") +
        (state.productHasMore ? '<div class="load-more-row"><button type="button" class="button button-secondary load-more-button" data-load-more-products' +
          (state.productLoadingMore ? ' disabled' : '') + '>' + (state.productLoadingMore ? "Loading…" : "Load more products") + "</button></div>" : "");
      return;
    }
    const message = state.lastCatalogError
      ? "Products could not be loaded. Check your connection and retry."
      : "No products match your search or filters. Try another word or clear your filters.";
    target.innerHTML = '<div class="empty-state">' + escapeHtml(message) +
      ' <button class="text-button" type="button" data-clear-explore>Clear filters</button>' +
      (state.productHasMore ? ' <button class="text-button" type="button" data-load-more-products>Show more results</button>' : "") +
      (state.lastCatalogError ? ' <button class="text-button" type="button" data-retry-catalog>Retry</button>' : "") + "</div>";
  }

  function filteredShops() {
    const query = ($("explore-query") && $("explore-query").value || "").trim().toLowerCase();
    const location = ($("explore-location") && $("explore-location").value || "").trim().toLowerCase();
    return state.shops.filter((shop) => {
      const searchable = [shop.name, shop.description, shop.city, shop.state, shop.country]
        .join(" ").toLowerCase();
      const locationText = [shop.city, shop.state, shop.country].join(" ").toLowerCase();
      return searchable.includes(query) && locationText.includes(location);
    });
  }

  function renderExploreShops() {
    const target = $("explore-shops-list");
    const count = $("shop-count");
    if (!target) return;
    const rows = filteredShops();
    if (count) count.textContent = rows.length + (state.shopHasMore ? "+" : "") + (rows.length === 1 ? " shop" : " shops");
    if (state.catalogLoading && !state.shops.length) {
      target.innerHTML = '<div class="loading-card">Finding shops…</div>';
      return;
    }
    if (rows.length) {
      target.innerHTML = rows.map(shopCard).join("") +
        (state.lastStoresError ? retryNote("Could not refresh shops.") : "") +
        (state.shopHasMore ? '<div class="load-more-row"><button type="button" class="button button-secondary load-more-button" data-load-more-shops' +
          (state.shopLoadingMore ? ' disabled' : '') + '>' + (state.shopLoadingMore ? "Loading…" : "Load more shops") + "</button></div>" : "");
      return;
    }
    const message = state.lastStoresError
      ? "Shop listings could not be loaded. Check your connection and retry."
      : "No shops match your search or location. Try another search.";
    target.innerHTML = '<div class="empty-state">' + escapeHtml(message) +
      ' <button class="text-button" type="button" data-clear-explore>Clear filters</button>' +
      (state.shopHasMore ? ' <button class="text-button" type="button" data-load-more-shops>Show more shops</button>' : "") +
      (state.lastStoresError ? ' <button class="text-button" type="button" data-retry-catalog>Retry</button>' : "") + "</div>";
  }

  async function loadJson(url) {
    const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    let payload;
    try { payload = await response.json(); } catch (_) { payload = {}; }
    if (!response.ok) throw new Error(payload.error || "The request could not be completed.");
    return payload;
  }

  async function requestExploreResults(options) {
    const settings = options || {};
    const moreProducts = settings.more === "products";
    const moreShops = settings.more === "shops";
    if (moreProducts && (state.productLoadingMore || !state.productHasMore)) return;
    if (moreShops && (state.shopLoadingMore || !state.shopHasMore)) return;

    const requestId = moreProducts || moreShops ? state.catalogRequestId : ++state.catalogRequestId;
    const filters = exploreFilters();
    const productOffset = moreProducts ? state.productNextOffset : 0;
    const shopOffset = moreShops ? state.shopNextOffset : 0;
    const PAGE_SIZE = 24;

    if (!moreProducts && !moreShops) {
      state.catalogLoading = true;
      state.productLoadingMore = false;
      state.shopLoadingMore = false;
      state.lastCatalogError = false;
      state.lastStoresError = false;
      state.products = [];
      state.shops = [];
      state.distanceScanLimited = false;
      state.distanceResultsLoaded = false;
      state.productHasMore = false;
      state.shopHasMore = false;
      state.productNextOffset = 0;
      state.shopNextOffset = 0;
    } else {
      if (moreProducts) state.productLoadingMore = true;
      if (moreShops) state.shopLoadingMore = true;
    }
    renderExploreProducts();
    renderExploreShops();
    renderExploreSummary();

    const productPromise = moreShops ? Promise.resolve(null) :
      loadCatalogPage("/api/products", filters, productOffset, PAGE_SIZE);
    const shopPromise = moreProducts ? Promise.resolve(null) :
      loadCatalogPage("/api/stores", filters, shopOffset, PAGE_SIZE);
    const results = await Promise.allSettled([productPromise, shopPromise]);
    if (requestId !== state.catalogRequestId) {
      // A slow initial Home request may finish after a buyer has already started
      // an Explore search. Keep its unfiltered preview without replacing the
      // newer, filtered Explore result set.
      if (!moreProducts && !moreShops && !filters.buyerPosition && !filters.q && !filters.location && !filters.category && filters.sort === "updated") {
        if (results[0].status === "fulfilled" && results[0].value && !state.homeProducts.length) {
          state.homeProducts = Array.isArray(results[0].value.products) ? results[0].value.products : [];
        }
        if (results[1].status === "fulfilled" && results[1].value && !state.homeShops.length) {
          state.homeShops = Array.isArray(results[1].value.stores) ? results[1].value.stores : [];
        }
        if (results.every((result) => result.status === "fulfilled")) {
          state.homeCatalogLoaded = true;
          renderCatalog();
        }
      }
      return;
    }

    if (results[0].status === "fulfilled" && results[0].value) {
      const incoming = Array.isArray(results[0].value.products) ? results[0].value.products : [];
      state.products = moreProducts
        ? state.products.concat(incoming.filter((item) => !state.products.some((old) => String(old.id) === String(item.id))))
        : incoming;
      state.productHasMore = Boolean(results[0].value.has_more);
      state.productNextOffset = Number(results[0].value.next_offset || (productOffset + incoming.length));
      state.distanceScanLimited = Boolean(results[0].value.distance_scan_limited);
      state.distanceResultsLoaded = Boolean(filters.buyerPosition);
      state.lastCatalogError = false;
      if (!filters.q && !filters.location && !filters.category && filters.sort === "updated") {
        state.homeProducts = state.products.slice();
      }
    } else if (!moreShops) {
      state.lastCatalogError = true;
    }

    if (results[1].status === "fulfilled" && results[1].value) {
      const incoming = Array.isArray(results[1].value.stores) ? results[1].value.stores : [];
      state.shops = moreShops
        ? state.shops.concat(incoming.filter((item) => !state.shops.some((old) => String(old.owner_id || old.id) === String(item.owner_id || item.id))))
        : incoming;
      state.shopHasMore = Boolean(results[1].value.has_more);
      state.shopNextOffset = Number(results[1].value.next_offset || (shopOffset + incoming.length));
      state.lastStoresError = false;
      if (!filters.q && !filters.location && !filters.category && filters.sort === "updated") {
        state.homeShops = state.shops.slice();
      }
    } else if (!moreProducts) {
      state.lastStoresError = true;
    }

    if (!state.homeCatalogLoaded && !state.lastCatalogError && !state.lastStoresError &&
        !filters.q && !filters.location && !filters.category && filters.sort === "updated") {
      state.homeCatalogLoaded = true;
    }
    state.catalogLoading = false;
    state.productLoadingMore = false;
    state.shopLoadingMore = false;
    renderCatalog();
  }

  function loadMoreProducts() {
    return requestExploreResults({ more: "products" });
  }

  function loadMoreShops() {
    return requestExploreResults({ more: "shops" });
  }

  function refreshExploreResults() {
    return requestExploreResults({ reset: true });
  }

  function scheduleExploreRefresh(immediate) {
    window.clearTimeout(exploreSearchTimer);
    const refresh = () => {
      if (currentScreen() === "explore") refreshExploreResults().catch((error) => {
        console.error("Buybook Explore search failed", error);
        state.catalogLoading = false;
        state.lastCatalogError = true;
        state.lastStoresError = true;
        renderCatalog();
      });
    };
    if (immediate) refresh();
    else exploreSearchTimer = window.setTimeout(refresh, 220);
  }

  function loadCatalog() {
    if (catalogLoadPromise) return catalogLoadPromise;
    catalogLoadPromise = refreshExploreResults().catch((error) => {
      console.error("Buybook catalogue failed", error);
      state.catalogLoading = false;
      state.lastCatalogError = true;
      state.lastStoresError = true;
      renderCatalog();
    }).finally(() => { catalogLoadPromise = null; });
    return catalogLoadPromise;
  }

  function clearExploreFilters() {
    $("explore-query").value = "";
    $("explore-location").value = "";
    $("explore-sort").value = "updated";
    state.selectedCategory = "";
    renderCategoryChips();
    refreshExploreResults().catch((error) => console.error("Could not clear Explore filters", error));
  }

  function openProduct(id) {
    const product = productById(id);
    if (!product) return;
    state.activeProductId = String(id);
    const owner = product.owner_id || "";
    const followed = state.subscribedShopIds.has(String(owner));
    const shop = shopById(owner);
    const locality = [product.store_city, product.store_state, product.store_country].filter(Boolean).join(", ");
    const distance = distanceLabel(product.distance_km);
    const image = product.image_url
      ? '<img src="' + escapeHtml(product.image_url) + '" alt="' + escapeHtml(product.name) + '">'
      : "🛍️";
    const shopImage = product.store_front_image_url || (shop && shop.shop_front_image_url) || "";
    const shopPhoto = shopImage ? '<img src="' + escapeHtml(shopImage) + '" alt="Front of ' + escapeHtml(product.store_name || "shop") + '">' : '<span class="chat-avatar">🏪</span>';
    const stock = product.stock_status || "available";
    $("product-detail-content").innerHTML =
      '<div class="detail-hero"><div class="detail-image">' + image + '</div><div class="detail-info">' +
      '<p class="eyebrow">PRODUCT DETAILS</p><h1 id="product-detail-title">' + escapeHtml(product.name) + "</h1>" +
      '<p class="detail-price">' + money(product.price, product.currency) + ' <span class="muted-text">/ ' + escapeHtml(product.unit || "item") + "</span></p>" +
      '<p class="detail-description">' + escapeHtml(product.description || "The seller has not added a description.") + "</p>" +
      '<p><strong>Category:</strong> ' + escapeHtml(product.category || "Not specified") + "</p>" +
      '<p><strong>Availability:</strong> ' + escapeHtml(stock === "out_of_stock" ? "Out of stock" : (stock === "low_stock" ? "Low stock" : "Available")) + "</p>" +
      '<div class="detail-actions"><button type="button" class="button button-secondary" data-follow-shop="' + escapeHtml(owner) + '">' +
      (followed ? "Following ✓" : "Follow shop") + '</button>' +
      '<button type="button" class="button button-secondary" data-locate-shop="' + escapeHtml(owner) +
      '" data-locate-name="' + escapeHtml(product.store_name || (shop && shop.name) || "Local shop") +
      '" data-locate-product="' + escapeHtml(product.id) + '">Locate seller</button>' +
      '<button type="button" class="button button-primary" data-reserve-product="' + escapeHtml(product.id) + '"' +
      (stock === "out_of_stock" ? " disabled" : "") + '>Reserve</button></div>' +
      '<div class="detail-note">A reservation is a request only. Payment and collection are arranged with the shop in person. The seller’s exact location is shown only when you choose Locate seller.</div></div></div>' +
      '<button type="button" class="detail-shop" data-shop-id="' + escapeHtml(owner) + '">' + shopPhoto +
      '<span><strong>' + escapeHtml(product.store_name || (shop && shop.name) || "Local shop") + '</strong><small>' +
      escapeHtml(locality || "Location not provided") + (distance ? " · " + escapeHtml(distance) : "") + "</small></span></button>";
    navigate("product");
  }

  function openShop(id) {
    const shop = shopById(id);
    if (!shop) return;
    state.activeShopId = String(id);
    const products = [...state.homeProducts, ...state.products]
      .filter((item, index, rows) => rows.findIndex((row) => String(row.id) === String(item.id)) === index)
      .filter((item) => String(item.owner_id) === String(id));
    const followed = state.subscribedShopIds.has(String(id));
    const locality = shopLocality(shop);
    const distance = distanceLabel(shop.distance_km);
    const image = shop.shop_front_image_url
      ? '<img src="' + escapeHtml(shop.shop_front_image_url) + '" alt="Front of ' + escapeHtml(shop.name || "shop") + '">'
      : '<div class="shop-photo shop-photo-placeholder">🏪</div>';
    $("shop-detail-content").innerHTML =
      '<div class="shop-detail-header">' + image + '<div><p class="eyebrow">LOCAL SHOP</p><h1 id="shop-detail-title">' +
      escapeHtml(shop.name || "Local shop") + "</h1><p class=\"muted-text\">" + escapeHtml(locality || "Location not provided") +
      (distance ? " · " + escapeHtml(distance) : "") + "</p></div></div>" +
      '<p class="detail-description">' + escapeHtml(shop.description || "This shop has not added a description.") + "</p>" +
      '<div class="detail-actions"><button type="button" class="button button-secondary" data-follow-shop="' + escapeHtml(id) + '">' +
      (followed ? "Following ✓" : "Follow shop") + "</button>" +
      '<button type="button" class="button button-secondary" data-locate-shop="' + escapeHtml(id) +
      '" data-locate-name="' + escapeHtml(shop.name || "Local shop") +
      '">Locate seller</button>' +
      '<button type="button" class="button button-primary" data-message-shop="' + escapeHtml(id) + '">Message shop</button>' +
      (shop.phone ? '<a class="button button-secondary" href="tel:' + escapeHtml(String(shop.phone).replace(/[^0-9+]/g, "")) + '">Call shop</a>' : "") +
      "</div><p class=\"detail-note\">The seller’s exact location stays private until you choose Locate seller.</p><h2 class=\"shop-detail-products\">Products from this shop</h2>" +
      '<div class="product-grid">' + (products.length ? products.map(productCard).join("") : '<div class="empty-state">No active products are listed by this shop yet.</div>') + "</div>";
    navigate("shop");
  }

  function renderAuthMode() {
    const isSignUp = state.authMode === "signup";
    const title = $("signin-title");
    const description = $("signin-description");
    const button = $("google-signin");
    const alternate = $("signin-alternate");
    if (title) title.textContent = isSignUp ? "Create your Buybook account" : "Sign in to Buybook";
    if (description) {
      description.textContent = isSignUp
        ? "Sign up to follow shops, message sellers and reserve products."
        : "Welcome back. Sign in to follow shops, message sellers and reserve products.";
    }
    if (button && !button.disabled) {
      button.innerHTML = '<span aria-hidden="true">G</span> ' +
        (isSignUp ? "Sign up with Google" : "Continue with Google");
    }
    if (alternate) {
      alternate.innerHTML = isSignUp
        ? 'Already have an account? <button type="button" class="text-button" data-auth-mode="signin">Sign in</button>'
        : 'New to Buybook? <button type="button" class="text-button" data-auth-mode="signup">Sign up</button>';
    }
  }

  function openSignIn(action, returnTo) {
    state.authMode = "signin";
    state.pendingAction = action || null;
    state.returnAfterSignIn = returnTo || currentScreen();
    renderAuthMode();
    setFeedback("signin-feedback", "Sign in with Google to continue.");
    navigate("signin");
  }

  function openSignUp(returnTo) {
    state.authMode = "signup";
    state.returnAfterSignIn = returnTo || state.returnAfterSignIn || currentScreen();
    renderAuthMode();
    setFeedback("signin-feedback", "Create your account with Google to continue.");
    navigate("signin");
  }

  function requireAccount(action, returnTo) {
    if (!state.authReady) {
      notifyUser("Checking your Buybook account. Please try again in a moment.");
      return false;
    }
    if (state.user && state.supabase) return true;
    openSignIn(action, returnTo);
    return false;
  }

  async function startGoogleSignIn() {
    const policyConsent=$("buybook-policy-consent");
    if(!policyConsent?.checked){
      setFeedback("signin-feedback","Please accept the Terms of Use and acknowledge the Privacy Notice before continuing.",true);
      policyConsent?.focus();
      return;
    }
    if (window.BuybookLocator && window.BuybookLocator.isActive()) {
      const stopped = await window.BuybookLocator.stop();
      if (!stopped) {
        setFeedback("signin-feedback", "Stop live location sharing before changing accounts.", true);
        return;
      }
    }
    if (!state.supabase) {
      setFeedback("signin-feedback", "Sign-in is not ready. Please try again.", true);
      return;
    }
    try {
      if (state.pendingAction) sessionStorage.setItem("buybook-pending-action", JSON.stringify(state.pendingAction));
      sessionStorage.setItem("buybook-return-screen", state.returnAfterSignIn || "me");
      if (state.activeProductId) sessionStorage.setItem("buybook-return-product-id", state.activeProductId);
      if (state.activeShopId) sessionStorage.setItem("buybook-return-shop-id", state.activeShopId);
    } catch (error) {
      console.warn("Buybook could not preserve the sign-in destination", error);
    }
    const button = $("google-signin");
    if (button) { button.disabled = true; button.textContent = "Opening Google…"; }
    sessionStorage.setItem("buybook-policy-acceptance-pending-v1",JSON.stringify({
      id: crypto.randomUUID(),
      application: "buybook",
      privacy_policy_version: "2026-11-06",
      terms_version: "2026-11-07",
      accepted_at: new Date().toISOString(),
      acceptance_method: "google_oauth"
    }));
    const { error } = await state.supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: OAUTH_REDIRECT }
    });
    if (error) {
      try {
        sessionStorage.removeItem("buybook-policy-acceptance-pending-v1");
        sessionStorage.removeItem("buybook-pending-action");
        sessionStorage.removeItem("buybook-return-screen");
        sessionStorage.removeItem("buybook-return-product-id");
        sessionStorage.removeItem("buybook-return-shop-id");
      } catch (_) {}
      setFeedback("signin-feedback", error.message || "Google sign-in could not start.", true);
      if (button) {
        button.disabled = false;
        button.innerHTML = '<span aria-hidden="true">G</span> ' +
          (state.authMode === "signup" ? "Sign up with Google" : "Continue with Google");
      }
    }
  }

  function stopRealtime() {
    const channel = state.realtimeChannel;
    state.realtimeChannel = null;
    if (channel && state.supabase) {
      state.supabase.removeChannel(channel).catch((error) => {
        console.warn("Buybook message channel cleanup failed", error);
      });
    }
  }

  function startRealtime() {
    if (!state.user || !state.supabase) return;
    stopRealtime();
    const userId = state.user.id;
    state.realtimeChannel = state.supabase.channel("buybook-messages-" + userId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "marketplace_messages" }, (payload) => {
        const row = payload && payload.new ? payload.new : null;
        if (!row || (row.owner_id !== userId && row.buyer_id !== userId) || row.sender_id === userId) return;
        upsertInboxMessage(row);
        refreshConversationUnreadCount(row.owner_id, row.buyer_id).catch((error) => console.warn("Buybook incoming unread count refresh failed", error));
        const conversation = state.activeConversation;
        const isOpen = currentScreen() === "chat" && conversation &&
          String(conversation.ownerId) === String(row.owner_id) &&
          String(conversation.buyerId) === String(row.buyer_id);
        if (isOpen) {
          upsertActiveMessage(row).catch((error) => console.warn("Buybook could not display an incoming image", error));
          state.supabase.rpc("mark_marketplace_conversation_read", {
            p_owner_id: row.owner_id, p_buyer_id: row.buyer_id
          }).then(({ error }) => {
            if (error) {
              console.warn("Buybook could not mark the open conversation as read", error);
              return refreshUnreadMessageCount();
            }
            markConversationReadLocally(row.owner_id, row.buyer_id);
            return refreshUnreadMessageCount();
          }).catch((error) => console.warn("Buybook live message read update failed", error));
        } else {
          refreshUnreadMessageCount().catch((error) => console.warn("Buybook unread count refresh failed", error));
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "marketplace_messages" }, (payload) => {
        const row = payload && payload.new ? payload.new : null;
        if (!row || (row.owner_id !== userId && row.buyer_id !== userId) || !row.read_at) return;
        refreshConversationUnreadCount(row.owner_id, row.buyer_id).catch((error) => console.warn("Buybook conversation unread count refresh failed", error));
        if (state.activeConversation &&
            String(state.activeConversation.ownerId) === String(row.owner_id) &&
            String(state.activeConversation.buyerId) === String(row.buyer_id)) {
          upsertActiveMessage(row).catch((error) => console.warn("Buybook could not refresh an incoming image", error));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "marketplace_message_blocks" }, (payload) => {
        const row = payload && (payload.new || payload.old) ? (payload.new || payload.old) : null;
        if (!row || (row.owner_id !== userId && row.buyer_id !== userId)) return;
        loadSocialData().catch((error) => console.warn("Buybook block status refresh failed", error));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "marketplace_reservations" }, (payload) => {
        const row = payload && payload.new ? payload.new : null;
        if (!row || (row.buyer_id !== userId && row.owner_id !== userId)) return;
        const screen = currentScreen();
        if (screen === "reservations" || screen === "reservation") {
          loadReservations().then(() => {
            if (currentScreen() === "reservation" && state.activeReservationId) openReservation(state.activeReservationId);
          }).catch((error) => console.warn("Buybook live reservation refresh failed", error));
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "marketplace_reservations" }, (payload) => {
        const row = payload && payload.new ? payload.new : null;
        if (row && (row.buyer_id === userId || row.owner_id === userId) && currentScreen() === "reservations") {
          loadReservations().catch((error) => console.warn("Buybook live reservation refresh failed", error));
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "app_notifications" }, (payload) => {
        const row = payload && payload.new ? payload.new : null;
        if (!row || (row.recipient_id && row.recipient_id !== userId)) return;
        loadNotifications().catch((error) => console.warn("Buybook live notification refresh failed", error));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notification_reads" }, (payload) => {
        const row = payload && payload.new ? payload.new : null;
        if (!row || row.user_id !== userId) return;
        loadNotifications().catch((error) => console.warn("Buybook notification read refresh failed", error));
      })
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("Buybook live messages are temporarily unavailable", error || status);
          notifyUser("Live message updates are temporarily unavailable. Reopen Messages to refresh.", true);
        }
      });
  }

  let buybookPolicyAcceptanceWrite = null;
  async function persistPendingBuybookPolicyAcceptance(user) {
    let pending;
    try { pending=JSON.parse(sessionStorage.getItem("buybook-policy-acceptance-pending-v1")||"null"); }
    catch (_) { pending=null; }
    if(!pending||!user?.id||user.is_anonymous)return true;
    if(pending.application!=="buybook"||pending.privacy_policy_version!=="2026-11-06"||pending.terms_version!=="2026-11-07"||!pending.id)return false;
    if(buybookPolicyAcceptanceWrite)return buybookPolicyAcceptanceWrite;
    buybookPolicyAcceptanceWrite=(async()=>{
      const {error}=await state.supabase.from("policy_acceptances").insert({
        id:pending.id,user_id:user.id,application:"buybook",
        privacy_policy_version:pending.privacy_policy_version,
        terms_version:pending.terms_version,accepted_at:pending.accepted_at,
        acceptance_method:"google_oauth"
      });
      if(error&&error.code!=="23505")throw error;
      sessionStorage.removeItem("buybook-policy-acceptance-pending-v1");
      return true;
    })().catch(error=>{
      console.warn("Buybook could not save the policy acceptance record:",error);
      return false;
    }).finally(()=>{buybookPolicyAcceptanceWrite=null;});
    return buybookPolicyAcceptanceWrite;
  }

  async function handleAuthSession(user) {
    if(user&&!user.is_anonymous&&sessionStorage.getItem("buybook-policy-acceptance-pending-v1")){
      const recorded=await persistPendingBuybookPolicyAcceptance(user);
      if(!recorded){
        await state.supabase.auth.signOut({scope:"local"}).catch(()=>{});
        setFeedback("signin-feedback","We could not save your agreement record. Please reconnect and accept the terms again before continuing.",true);
        return;
      }
    }
    const previousId = state.user && state.user.id;
    const appUser = user && user.is_anonymous ? null : user;
    const nextId = appUser && appUser.id ? appUser.id : null;
    if (previousId !== nextId) {
      stopRealtime();
      state.ownShop = null;
      state.mePanelRequestId += 1;
      state.meFollowingRows = [];
      state.meFollowingOffset = 0;
      state.meFollowingHasMore = false;
      state.meFollowingLoading = false;
      state.meFollowingError = false;
      state.meConnectionLoading = false;
      state.meConnectionLoaded = false;
      state.meConnectionError = false;
      state.mePanelLoadedAt = 0;
      state.mePanelLastReturnRefreshAt = 0;
      state.signingOut = false;
      state.shopNames = {};
      state.activeConversation = null;
      state.buyerSubscriptions = [];
      state.sellerSubscriptions = [];
      state.subscribedShopIds = new Set();
      state.messages = [];
      state.messagesInboxHasMore = false;
      state.messagesInboxLoading = false;
      state.messagesInboxError = false;
      state.messagesInboxLoaded = false;
      state.socialPermissionsError = false;
      state.messagesInboxCursor = null;
      state.messagesInboxRequestId += 1;
      state.messageBlocks = [];
      state.pendingAttachmentFile = null;
      state.activeMessages = [];
      state.activeMessagesHasMore = false;
      state.activeMessagesLoadingOlder = false;
      state.activeMessagesRequestId += 1;
      state.messagesUnread = 0;
      state.messageSendRequestId += 1;
      state.messageSending = false;
      state.pendingMessage = null;
      state.conversationFilter = "all";
      state.conversationSearch = "";
      state.conversations = [];
      state.reservations = [];
      state.reservationsHasMore = false;
      state.reservationsLoadingMore = false;
      state.reservationsRequestId += 1;
      state.reservationRequestKey = null;
      state.reservationSubmitting = false;
      state.notifications = [];
      state.notificationsUnread = 0;
      state.notificationsUnreadLoaded = false;
      state.notificationReads = new Set();
      renderUnreadBadges(0, 0);
      if ($("chat-messages")) $("chat-messages").innerHTML = "";
      if ($("message-body")) $("message-body").value = "";
      if ($("reservations-list")) $("reservations-list").innerHTML = '<div class="empty-state">Sign in to view your reservations.</div>';
      if ($("notifications-list")) $("notifications-list").innerHTML = '<div class="empty-state">Sign in to view notifications.</div>';
      if ($("following-shops")) $("following-shops").innerHTML = '<div class="empty-state">Sign in to see the shops you follow.</div>';
      if (previousId) navigate("home", { push: false });
    }
    state.user = appUser || null;
    state.authReady = true;
    renderHeaderAvatar();
    if (!state.user) {
      renderMe();
      return;
    }
    if (previousId !== state.user.id) {
      await loadSocialData();
      await loadNotifications();
      if (currentScreen() === "reservations") await loadReservations();
      startRealtime();
    }
    renderMe();
    if (currentScreen() === "me") await loadMePanelData({ force: true });
    if (currentScreen() === "signin" || state.pendingAction) {
      const destination = state.returnAfterSignIn || "me";
      if (destination === "product" && state.activeProductId) {
        if (!productById(state.activeProductId)) await loadCatalog();
        if (productById(state.activeProductId)) openProduct(state.activeProductId);
        else navigate("explore");
      } else if (destination === "shop" && state.activeShopId) {
        if (!shopById(state.activeShopId)) await loadCatalog();
        if (shopById(state.activeShopId)) openShop(state.activeShopId);
        else navigate("home");
      } else {
        navigate(destination);
      }
      const pending = state.pendingAction;
      state.pendingAction = null;
      try {
        sessionStorage.removeItem("buybook-pending-action");
        sessionStorage.removeItem("buybook-return-screen");
        sessionStorage.removeItem("buybook-return-product-id");
        sessionStorage.removeItem("buybook-return-shop-id");
      } catch (_) {}
      if (pending) await executePendingAction(pending);
    }
  }

  function renderHeaderAvatar() {
    const button = $("profile-button");
    const signInButton = $("header-signin-button");
    const user = state.user;
    if (button) button.hidden = !user;
    if (signInButton) signInButton.hidden = Boolean(user);
    if (!button || !user) return;
    const meta = user && user.user_metadata ? user.user_metadata : {};
    const photo = meta.avatar_url || meta.picture || "";
    const label = initials(meta.full_name || meta.name || (user && user.email) || "Buybook");
    button.innerHTML = photo
      ? '<img id="header-avatar" src="' + escapeHtml(photo) + '" alt="">'
      : '<span id="header-avatar">' + escapeHtml(user ? label : "B") + "</span>";
    button.setAttribute("aria-label", "Open your account");
  }

  const ME_FOLLOWING_PAGE_SIZE = 20;

  async function loadMePanelData(options) {
    const settings = options || {};
    if (!state.user || !state.supabase) {
      state.mePanelRequestId += 1;
      state.meFollowingRows = [];
      state.meFollowingOffset = 0;
      state.meFollowingHasMore = false;
      state.meFollowingLoading = false;
      state.meFollowingError = false;
      state.meConnectionLoading = false;
      state.meConnectionLoaded = false;
      state.meConnectionError = false;
      state.mePanelLoadedAt = 0;
      renderMe();
      return;
    }

    const append = Boolean(settings.append);
    const force = Boolean(settings.force);
    if (state.meFollowingLoading) return;
    if (!append && !force && state.mePanelLoadedAt && Date.now() - state.mePanelLoadedAt < 15000) {
      renderMe();
      return;
    }

    const userId = String(state.user.id);
    const requestId = ++state.mePanelRequestId;
    const offset = append ? state.meFollowingOffset : 0;
    state.meFollowingLoading = true;
    state.meFollowingError = false;
    if (!append) {
      state.meConnectionLoading = true;
      state.meConnectionError = false;
    }
    renderMe();

    let subscriptionsResult;
    let shopResult;
    try {
      const client = state.supabase;
      const queries = [
        client.from("marketplace_store_subscriptions").select("owner_id,buyer_id,created_at")
          .eq("buyer_id", userId)
          .order("created_at", { ascending: false })
          .order("owner_id", { ascending: true })
          .range(offset, offset + ME_FOLLOWING_PAGE_SIZE),
        append
          ? Promise.resolve({ data: state.ownShop, error: null })
          : client.from("marketplace_shops").select("owner_id,name,is_connected,is_active")
            .eq("owner_id", userId).maybeSingle()
      ];
      [subscriptionsResult, shopResult] = await Promise.all(queries);
    } catch (error) {
      if (requestId !== state.mePanelRequestId || !state.user || String(state.user.id) !== userId) return;
      console.warn("Buybook Me data could not be refreshed", error);
      state.meFollowingLoading = false;
      state.meFollowingError = true;
      if (!append) {
        state.meConnectionLoading = false;
        state.meConnectionError = true;
      }
      renderMe();
      return;
    }

    if (requestId !== state.mePanelRequestId || !state.user || String(state.user.id) !== userId) return;

    if (subscriptionsResult.error) {
      console.warn("Buybook followed shops could not be loaded", subscriptionsResult.error);
      state.meFollowingError = true;
    } else {
      const receivedRows = Array.isArray(subscriptionsResult.data) ? subscriptionsResult.data : [];
      const pageRows = receivedRows.slice(0, ME_FOLLOWING_PAGE_SIZE);
      if (append) {
        const existingIds = new Set(state.meFollowingRows.map((row) => String(row.owner_id)));
        state.meFollowingRows = state.meFollowingRows.concat(
          pageRows.filter((row) => !existingIds.has(String(row.owner_id)))
        );
      } else {
        state.meFollowingRows = pageRows;
      }
      state.meFollowingOffset = offset + pageRows.length;
      state.meFollowingHasMore = receivedRows.length > ME_FOLLOWING_PAGE_SIZE;
      state.meFollowingError = false;

      const ownerIds = Array.from(new Set(pageRows.map((row) => row.owner_id).filter(Boolean)));
      if (ownerIds.length) {
        try {
          const namesResult = await state.supabase.from("marketplace_shops").select("owner_id,name").in("owner_id", ownerIds);
          if (requestId !== state.mePanelRequestId || !state.user || String(state.user.id) !== userId) return;
          if (!namesResult.error) {
            const nextNames = Object.assign({}, state.shopNames);
            (namesResult.data || []).forEach((shop) => {
              nextNames[shop.owner_id] = shop.name || "Local shop";
            });
            state.shopNames = nextNames;
          } else {
            console.warn("Buybook followed shop names could not be loaded", namesResult.error);
          }
        } catch (error) {
          console.warn("Buybook followed shop names could not be loaded", error);
        }
      }
    }

    if (!append) {
      if (shopResult && !shopResult.error) {
        state.ownShop = shopResult.data || null;
        state.meConnectionLoaded = true;
        state.meConnectionError = false;
        if (state.ownShop) state.shopNames[userId] = state.ownShop.name || "Your shop";
      } else {
        state.meConnectionError = true;
        console.warn("Buybook Sellbook connection status could not be loaded", shopResult && shopResult.error);
      }
      state.meConnectionLoading = false;
    }

    state.meFollowingLoading = false;
    if (!subscriptionsResult.error && (append || (shopResult && !shopResult.error))) {
      state.mePanelLoadedAt = Date.now();
    }
    renderMe();
  }

  function refreshMePanelOnReturn() {
    if (currentScreen() !== "me" || !state.user || state.meFollowingLoading) return;
    const now = Date.now();
    if (now - state.mePanelLastReturnRefreshAt < 2500) return;
    state.mePanelLastReturnRefreshAt = now;
    loadMePanelData({ force: true });
  }

  function renderMe() {
    const profile = $("me-profile");
    const following = $("following-shops");
    const signOut = $("sign-out-button");
    const signOutSection = $("me-signout-section");
    const followingSection = $("me-following-section");
    const connectionSection = $("me-sellbook-section");
    const connection = $("sellbook-connection");
    if (!profile || !following) return;

    if (!state.user) {
      if (followingSection) followingSection.hidden = true;
      if (connectionSection) connectionSection.hidden = true;
      profile.innerHTML = '<div class="profile-avatar">B</div><div class="profile-copy"><h2>Welcome to Buybook</h2><p>Create an account to follow shops, message sellers and reserve products.</p><button type="button" class="button button-primary" data-open-signup>Sign up</button><p class="signin-alternate">Already have an account? <button type="button" class="text-button" data-open-signin>Sign in</button></p></div>';
      following.innerHTML = '<div class="empty-state">Sign in to see the shops you follow.</div>';
      if (connection) {
        connection.innerHTML = '<div class="connection-copy"><p>Browse and reserve as a buyer. Sellers manage products and connect their shop directly in Sellbook.</p></div><a class="button button-secondary" href="https://my-sales-book.vercel.app/" target="_blank" rel="noopener noreferrer">Open Sellbook</a>';
      }
      if (signOut) signOut.hidden = true;
      if (signOutSection) signOutSection.hidden = true;
      return;
    }

    if (followingSection) followingSection.hidden = false;
    if (connectionSection) connectionSection.hidden = false;
    const meta = state.user.user_metadata || {};
    const name = meta.full_name || meta.name || "Buybook member";
    const photo = meta.avatar_url || meta.picture || "";
    profile.innerHTML = '<div class="profile-avatar">' + (photo ? '<img src="' + escapeHtml(photo) + '" alt="">' : escapeHtml(initials(name))) +
      '</div><div class="profile-copy"><h2>' + escapeHtml(name) + "</h2><p>" + escapeHtml(state.user.email || "") + "</p></div>";

    const followed = state.meFollowingRows;
    let followingMarkup = "";
    if (state.meFollowingLoading && !followed.length) {
      followingMarkup = '<div class="loading-card">Loading shops you follow…</div>';
    } else if (state.meFollowingError && !followed.length) {
      followingMarkup = '<div class="empty-state">Your followed shops could not be loaded. Check your connection and try again.<br><button type="button" class="text-button" data-retry-me>Try again</button></div>';
    } else if (!followed.length) {
      followingMarkup = '<div class="empty-state">You are not following any shops yet. Explore products and follow a shop to keep in touch.</div>';
    } else {
      followingMarkup = followed.map((row) => {
        const shopName = state.shopNames[row.owner_id] || "Local shop";
        return '<article class="list-card"><div class="row-between"><h3>' + escapeHtml(shopName) + '</h3><span class="muted-text">' +
          escapeHtml(formatDate(row.created_at, false)) + '</span></div><div class="list-actions"><button class="button button-secondary" type="button" data-shop-id="' +
          escapeHtml(row.owner_id) + '">View shop</button><button class="button button-secondary" type="button" data-message-shop="' +
          escapeHtml(row.owner_id) + '">Message</button><button class="text-button" type="button" data-unfollow-shop="' +
          escapeHtml(row.owner_id) + '">Unfollow</button></div></article>';
      }).join("");
      if (state.meFollowingError) {
        followingMarkup += '<div class="empty-state">More shops could not be loaded. Please try again.</div>';
      }
    }
    if (state.meFollowingHasMore) {
      followingMarkup += '<div class="load-more-row"><button class="button button-secondary load-more-button" type="button" data-load-more-following' +
        (state.meFollowingLoading ? " disabled" : "") + ">" +
        (state.meFollowingLoading ? "Loading…" : "Load more shops") + "</button></div>";
    }
    following.innerHTML = followingMarkup;

    if (connection) {
      let connectionCopy = "";
      if (state.meConnectionLoading && !state.meConnectionLoaded) {
        connectionCopy = '<p>Checking your Sellbook connection…</p>';
      } else if (state.meConnectionError && !state.meConnectionLoaded) {
        connectionCopy = '<p>Your Sellbook connection status could not be loaded.</p><button type="button" class="text-button" data-retry-me>Try again</button>';
      } else if (state.ownShop) {
        const connected = Boolean(state.ownShop.is_connected && state.ownShop.is_active);
        const status = connected
          ? '<span class="status-pill is-good">Connected</span>'
          : '<span class="status-pill is-pending">Disconnected</span>';
        const copy = connected
          ? "Your active shop is connected. Eligible products from Sellbook appear on Buybook automatically."
          : "Your shop is not currently available for discovery. Reconnect it in Sellbook when you are ready.";
        connectionCopy = '<div class="connection-copy"><div class="connection-heading"><strong>' +
          escapeHtml(state.ownShop.name || "Your shop") + '</strong>' + status + '</div><p>' + copy + '</p></div>';
        if (state.meConnectionError) {
          connectionCopy += '<p class="me-inline-note">Connection status may be out of date. <button type="button" class="text-button" data-retry-me>Refresh</button></p>';
        }
      } else {
        connectionCopy = '<div class="connection-copy"><p>Use Buybook to discover local shops, follow sellers, send messages and make reservations. Manage products and shop connections in Sellbook.</p></div>';
      }
      connection.innerHTML = connectionCopy +
        '<a class="button button-secondary" href="https://my-sales-book.vercel.app/" target="_blank" rel="noopener noreferrer">Open Sellbook</a>';
    }
    if (signOut) {
      signOut.hidden = false;
      signOut.disabled = state.signingOut;
      signOut.textContent = state.signingOut ? "Signing out…" : "Sign out";
    }
    if (signOutSection) signOutSection.hidden = false;
  }

  function renderUnreadBadges(messagesUnread, notificationsUnread) {
    const messageBadge = $("messages-badge");
    if (messageBadge) {
      messageBadge.hidden = !messagesUnread;
      messageBadge.textContent = messagesUnread > 99 ? "99+" : String(messagesUnread);
    }
    const notificationsBadge = $("notifications-badge");
    if (notificationsBadge) {
      notificationsBadge.hidden = !notificationsUnread;
      notificationsBadge.textContent = notificationsUnread > 99 ? "99+" : String(notificationsUnread);
    }
  }

  function conversationKey(ownerId, buyerId) {
    return String(ownerId) + ":" + String(buyerId);
  }

  async function signMessageAttachments(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const paths = Array.from(new Set(list.map((row) => row && row.attachment_path).filter(Boolean)));
    if (!paths.length || !state.supabase) return list;
    const { data, error } = await state.supabase.storage
      .from("buybook-message-attachments").createSignedUrls(paths, 4 * 60 * 60);
    if (error) {
      console.warn("Buybook could not create private image links", error);
      return list;
    }
    const urls = new Map((data || []).map((item) => [item.path, item.signedUrl]));
    const signedAt = Date.now();
    return list.map((row) => row.attachment_path
      ? Object.assign({}, row, { attachmentUrl: urls.get(row.attachment_path) || null, attachmentSignedAt: signedAt })
      : row);
  }

  async function renewMessageAttachmentLink(path) {
    if (!path || !state.supabase) throw new Error("Image link is unavailable.");
    const { data, error } = await state.supabase.storage
      .from("buybook-message-attachments").createSignedUrl(path, 4 * 60 * 60);
    if (error || !data || !data.signedUrl) throw error || new Error("Image link could not be renewed.");
    return data.signedUrl;
  }

  async function handleMessageAttachmentImageError(event) {
    const image = event && event.target;
    if (!image || !image.classList || !image.classList.contains("message-attachment-image")) return;
    if (image.dataset.renewing === "true") return;
    const attempts = Number(image.dataset.renewAttempts || 0);
    if (attempts >= 2) return;
    const path = image.dataset.attachmentPath;
    const link = image.closest(".message-attachment-link");
    if (!path || !link || !state.supabase) return;
    image.dataset.renewing = "true";
    image.dataset.renewAttempts = String(attempts + 1);
    try {
      const url = await renewMessageAttachmentLink(path);
      image.src = url;
      image.dataset.signedAt = String(Date.now());
      link.href = url;
    } catch (error) {
      console.warn("Buybook could not renew an expired private image link", error);
      const fallback = document.createElement("p");
      fallback.className = "message-attachment-missing";
      fallback.textContent = "Photo unavailable. Reopen this conversation to try again.";
      link.replaceWith(fallback);
    } finally {
      image.dataset.renewing = "false";
    }
  }

  function updateMessageAttachmentUI() {
    const file = state.pendingAttachmentFile;
    const status = $("message-attachment-status");
    const remove = $("message-attachment-remove");
    const trigger = $("message-attach-trigger");
    if (status) {
      status.hidden = !file;
      status.textContent = file ? file.name + " · " + (file.size / 1024 / 1024).toFixed(1) + " MB" : "";
    }
    if (remove) remove.hidden = !file;
    if (trigger) trigger.disabled = Boolean(state.messageSending ||
      (state.activeConversation && state.activeConversation.canSend === false));
  }

  function handleMessageAttachmentSelection() {
    const input = $("message-attachment");
    const file = input && input.files && input.files[0];
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      input.value = "";
      notifyUser("Choose a JPG, PNG or WebP image.", true);
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      input.value = "";
      notifyUser("Choose an image smaller than 3 MB.", true);
      return;
    }
    discardPendingMessageAttachment();
    state.pendingAttachmentFile = file;
    updateMessageAttachmentUI();
  }

  function discardPendingMessageAttachment() {
    const path = state.pendingMessage && state.pendingMessage.attachmentPath;
    state.pendingMessage = null;
    if (path && state.supabase) {
      state.supabase.storage.from("buybook-message-attachments").remove([path])
        .then(({ error }) => {
          if (error) console.warn("Buybook could not clean up an unsent photo", error);
        }).catch((error) => console.warn("Buybook photo cleanup failed", error));
    }
  }

  function clearMessageAttachment(discardPending) {
    if (discardPending) discardPendingMessageAttachment();
    state.pendingAttachmentFile = null;
    const input = $("message-attachment");
    if (input) input.value = "";
    updateMessageAttachmentUI();
  }

  function sortMessagesAscending(rows) {
    return (rows || []).slice().sort((a, b) => {
      const dateOrder = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return dateOrder || String(a.id || "").localeCompare(String(b.id || ""));
    });
  }

  async function refreshUnreadMessageCount() {
    if (!state.user || !state.supabase) return;
    const userId = state.user.id;
    try {
      const { count, error } = await state.supabase.from("marketplace_messages")
        .select("id", { count: "exact", head: true })
        .or("owner_id.eq." + userId + ",buyer_id.eq." + userId)
        .neq("sender_id", userId).is("read_at", null);
      if (error) throw error;
      if (!state.user || state.user.id !== userId) return;
      state.messagesUnread = Number(count || 0);
      renderUnreadBadges(state.messagesUnread, state.notificationsUnread);
    } catch (error) {
      console.warn("Buybook unread message count could not be refreshed", error);
    }
  }
  function upsertInboxMessage(row, options) {
    if (!row || !state.user) return;
    const settings = options || {};
    const key = conversationKey(row.owner_id, row.buyer_id);
    const existing = state.messages.find((item) => conversationKey(item.owner_id, item.buyer_id) === key);
    const isOlder = existing && existing.created_at && row.created_at &&
      new Date(existing.created_at).getTime() > new Date(row.created_at).getTime();
    const next = isOlder ? Object.assign({}, existing) : Object.assign({}, existing || {}, row);
    next.unread_count = typeof settings.unreadCount === "number"
      ? Math.max(0, settings.unreadCount)
      : Math.max(0, Number(existing && existing.unread_count || 0));
    next.activity_at = next.activity_at || next.created_at || null;
    state.messages = state.messages.filter((item) => conversationKey(item.owner_id, item.buyer_id) !== key).concat(next)
      .sort((a, b) => new Date(b.activity_at || b.created_at || 0).getTime() - new Date(a.activity_at || a.created_at || 0).getTime());
    state.messagesInboxLoaded = true;
    state.messagesInboxError = false;
    const oldest = state.messages[state.messages.length - 1];
    state.messagesInboxCursor = oldest ? {
      activity_at: oldest.activity_at || oldest.created_at,
      owner_id: oldest.owner_id,
      buyer_id: oldest.buyer_id
    } : null;
    buildConversations();
    if (currentScreen() === "messages") renderConversations();
  }

  async function refreshConversationUnreadCount(ownerId, buyerId) {
    if (!state.user || !state.supabase) return;
    const userId = state.user.id;
    try {
      const { count, error } = await state.supabase.from("marketplace_messages")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId).eq("buyer_id", buyerId)
        .neq("sender_id", userId).is("read_at", null);
      if (error) throw error;
      if (!state.user || state.user.id !== userId) return;
      const summary = state.messages.find((row) =>
        String(row.owner_id) === String(ownerId) && String(row.buyer_id) === String(buyerId));
      if (summary) summary.unread_count = Number(count || 0);
      buildConversations();
      if (currentScreen() === "messages") renderConversations();
    } catch (error) {
      console.warn("Buybook conversation unread count could not be refreshed", error);
    }
  }
  async function upsertActiveMessage(row) {
    const conversation = state.activeConversation;
    if (!row || !conversation ||
        String(row.owner_id) !== String(conversation.ownerId) ||
        String(row.buyer_id) !== String(conversation.buyerId)) return;
    const hydrated = row.attachment_path && !row.attachmentUrl
      ? (await signMessageAttachments([row]))[0] : row;
    const rows = state.activeMessages.filter((item) => item.id !== hydrated.id &&
      !(hydrated.client_message_id && item.client_message_id === hydrated.client_message_id));
    state.activeMessages = sortMessagesAscending(rows.concat(hydrated));
    renderChat();
  }

  function markConversationReadLocally(ownerId, buyerId) {
    if (!state.user) return;
    const readAt = new Date().toISOString();
    const markRows = (rows) => rows.map((row) =>
      String(row.owner_id) === String(ownerId) && String(row.buyer_id) === String(buyerId)
        ? Object.assign({}, row, {
          read_at: String(row.sender_id) !== String(state.user.id) ? (row.read_at || readAt) : row.read_at,
          unread_count: 0
        }) : row);
    state.messages = markRows(state.messages);
    state.activeMessages = markRows(state.activeMessages);
    buildConversations();
    if (currentScreen() === "messages") renderConversations();
    if (currentScreen() === "chat") renderChat();
  }

  async function loadSocialData() {
    if (!state.user || !state.supabase) return;
    const userId = state.user.id;
    const client = state.supabase;
    const requestId = ++state.socialLoadRequestId;
    state.messagesInboxRequestId += 1;
    state.messagesInboxLoading = true;
    state.messagesInboxError = false;
    if (currentScreen() === "messages") renderConversations();

    let results;
    try {
      results = await Promise.all([
        client.from("marketplace_store_subscriptions").select("owner_id,buyer_id,created_at")
          .eq("buyer_id", userId).order("created_at", { ascending: false }),
        client.from("marketplace_store_subscriptions").select("owner_id,buyer_id,created_at")
          .eq("owner_id", userId).order("created_at", { ascending: false }),
        client.rpc("get_marketplace_message_inbox", {
          p_limit: 31, p_before_at: null, p_before_owner_id: null, p_before_buyer_id: null
        }),
        client.from("marketplace_shops").select("owner_id,name,is_connected,is_active").eq("owner_id", userId).maybeSingle(),
        client.from("marketplace_messages").select("id", { count: "exact", head: true })
          .or("owner_id.eq." + userId + ",buyer_id.eq." + userId)
          .neq("sender_id", userId).is("read_at", null),
        client.from("marketplace_message_blocks").select("owner_id,buyer_id,blocked_by,created_at")
          .or("owner_id.eq." + userId + ",buyer_id.eq." + userId)
      ]);
    } catch (error) {
      if (requestId !== state.socialLoadRequestId || !state.user || state.user.id !== userId) return;
      state.messagesInboxLoading = false;
      state.messagesInboxError = !state.messagesInboxLoaded;
      state.socialPermissionsError = true;
      console.warn("Buybook conversation data could not be refreshed", error);
      if (currentScreen() === "messages") renderConversations();
      renderUnreadBadges(state.messagesUnread, state.notificationsUnread);
      return;
    }

    if (requestId !== state.socialLoadRequestId || !state.user || state.user.id !== userId) return;
    state.messagesInboxLoading = false;
    state.socialPermissionsError = Boolean(results[0].error || results[1].error || results[5].error);

    if (!results[0].error) state.buyerSubscriptions = results[0].data || [];
    else console.warn("Buybook followed shops could not be refreshed", results[0].error);
    if (!results[1].error) state.sellerSubscriptions = results[1].data || [];
    else console.warn("Buybook buyer subscriptions could not be refreshed", results[1].error);

    if (!results[2].error) {
      const inboxRows = Array.isArray(results[2].data) ? results[2].data : [];
      const pageRows = inboxRows.slice(0, 30);
      state.messages = pageRows.map((row) => ({
        id: row.last_message_id || null,
        owner_id: row.owner_id,
        buyer_id: row.buyer_id,
        sender_id: row.last_sender_id || null,
        body: row.last_body || "",
        created_at: row.last_created_at || row.activity_at || null,
        activity_at: row.activity_at || row.last_created_at || null,
        read_at: row.last_read_at || null,
        attachment_path: row.last_attachment_path || null,
        unread_count: Number(row.unread_count || 0)
      }));
      state.messagesInboxHasMore = inboxRows.length > 30;
      const cursor = pageRows.length ? pageRows[pageRows.length - 1] : null;
      state.messagesInboxCursor = cursor ? {
        activity_at: cursor.activity_at || cursor.last_created_at,
        owner_id: cursor.owner_id,
        buyer_id: cursor.buyer_id
      } : null;
      state.messagesInboxLoaded = true;
      state.messagesInboxError = false;
    } else {
      console.warn("Buybook conversation inbox could not be loaded", results[2].error);
      state.messagesInboxError = true;
      if (!state.messagesInboxLoaded) {
        state.messages = [];
        state.messagesInboxHasMore = false;
        state.messagesInboxCursor = null;
      }
    }

    if (!results[3].error) state.ownShop = results[3].data || null;
    else console.warn("Buybook shop details could not be refreshed", results[3].error);
    if (!results[4].error) state.messagesUnread = Number(results[4].count || 0);
    else console.warn("Buybook unread message count could not be refreshed", results[4].error);
    if (!results[5].error) state.messageBlocks = results[5].data || [];
    else console.warn("Buybook conversation block status could not be refreshed", results[5].error);
    state.subscribedShopIds = new Set(state.buyerSubscriptions.map((row) => String(row.owner_id)));

    const ownerIds = Array.from(new Set(
      state.buyerSubscriptions.concat(state.sellerSubscriptions).map((row) => row.owner_id)
        .concat(state.messages.map((row) => row.owner_id)).filter(Boolean)
    ));
    const nextShopNames = Object.assign({}, state.shopNames);
    if (ownerIds.length) {
      try {
        const shopsResult = await client.from("marketplace_shops").select("owner_id,name").in("owner_id", ownerIds);
        if (requestId !== state.socialLoadRequestId || !state.user || state.user.id !== userId) return;
        if (!shopsResult.error) {
          (shopsResult.data || []).forEach((shop) => {
            nextShopNames[shop.owner_id] = shop.name || "Local shop";
          });
        } else {
          console.warn("Buybook conversation shop names could not be refreshed", shopsResult.error);
        }
      } catch (error) {
        console.warn("Buybook conversation shop names could not be refreshed", error);
      }
    }
    if (requestId !== state.socialLoadRequestId || !state.user || state.user.id !== userId) return;
    state.shopNames = nextShopNames;
    if (state.ownShop) state.shopNames[userId] = state.ownShop.name || "Your shop";
    buildConversations();
    if (currentScreen() === "me") renderMe();
    if (["product", "shop", "explore"].includes(currentScreen())) renderCatalog();
    if (currentScreen() === "messages") renderConversations();
    renderUnreadBadges(state.messagesUnread, state.notificationsUnread);
  }
  function buildConversations() {
    if (!state.user) { state.conversations = []; return; }
    const blocks = new Map();
    state.messageBlocks.forEach((row) => {
      const key = conversationKey(row.owner_id, row.buyer_id);
      const current = blocks.get(key) || { blockedByMe: false, blockedByOther: false };
      if (String(row.blocked_by) === String(state.user.id)) current.blockedByMe = true;
      else current.blockedByOther = true;
      blocks.set(key, current);
    });
    state.conversations = state.messages.map((row) => {
      const key = conversationKey(row.owner_id, row.buyer_id);
      const isShop = String(row.owner_id) === String(state.user.id);
      const canSend = isShop
        ? state.sellerSubscriptions.some((item) => String(item.owner_id) === String(row.owner_id) && String(item.buyer_id) === String(row.buyer_id))
        : state.buyerSubscriptions.some((item) => String(item.owner_id) === String(row.owner_id) && String(item.buyer_id) === String(row.buyer_id));
      const block = blocks.get(key) || { blockedByMe: false, blockedByOther: false };
      let lastMessage = String(row.body || "").trim();
      if (!lastMessage && row.attachment_path) lastMessage = "Photo";
      if (!lastMessage) lastMessage = row.id ? "New message" : "Start a conversation with this shop.";
      if (row.id && String(row.sender_id) === String(state.user.id)) lastMessage = "You: " + lastMessage;
      return {
        key, ownerId: row.owner_id, buyerId: row.buyer_id, isShop,
        createdAt: row.activity_at || row.created_at,
        name: isShop ? buyerDisplayName(row.buyer_id) : (state.shopNames[row.owner_id] || "Local shop"),
        lastMessage,
        lastAt: row.activity_at || row.created_at,
        unread: Number(row.unread_count || 0),
        blockedByMe: block.blockedByMe,
        blockedByOther: block.blockedByOther,
        blocked: block.blockedByMe || block.blockedByOther,
        canSend: canSend && !state.socialPermissionsError && !block.blockedByMe && !block.blockedByOther
      };
    }).sort((a, b) => {
      const activity = new Date(b.lastAt || 0).getTime() - new Date(a.lastAt || 0).getTime();
      return activity || a.key.localeCompare(b.key);
    });
    if (state.activeConversation) {
      const updated = state.conversations.find((row) =>
        String(row.ownerId) === String(state.activeConversation.ownerId) &&
        String(row.buyerId) === String(state.activeConversation.buyerId));
      if (updated) state.activeConversation = updated;
    }
  }

  function renderConversations() {
    const target = $("conversations-list");
    if (!target) return;
    if (!state.user) {
      target.innerHTML = '<div class="empty-state">Sign in to view your messages. <button class="text-button" type="button" data-open-signin>Sign in</button></div>';
      return;
    }
    document.querySelectorAll("[data-conversation-filter]").forEach((button) => {
      const selected = button.dataset.conversationFilter === state.conversationFilter;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    if (state.messagesInboxLoading && !state.messagesInboxLoaded && !state.messages.length) {
      target.innerHTML = '<div class="loading-card">Loading your conversations…</div>';
      return;
    }
    if (state.messagesInboxError && !state.messagesInboxLoaded) {
      target.innerHTML = '<div class="empty-state">Conversations could not be loaded. Check your connection and retry. <button class="text-button" type="button" data-retry-conversations>Retry</button></div>';
      return;
    }
    const search = String(state.conversationSearch || "").trim().toLowerCase();
    const rows = state.conversations.filter((conversation) => {
      if (state.conversationFilter === "unread" && !conversation.unread) return false;
      return !search || (conversation.name + " " + conversation.lastMessage).toLowerCase().includes(search);
    });
    let warning = "";
    if (state.messagesInboxError) {
      warning += '<div class="empty-state">Could not refresh conversations. Showing the last available list. <button class="text-button" type="button" data-retry-conversations>Retry</button></div>';
    }
    if (state.socialPermissionsError) {
      warning += '<div class="empty-state">Some conversation permissions could not be checked. Refresh before sending messages. <button class="text-button" type="button" data-retry-conversations>Retry</button></div>';
    }
    const more = state.messagesInboxHasMore
      ? '<div class="load-more-row"><button class="button button-secondary load-more-button" type="button" data-load-more-conversations' +
        (state.messagesInboxLoading ? " disabled" : "") + ">" +
        (state.messagesInboxLoading ? "Loading…" : "Load older conversations") + "</button></div>"
      : "";
    if (!rows.length) {
      const message = !state.conversations.length
        ? "No conversations yet. Follow a shop and send your first message from its product or shop page."
        : (state.conversationFilter === "unread" ? "No unread conversations on this page." : "No conversations match your search on this page.");
      target.innerHTML = warning + '<div class="empty-state">' + escapeHtml(message) + "</div>" + more;
      return;
    }
    target.innerHTML = warning + rows.map((conversation) =>
      '<button class="conversation-card' + (conversation.unread ? " has-unread" : "") +
      '" type="button" data-conversation-key="' + escapeHtml(conversation.key) + '">' +
      '<span class="conversation-avatar">' + escapeHtml(initials(conversation.name)) + '</span>' +
      '<span class="conversation-copy"><strong>' + escapeHtml(conversation.name) + "</strong><p>" +
      escapeHtml(conversation.lastMessage) + '</p></span><span class="conversation-meta">' +
      escapeHtml(formatConversationTime(conversation.lastAt)) +
      (conversation.unread ? '<span class="unread-dot">' + (conversation.unread > 99 ? "99+" : conversation.unread) + "</span>" : "") +
      "</span></button>"
    ).join("") + more;
  }
  async function loadMoreConversations() {
    if (!state.user || !state.supabase || state.messagesInboxLoading || !state.messagesInboxHasMore || !state.messagesInboxCursor) return;
    const cursor = state.messagesInboxCursor;
    const requestId = ++state.messagesInboxRequestId;
    const userId = state.user.id;
    state.messagesInboxLoading = true;
    renderConversations();
    try {
      const { data, error } = await state.supabase.rpc("get_marketplace_message_inbox", {
        p_limit: 31,
        p_before_at: cursor.activity_at,
        p_before_owner_id: cursor.owner_id,
        p_before_buyer_id: cursor.buyer_id
      });
      if (requestId !== state.messagesInboxRequestId || !state.user || state.user.id !== userId) return;
      if (error) throw error;
      const received = Array.isArray(data) ? data : [];
      const pageRows = received.slice(0, 30).map((row) => ({
        id: row.last_message_id || null,
        owner_id: row.owner_id,
        buyer_id: row.buyer_id,
        sender_id: row.last_sender_id || null,
        body: row.last_body || "",
        created_at: row.last_created_at || row.activity_at || null,
        activity_at: row.activity_at || row.last_created_at || null,
        read_at: row.last_read_at || null,
        attachment_path: row.last_attachment_path || null,
        unread_count: Number(row.unread_count || 0)
      }));
      const byKey = new Map(state.messages.map((row) => [conversationKey(row.owner_id, row.buyer_id), row]));
      pageRows.forEach((row) => byKey.set(conversationKey(row.owner_id, row.buyer_id), row));
      state.messages = Array.from(byKey.values()).sort((a, b) =>
        new Date(b.activity_at || b.created_at || 0).getTime() - new Date(a.activity_at || a.created_at || 0).getTime());
      state.messagesInboxHasMore = received.length > 30;
      if (pageRows.length) {
        const oldest = pageRows[pageRows.length - 1];
        state.messagesInboxCursor = { activity_at: oldest.activity_at || oldest.created_at, owner_id: oldest.owner_id, buyer_id: oldest.buyer_id };
      } else {
        state.messagesInboxHasMore = false;
      }
      state.messagesInboxError = false;
      const ownerIds = Array.from(new Set(pageRows.map((row) => row.owner_id).filter((id) => id && !state.shopNames[id])));
      if (ownerIds.length) {
        const shops = await state.supabase.from("marketplace_shops").select("owner_id,name").in("owner_id", ownerIds);
        if (!shops.error) (shops.data || []).forEach((shop) => { state.shopNames[shop.owner_id] = shop.name || "Local shop"; });
      }
      if (requestId !== state.messagesInboxRequestId || !state.user || state.user.id !== userId) return;
      buildConversations();
    } catch (error) {
      console.warn("Buybook could not load older conversations", error);
      if (!state.messages.length) state.messagesInboxError = true;
      notifyUser("Could not load older conversations. Please retry.", true);
    } finally {
      if (requestId === state.messagesInboxRequestId) {
        state.messagesInboxLoading = false;
        renderConversations();
      }
    }
  }

  async function ensureConversation(ownerId, buyerId) {
    const owner = String(ownerId || "");
    const buyer = String(buyerId || "");
    if (!owner || !buyer || !state.user || !state.supabase) return null;
    let conversation = state.conversations.find((row) =>
      String(row.ownerId) === owner && String(row.buyerId) === buyer);
    if (conversation) return conversation;
    const { data, error } = await state.supabase.from("marketplace_messages")
      .select("id,owner_id,buyer_id,sender_id,body,created_at,read_at,client_message_id,attachment_path,attachment_mime_type")
      .eq("owner_id", owner).eq("buyer_id", buyer)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (data) {
      upsertInboxMessage(data, { preserveUnread: true });
      conversation = state.conversations.find((row) =>
        String(row.ownerId) === owner && String(row.buyerId) === buyer);
      if (conversation) return conversation;
    }
    const isShop = owner === String(state.user.id);
    if (!isShop && !state.shopNames[owner]) {
      const shop = await state.supabase.from("marketplace_shops").select("owner_id,name").eq("owner_id", owner).maybeSingle();
      if (!shop.error && shop.data) state.shopNames[owner] = shop.data.name || "Local shop";
    }
    const subscribed = isShop
      ? state.sellerSubscriptions.some((row) => String(row.owner_id) === owner && String(row.buyer_id) === buyer)
      : state.buyerSubscriptions.some((row) => String(row.owner_id) === owner && String(row.buyer_id) === buyer);
    conversation = {
      key: conversationKey(owner, buyer), ownerId: owner, buyerId: buyer, isShop,
      name: isShop ? buyerDisplayName(buyer) : (state.shopNames[owner] || "Local shop"),
      createdAt: null, lastAt: null, lastMessage: "Start a conversation with this shop.",
      unread: 0, blockedByMe: false, blockedByOther: false, blocked: false, canSend: subscribed
    };
    const block = state.messageBlocks.find((row) => String(row.owner_id) === owner && String(row.buyer_id) === buyer);
    if (block) {
      conversation.blockedByMe = String(block.blocked_by) === String(state.user.id);
      conversation.blockedByOther = !conversation.blockedByMe;
      conversation.blocked = true;
      conversation.canSend = false;
    }
    state.conversations = [conversation].concat(state.conversations);
    return conversation;
  }

  async function loadConversationMessages(options) {
    const settings = options || {};
    const conversation = state.activeConversation;
    if (!conversation || !state.user || !state.supabase) return;
    if (settings.older && state.activeMessagesLoadingOlder) return;
    const requestId = ++state.activeMessagesRequestId;
    const userId = state.user.id;
    const keyAtStart = conversationKey(conversation.ownerId, conversation.buyerId);
    const pageSize = 50;
    const target = $("chat-messages");
    const requestIsCurrent = () => requestId === state.activeMessagesRequestId &&
      state.activeConversation &&
      conversationKey(state.activeConversation.ownerId, state.activeConversation.buyerId) === keyAtStart &&
      state.user && state.user.id === userId;
    if (settings.older) {
      state.activeMessagesLoadingOlder = true;
      renderChat({ preserveViewport: settings.viewport });
    } else if (target) {
      target.innerHTML = '<div class="loading-card">Loading conversation…</div>';
    }

    let query = state.supabase.from("marketplace_messages")
      .select("id,owner_id,buyer_id,sender_id,body,created_at,read_at,client_message_id,attachment_path,attachment_mime_type")
      .eq("owner_id", conversation.ownerId).eq("buyer_id", conversation.buyerId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(pageSize + 1);
    if (settings.older) {
      const oldest = state.activeMessages.find((row) => !row.pending);
      if (!oldest) {
        state.activeMessagesLoadingOlder = false;
        return;
      }
      query = query.or("created_at.lt." + oldest.created_at +
        ",and(created_at.eq." + oldest.created_at + ",id.lt." + oldest.id + ")");
    }

    let data;
    let error;
    try {
      const result = await query;
      data = result.data;
      error = result.error;
    } catch (requestError) {
      if (!requestIsCurrent()) return;
      state.activeMessagesLoadingOlder = false;
      console.warn("Buybook conversation messages could not be loaded", requestError);
      if (settings.older) {
        notifyUser("Earlier messages could not be loaded. Please retry.", true);
        renderChat({ preserveViewport: settings.viewport });
      } else {
        setFeedback("message-feedback", "Could not load messages. Check your connection and retry.", true);
        if (target) target.innerHTML = '<div class="empty-state">Could not load messages. Check your connection. <button class="text-button" type="button" data-retry-chat>Retry</button></div>';
      }
      return;
    }
    if (!requestIsCurrent()) return;
    state.activeMessagesLoadingOlder = false;
    if (error) {
      console.warn("Buybook conversation messages could not be loaded", error);
      if (settings.older) {
        notifyUser("Earlier messages could not be loaded. Please retry.", true);
        renderChat({ preserveViewport: settings.viewport });
      } else {
        setFeedback("message-feedback", "Could not load messages. Check your connection and retry.", true);
        if (target) target.innerHTML = '<div class="empty-state">Could not load messages. Check your connection. <button class="text-button" type="button" data-retry-chat>Retry</button></div>';
      }
      return;
    }

    const fetched = Array.isArray(data) ? data : [];
    const hasMore = fetched.length > pageSize;
    const rawPageRows = fetched.slice(0, pageSize).reverse();
    let pageRows = rawPageRows;
    try {
      pageRows = await signMessageAttachments(rawPageRows);
    } catch (attachmentError) {
      console.warn("Buybook private message images could not be refreshed", attachmentError);
    }
    if (!requestIsCurrent()) return;
    if (settings.older || settings.sync) {
      const byId = new Map(state.activeMessages.map((row) => [row.id, row]));
      pageRows.forEach((row) => byId.set(row.id, row));
      state.activeMessages = sortMessagesAscending(Array.from(byId.values()));
      if (settings.sync && state.activeMessages.length) {
        const latest = state.activeMessages[state.activeMessages.length - 1];
        upsertInboxMessage(latest, { preserveUnread: true });
      }
    } else {
      state.activeMessages = pageRows;
    }
    state.activeMessagesHasMore = settings.sync ? (hasMore || state.activeMessagesHasMore) : hasMore;
    renderChat({ forceBottom: !settings.older && !settings.sync, preserveViewport: settings.viewport });
  }
  async function loadOlderConversationMessages() {
    if (!state.activeMessagesHasMore || state.activeMessagesLoadingOlder) return;
    const target = $("chat-messages");
    const viewport = target ? { height: target.scrollHeight, top: target.scrollTop } : null;
    await loadConversationMessages({ older: true, viewport });
  }

  async function openConversation(key) {
    if (!requireAccount(null, "messages")) return;
    const conversation = state.conversations.find((row) => row.key === key);
    if (!conversation) return;
    state.messageSendRequestId += 1;
    state.messageSending = false;
    state.pendingMessage = null;
    state.messageSendRequestId += 1;
    state.messageSending = false;
    state.pendingMessage = null;
    state.activeConversation = conversation;
    state.activeMessages = [];
    state.activeMessagesHasMore = false;
    state.activeMessagesLoadingOlder = false;
    clearMessageAttachment(true);
    state.activeMessagesRequestId += 1;
    navigate("chat");
    $("chat-title").textContent = conversation.name;
    $("chat-subtitle").textContent = conversation.isShop ? "Buyer conversation" : "Shop conversation";
    $("chat-avatar").textContent = initials(conversation.name);
    $("chat-messages").innerHTML = '<div class="loading-card">Loading conversation…</div>';
    $("message-body").value = "";
    clearMessageAttachment();
    setFeedback("message-feedback", "");
    const userId = state.user.id;
    const ownerId = conversation.ownerId;
    const buyerId = conversation.buyerId;
    const keyAtStart = conversationKey(ownerId, buyerId);
    const messagesPromise = loadConversationMessages();
    try {
      const readResult = await state.supabase.rpc("mark_marketplace_conversation_read", {
        p_owner_id: ownerId, p_buyer_id: buyerId
      });
      if (!state.user || state.user.id !== userId ||
          !state.activeConversation ||
          conversationKey(state.activeConversation.ownerId, state.activeConversation.buyerId) !== keyAtStart) return;
      if (readResult.error) {
        setFeedback("message-feedback", "Messages opened, but read status could not be updated. Please refresh.", true);
      } else {
        markConversationReadLocally(ownerId, buyerId);
        await refreshUnreadMessageCount();
        await refreshConversationUnreadCount(ownerId, buyerId);
      }
    } catch (error) {
      if (state.user && state.user.id === userId && state.activeConversation &&
          conversationKey(state.activeConversation.ownerId, state.activeConversation.buyerId) === keyAtStart) {
        console.warn("Buybook conversation read status could not be updated", error);
        setFeedback("message-feedback", "Messages opened, but read status could not be updated. Please refresh.", true);
      }
    }
    await messagesPromise;
  }
  function messageDayLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Date unavailable" :
      date.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  }

  function messageTimeLabel(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" :
      date.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" });
  }

  function renderChat(options) {
    const settings = options || {};
    const target = $("chat-messages");
    if (!target || !state.activeConversation || !state.user) return;
    const conversation = state.activeConversation;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
    const previousHeight = target.scrollHeight;
    const previousTop = target.scrollTop;
    let previousDay = "";
    let markup = state.activeMessagesHasMore
      ? '<button class="text-button chat-load-older" type="button" data-load-older-messages' +
        (state.activeMessagesLoadingOlder ? " disabled" : "") + ">" +
        (state.activeMessagesLoadingOlder ? "Loading earlier messages…" : "Load earlier messages") + "</button>"
      : "";
    if (state.activeMessages.length) {
      markup += state.activeMessages.map((row) => {
        const day = messageDayLabel(row.created_at);
        const separator = day !== previousDay
          ? '<div class="message-day-separator"><span>' + escapeHtml(day) + "</span></div>" : "";
        previousDay = day;
        const mine = String(row.sender_id) === String(state.user.id);
        let status = "";
        if (row.pendingFailed) status = "Not sent · Tap Send to retry";
        else if (row.pending) status = "Sending…";
        else if (mine && row.read_at) status = "Read";
        else if (mine) status = "Sent";
        const attachmentMarkup = row.attachment_path
          ? (row.attachmentUrl
            ? '<a class="message-attachment-link" href="' + escapeHtml(row.attachmentUrl) + '" data-attachment-path="' + escapeHtml(row.attachment_path) + '" target="_blank" rel="noopener noreferrer"><img class="message-attachment-image" src="' + escapeHtml(row.attachmentUrl) + '" data-attachment-path="' + escapeHtml(row.attachment_path) + '" data-signed-at="' + escapeHtml(row.attachmentSignedAt || Date.now()) + '" alt="Image sent in this conversation" loading="lazy" decoding="async"></a>'
            : '<p class="message-attachment-missing">Image unavailable. Reopen the conversation to try again.</p>')
          : "";
        return separator + '<article class="message-bubble' + (mine ? " is-mine" : "") +
          (row.pendingFailed ? " is-failed" : "") + '">' + attachmentMarkup + '<p>' + escapeHtml(row.body) +
          "</p><time>" + escapeHtml(messageTimeLabel(row.created_at)) +
          (status ? " · " + escapeHtml(status) : "") + "</time></article>";
      }).join("");
    } else {
      markup += '<div class="empty-state">No messages yet. Write a message to start the conversation.</div>';
    }
    target.innerHTML = markup;
    const canSend = conversation.canSend !== false;
    $("message-body").disabled = !canSend || state.messageSending;
    $("message-send").disabled = !canSend || state.messageSending;
    const attachTrigger = $("message-attach-trigger");
    if (attachTrigger) attachTrigger.disabled = !canSend || state.messageSending;
    const blockButton = $("message-block-button");
    const participantType = conversation.isShop ? "buyer" : "shop";
    if (blockButton) {
      blockButton.textContent = conversation.blockedByMe ? "Unblock " + participantType : "Block " + participantType;
      blockButton.disabled = Boolean(conversation.blockedByOther && !conversation.blockedByMe);
      blockButton.setAttribute("aria-label", conversation.blockedByMe ? "Unblock this " + participantType : "Block this " + participantType);
    }
    const pendingFailed = state.activeMessages.some((row) => row.pendingFailed);
    const blockedMessage = conversation.blockedByMe
      ? "You blocked this conversation. Unblock to send messages."
      : (conversation.blockedByOther ? "This conversation is blocked by the other participant." : "");
    const cannotSendMessage = blockedMessage ||
      (state.socialPermissionsError
        ? "Buybook could not verify this conversation's permissions. Refresh Messages before sending."
        : "Follow this shop again before sending another message.");
    setFeedback("message-feedback",
      !canSend ? cannotSendMessage :
        (pendingFailed ? "Message not confirmed. Your text is kept here. Tap Send to retry safely." : ""),
      !canSend || pendingFailed);
    $("chat-title").textContent = conversation.name;
    if (settings.preserveViewport) {
      target.scrollTop = settings.preserveViewport.top + (target.scrollHeight - settings.preserveViewport.height);
    } else if (settings.forceBottom || nearBottom) {
      target.scrollTop = target.scrollHeight;
    } else if (previousHeight && previousTop) {
      target.scrollTop = previousTop;
    }
  }

  async function toggleFollow(ownerId, options) {
    const settings = options || {};
    if (!ownerId || !requireAccount({ type: "follow", ownerId: ownerId }, currentScreen())) return;
    if (String(ownerId) === String(state.user.id)) {
      notifyUser("You cannot follow your own shop.", true);
      return;
    }

    const ownerKey = String(ownerId);
    const following = settings.following === true ||
      (settings.following !== false && state.subscribedShopIds.has(ownerKey));
    if (state.followMutationIds.has(ownerKey)) return;

    const button = document.querySelector(
      '[data-follow-shop="' + CSS.escape(ownerKey) + '"], [data-unfollow-shop="' + CSS.escape(ownerKey) + '"]'
    );
    state.followMutationIds.add(ownerKey);
    if (button) {
      button.disabled = true;
      button.textContent = following ? "Unfollowing…" : "Following…";
    }

    try {
      const result = following
        ? await state.supabase.from("marketplace_store_subscriptions").delete()
          .eq("owner_id", ownerId).eq("buyer_id", state.user.id)
        : await state.supabase.from("marketplace_store_subscriptions").insert({
          owner_id: ownerId, buyer_id: state.user.id
        });
      if (result.error) throw result.error;

      if (following) {
        state.subscribedShopIds.delete(ownerKey);
        state.buyerSubscriptions = state.buyerSubscriptions.filter((row) => String(row.owner_id) !== ownerKey);
      } else {
        state.subscribedShopIds.add(ownerKey);
        state.buyerSubscriptions.unshift({
          owner_id: ownerId, buyer_id: state.user.id, created_at: new Date().toISOString()
        });
      }

      if (currentScreen() === "me") {
        if (following) {
          state.meFollowingRows = state.meFollowingRows.filter((row) => String(row.owner_id) !== ownerKey);
          state.meFollowingOffset = Math.max(0, state.meFollowingOffset - 1);
        }
        state.mePanelRequestId += 1;
        state.meFollowingLoading = false;
        state.mePanelLoadedAt = 0;
        buildConversations();
        renderMe();
        await loadMePanelData({ force: true });
      } else {
        await loadSocialData();
      }

      if (currentScreen() === "product" && state.activeProductId) openProduct(state.activeProductId);
      if (currentScreen() === "shop" && state.activeShopId) openShop(state.activeShopId);
    } catch (error) {
      console.warn("Buybook could not update the followed shop", error);
      notifyUser(following
        ? "Could not unfollow this shop. Check your connection and try again."
        : "Could not follow this shop. Confirm the shop is active and try again.", true);
      if (button) {
        button.disabled = false;
        button.textContent = following ? "Unfollow" : "Follow shop";
      }
    } finally {
      state.followMutationIds.delete(ownerKey);
      if (button && button.isConnected) button.disabled = false;
    }
  }

  async function executePendingAction(action) {
    if (!action || !state.user) return;
    if (action.type === "follow") await toggleFollow(action.ownerId);
    if (action.type === "reserve") await beginReservation(action.productId);
    if (action.type === "message") await startShopMessage(action.ownerId);
  }

  async function startShopMessage(ownerId) {
    if (!requireAccount({ type: "message", ownerId: ownerId }, currentScreen())) return;
    if (!state.subscribedShopIds.has(String(ownerId))) {
      notifyUser("Follow this shop before sending a message.", true);
      return;
    }
    try {
      const conversation = await ensureConversation(ownerId, state.user.id);
      if (!conversation) throw new Error("Conversation is not available.");
      await openConversation(conversation.key);
    } catch (error) {
      console.warn("Buybook could not open the shop conversation", error);
      notifyUser("This shop conversation is not available right now. Please try again.", true);
      navigate("messages");
    }
  }

  function reservationEffectiveStatus(row, nowTime) {
    const raw = String(row && row.status || "pending").toLowerCase();
    const expiry = row && row.expires_at ? Date.parse(row.expires_at) : NaN;
    if (raw === "pending" && Number.isFinite(expiry) && expiry <= (nowTime || Date.now())) return "expired";
    return raw;
  }

  function reservationStatusLabel(status) {
    const labels = {
      pending: "Pending", approved: "Approved", accepted: "Approved",
      ready: "Ready for collection", collected: "Collected",
      rejected: "Declined", declined: "Declined", cancelled: "Cancelled", expired: "Expired"
    };
    return labels[status] || String(status || "Status unavailable").replace(/[_-]+/g, " ");
  }

  function reservationStatusBucket(row, nowTime) {
    const status = reservationEffectiveStatus(row, nowTime);
    if (status === "pending") return "pending";
    if (["approved", "accepted", "ready"].includes(status)) return "approved";
    if (status === "collected") return "collected";
    return "closed";
  }

  function reservationStatusExplanation(status) {
    const messages = {
      pending: "Your request has been sent. Please wait for the shop to respond.",
      approved: "The shop approved your request. Message the shop to agree on collection arrangements. Payment is made in person.",
      accepted: "The shop approved your request. Message the shop to agree on collection arrangements. Payment is made in person.",
      ready: "Your product is marked ready. Contact the shop to confirm when to collect it.",
      collected: "This reservation has been marked as collected.",
      rejected: "The shop cannot fulfil this request. You can explore other shops.",
      declined: "The shop cannot fulfil this request. You can explore other shops.",
      cancelled: "This reservation was cancelled.",
      expired: "This request passed its reservation time limit. You can make a new request if the product is still available."
    };
    return messages[status] || "Message the shop if you need more information.";
  }

  function reservationReference(id) {
    const compact = String(id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
    return compact ? "BB-" + compact : "Not available";
  }

  function reservationTotal(row) {
    return (row && row.marketplace_reservation_items || []).reduce((sum, item) =>
      sum + (Number(item.unit_price) || 0) * (Number(item.quantity) || 0), 0);
  }

  function reservationFilterMatches(row, filter, nowTime) {
    return filter === "all" || reservationStatusBucket(row, nowTime) === filter;
  }

  function renderReservations() {
    const target = $("reservations-list");
    if (!target) return;
    if (!state.user) {
      target.innerHTML = '<div class="empty-state">Sign in to view your reservations. <button type="button" class="text-button" data-open-signin>Sign in</button></div>';
      return;
    }
    const visible = state.reservations.filter((row) => reservationFilterMatches(row, state.reservationFilter));
    if (!visible.length) {
      const emptyMessage = state.reservations.length
        ? "There are no reservations in this category."
        : "You have not made any reservations yet. Find a product and send a request.";
      target.innerHTML = '<div class="empty-state">' + escapeHtml(emptyMessage) + "</div>" +
        (state.reservationsHasMore ? '<div class="load-more-row"><button type="button" class="button button-secondary load-more-button" data-load-more-reservations>Load older reservations</button></div>' : "");
    } else {
      target.innerHTML = visible.map((row) => {
        const items = row.marketplace_reservation_items || [];
        const first = items[0] || {};
        const status = reservationEffectiveStatus(row);
        const statusLabel = reservationStatusLabel(status);
        const statusClass = status === "pending" ? "is-pending" :
          (["rejected", "declined", "cancelled", "expired"].includes(status) ? "is-danger" : "is-good");
        const productLabel = items.length > 1
          ? (first.product_name || "Product") + " +" + (items.length - 1) + " more"
          : (first.product_name || "Product reservation");
        const quantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
        return '<button class="list-card reservation-card" type="button" data-reservation-id="' + escapeHtml(row.id) + '">' +
          '<div class="row-between"><h3>' + escapeHtml(productLabel) + "</h3>" +
          '<span class="status-pill ' + statusClass + '">' + escapeHtml(statusLabel) + "</span></div>" +
          '<p class="muted-text">' + escapeHtml(state.shopNames[row.owner_id] || "Local shop") + " · " +
          escapeHtml(formatDate(row.created_at, false)) + "</p>" +
          '<p class="reservation-card-total">' + escapeHtml(String(quantity || 1)) + " item" + (quantity === 1 ? "" : "s") +
          " · " + money(reservationTotal(row)) + "</p>" +
          '<small class="muted-text">Reference ' + escapeHtml(reservationReference(row.id)) + "</small>" +
          "</button>";
      }).join("");
    }
    if (state.reservationsHasMore || state.reservationsLoadingMore) {
      target.innerHTML += '<div class="load-more-row"><button type="button" class="button button-secondary load-more-button" data-load-more-reservations' +
        (state.reservationsLoadingMore ? " disabled" : "") + ">" +
        (state.reservationsLoadingMore ? "Loading…" : "Load older reservations") + "</button></div>";
    }
  }

  async function loadReservations(options) {
    const settings = options || {};
    const more = settings.more === true;
    const target = $("reservations-list");
    if (!target) return;
    if (!state.user || !state.supabase) {
      if (!more) {
        state.reservations = [];
        state.reservationsHasMore = false;
        renderReservations();
      }
      return;
    }
    if (more && (state.reservationsLoadingMore || !state.reservationsHasMore)) return;
    const userId = state.user.id;
    const requestId = ++state.reservationsRequestId;
    const offset = more ? state.reservations.length : 0;
    const pageSize = 50;
    state.reservationsLoadingMore = more;
    if (!more && !state.reservations.length) target.innerHTML = '<div class="loading-card">Loading your reservations…</div>';
    else renderReservations();
    const current = () => requestId === state.reservationsRequestId && state.user && state.user.id === userId;
    try {
      const { data, error } = await state.supabase.from("marketplace_reservations")
        .select("id,buyer_id,status,buyer_note,created_at,updated_at,expires_at,owner_id,marketplace_reservation_items(product_name,unit_price,quantity,product_id)")
        .eq("buyer_id", userId).order("created_at", { ascending: false })
        .order("id", { ascending: false }).range(offset, offset + pageSize);
      if (!current()) return;
      if (error) throw error;
      const received = Array.isArray(data) ? data : [];
      const pageRows = received.slice(0, pageSize);
      state.reservations = more
        ? state.reservations.concat(pageRows.filter((row) => !state.reservations.some((old) => String(old.id) === String(row.id))))
        : pageRows;
      state.reservationsHasMore = received.length > pageSize;
      const ownerIds = Array.from(new Set(pageRows.map((row) => row.owner_id).filter((id) => id && !state.shopNames[id])));
      if (ownerIds.length) {
        const shops = await state.supabase.from("marketplace_shops").select("owner_id,name").in("owner_id", ownerIds);
        if (!current()) return;
        if (!shops.error) (shops.data || []).forEach((row) => { state.shopNames[row.owner_id] = row.name || "Local shop"; });
      }
      renderReservations();
      if (currentScreen() === "reservation" && state.activeReservationId) openReservation(state.activeReservationId);
    } catch (error) {
      if (!current()) return;
      if (!state.reservations.length) {
        target.innerHTML = '<div class="empty-state">Reservations could not be loaded. Check your connection and retry. <button type="button" class="text-button" data-retry-reservations>Retry</button></div>';
      } else {
        notifyUser("Could not refresh reservations. Showing the reservations already loaded.", true);
        renderReservations();
      }
    } finally {
      if (current()) {
        state.reservationsLoadingMore = false;
        renderReservations();
      }
    }
  }

  function openReservation(id) {
    const row = state.reservations.find((item) => String(item.id) === String(id));
    if (!row) return;
    state.activeReservationId = String(id);
    const items = row.marketplace_reservation_items || [];
    const status = reservationEffectiveStatus(row);
    const statusLabel = reservationStatusLabel(status);
    const statusClass = status === "pending" ? "is-pending" :
      (["rejected", "declined", "cancelled", "expired"].includes(status) ? "is-danger" : "is-good");
    const total = reservationTotal(row);
    const itemHtml = items.map((item) => {
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unit_price) || 0;
      return '<article class="list-card reservation-item-card"><div class="row-between"><h3>' +
        escapeHtml(item.product_name || "Product") + "</h3><strong>" + money(unitPrice * quantity) + "</strong></div><p>" +
        escapeHtml(String(quantity)) + " × " + money(unitPrice) + "</p></article>";
    }).join("");
    const ownerName = state.shopNames[row.owner_id] || "Local shop";
    const updatedAt = row.updated_at || row.created_at;
    $("reservation-detail-content").innerHTML =
      '<div class="reservation-detail-heading"><p class="eyebrow">RESERVATION DETAILS</p><h1 id="reservation-detail-title">' +
      escapeHtml(ownerName) + "</h1><span class=\"status-pill " + statusClass + "\">" + escapeHtml(statusLabel) + "</span>" +
      '<p class="reservation-status-explanation">' + escapeHtml(reservationStatusExplanation(status)) + "</p></div>" +
      '<section class="reservation-detail-section"><h2>Reserved products</h2><div class="stack-list">' + itemHtml + "</div>" +
      '<div class="reservation-total-row"><span>Listed total</span><strong>' + money(total) + "</strong></div>" +
      '<p class="muted-text">Based on the price saved when you made this request. Payment is made in person.</p></section>' +
      '<section class="reservation-detail-section"><h2>Request information</h2>' +
      '<p><span class="muted-text">Reference</span><strong class="reservation-reference">' + escapeHtml(reservationReference(row.id)) + "</strong></p>" +
      '<p><span class="muted-text">Requested</span><strong>' + escapeHtml(formatDate(row.created_at, true)) + "</strong></p>" +
      '<p><span class="muted-text">Last updated</span><strong>' + escapeHtml(formatDate(updatedAt, true)) + "</strong></p>" +
      (row.expires_at && status === "pending" ? '<p><span class="muted-text">Request expires</span><strong>' + escapeHtml(formatDate(row.expires_at, true)) + "</strong></p>" : "") +
      "</section>" +
      (row.buyer_note ? '<section class="reservation-detail-section"><h2>Your note to the shop</h2><p>' + escapeHtml(row.buyer_note) + "</p></section>" : "") +
      '<div class="detail-note">A reservation is a request, not a completed purchase. Contact the shop to agree on collection. Buybook does not process payment.</div>' +
      '<div class="detail-actions">' +
      (status === "pending" && row.expires_at && new Date(row.expires_at).getTime() > Date.now()
        ? '<button class="button button-secondary" type="button" data-cancel-reservation="' + escapeHtml(row.id) + '">Cancel reservation</button>'
        : "") +
      '<button class="button button-primary" type="button" data-message-shop="' + escapeHtml(row.owner_id) + '">Message shop</button></div>';
    navigate("reservation");
  }

  async function cancelBuyerReservation(id, button) {
    if (!state.user || !state.supabase) {
      notifyUser("Sign in to manage your reservations.", true);
      return;
    }
    const userId = state.user.id;
    let row = state.reservations.find((item) => String(item.id) === String(id));
    if (!row || String(row.buyer_id || userId) !== String(userId) ||
        reservationEffectiveStatus(row) !== "pending" ||
        !row.expires_at || new Date(row.expires_at).getTime() <= Date.now()) {
      notifyUser("This reservation can no longer be cancelled.", true);
      await loadReservations();
      return;
    }
    if (!window.confirm("Cancel this pending reservation? The shop will be notified.")) return;
    if (button) {
      button.disabled = true;
      button.textContent = "Cancelling…";
    }
    let cancellationConfirmed = false;
    try {
      const { data, error } = await state.supabase.rpc("cancel_marketplace_reservation", {
        p_reservation_id: String(id)
      });
      if (error) throw error;
      if (data !== true) throw new Error("The cancellation could not be confirmed.");
      cancellationConfirmed = true;
    } catch (error) {
      console.warn("Buybook reservation cancellation response was not confirmed", error);
      await loadReservations();
      row = state.reservations.find((item) => String(item.id) === String(id));
      if (row && reservationEffectiveStatus(row) === "cancelled") cancellationConfirmed = true;
      else notifyUser(error.message || "Could not cancel this reservation. Refresh and try again.", true);
    }
    if (cancellationConfirmed) {
      const refreshed = state.reservations.find((item) => String(item.id) === String(id));
      if (refreshed) {
        refreshed.status = "cancelled";
        refreshed.updated_at = refreshed.updated_at || new Date().toISOString();
        openReservation(id);
      }
      renderReservations();
      await loadNotifications();
      notifyUser("Reservation cancelled. The shop has been notified.");
    }
    if (button) {
      button.disabled = false;
      button.textContent = "Cancel reservation";
    }
  }
  async function beginReservation(productId) {
    state.activeProductId = String(productId || "");
    if (!requireAccount({ type: "reserve", productId: productId }, currentScreen())) return;
    const product = productById(productId);
    if (!product || !product.owner_id) {
      notifyUser("This product is not available for reservation.", true);
      return;
    }
    if (String(product.owner_id) === String(state.user.id)) {
      notifyUser("You cannot reserve a product from your own shop.", true);
      return;
    }
    if (!state.subscribedShopIds.has(String(product.owner_id))) {
      notifyUser("Follow this shop before requesting a reservation. Use Follow shop on the product page first.", true);
      return;
    }
    if (product.stock_status === "out_of_stock") {
      setFeedback("reserve-feedback", "This product is marked out of stock.", true);
      return;
    }
    $("reserve-product-name").textContent = product.name + " · " + money(product.price, product.currency) + " per " + (product.unit || "item");
    $("reserve-quantity").value = "1";
    $("reserve-note").value = "";
    state.reservationRequestKey = createReservationRequestKey();
    state.reservationSubmitting = false;
    setFeedback("reserve-feedback", "");
    $("reserve-submit").disabled = false;
    $("reserve-submit").textContent = "Send request";
    $("reserve-dialog").showModal();
  }

  async function submitReservation(event) {
    event.preventDefault();
    if (!state.user || !state.supabase || state.reservationSubmitting) return;
    const userId = state.user.id;
    const productId = state.activeProductId;
    const product = productById(productId);
    if (!product || !product.owner_id) {
      setFeedback("reserve-feedback", "Please close this form and open the product again.", true);
      return;
    }
    const quantity = Number($("reserve-quantity").value);
    const note = $("reserve-note").value.trim();
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
      setFeedback("reserve-feedback", "Enter a whole number between 1 and 1,000.", true);
      return;
    }
    if (note.length > 500) {
      setFeedback("reserve-feedback", "The note must be 500 characters or fewer.", true);
      return;
    }
    if (!state.reservationRequestKey) state.reservationRequestKey = createReservationRequestKey();
    const requestKey = state.reservationRequestKey;
    state.reservationSubmitting = true;
    const button = $("reserve-submit");
    button.disabled = true;
    button.textContent = "Sending…";
    setFeedback("reserve-feedback", "Sending your request…");
    let reservationId = null;
    try {
      const result = await state.supabase.rpc("create_marketplace_reservation_v2", {
        p_product_id: product.id,
        p_quantity: quantity,
        p_buyer_note: note,
        p_request_key: requestKey
      });
      if (result.error) throw result.error;
      reservationId = result.data || null;
      if (!reservationId) throw new Error("The shop did not confirm this reservation. Please retry.");
    } catch (error) {
      state.reservationSubmitting = false;
      if (state.user && state.user.id === userId && state.reservationRequestKey === requestKey) {
        setFeedback("reserve-feedback", error.message || "The request could not be confirmed. Check your Reservations before trying again.", true);
        button.disabled = false;
        button.textContent = "Try again";
      }
      console.warn("Buybook reservation request could not be confirmed", error);
      return;
    }
    if (!state.user || state.user.id !== userId) return;
    state.reservationSubmitting = false;
    if (state.reservationRequestKey === requestKey) state.reservationRequestKey = null;
    $("reserve-dialog").close();
    navigate("reservations");
    await loadReservations();
    await loadNotifications();
    notifyUser("Reservation request sent. Follow its status in Reservations.");
  }
  async function toggleConversationBlock() {
    const conversation = state.activeConversation;
    if (!conversation || !state.user || !state.supabase) return;
    if (conversation.blockedByOther && !conversation.blockedByMe) {
      notifyUser("The other participant has blocked this conversation.", true);
      return;
    }
    const userId = state.user.id;
    const keyAtStart = conversationKey(conversation.ownerId, conversation.buyerId);
    const button = $("message-block-button");
    const blocking = !conversation.blockedByMe;
    const participantType = conversation.isShop ? "buyer" : "shop";
    if (blocking && !window.confirm("Block this " + participantType + "? You will no longer be able to send messages in this conversation.")) return;
    if (button) {
      button.disabled = true;
      button.textContent = blocking ? "Blocking…" : "Unblocking…";
    }
    try {
      const result = blocking
        ? await state.supabase.from("marketplace_message_blocks").insert({
            owner_id: conversation.ownerId,
            buyer_id: conversation.buyerId,
            blocked_by: userId
          })
        : await state.supabase.from("marketplace_message_blocks")
            .delete().eq("owner_id", conversation.ownerId)
            .eq("buyer_id", conversation.buyerId).eq("blocked_by", userId);
      if (result.error) throw result.error;
      if (!state.user || state.user.id !== userId) return;
      const optionsMenu = document.querySelector(".chat-options");
      if (optionsMenu) optionsMenu.open = false;
      await loadSocialData();
      if (state.activeConversation &&
          conversationKey(state.activeConversation.ownerId, state.activeConversation.buyerId) === keyAtStart) {
        const updated = state.conversations.find((row) => row.key === keyAtStart);
        if (updated) state.activeConversation = updated;
        renderChat();
      }
      notifyUser(blocking ? "Conversation blocked." : "Conversation unblocked.");
    } catch (error) {
      console.warn("Buybook conversation block update failed", error);
      notifyUser(blocking ? "Could not block this conversation. Please retry." : "Could not unblock this conversation. Please retry.", true);
    } finally {
      if (button && state.activeConversation &&
          conversationKey(state.activeConversation.ownerId, state.activeConversation.buyerId) === keyAtStart) {
        button.disabled = Boolean(state.activeConversation.blockedByOther && !state.activeConversation.blockedByMe);
        button.textContent = state.activeConversation.blockedByMe ? "Unblock " + participantType : "Block " + participantType;
      }
    }
  }
  function openMessageReportDialog() {
    if (!state.activeConversation || !state.user) return;
    const dialog = $("message-report-dialog");
    if (!dialog) return;
    $("message-report-details").value = "";
    setFeedback("message-report-feedback", "");
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  async function submitMessageReport(event) {
    event.preventDefault();
    const conversation = state.activeConversation;
    if (!conversation || !state.user || !state.supabase) return;
    const reason = $("message-report-reason").value;
    const details = $("message-report-details").value.trim();
    if (details.length > 500) {
      setFeedback("message-report-feedback", "Please keep the details under 500 characters.", true);
      return;
    }
    const button = $("message-report-submit");
    button.disabled = true;
    button.textContent = "Submitting…";
    try {
      const latestIncoming = state.activeMessages.slice().reverse().find((row) =>
        !row.pending && String(row.sender_id) !== String(state.user.id));
      const { error } = await state.supabase.from("marketplace_message_reports").insert({
        owner_id: conversation.ownerId,
        buyer_id: conversation.buyerId,
        reporter_id: state.user.id,
        message_id: latestIncoming ? latestIncoming.id : null,
        reason,
        details
      });
      if (error) {
        if (String(error.code || "") === "23505") {
          throw new Error("You have already reported this conversation. Buybook support will review it.");
        }
        throw error;
      }
      $("message-report-dialog").close();
      notifyUser("Report submitted. Buybook support can review it.");
    } catch (error) {
      console.warn("Buybook message report failed", error);
      setFeedback("message-report-feedback",
        error.message || "Could not submit your report. Please check your connection and retry.", true);
    } finally {
      button.disabled = false;
      button.textContent = "Submit report";
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (state.messageSending || !state.user || !state.supabase || !state.activeConversation) return;
    const textBody = $("message-body").value.trim();
    const attachmentFile = state.pendingAttachmentFile;
    const body = textBody || (attachmentFile ? "Photo" : "");
    if (!body || body.length > 2000) {
      setFeedback("message-feedback", "Write a message or attach one image (up to 3 MB).", true);
      return;
    }
    const conversation = state.activeConversation;
    if (conversation.canSend === false) {
      setFeedback("message-feedback", "You cannot send messages in this conversation while it is blocked or unfollowed.", true);
      return;
    }
    let pending = state.pendingMessage;
    if (!pending || pending.body !== body ||
        String(pending.ownerId) !== String(conversation.ownerId) ||
        String(pending.buyerId) !== String(conversation.buyerId) ||
        pending.attachmentFile !== attachmentFile) {
      pending = {
        clientMessageId: createReservationRequestKey(),
        body, ownerId: conversation.ownerId, buyerId: conversation.buyerId,
        attachmentFile,
        attachmentPath: null,
        attachmentMimeType: attachmentFile ? attachmentFile.type : null
      };
      state.pendingMessage = pending;
    }

    const userId = state.user.id;
    const keyAtStart = conversationKey(conversation.ownerId, conversation.buyerId);
    const sendRequestId = ++state.messageSendRequestId;
    const requestIsCurrent = () => sendRequestId === state.messageSendRequestId &&
      state.user && state.user.id === userId && state.activeConversation &&
      conversationKey(state.activeConversation.ownerId, state.activeConversation.buyerId) === keyAtStart;
    state.messageSending = true;
    const button = $("message-send");
    if (button) {
      button.disabled = true;
      button.textContent = "Sending…";
    }
    updateMessageAttachmentUI();
    setFeedback("message-feedback", "");

    try {
      await upsertActiveMessage({
        id: "pending-" + pending.clientMessageId,
        client_message_id: pending.clientMessageId,
        owner_id: pending.ownerId, buyer_id: pending.buyerId,
        sender_id: userId, body: pending.body,
        created_at: new Date().toISOString(), read_at: null, pending: true,
        attachment_path: pending.attachmentPath,
        attachment_mime_type: pending.attachmentMimeType
      });

      if (pending.attachmentFile && !pending.attachmentPath) {
        const extension = pending.attachmentMimeType === "image/png" ? "png"
          : (pending.attachmentMimeType === "image/webp" ? "webp" : "jpg");
        const path = pending.ownerId + "/" + pending.buyerId + "/" + userId + "/" +
          pending.clientMessageId + "." + extension;
        const { error: uploadError } = await state.supabase.storage
          .from("buybook-message-attachments")
          .upload(path, pending.attachmentFile, {
            contentType: pending.attachmentMimeType,
            upsert: true,
            cacheControl: "3600"
          });
        if (uploadError) throw uploadError;
        pending.attachmentPath = path;
      }

      if (!state.user || state.user.id !== userId) throw new Error("Your account changed before the message was confirmed.");
      const fields = "id,owner_id,buyer_id,sender_id,body,created_at,read_at,client_message_id,attachment_path,attachment_mime_type";
      const result = await state.supabase.from("marketplace_messages").insert({
        owner_id: pending.ownerId, buyer_id: pending.buyerId,
        sender_id: userId, body: pending.body,
        client_message_id: pending.clientMessageId,
        attachment_path: pending.attachmentPath,
        attachment_mime_type: pending.attachmentMimeType
      }).select(fields).single();
      let saved = result.data || null;
      if (result.error || !saved) {
        const recovery = await state.supabase.from("marketplace_messages")
          .select(fields)
          .eq("sender_id", userId).eq("client_message_id", pending.clientMessageId).maybeSingle();
        if (!recovery.error && recovery.data) saved = recovery.data;
      }
      if (!saved) {
        if (requestIsCurrent()) {
          state.activeMessages = state.activeMessages.map((row) =>
            row.client_message_id === pending.clientMessageId
              ? Object.assign({}, row, { pending: false, pendingFailed: true }) : row);
          setFeedback("message-feedback", "Message not confirmed. Your text/photo is kept here. Tap Send to retry safely.", true);
        }
        return;
      }

      if (state.user && state.user.id === userId) {
        let hydrated = saved;
        try { hydrated = (await signMessageAttachments([saved]))[0]; }
        catch (attachmentError) { console.warn("Buybook sent photo link could not be refreshed", attachmentError); }
        upsertInboxMessage(saved);
        if (requestIsCurrent()) {
          state.activeMessages = state.activeMessages.filter((row) => row.client_message_id !== pending.clientMessageId);
          state.activeMessages.push(hydrated);
          state.activeMessages = sortMessagesAscending(state.activeMessages);
          renderChat({ forceBottom: true });
          $("message-body").value = "";
          clearMessageAttachment();
          $("message-body").focus();
        }
      }
      if (sendRequestId === state.messageSendRequestId && state.pendingMessage === pending) {
        state.pendingMessage = null;
      }
    } catch (error) {
      console.warn("Buybook message send failed", error);
      if (requestIsCurrent()) {
        state.activeMessages = state.activeMessages.map((row) =>
          row.client_message_id === pending.clientMessageId
            ? Object.assign({}, row, { pending: false, pendingFailed: true }) : row);
        setFeedback("message-feedback", error.message || "Message not confirmed. Your text/photo is kept here. Tap Send to retry safely.", true);
      }
    } finally {
      if (sendRequestId === state.messageSendRequestId) {
        state.messageSending = false;
        if (button && currentScreen() === "chat") {
          button.disabled = Boolean(state.activeConversation && state.activeConversation.canSend === false);
          button.textContent = "Send";
          updateMessageAttachmentUI();
          renderChat();
        }
      }
    }
  }
  async function refreshNotificationUnreadCount() {
    if (!state.user || !state.supabase) return;
    const userId = state.user.id;
    try {
      const { data, error } = await state.supabase.rpc("get_my_unread_notification_count");
      if (error) throw error;
      if (!state.user || state.user.id !== userId) return;
      state.notificationsUnread = Math.max(0, Number(data || 0));
      state.notificationsUnreadLoaded = true;
      renderUnreadBadges(state.messagesUnread, state.notificationsUnread);
    } catch (error) {
      console.warn("Buybook unread notification count could not be refreshed", error);
      if (state.user && state.user.id === userId && !state.notificationsUnreadLoaded) {
        state.notificationsUnread = state.notifications.filter((row) => !state.notificationReads.has(row.id)).length;
        renderUnreadBadges(state.messagesUnread, state.notificationsUnread);
      }
    }
  }
  async function loadNotifications() {
    const target = $("notifications-list");
    if (!target) return;
    const requestId = ++state.notificationLoadRequestId;
    if (!state.user || !state.supabase) {
      state.notifications = [];
      state.notificationsUnread = 0;
      state.notificationsUnreadLoaded = false;
      state.notificationReads = new Set();
      target.innerHTML = '<div class="empty-state">Sign in to see your notifications. <button type="button" class="text-button" data-open-signin>Sign in</button></div>';
      renderUnreadBadges(0, 0);
      return;
    }
    const userId = state.user.id;
    target.innerHTML = '<div class="loading-card">Loading notifications…</div>';
    try {
      const results = await Promise.all([
        state.supabase.from("app_notifications")
          .select("id,title,body,kind,created_at,expires_at,recipient_id,reservation_id,conversation_owner_id,conversation_buyer_id")
          .or("recipient_id.eq." + userId + ",recipient_id.is.null")
          .order("created_at", { ascending: false }).limit(100),
        state.supabase.from("notification_reads")
          .select("notification_id,read_at").eq("user_id", userId)
          .order("read_at", { ascending: false }).limit(500),
        state.supabase.rpc("get_my_unread_notification_count")
      ]);
      if (requestId !== state.notificationLoadRequestId || !state.user || state.user.id !== userId) return;
      if (results[0].error || results[1].error) throw (results[0].error || results[1].error);
      const now = Date.now();
      state.notifications = (results[0].data || []).filter((row) =>
        !row.expires_at || new Date(row.expires_at).getTime() > now);
      state.notificationReads = new Set((results[1].data || []).map((row) => row.notification_id));
      if (!results[2].error) {
        state.notificationsUnread = Math.max(0, Number(results[2].data || 0));
        state.notificationsUnreadLoaded = true;
      } else {
        console.warn("Buybook total unread notification count could not be loaded", results[2].error);
        if (!state.notificationsUnreadLoaded) {
          state.notificationsUnread = state.notifications.filter((row) => !state.notificationReads.has(row.id)).length;
        }
      }
      renderNotifications();
      renderUnreadBadges(state.messagesUnread, state.notificationsUnread);
    } catch (error) {
      if (requestId !== state.notificationLoadRequestId) return;
      console.warn("Buybook notifications could not be loaded", error);
      target.innerHTML = '<div class="empty-state">Notifications could not be loaded. Check your connection and try again. <button type="button" class="text-button" data-retry-notifications>Retry</button></div>';
    }
  }
  function renderNotifications() {
    const target = $("notifications-list");
    if (!target) return;
    const visible = state.notifications.filter((row) => {
      if (state.notificationFilter === "all") return true;
      if (state.notificationFilter === "reservation") return row.kind === "reservation" || Boolean(row.reservation_id);
      return row.kind === state.notificationFilter;
    });
    if (!visible.length) {
      target.innerHTML = '<div class="empty-state">No notifications in this category yet.</div>';
      return;
    }
    target.innerHTML = visible.map((row) => {
      const unread = !state.notificationReads.has(row.id);
      return '<article class="list-card"><div class="row-between"><span class="status-pill">' +
        escapeHtml((row.kind || "update").replace(/_/g, " ")) + "</span>" +
        (unread ? '<span class="unread-dot">New</span>' : "") + "</div>" +
        "<h3>" + escapeHtml(row.title || "Notification") + "</h3><p>" +
        escapeHtml(row.body || "") + "</p><p class=\"muted-text\">" + escapeHtml(formatDate(row.created_at, true)) + "</p>" +
        (unread ? '<button class="text-button" type="button" data-read-notification="' + escapeHtml(row.id) + '">Mark as read</button>' : "") +
        (row.reservation_id ? '<button class="text-button" type="button" data-open-reservation-from-notification="' + escapeHtml(row.reservation_id) + '">View reservation</button>' : "") +
        (row.kind === "message" && row.conversation_owner_id && row.conversation_buyer_id
          ? '<button class="text-button" type="button" data-open-message-from-notification="' + escapeHtml(row.id) +
            '" data-message-owner="' + escapeHtml(row.conversation_owner_id) +
            '" data-message-buyer="' + escapeHtml(row.conversation_buyer_id) + '">Open conversation</button>' : "") +
        "</article>";
    }).join("");
  }

  async function markNotificationRead(id) {
    if (!state.user || !state.supabase || state.notificationReads.has(id)) return;
    const userId = state.user.id;
    try {
      const { error } = await state.supabase.from("notification_reads").insert({
        notification_id: id,
        user_id: userId
      });
      if (error && !String(error.code || "").includes("23505")) throw error;
      if (!state.user || state.user.id !== userId) return;
      state.notificationReads.add(id);
      state.notificationsUnread = Math.max(0, state.notificationsUnread - 1);
      renderNotifications();
      renderUnreadBadges(state.messagesUnread, state.notificationsUnread);
      await refreshNotificationUnreadCount();
    } catch (error) {
      console.warn("Buybook notification read update failed", error);
      notifyUser("This notification could not be marked as read. Please retry.", true);
    }
  }
  async function signOut() {
    if (state.signingOut) return;
    if (!state.supabase) {
      notifyUser("Account service is unavailable. Please try again.", true);
      return;
    }
    state.signingOut = true;
    renderMe();
    try {
      if (window.BuybookLocator && window.BuybookLocator.isActive()) {
        const stopped = await window.BuybookLocator.stop();
        if (!stopped) {
          notifyUser("Stop live location sharing before signing out.", true);
          return;
        }
      }

      const { error } = await state.supabase.auth.signOut({ scope: "local" });
      if (error) {
        const sessionResult = await state.supabase.auth.getSession();
        if (sessionResult.error || (sessionResult.data && sessionResult.data.session)) throw error;
        console.warn("Buybook signed out locally, but server session cleanup was not confirmed", error);
        notifyUser("You are signed out on this device, but server session cleanup could not be confirmed.", true);
      } else {
        notifyUser("You have signed out.");
      }
      state.user = null;
      state.pendingAction = null;
      state.mePanelRequestId += 1;
      renderHeaderAvatar();
      renderMe();
      navigate("home");
    } catch (error) {
      console.warn("Buybook could not sign out", error);
      notifyUser("Could not sign out. Check your connection and try again.", true);
    } finally {
      state.signingOut = false;
      renderMe();
    }
  }

  function messageShopFromDetail(ownerId) {
    if (!requireAccount({ type: "message", ownerId: ownerId }, currentScreen())) return;
    if (!state.subscribedShopIds.has(String(ownerId))) {
      notifyUser("Follow this shop before messaging the seller.", true);
      return;
    }
    startShopMessage(ownerId);
  }

  async function executeClickAction(event) {
    const target = event.target.closest("button, a");
    if (!target) return;
    if (target.matches("[data-nav-screen]")) {
      navigate(target.dataset.navScreen);
      return;
    }
    if (target.matches("[data-screen-link]")) {
      navigate(target.dataset.screenLink);
      const scrollTarget = target.dataset.scrollTarget;
      if (scrollTarget) {
        window.requestAnimationFrame(() => {
          const section = $(scrollTarget);
          if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
      return;
    }
    if (target.matches("[data-back]")) {
      goBack();
      return;
    }
    if (target.matches("[data-go-home]")) {
      event.preventDefault();
      navigate("home");
      return;
    }
    if (target.matches("[data-open-signup]")) {
      openSignUp(currentScreen());
      return;
    }
    if (target.matches("[data-open-signin]")) {
      openSignIn(null, currentScreen());
      return;
    }
    if (target.matches("[data-auth-mode]")) {
      const returnTo = state.returnAfterSignIn || currentScreen();
      if (target.dataset.authMode === "signup") openSignUp(returnTo);
      else openSignIn(state.pendingAction, returnTo);
      return;
    }
    if (target.id === "profile-button") {
      navigate("me");
      return;
    }
    if (target.id === "notifications-button") {
      navigate("notifications");
      return;
    }
    if (target.id === "google-signin") {
      await startGoogleSignIn();
      return;
    }
    if (target.id === "sign-out-button") {
      await signOut();
      return;
    }
    if (target.matches("[data-category-key]")) {
      state.selectedCategory = state.selectedCategory === target.dataset.categoryKey ? "" : target.dataset.categoryKey;
      renderCategoryChips();
      if (currentScreen() !== "explore") navigate("explore");
      scheduleExploreRefresh(true);
      return;
    }
    if (target.matches("[data-product-id]")) {
      openProduct(target.dataset.productId);
      return;
    }
    if (target.matches("[data-shop-id]")) {
      openShop(target.dataset.shopId);
      return;
    }
    if (target.matches("[data-locate-shop]")) {
      const locator = window.BuybookLocator;
      if (locator && locator.isActive()) {
        notifyUser("Stop sharing live location with the current shop before locating a different shop.", true);
        return;
      }
      if (locator && typeof locator.resetPreview === "function") locator.resetPreview();
      state.pendingLocationContext = {
        ownerId: target.dataset.locateShop,
        productId: target.dataset.locateProduct || null,
        shopName: target.dataset.locateName || "Local shop",
        address: "",
        latitude: "",
        longitude: ""
      };
      navigate("locate");
      $("locate-title").textContent = "Locate " + state.pendingLocationContext.shopName;
      $("locate-status").textContent = "Loading the seller’s saved shop location…";
      $("locate-start").hidden = false;
      $("locate-stop").hidden = true;
      if (locator && state.pendingLocationContext) {
        try {
          await locator.preview({ ...state.pendingLocationContext, supabase: state.supabase });
        } catch (error) {
          $("locate-status").textContent = error.message || "Could not load this shop’s location.";
          $("locate-status").classList.add("is-error");
        }
      }
      return;
    }
    if (target.id === "locate-start") {
      const locator = window.BuybookLocator;
      const context = state.pendingLocationContext;
      if (!locator || !context) {
        notifyUser("The shop location is unavailable. Return to the shop and try again.", true);
        return;
      }
      target.disabled = true;
      target.textContent = "Starting live location…";
      try {
        await locator.start({ ...context, supabase: state.supabase });
      } catch (error) {
        const status = $("locate-status");
        if (status) {
          status.textContent = error.message || "Could not start location sharing.";
          status.classList.add("is-error");
        }
      } finally {
        target.disabled = false;
        target.textContent = "Start live location sharing";
        target.hidden = locator.isActive();
        $("locate-stop").hidden = !locator.isActive();
      }
      return;
    }
    if (target.matches("[data-follow-shop]")) {
      await toggleFollow(target.dataset.followShop);
      return;
    }
    if (target.matches("[data-unfollow-shop]")) {
      await toggleFollow(target.dataset.unfollowShop, { following: true });
      return;
    }
    if (target.matches("[data-load-more-following]")) {
      await loadMePanelData({ append: true, force: true });
      return;
    }
    if (target.matches("[data-retry-me]")) {
      await loadMePanelData({ force: true });
      return;
    }
    if (target.matches("[data-reserve-product]")) {
      state.activeProductId = target.dataset.reserveProduct;
      await beginReservation(target.dataset.reserveProduct);
      return;
    }
    if (target.matches("[data-cancel-reservation]")) {
      await cancelBuyerReservation(target.dataset.cancelReservation, target);
      return;
    }
    if (target.matches("[data-message-shop]")) {
      await messageShopFromDetail(target.dataset.messageShop);
      return;
    }
    if (target.id === "message-block-button") {
      await toggleConversationBlock();
      return;
    }
    if (target.id === "message-report-button") {
      openMessageReportDialog();
      return;
    }
    if (target.matches("[data-conversation-filter]")) {
      state.conversationFilter = target.dataset.conversationFilter === "unread" ? "unread" : "all";
      renderConversations();
      return;
    }
    if (target.matches("[data-load-older-messages]")) {
      await loadOlderConversationMessages();
      return;
    }
    if (target.matches("[data-load-more-conversations]")) {
      await loadMoreConversations();
      return;
    }
    if (target.matches("[data-retry-conversations]")) {
      await loadSocialData();
      return;
    }
    if (target.matches("[data-retry-chat]")) {
      await loadConversationMessages();
      return;
    }
    if (target.matches("[data-conversation-key]")) {
      await openConversation(target.dataset.conversationKey);
      return;
    }
    if (target.matches("[data-reservation-id]")) {
      openReservation(target.dataset.reservationId);
      return;
    }
    if (target.matches("[data-load-more-reservations]")) {
      await loadReservations({ more: true });
      return;
    }
    if (target.matches("[data-retry-reservations]")) {
      await loadReservations();
      return;
    }
    if (target.matches("[data-retry-notifications]")) {
      await loadNotifications();
      return;
    }
    if (target.matches("[data-read-notification]")) {
      await markNotificationRead(target.dataset.readNotification);
      return;
    }
    if (target.matches("[data-open-message-from-notification]")) {
      const notificationId = target.dataset.openMessageFromNotification;
      const ownerId = target.dataset.messageOwner;
      const buyerId = target.dataset.messageBuyer;
      await markNotificationRead(notificationId);
      await loadSocialData();
      const conversation = await ensureConversation(ownerId, buyerId);
      if (!conversation) {
        notifyUser("This conversation could not be opened. Refresh Messages and try again.", true);
        return;
      }
      await openConversation(conversation.key);
      return;
    }
    if (target.matches("[data-open-reservation-from-notification]")) {
      const id = target.dataset.openReservationFromNotification;
      await loadReservations();
      openReservation(id);
      return;
    }
    if (target.matches("[data-retry-catalog]")) {
      await loadCatalog();
      return;
    }
    if (target.matches("[data-load-more-products]")) {
      await loadMoreProducts();
      return;
    }
    if (target.matches("[data-load-more-shops]")) {
      await loadMoreShops();
      return;
    }
    if (target.matches("[data-clear-explore]") || target.id === "clear-filters") {
      clearExploreFilters();
    }
  }

  function handleMessageConnectionRestored() {
    setOfflineBanner();
    if (!state.user || !state.supabase) return;
    startRealtime();
    const screen = currentScreen();
    if (screen === "messages") loadSocialData().catch((error) => console.warn("Inbox reconnect refresh failed", error));
    if (screen === "chat" && state.activeConversation) {
      const ownerId = state.activeConversation.ownerId;
      const buyerId = state.activeConversation.buyerId;
      loadConversationMessages({ sync: true }).catch((error) => console.warn("Chat reconnect refresh failed", error));
      state.supabase.rpc("mark_marketplace_conversation_read", {
        p_owner_id: ownerId, p_buyer_id: buyerId
      }).then(({ error }) => {
        if (error) return refreshConversationUnreadCount(ownerId, buyerId);
        markConversationReadLocally(ownerId, buyerId);
        return refreshUnreadMessageCount();
      }).catch((error) => console.warn("Buybook reconnect read update failed", error));
    }
    refreshUnreadMessageCount().catch((error) => console.warn("Unread count reconnect refresh failed", error));
  }

  function bindEvents() {
    document.addEventListener("click", (event) => { executeClickAction(event).catch((error) => console.error("Buybook action failed", error)); });
    document.addEventListener("error", (event) => {
      handleMessageAttachmentImageError(event).catch((error) => console.warn("Buybook image recovery failed", error));
    }, true);
    $("home-search").addEventListener("submit", (event) => {
      event.preventDefault();
      $("explore-query").value = $("home-query").value.trim();
      navigate("explore");
      scheduleExploreRefresh(true);
    });
    $("explore-search").addEventListener("submit", (event) => {
      event.preventDefault();
      scheduleExploreRefresh(true);
    });
    ["explore-query", "explore-location"].forEach((id) => {
      $(id).addEventListener("input", () => scheduleExploreRefresh(false));
      $(id).addEventListener("change", () => scheduleExploreRefresh(true));
    });
    $("explore-sort").addEventListener("change", () => scheduleExploreRefresh(true));
    $("reserve-form").addEventListener("submit", (event) => { submitReservation(event).catch((error) => setFeedback("reserve-feedback", error.message, true)); });
    $("reserve-cancel").addEventListener("click", () => $("reserve-dialog").close());
    $("reserve-close").addEventListener("click", () => $("reserve-dialog").close());
    $("send-message-form").addEventListener("submit", (event) => { sendMessage(event).catch((error) => setFeedback("message-feedback", error.message, true)); });
    $("message-attach-trigger").addEventListener("click", () => $("message-attachment").click());
    $("message-attachment").addEventListener("change", handleMessageAttachmentSelection);
    $("message-attachment-remove").addEventListener("click", () => clearMessageAttachment(true));
    $("conversation-search").addEventListener("input", () => {
      state.conversationSearch = $("conversation-search").value || "";
      renderConversations();
    });
    $("message-report-form").addEventListener("submit", (event) => {
      submitMessageReport(event).catch((error) => {
        console.error("Buybook report submission failed", error);
        setFeedback("message-report-feedback", "Could not submit your report. Please retry.", true);
      });
    });
    $("message-report-cancel").addEventListener("click", () => $("message-report-dialog").close());
    $("message-report-cancel-bottom").addEventListener("click", () => $("message-report-dialog").close());
    document.querySelectorAll("[data-reservation-filter]").forEach((button) => button.addEventListener("click", () => {
      state.reservationFilter = button.dataset.reservationFilter;
      document.querySelectorAll("[data-reservation-filter]").forEach((item) => item.classList.toggle("is-selected", item === button));
      renderReservations();
    }));
    document.querySelectorAll("[data-notification-filter]").forEach((button) => button.addEventListener("click", () => {
      state.notificationFilter = button.dataset.notificationFilter;
      document.querySelectorAll("[data-notification-filter]").forEach((item) => item.classList.toggle("is-selected", item === button));
      renderNotifications();
    }));
    $("refresh-products").addEventListener("click", () => refreshExploreResults().catch((error) => console.error("Explore refresh failed", error)));
    $("profile-button").addEventListener("keydown", (event) => { if (event.key === "Enter") navigate("me"); });
    window.addEventListener("popstate", (event) => {
      const requested = event.state && event.state.buybook ? event.state.screen : "home";
      const screen = $("screen-" + requested) ? requested : "home";
      renderScreen(screen);
      const main = $("app-main");
      if (main) main.focus({ preventScroll: true });
    });
    window.addEventListener("online", handleMessageConnectionRestored);
    window.addEventListener("focus", refreshBuyerLocationWhenReturning);
    window.addEventListener("offline", setOfflineBanner);
    document.addEventListener("visibilitychange", () => {
      refreshBuyerLocationWhenReturning();
      if (document.visibilityState !== "visible" || !state.user) return;
      const screen = currentScreen();
      if (screen === "messages") {
        loadSocialData().catch((error) => console.warn("Inbox refresh failed", error));
      } else if (screen === "chat" && state.activeConversation) {
        loadConversationMessages({ sync: true }).catch((error) => console.warn("Open conversation refresh failed", error));
        refreshUnreadMessageCount().catch((error) => console.warn("Unread message refresh failed", error));
      }
      if (screen === "reservations") loadReservations().catch((error) => console.warn("Reservation refresh failed", error));
      if (screen === "notifications") loadNotifications().catch((error) => console.warn("Notification refresh failed", error));
    });
  }

  async function initAuth() {
    try {
      const config = await loadJson("/api/config");
      if (!config.url || !config.anon_key) throw new Error("Sign-in has not been configured yet.");
      if (!window.supabase || typeof window.supabase.createClient !== "function") throw new Error("The sign-in library could not load.");
      state.supabase = window.supabase.createClient(config.url, config.anon_key);
      window.buybookSupabaseClient = state.supabase;
      window.dispatchEvent(new Event("buybook:supabase-ready"));
      try {
        const savedAction = sessionStorage.getItem("buybook-pending-action");
        const savedScreen = sessionStorage.getItem("buybook-return-screen");
        const savedProductId = sessionStorage.getItem("buybook-return-product-id");
        const savedShopId = sessionStorage.getItem("buybook-return-shop-id");
        if (savedAction) state.pendingAction = JSON.parse(savedAction);
        if (savedScreen && $("screen-" + savedScreen)) state.returnAfterSignIn = savedScreen;
        if (savedProductId) state.activeProductId = savedProductId;
        if (savedShopId) state.activeShopId = savedShopId;
      } catch (error) {
        console.warn("Buybook could not restore the sign-in destination", error);
      }
      const { data, error } = await state.supabase.auth.getSession();
      if (error) throw error;
      await handleAuthSession(data.session ? data.session.user : null);
      state.supabase.auth.onAuthStateChange((_event, session) => {
        Promise.resolve().then(() => handleAuthSession(session ? session.user : null))
          .catch((error) => console.error("Buybook auth state update failed", error));
      });
    } catch (error) {
      console.error("Buybook authentication initialization failed", error);
      state.authReady = true;
      setFeedback("signin-feedback", "Sign-in is temporarily unavailable. You can still browse products.", true);
      renderHeaderAvatar();
      renderMe();
    }
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch((error) => {
      console.warn("Buybook offline shell could not be installed", error);
    });
  }

  async function init() {
    setOfflineBanner();
    bindEvents();
    renderAuthMode();
    renderCategoryChips();
    // Keep the location status quiet during automatic detection. Show it only if
    // location is unavailable or the user needs to change a setting.
    updateDistanceControls("");
    const locationSettingsAction = $("distance-location-settings");
    if (locationSettingsAction) {
      locationSettingsAction.addEventListener("click", () => {
        const status = $("distance-location-status");
        if (status) {
          status.textContent = "Turn on your phone's Location setting, then return to Buybook. Buybook will check your location automatically.";
          status.hidden = false;
        }
      });
    }
    initBuyerLocation();
    loadCatalog().catch((error) => console.error("Buybook catalogue failed", error));
    await initAuth();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshMePanelOnReturn();
    });
    window.addEventListener("focus", refreshMePanelOnReturn);
    registerServiceWorker();
    if (window.location.hash && window.location.hash.length > 1) {
      const requested = window.location.hash.slice(1);
      if ($("screen-" + requested)) {
        window.history.replaceState({ buybook: true, screen: requested, previousScreen: null }, "", "#" + requested);
        renderScreen(requested);
      }
    } else {
      window.history.replaceState({ buybook: true, screen: "home", previousScreen: null }, "", window.location.pathname + window.location.search + "#home");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
