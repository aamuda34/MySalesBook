do $migration$
declare
  f record;
  v_definition text;
  v_updated text;
  v_pattern text := '(if[[:space:]]+v_user_id[[:space:]]+is[[:space:]]+null[[:space:]]+then[[:space:]]+raise[[:space:]]+exception[[:space:]]+''[^'']+'';[[:space:]]*end[[:space:]]+if;)';
  v_replacement text := E'\\1\n  if not private.is_sellbook_pin_verified() then raise exception ''Verify your Sellbook security PIN before recording or synchronising sales.''; end if;';
begin
  for f in
    select p.oid, p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in ('record_sale','record_sale_offline')
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
  loop
    v_definition := pg_get_functiondef(f.oid);
    if position('is_sellbook_pin_verified' in v_definition) > 0 then
      raise exception 'Unexpected existing PIN guard in %; review manually.', f.signature;
    end if;
    v_updated := regexp_replace(v_definition,v_pattern,v_replacement,'i');
    if v_updated = v_definition then
      raise exception 'Could not safely insert PIN guard into %; no migration applied.', f.signature;
    end if;
    execute v_updated;
  end loop;
end
$migration$;
