create table if not exists store_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  customer_name text not null,
  mobile text not null,
  emirate text not null,
  address text not null,
  notes text not null default '',
  subtotal numeric not null default 0 check (subtotal >= 0),
  shipping numeric not null default 0 check (shipping >= 0),
  total numeric not null default 0 check (total >= 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'expired')),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists store_order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references store_orders(id) on delete cascade,
  filament_id uuid not null references filaments(id) on delete restrict,
  material text not null,
  color text not null,
  brand text not null default '',
  quantity integer not null check (quantity > 0),
  spool_weight_g numeric not null check (spool_weight_g > 0),
  unit_price numeric not null check (unit_price >= 0),
  created_at timestamptz not null default now()
);

create index if not exists store_orders_status_created_idx on store_orders(status, created_at desc);
create index if not exists store_order_items_order_idx on store_order_items(order_id);

alter table store_orders enable row level security;
alter table store_order_items enable row level security;

drop policy if exists "authenticated read store orders" on store_orders;
create policy "authenticated read store orders" on store_orders for select to authenticated using (true);
drop policy if exists "authenticated read store order items" on store_order_items;
create policy "authenticated read store order items" on store_order_items for select to authenticated using (true);

create or replace function store_public_material(p_material text)
returns text
language sql
immutable
as $$
  select case
    when p_material in ('PLA Basic', 'PLA HS', 'PLA+') then 'PLA'
    when p_material in ('PLA Matte', 'Matte PLA') then 'PLA Matte'
    when p_material in ('PETG', 'PETG Matte') then 'PETG'
    when p_material in ('Silk Tricolor', 'PLA Marble') then 'PLA'
    else p_material
  end;
$$;

create or replace function store_public_color(p_material text, p_color text)
returns text
language sql
immutable
as $$
  select case
    when p_material = 'Silk Tricolor' then 'Silk ' || p_color
    when p_material = 'PLA Marble' then 'Marble'
    else p_color
  end;
$$;

create or replace function expire_store_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_count integer := 0;
begin
  with expired as (
    update store_orders
    set status = 'expired', updated_at = now()
    where status = 'pending' and expires_at <= now()
    returning id
  )
  select array_agg(id), count(*)::integer into v_ids, v_count from expired;

  if v_count = 0 then return 0; end if;

  update filaments f
  set remaining_g = f.remaining_g + restored.grams,
      updated_at = now()
  from (
    select filament_id, sum(quantity * spool_weight_g) as grams
    from store_order_items
    where order_id = any(v_ids)
    group by filament_id
  ) restored
  where f.id = restored.filament_id;

  insert into inventory_movements (filament_id, grams_delta, reason)
  select filament_id, sum(quantity * spool_weight_g), 'Store reservation expired'
  from store_order_items
  where order_id = any(v_ids)
  group by filament_id;

  return v_count;
end;
$$;

create or replace function create_store_order(
  p_customer_name text,
  p_mobile text,
  p_emirate text,
  p_address text,
  p_notes text,
  p_items jsonb
)
returns setof store_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_reference text;
  v_subtotal numeric := 0;
  v_shipping numeric := 0;
  v_total_quantity integer := 0;
  v_needed integer;
  v_available integer;
  v_take integer;
  v_phone text := regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g');
  requested record;
  candidate record;
begin
  perform expire_store_orders();

  if length(trim(coalesce(p_customer_name, ''))) < 2 then raise exception 'Customer name is required'; end if;
  if length(v_phone) < 9 or length(v_phone) > 15 then raise exception 'Valid mobile number is required'; end if;
  if trim(coalesce(p_emirate, '')) = '' then raise exception 'Emirate is required'; end if;
  if length(trim(coalesce(p_address, ''))) < 8 then raise exception 'Delivery address is required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'At least one item is required'; end if;

  if exists (
    select 1 from store_orders
    where status = 'pending'
      and expires_at > now()
      and regexp_replace(mobile, '\D', '', 'g') = v_phone
  ) then
    raise exception 'A pending order already exists for this mobile number';
  end if;

  v_reference := 'PT-' || to_char(now(), 'YYMMDDHH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));

  insert into store_orders (reference, customer_name, mobile, emirate, address, notes)
  values (v_reference, trim(p_customer_name), trim(p_mobile), trim(p_emirate), trim(p_address), trim(coalesce(p_notes, '')))
  returning id into v_order_id;

  for requested in
    select trim(item ->> 'material') as material,
           trim(item ->> 'color') as color,
           sum(greatest(0, least(20, coalesce((item ->> 'quantity')::integer, 0))))::integer as quantity
    from jsonb_array_elements(p_items) item
    group by trim(item ->> 'material'), trim(item ->> 'color')
  loop
    if requested.quantity <= 0 then continue; end if;
    v_needed := requested.quantity;
    v_total_quantity := v_total_quantity + requested.quantity;
    if v_total_quantity > 20 then raise exception 'Maximum order size is 20 spools'; end if;

    for candidate in
      select id, brand, material, color, spool_weight_g, remaining_g, selling_price
      from filaments
      where stock_status = 'available'
        and selling_price > 0
        and store_public_material(material) = requested.material
        and store_public_color(material, color) = requested.color
        and remaining_g >= spool_weight_g
      order by created_at, id
      for update
    loop
      exit when v_needed = 0;
      v_available := floor(candidate.remaining_g / candidate.spool_weight_g);
      v_take := least(v_needed, v_available);
      if v_take <= 0 then continue; end if;

      insert into store_order_items (order_id, filament_id, material, color, brand, quantity, spool_weight_g, unit_price)
      values (v_order_id, candidate.id, requested.material, requested.color, candidate.brand, v_take, candidate.spool_weight_g, candidate.selling_price);

      update filaments
      set remaining_g = remaining_g - (v_take * candidate.spool_weight_g), updated_at = now()
      where id = candidate.id;

      insert into inventory_movements (filament_id, grams_delta, reason)
      values (candidate.id, -(v_take * candidate.spool_weight_g), 'Store order reserved ' || v_reference);

      v_subtotal := v_subtotal + (v_take * candidate.selling_price);
      v_needed := v_needed - v_take;
    end loop;

    if v_needed > 0 then raise exception 'Not enough stock for % %', requested.material, requested.color; end if;
  end loop;

  if v_total_quantity = 0 then raise exception 'At least one valid item is required'; end if;
  v_shipping := case when v_total_quantity <= 10 then 20 else 0 end;

  update store_orders
  set subtotal = v_subtotal, shipping = v_shipping, total = v_subtotal + v_shipping, updated_at = now()
  where id = v_order_id;

  return query select * from store_orders where id = v_order_id;
end;
$$;

create or replace function set_store_order_status(p_order_id uuid, p_status text)
returns setof store_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order store_orders%rowtype;
begin
  if auth.role() <> 'authenticated' then raise exception 'Authentication required'; end if;
  if p_status not in ('confirmed', 'cancelled') then raise exception 'Invalid order status'; end if;

  perform expire_store_orders();
  select * into v_order from store_orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status <> 'pending' then raise exception 'Only pending orders can be changed'; end if;

  if p_status = 'cancelled' then
    update filaments f
    set remaining_g = f.remaining_g + restored.grams,
        updated_at = now()
    from (
      select filament_id, sum(quantity * spool_weight_g) as grams
      from store_order_items
      where order_id = p_order_id
      group by filament_id
    ) restored
    where f.id = restored.filament_id;

    insert into inventory_movements (filament_id, grams_delta, reason)
    select filament_id, sum(quantity * spool_weight_g), 'Store order cancelled ' || v_order.reference
    from store_order_items
    where order_id = p_order_id
    group by filament_id;
  end if;

  update store_orders set status = p_status, updated_at = now() where id = p_order_id;
  return query select * from store_orders where id = p_order_id;
end;
$$;

revoke all on function create_store_order(text, text, text, text, text, jsonb) from public;
grant execute on function create_store_order(text, text, text, text, text, jsonb) to anon;
revoke all on function set_store_order_status(uuid, text) from public;
grant execute on function set_store_order_status(uuid, text) to authenticated;
revoke all on function expire_store_orders() from public;
grant execute on function expire_store_orders() to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'store_orders'
  ) then
    alter publication supabase_realtime add table store_orders;
  end if;
end;
$$;
