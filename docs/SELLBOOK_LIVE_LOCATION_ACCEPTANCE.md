# Sellbook Live Customer Location Acceptance

**Preview branch:** `sellbook-live-location-v1`  
**Related Buybook branch:** `buybook-live-location-v1`

## Seller checks

- [ ] Sign in to Sellbook with a normal seller account connected to Buybook.
- [ ] Confirm the Home panel **Customers locating your shop** is visible.
- [ ] Confirm an unconnected or inactive shop receives no live location sessions.
- [ ] Confirm the map pin matches the shop location saved in Connect to Buybook.
- [ ] Have a test buyer start Locate shop from Buybook; confirm one seller notification appears.
- [ ] Confirm the buyer is shown on the map only for the selected shop owner.
- [ ] Confirm the seller sees a live state, last-update time, approximate distance and reported GPS accuracy.
- [ ] Confirm the buyer marker moves as the test phone moves.
- [ ] Confirm a stale GPS signal is not displayed as a live/current position.
- [ ] Confirm more than one test buyer can share location with the same shop.
- [ ] Confirm a seller account for a different shop cannot see the buyer or the buyer's coordinates.
- [ ] Confirm a disconnected shop stops receiving/reading live-location sessions.
- [ ] Confirm the map fallback message appears if map tiles or the Leaflet CDN are unavailable; ordinary Sellbook sales and stock functions must continue working.

## Privacy and lifecycle checks

- [ ] Buyer must start sharing from Buybook; browsing alone creates no tracking session.
- [ ] The notification contains no coordinates.
- [ ] Stop sharing in Buybook; confirm the marker disappears and coordinates are cleared.
- [ ] Close Buybook without stopping; confirm the seller view stops showing live location after the stale timeout.
- [ ] Confirm expired and stopped records are cleared and eventually deleted by the scheduled cleanup.
- [ ] Confirm anonymous authentication accounts created solely for guest location use are deleted after 30 days without further location use.
- [ ] Confirm customer names, email addresses and phone numbers are not shown on this map; display a minimal buyer label only.
- [ ] Confirm the location panel does not expose any other shop's customers.

## Operational notes

- The seller map updates through Supabase Realtime, with a periodic refresh fallback.
- Buyer GPS updates require the buyer's browser/PWA to remain active, with location permission and internet access. Android may suspend updates when Buybook is backgrounded or the device is locked.
- The preview uses Leaflet with OpenStreetMap map tiles. The tile service is best-effort and has no application SLA; monitor usage and move to a provider with an appropriate service agreement if traffic grows.
- Do not use location data to infer a buyer's identity or build historical travel routes.
