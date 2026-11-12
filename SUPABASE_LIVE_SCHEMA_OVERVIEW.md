# Live Supabase schema snapshot
Captured 2026-11-12. Structural metadata only; no business/customer/user rows exported.
Project ref: ueyqrbyqicfpvnznnyxj. Shared by Sellbook and Buybook.

## Tables
### public.app_notifications
- RLS enabled: Yes
- Columns: id uuid, created_by uuid, recipient_id uuid, title text, body text, kind text, created_at timestamp with time zone, expires_at timestamp with time zone, reservation_id uuid, conversation_owner_id uuid, conversation_buyer_id uuid

### public.app_page_visits
- RLS enabled: Yes
- Columns: id bigint, visit_date date, session_key text, created_at timestamp with time zone

### public.expenses
- RLS enabled: Yes
- Columns: id uuid, user_id uuid, description text, amount numeric, spent_at timestamp with time zone, created_at timestamp with time zone, category text, note text, voided_at timestamp with time zone, void_reason text, updated_at timestamp with time zone

### public.marketplace_listings
- RLS enabled: Yes
- Columns: product_id uuid, owner_id uuid, shop_name text, name text, description text, category text, price numeric, currency text, unit text, stock_status text, image_url text, is_active boolean, updated_at timestamp with time zone

### public.marketplace_location_guest_accounts
- RLS enabled: Yes
- Columns: user_id uuid, first_seen_at timestamp with time zone, last_seen_at timestamp with time zone

### public.marketplace_location_sessions
- RLS enabled: Yes
- Columns: id uuid, owner_id uuid, buyer_id uuid, product_id uuid, buyer_type text, latitude double precision, longitude double precision, accuracy_m double precision, heading_deg double precision, speed_mps double precision, status text, started_at timestamp with time zone, updated_at timestamp with time zone, expires_at timestamp with time zone, stopped_at timestamp with time zone

### public.marketplace_message_blocks
- RLS enabled: Yes
- Columns: owner_id uuid, buyer_id uuid, blocked_by uuid, created_at timestamp with time zone

### public.marketplace_message_reports
- RLS enabled: Yes
- Columns: id uuid, owner_id uuid, buyer_id uuid, reporter_id uuid, message_id uuid, reason text, details text, status text, admin_notes text, created_at timestamp with time zone, reviewed_at timestamp with time zone

### public.marketplace_messages
- RLS enabled: Yes
- Columns: id uuid, owner_id uuid, buyer_id uuid, sender_id uuid, body text, created_at timestamp with time zone, read_at timestamp with time zone, client_message_id uuid, attachment_path text, attachment_mime_type text

### public.marketplace_reservation_items
- RLS enabled: Yes
- Columns: id uuid, reservation_id uuid, product_id uuid, product_name text, unit_price numeric, quantity integer, created_at timestamp with time zone

### public.marketplace_reservations
- RLS enabled: Yes
- Columns: id uuid, buyer_id uuid, owner_id uuid, status text, buyer_note text, expires_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone, request_key uuid

### public.marketplace_shops
- RLS enabled: Yes
- Columns: owner_id uuid, name text, description text, phone text, address text, city text, state text, country text, latitude double precision, longitude double precision, is_connected boolean, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone, shop_front_image_url text, shop_front_image_path text, shop_front_confirmed_at timestamp with time zone, whatsapp_checked_at timestamp with time zone, location_accuracy_m double precision, location_captured_at timestamp with time zone, location_confirmed_at timestamp with time zone, location_source text

### public.marketplace_store_subscriptions
- RLS enabled: Yes
- Columns: owner_id uuid, buyer_id uuid, created_at timestamp with time zone

### public.notification_reads
- RLS enabled: Yes
- Columns: notification_id uuid, user_id uuid, read_at timestamp with time zone

### public.policy_acceptances
- RLS enabled: Yes
- Columns: id uuid, user_id uuid, application text, privacy_policy_version text, terms_version text, accepted_at timestamp with time zone, acceptance_method text, recorded_at timestamp with time zone

### public.product_activity
- RLS enabled: Yes
- Columns: id uuid, user_id uuid, product_id uuid, product_name text, activity_type text, old_values jsonb, new_values jsonb, created_at timestamp with time zone

### public.product_creation_history
- RLS enabled: Yes
- Columns: id uuid, user_id uuid, product_id uuid, product_name text, category text, cost_price numeric, selling_price numeric, initial_stock integer, image_path text, base_unit text, purchase_unit text, units_per_purchase integer, pack_unit text, units_per_pack integer, pack_selling_price numeric, added_at timestamp with time zone

### public.products
- RLS enabled: Yes
- Columns: id uuid, user_id uuid, name text, cost_price numeric, selling_price numeric, stock integer, image_path text, created_at timestamp with time zone, updated_at timestamp with time zone, category text, base_unit text, purchase_unit text, units_per_purchase integer, pack_unit text, units_per_pack integer, pack_selling_price numeric, archived_at timestamp with time zone

### public.sales
- RLS enabled: Yes
- Columns: id uuid, user_id uuid, product_id uuid, product_name text, quantity integer, unit_price numeric, unit_cost numeric, total numeric, gross_profit numeric, note text, sold_at timestamp with time zone, base_quantity integer, sale_unit text, units_per_sale integer, transaction_id uuid, reversed_at timestamp with time zone, reversal_reason text, stock_returned boolean

### public.stock_adjustments
- RLS enabled: Yes
- Columns: id uuid, user_id uuid, product_id uuid, product_name text, previous_stock integer, new_stock integer, quantity_change integer, reason text, adjusted_at timestamp with time zone

### public.stock_purchases
- RLS enabled: Yes
- Columns: id uuid, user_id uuid, product_id uuid, product_name text, purchase_quantity integer, purchase_unit text, units_per_purchase integer, base_quantity integer, cost_per_purchase_unit numeric, total_cost numeric, base_unit_cost numeric, average_cost_before numeric, average_cost_after numeric, restocked_at timestamp with time zone, previous_stock integer, new_stock integer

### public.support_messages
- RLS enabled: Yes
- Columns: id uuid, sender_id uuid, recipient_id uuid, body text, created_at timestamp with time zone, read_at timestamp with time zone, delivered_at timestamp with time zone

### public.user_feedback
- RLS enabled: Yes
- Columns: id uuid, user_id uuid, category text, subject text, message text, status text, admin_reply text, replied_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone

### public.user_profiles
- RLS enabled: Yes
- Columns: user_id uuid, business_name text, business_logo text, updated_at timestamp with time zone

## Storage buckets
- buybook-message-attachments: public=false; file size limit=3145728 bytes; MIME=image/jpeg, image/png, image/webp
- marketplace-product-images: public=true; file size limit=5242880 bytes; MIME=image/jpeg, image/png, image/webp
- marketplace-shop-fronts: public=true; file size limit=5242880 bytes; MIME=image/jpeg, image/png, image/webp
- product-images: public=false; file size limit=5242880 bytes; MIME=image/jpeg, image/png, image/webp

## Functions
- private.capture_sellbook_signup_policy_acceptance() → trigger; plpgsql; SECURITY DEFINER
- private.enforce_sellbook_pin_before_write() → trigger; plpgsql; SECURITY DEFINER
- private.is_sellbook_pin_verified() → boolean; plpgsql; SECURITY DEFINER
- private.log_sellbook_product_update() → trigger; plpgsql; SECURITY DEFINER
- public.attach_identity_liveness_session(p_user_id uuid, p_attempt_id uuid, p_liveness_session_id text) → jsonb; plpgsql; SECURITY DEFINER
- public.begin_identity_verification_attempt(p_user_id uuid, p_attempt_id uuid, p_provider_reference text, p_consent_version text) → jsonb; plpgsql; SECURITY DEFINER
- public.cancel_marketplace_reservation(p_reservation_id uuid) → boolean; plpgsql; invoker
- public.capture_product_creation_history() → trigger; plpgsql; SECURITY DEFINER
- public.claim_and_finish_verified_identity(p_user_id uuid, p_attempt_id uuid, p_identity_fingerprint text, p_provider_reference text, p_consent_version text, p_face_match_reference text) → jsonb; plpgsql; SECURITY DEFINER
- public.claim_verified_identity(p_user_id uuid, p_identity_fingerprint text, p_provider text, p_provider_reference text, p_consent_version text) → jsonb; plpgsql; SECURITY DEFINER
- public.consume_sellbook_email_action(p_action text) → jsonb; plpgsql; SECURITY DEFINER
- public.create_marketplace_reservation(p_product_id uuid, p_quantity integer, p_buyer_note text) → uuid; plpgsql; invoker
- public.create_marketplace_reservation_v2(p_product_id uuid, p_quantity integer, p_buyer_note text, p_request_key uuid) → uuid; plpgsql; invoker
- public.delete_my_account() → void; plpgsql; SECURITY DEFINER
- public.expire_marketplace_location_guest_accounts() → integer; plpgsql; SECURITY DEFINER
- public.expire_marketplace_location_sessions() → void; plpgsql; SECURITY DEFINER
- public.expire_marketplace_reservations() → integer; plpgsql; SECURITY DEFINER
- public.finish_identity_verification_attempt(p_user_id uuid, p_attempt_id uuid, p_state text, p_face_match_reference text, p_provider_verification_reference text) → boolean; plpgsql; SECURITY DEFINER
- public.get_app_pin_status() → jsonb; plpgsql; SECURITY DEFINER
- public.get_identity_verification_attempt(p_user_id uuid, p_attempt_id uuid) → jsonb; plpgsql; SECURITY DEFINER
- public.get_identity_verification_status() → jsonb; plpgsql; SECURITY DEFINER
- public.get_marketplace_message_inbox(p_limit integer, p_before_at timestamp with time zone, p_before_owner_id uuid, p_before_buyer_id uuid) → TABLE(owner_id uuid, buyer_id uuid, last_message_id uuid, last_sender_id uuid, last_body text, last_created_at timestamp with time zone, last_read_at timestamp with time zone, last_attachment_path text, unread_count bigint, activity_at timestamp with time zone); sql; invoker
- public.get_my_marketplace_subscribers() → TABLE(owner_id uuid, buyer_id uuid, display_name text, created_at timestamp with time zone); plpgsql; SECURITY DEFINER
- public.get_my_unread_notification_count() → bigint; sql; invoker
- public.grant_sellbook_email_action(p_target_session_id uuid, p_action text, p_previous_session_id uuid) → jsonb; plpgsql; SECURITY DEFINER
- public.is_marketplace_registered_user() → boolean; sql; invoker
- public.is_sellbook_admin() → boolean; sql; SECURITY DEFINER
- public.mark_marketplace_conversation_read(p_owner_id uuid, p_buyer_id uuid) → integer; plpgsql; SECURITY DEFINER
- public.mark_my_notifications_read() → integer; plpgsql; invoker
- public.notify_marketplace_message_recipient() → trigger; plpgsql; SECURITY DEFINER
- public.notify_marketplace_reservation_cancellation() → trigger; plpgsql; SECURITY DEFINER
- public.notify_marketplace_reservation_created() → trigger; plpgsql; SECURITY DEFINER
- public.notify_marketplace_reservation_owner() → trigger; plpgsql; SECURITY DEFINER
- public.purge_identity_verification_attempts(p_before timestamp with time zone) → integer; plpgsql; SECURITY DEFINER
- public.record_buybook_shop_front_verification(p_user_id uuid, p_storage_path text, p_status text, p_reason text, p_model text) → timestamp with time zone; plpgsql; SECURITY DEFINER
- public.record_sale(p_product_id uuid, p_quantity integer, p_unit_price numeric, p_note text) → uuid; plpgsql; SECURITY DEFINER
- public.record_sale(p_product_id uuid, p_quantity integer, p_unit_price numeric, p_note text, p_units_per_sale integer, p_sale_unit text) → uuid; plpgsql; SECURITY DEFINER
- public.record_sale_offline(p_sale_id uuid, p_product_id uuid, p_quantity integer, p_unit_price numeric, p_note text, p_sold_at timestamp with time zone, p_units_per_sale integer, p_sale_unit text) → uuid; plpgsql; SECURITY DEFINER
- public.record_sale_offline(p_sale_id uuid, p_product_id uuid, p_quantity integer, p_unit_price numeric, p_note text, p_sold_at timestamp with time zone) → uuid; plpgsql; SECURITY DEFINER
- public.record_sale_offline(p_sale_id uuid, p_product_id uuid, p_quantity integer, p_unit_price numeric, p_note text, p_sold_at timestamp with time zone, p_units_per_sale integer, p_sale_unit text, p_expected_updated_at timestamp with time zone) → uuid; plpgsql; SECURITY DEFINER
- public.record_sales_batch(p_transaction_id uuid, p_sales jsonb) → jsonb; plpgsql; SECURITY DEFINER
- public.record_sellbook_visit(p_session_key text) → boolean; plpgsql; SECURITY DEFINER
- public.reject_sale_for_archived_product() → trigger; plpgsql; SECURITY DEFINER
- public.reset_app_pin_after_reauth() → jsonb; plpgsql; SECURITY DEFINER
- public.restock_product(p_purchase_id uuid, p_product_id uuid, p_purchase_quantity integer, p_purchase_unit text, p_units_per_purchase integer, p_cost_per_purchase_unit numeric, p_restocked_at timestamp with time zone) → jsonb; plpgsql; SECURITY DEFINER
- public.reverse_sale_transaction(p_transaction_id uuid, p_reason text, p_return_to_stock boolean) → jsonb; plpgsql; SECURITY DEFINER
- public.rls_auto_enable() → event_trigger; plpgsql; SECURITY DEFINER
- public.sellbook_admin_message_reports(p_status text, p_limit integer) → TABLE(id uuid, owner_id uuid, buyer_id uuid, reporter_id uuid, message_id uuid, reason text, details text, status text, admin_notes text, created_at timestamp with time zone, message_body text, message_created_at timestamp with time zone); plpgsql; SECURITY DEFINER
- public.sellbook_admin_overview() → jsonb; plpgsql; SECURITY DEFINER
- public.sellbook_admin_platform_metrics() → jsonb; plpgsql; SECURITY DEFINER
- public.sellbook_admin_update_message_report(p_report_id uuid, p_status text, p_admin_notes text) → void; plpgsql; SECURITY DEFINER
- public.sellbook_admin_users() → TABLE(user_id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone); plpgsql; SECURITY DEFINER
- public.set_app_pin(p_pin text) → jsonb; plpgsql; SECURITY DEFINER
- public.start_marketplace_location(p_owner_id uuid, p_product_id uuid, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision, p_heading_deg double precision, p_speed_mps double precision) → uuid; plpgsql; SECURITY DEFINER
- public.stop_marketplace_location(p_session_id uuid) → boolean; plpgsql; SECURITY DEFINER
- public.stop_marketplace_location_sessions_when_shop_disconnects() → trigger; plpgsql; SECURITY DEFINER
- public.sync_marketplace_listing_from_product() → trigger; plpgsql; SECURITY DEFINER
- public.sync_owner_marketplace_listings(p_owner_id uuid) → void; plpgsql; SECURITY DEFINER
- public.track_marketplace_guest_auth_user() → trigger; plpgsql; SECURITY DEFINER
- public.track_marketplace_location_guest() → trigger; plpgsql; SECURITY DEFINER
- public.update_marketplace_location(p_session_id uuid, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision, p_heading_deg double precision, p_speed_mps double precision) → boolean; plpgsql; SECURITY DEFINER
- public.validate_buybook_shop_profile_before_activation() → trigger; plpgsql; SECURITY DEFINER
- public.verify_app_pin(p_pin text) → jsonb; plpgsql; SECURITY DEFINER
- public.verify_app_pin_for_account_deletion(p_pin text) → jsonb; plpgsql; SECURITY DEFINER

## Public RLS policies
### app_notifications — Admins create notifications
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: (( SELECT is_sellbook_admin() AS is_sellbook_admin) AND (created_by = ( SELECT auth.uid() AS uid)))

### app_notifications — Admins delete notifications
- DELETE; roles={authenticated}
- USING: ( SELECT is_sellbook_admin() AS is_sellbook_admin)
- WITH CHECK: —

### app_notifications — Users read notifications for them
- SELECT; roles={authenticated}
- USING: ((recipient_id = ( SELECT auth.uid() AS uid)) OR (recipient_id IS NULL) OR ( SELECT is_sellbook_admin() AS is_sellbook_admin))
- WITH CHECK: —

### expenses — Users delete own expenses
- DELETE; roles={authenticated}
- USING: (user_id = ( SELECT auth.uid() AS uid))
- WITH CHECK: —

### expenses — Users insert own expenses
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: (user_id = ( SELECT auth.uid() AS uid))

### expenses — Users read own expenses
- SELECT; roles={authenticated}
- USING: (user_id = ( SELECT auth.uid() AS uid))
- WITH CHECK: —

### expenses — Users update own expenses
- UPDATE; roles={authenticated}
- USING: (user_id = ( SELECT auth.uid() AS uid))
- WITH CHECK: (user_id = ( SELECT auth.uid() AS uid))

### expenses — sellbook_pin_gate
- ALL; roles={authenticated}
- USING: private.is_sellbook_pin_verified()
- WITH CHECK: private.is_sellbook_pin_verified()

### marketplace_listings — marketplace_listings_owner_delete
- DELETE; roles={authenticated}
- USING: ((owner_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user))
- WITH CHECK: —

### marketplace_listings — marketplace_listings_owner_insert
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: ((owner_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user))

### marketplace_listings — marketplace_listings_owner_update
- UPDATE; roles={authenticated}
- USING: ((owner_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user))
- WITH CHECK: ((owner_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user))

### marketplace_listings — marketplace_listings_read
- SELECT; roles={anon,authenticated}
- USING: (is_active OR (owner_id = ( SELECT auth.uid() AS uid)))
- WITH CHECK: —

### marketplace_location_sessions — marketplace_location_participant_read
- SELECT; roles={authenticated}
- USING: (((buyer_id = ( SELECT auth.uid() AS uid)) AND (status = 'active'::text) AND (expires_at > now()) AND (updated_at > (now() - '00:03:00'::interval))) OR ((owner_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM marketplace_shops s
  WHERE ((s.owner_id = marketplace_location_sessions.owner_id) AND (s.is_connected = true) AND (s.is_active = true)))) AND (((status = 'active'::text) AND (expires_at > now()) AND (updated_at > (now() - '00:03:00'::interval))) OR ((status = ANY (ARRAY['stopped'::text, 'expired'::text])) AND (stopped_at > (now() - '00:02:00'::interval)) AND (latitude = (0)::double precision) AND (longitude = (0)::double precision)))))
- WITH CHECK: —

### marketplace_message_blocks — marketplace_message_blocks_delete_self
- DELETE; roles={authenticated}
- USING: ((blocked_by = ( SELECT auth.uid() AS uid)) AND ((( SELECT auth.uid() AS uid) = owner_id) OR (( SELECT auth.uid() AS uid) = buyer_id)))
- WITH CHECK: —

### marketplace_message_blocks — marketplace_message_blocks_insert_self
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: (is_marketplace_registered_user() AND (blocked_by = ( SELECT auth.uid() AS uid)) AND ((( SELECT auth.uid() AS uid) = owner_id) OR (( SELECT auth.uid() AS uid) = buyer_id)) AND (owner_id <> buyer_id))

### marketplace_message_blocks — marketplace_message_blocks_select_participants
- SELECT; roles={authenticated}
- USING: (is_marketplace_registered_user() AND ((( SELECT auth.uid() AS uid) = owner_id) OR (( SELECT auth.uid() AS uid) = buyer_id)))
- WITH CHECK: —

### marketplace_message_reports — marketplace_message_reports_insert_participant
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: (is_marketplace_registered_user() AND (reporter_id = ( SELECT auth.uid() AS uid)) AND ((( SELECT auth.uid() AS uid) = owner_id) OR (( SELECT auth.uid() AS uid) = buyer_id)) AND ((message_id IS NULL) OR (EXISTS ( SELECT 1
   FROM marketplace_messages m
  WHERE ((m.id = marketplace_message_reports.message_id) AND (m.owner_id = marketplace_message_reports.owner_id) AND (m.buyer_id = marketplace_message_reports.buyer_id))))))

### marketplace_message_reports — marketplace_message_reports_select_reporter
- SELECT; roles={authenticated}
- USING: (reporter_id = ( SELECT auth.uid() AS uid))
- WITH CHECK: —

### marketplace_messages — marketplace_messages_read_participants
- SELECT; roles={authenticated}
- USING: (( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user) AND ((sender_id = ( SELECT auth.uid() AS uid)) OR (owner_id = ( SELECT auth.uid() AS uid)) OR (buyer_id = ( SELECT auth.uid() AS uid))))
- WITH CHECK: —

### marketplace_messages — marketplace_messages_recipient_mark_read
- UPDATE; roles={authenticated}
- USING: (( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user) AND (sender_id <> ( SELECT auth.uid() AS uid)) AND ((owner_id = ( SELECT auth.uid() AS uid)) OR (buyer_id = ( SELECT auth.uid() AS uid))))
- WITH CHECK: (( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user) AND (sender_id <> ( SELECT auth.uid() AS uid)) AND ((owner_id = ( SELECT auth.uid() AS uid)) OR (buyer_id = ( SELECT auth.uid() AS uid))))

### marketplace_messages — marketplace_messages_subscribed_participant_send
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: (is_marketplace_registered_user() AND (sender_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM marketplace_store_subscriptions ss
  WHERE ((ss.owner_id = marketplace_messages.owner_id) AND (ss.buyer_id = marketplace_messages.buyer_id)))) AND (((sender_id = buyer_id) AND (owner_id <> sender_id)) OR ((sender_id = owner_id) AND (buyer_id <> sender_id))) AND (NOT (EXISTS ( SELECT 1
   FROM marketplace_message_blocks b
  WHERE ((b.owner_id = marketplace_messages.owner_id) AND (b.buyer_id = marketplace_messages.buyer_id))))) AND (((attachment_path IS NULL) AND (attachment_mime_type IS NULL)) OR ((attachment_mime_type = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])) AND (attachment_path ~~ ((((((owner_id)::text || '/'::text) || (buyer_id)::text) || '/'::text) || (sender_id)::text) || '/%'::text)))))

### marketplace_reservation_items — marketplace_reservation_items_buyer_insert
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: (( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user) AND (EXISTS ( SELECT 1
   FROM (marketplace_reservations r
     JOIN marketplace_listings l ON (((l.product_id = marketplace_reservation_items.product_id) AND (l.owner_id = r.owner_id) AND (l.is_active = true) AND (lower(COALESCE(l.stock_status, ''::text)) <> 'out_of_stock'::text))))
  WHERE ((r.id = marketplace_reservation_items.reservation_id) AND (r.buyer_id = ( SELECT auth.uid() AS uid))))))

### marketplace_reservation_items — marketplace_reservation_items_participant_read
- SELECT; roles={authenticated}
- USING: (( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user) AND (EXISTS ( SELECT 1
   FROM marketplace_reservations r
  WHERE ((r.id = marketplace_reservation_items.reservation_id) AND ((r.buyer_id = ( SELECT auth.uid() AS uid)) OR (r.owner_id = ( SELECT auth.uid() AS uid)))))))
- WITH CHECK: —

### marketplace_reservations — marketplace_reservations_buyer_insert
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: (( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user) AND (buyer_id = ( SELECT auth.uid() AS uid)) AND (owner_id <> ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM (marketplace_store_subscriptions ss
     JOIN marketplace_shops s ON ((s.owner_id = ss.owner_id)))
  WHERE ((ss.owner_id = marketplace_reservations.owner_id) AND (ss.buyer_id = ( SELECT auth.uid() AS uid)) AND (s.is_connected = true) AND (s.is_active = true)))))

### marketplace_reservations — marketplace_reservations_participant_read
- SELECT; roles={authenticated}
- USING: (( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user) AND ((buyer_id = ( SELECT auth.uid() AS uid)) OR (owner_id = ( SELECT auth.uid() AS uid))))
- WITH CHECK: —

### marketplace_reservations — marketplace_reservations_participant_update
- UPDATE; roles={authenticated}
- USING: (( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user) AND ((owner_id = ( SELECT auth.uid() AS uid)) OR ((buyer_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text) AND (expires_at > now()))))
- WITH CHECK: (( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user) AND ((owner_id = ( SELECT auth.uid() AS uid)) OR ((buyer_id = ( SELECT auth.uid() AS uid)) AND (status = 'cancelled'::text))))

### marketplace_shops — marketplace_shops_owner_insert
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: ((owner_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user))

### marketplace_shops — marketplace_shops_owner_update
- UPDATE; roles={authenticated}
- USING: ((owner_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user))
- WITH CHECK: ((owner_id = ( SELECT auth.uid() AS uid)) AND ( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user))

### marketplace_shops — marketplace_shops_read
- SELECT; roles={anon,authenticated}
- USING: ((is_connected AND is_active) OR (owner_id = ( SELECT auth.uid() AS uid)))
- WITH CHECK: —

### marketplace_store_subscriptions — store_subscriptions_buyer_follow_active_shop
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: (( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user) AND (buyer_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM marketplace_shops s
  WHERE ((s.owner_id = marketplace_store_subscriptions.owner_id) AND (s.is_connected = true) AND (s.is_active = true)))) AND (owner_id <> ( SELECT auth.uid() AS uid)))

### marketplace_store_subscriptions — store_subscriptions_buyer_unfollow
- DELETE; roles={authenticated}
- USING: (( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user) AND (buyer_id = ( SELECT auth.uid() AS uid)))
- WITH CHECK: —

### marketplace_store_subscriptions — store_subscriptions_read_participants
- SELECT; roles={authenticated}
- USING: (( SELECT is_marketplace_registered_user() AS is_marketplace_registered_user) AND ((buyer_id = ( SELECT auth.uid() AS uid)) OR (owner_id = ( SELECT auth.uid() AS uid))))
- WITH CHECK: —

### notification_reads — Users create their notification receipts
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: (( SELECT auth.uid() AS uid) = user_id)

### notification_reads — Users read their notification receipts
- SELECT; roles={authenticated}
- USING: (( SELECT auth.uid() AS uid) = user_id)
- WITH CHECK: —

### policy_acceptances — policy_acceptances_insert_own
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: ((( SELECT auth.uid() AS uid) = user_id) AND (accepted_at <= (now() + '00:05:00'::interval)) AND (((application = 'sellbook'::text) AND (privacy_policy_version = '2026-11-06'::text) AND (terms_version = '2026-11-05'::text)) OR ((application = 'buybook'::text) AND (privacy_policy_version = '2026-11-06'::text) AND (terms_version = '2026-11-07'::text))))

### policy_acceptances — policy_acceptances_read_own
- SELECT; roles={authenticated}
- USING: (( SELECT auth.uid() AS uid) = user_id)
- WITH CHECK: —

### product_activity — product_activity_read_own
- SELECT; roles={authenticated}
- USING: (user_id = ( SELECT auth.uid() AS uid))
- WITH CHECK: —

### product_creation_history — Users can view their own product creation history
- SELECT; roles={authenticated}
- USING: (( SELECT auth.uid() AS uid) = user_id)
- WITH CHECK: —

### product_creation_history — sellbook_pin_gate
- ALL; roles={authenticated}
- USING: private.is_sellbook_pin_verified()
- WITH CHECK: private.is_sellbook_pin_verified()

### products — Users delete own products
- DELETE; roles={authenticated}
- USING: (user_id = ( SELECT auth.uid() AS uid))
- WITH CHECK: —

### products — Users insert own products
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: (user_id = ( SELECT auth.uid() AS uid))

### products — Users read own products
- SELECT; roles={authenticated}
- USING: (user_id = ( SELECT auth.uid() AS uid))
- WITH CHECK: —

### products — Users update own products
- UPDATE; roles={authenticated}
- USING: (user_id = ( SELECT auth.uid() AS uid))
- WITH CHECK: (user_id = ( SELECT auth.uid() AS uid))

### products — sellbook_pin_gate
- ALL; roles={authenticated}
- USING: private.is_sellbook_pin_verified()
- WITH CHECK: private.is_sellbook_pin_verified()

### sales — Users import own sales
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: ((user_id = ( SELECT auth.uid() AS uid)) AND ((product_id IS NULL) OR (EXISTS ( SELECT 1
   FROM products p
  WHERE ((p.id = sales.product_id) AND (p.user_id = ( SELECT auth.uid() AS uid)))))))

### sales — Users read own sales
- SELECT; roles={authenticated}
- USING: (user_id = ( SELECT auth.uid() AS uid))
- WITH CHECK: —

### sales — sellbook_pin_gate
- ALL; roles={authenticated}
- USING: private.is_sellbook_pin_verified()
- WITH CHECK: private.is_sellbook_pin_verified()

### stock_adjustments — Users can create their own stock adjustments
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: (( SELECT auth.uid() AS uid) = user_id)

### stock_adjustments — Users can delete their own stock adjustments
- DELETE; roles={authenticated}
- USING: (( SELECT auth.uid() AS uid) = user_id)
- WITH CHECK: —

### stock_adjustments — Users can update their own stock adjustments
- UPDATE; roles={authenticated}
- USING: (( SELECT auth.uid() AS uid) = user_id)
- WITH CHECK: (( SELECT auth.uid() AS uid) = user_id)

### stock_adjustments — Users can view their own stock adjustments
- SELECT; roles={authenticated}
- USING: (( SELECT auth.uid() AS uid) = user_id)
- WITH CHECK: —

### stock_adjustments — sellbook_pin_gate
- ALL; roles={authenticated}
- USING: private.is_sellbook_pin_verified()
- WITH CHECK: private.is_sellbook_pin_verified()

### stock_purchases — Users can insert their own stock purchases
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: (( SELECT auth.uid() AS uid) = user_id)

### stock_purchases — Users can view their own stock purchases
- SELECT; roles={authenticated}
- USING: (( SELECT auth.uid() AS uid) = user_id)
- WITH CHECK: —

### stock_purchases — sellbook_pin_gate
- ALL; roles={authenticated}
- USING: private.is_sellbook_pin_verified()
- WITH CHECK: private.is_sellbook_pin_verified()

### support_messages — Participants mark messages read
- UPDATE; roles={authenticated}
- USING: ((sender_id = ( SELECT auth.uid() AS uid)) OR (recipient_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_sellbook_admin() AS is_sellbook_admin))
- WITH CHECK: ((sender_id = ( SELECT auth.uid() AS uid)) OR (recipient_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_sellbook_admin() AS is_sellbook_admin))

### support_messages — Users read their support messages
- SELECT; roles={authenticated}
- USING: ((sender_id = ( SELECT auth.uid() AS uid)) OR (recipient_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_sellbook_admin() AS is_sellbook_admin))
- WITH CHECK: —

### support_messages — sellbook_pin_gate
- ALL; roles={authenticated}
- USING: private.is_sellbook_pin_verified()
- WITH CHECK: private.is_sellbook_pin_verified()

### support_messages — support_messages_insert
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: ((sender_id = ( SELECT auth.uid() AS uid)) AND ((recipient_id IS NULL) OR ( SELECT is_sellbook_admin() AS is_sellbook_admin)))

### user_feedback — Admins update feedback
- UPDATE; roles={authenticated}
- USING: ( SELECT is_sellbook_admin() AS is_sellbook_admin)
- WITH CHECK: ( SELECT is_sellbook_admin() AS is_sellbook_admin)

### user_feedback — Users create own feedback
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: ((user_id = ( SELECT auth.uid() AS uid)) AND (status = 'new'::text) AND (admin_reply IS NULL) AND (replied_at IS NULL))

### user_feedback — Users read own feedback and admins read all
- SELECT; roles={authenticated}
- USING: ((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_sellbook_admin() AS is_sellbook_admin))
- WITH CHECK: —

### user_feedback — sellbook_pin_gate
- ALL; roles={authenticated}
- USING: private.is_sellbook_pin_verified()
- WITH CHECK: private.is_sellbook_pin_verified()

### user_profiles — Users can create their own profile
- INSERT; roles={authenticated}
- USING: —
- WITH CHECK: (( SELECT auth.uid() AS uid) = user_id)

### user_profiles — Users can delete their own profile
- DELETE; roles={authenticated}
- USING: (( SELECT auth.uid() AS uid) = user_id)
- WITH CHECK: —

### user_profiles — Users can update their own profile
- UPDATE; roles={authenticated}
- USING: (( SELECT auth.uid() AS uid) = user_id)
- WITH CHECK: (( SELECT auth.uid() AS uid) = user_id)

### user_profiles — Users can view their own profile
- SELECT; roles={authenticated}
- USING: (( SELECT auth.uid() AS uid) = user_id)
- WITH CHECK: —

### user_profiles — sellbook_pin_gate
- ALL; roles={authenticated}
- USING: private.is_sellbook_pin_verified()
- WITH CHECK: private.is_sellbook_pin_verified()

## Reviewer notes
An RLS-enabled flag alone does not prove a table is safely protected. Inspect ownership checks, role separation, grants, function EXECUTE privileges, SECURITY DEFINER functions, safe search_path, triggers, views, attachment ownership, reservation state transitions, live-location access, guest sessions, PIN gates and admin checks. Compare this live catalogue with migrations and flag schema drift. Do not query real production rows or modify schema/data.
