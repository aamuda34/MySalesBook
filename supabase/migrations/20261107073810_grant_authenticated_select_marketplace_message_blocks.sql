-- Storage policies for Buybook message attachments reference this table.
-- Grant the signed-in role the table privilege required to evaluate those
-- policies. Existing row-level security continues to restrict visible rows
-- to relationships where the current user is the owner or buyer.
GRANT SELECT ON TABLE public.marketplace_message_blocks TO authenticated;
