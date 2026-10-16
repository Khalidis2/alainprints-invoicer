-- Run this once in Supabase SQL Editor for a fresh project or an existing one.

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_ar text default '',
  category text not null default 'Custom',
  price numeric not null default 0,
  description text default '',
  image_url text,
  created_at timestamptz default now()
);

-- Safe upgrade for projects created with the original schema.
-- Existing products and values are preserved.
alter table items add column if not exists name_ar text default '';
alter table items add column if not exists image_url text;

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique,
  date date not null,
  customer_name text default '',
  customer_phone text default '',
  notes text default '',
  total numeric not null default 0,
  lines jsonb not null default '[]',
  created_at timestamptz default now()
);

create table if not exists settings (
  key text primary key,
  value jsonb not null
);

insert into settings (key, value)
values ('invoice_no', '1000')
on conflict (key) do nothing;

alter table items enable row level security;
alter table invoices enable row level security;
alter table settings enable row level security;

create policy "authenticated access" on items for all to authenticated
  using (true) with check (true);
create policy "authenticated access" on invoices for all to authenticated
  using (true) with check (true);
create policy "authenticated access" on settings for all to authenticated
  using (true) with check (true);


-- Safe upgrade for existing projects: duplicate protection and atomic invoice saves.
create unique index if not exists invoices_number_unique on invoices (number);

create or replace function save_invoice(
  p_id uuid,
  p_number integer,
  p_date date,
  p_customer_name text,
  p_customer_phone text,
  p_notes text,
  p_total numeric,
  p_lines jsonb
)
returns setof invoices
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_number < 1 then
    raise exception 'Invoice number must be positive';
  end if;

  if p_id is null then
    return query
      insert into invoices (number, date, customer_name, customer_phone, notes, total, lines)
      values (p_number, p_date, p_customer_name, p_customer_phone, p_notes, p_total, p_lines)
      returning *;
  else
    return query
      update invoices
      set number = p_number,
          date = p_date,
          customer_name = p_customer_name,
          customer_phone = p_customer_phone,
          notes = p_notes,
          total = p_total,
          lines = p_lines
      where id = p_id
      returning *;
  end if;

  update settings
  set value = to_jsonb(greatest((value #>> '{}')::integer, p_number + 1))
  where key = 'invoice_no';
end;
$$;


-- Run once in Supabase SQL Editor to enable customer records.

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  customer_key text not null unique,
  name text not null,
  phone text default '',
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table customers enable row level security;

drop policy if exists "authenticated access" on customers;
create policy "authenticated access" on customers for all to authenticated
  using (true) with check (true);

insert into customers (customer_key, name, phone)
select distinct on (
  case
    when regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g') <> ''
      then 'phone:' || regexp_replace(customer_phone, '[^0-9]', '', 'g')
    else 'name:' || lower(trim(customer_name))
  end
)
  case
    when regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g') <> ''
      then 'phone:' || regexp_replace(customer_phone, '[^0-9]', '', 'g')
    else 'name:' || lower(trim(customer_name))
  end,
  trim(customer_name),
  coalesce(customer_phone, '')
from invoices
where trim(coalesce(customer_name, '')) <> ''
order by
  case
    when regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g') <> ''
      then 'phone:' || regexp_replace(customer_phone, '[^0-9]', '', 'g')
    else 'name:' || lower(trim(customer_name))
  end,
  created_at desc
on conflict (customer_key) do update
set name = excluded.name,
    phone = excluded.phone,
    updated_at = now();

alter publication supabase_realtime add table customers;


-- Run once in Supabase SQL Editor to enable filament inventory and automatic deductions.

create table if not exists filaments (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  brand text not null default '',
  material text not null,
  color text not null,
  spool_weight_g numeric not null default 1000 check (spool_weight_g > 0),
  quantity_spools numeric not null default 0 check (quantity_spools >= 0),
  remaining_g numeric not null default 0 check (remaining_g >= 0),
  purchase_cost_per_spool numeric not null default 0 check (purchase_cost_per_spool >= 0),
  selling_price numeric not null default 0 check (selling_price >= 0),
  stock_status text not null default 'available' check (stock_status in ('available', 'incoming')),
  location text default '',
  expected_date date,
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inventory_movements (
  id bigint generated always as identity primary key,
  filament_id uuid not null references filaments(id) on delete restrict,
  invoice_id uuid references invoices(id) on delete set null,
  grams_delta numeric not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table items add column if not exists filament_id uuid references filaments(id) on delete set null;
alter table items add column if not exists grams_per_unit numeric not null default 0 check (grams_per_unit >= 0);

alter table filaments enable row level security;
alter table inventory_movements enable row level security;

drop policy if exists "authenticated access" on filaments;
create policy "authenticated access" on filaments for all to authenticated using (true) with check (true);
drop policy if exists "authenticated access" on inventory_movements;
create policy "authenticated access" on inventory_movements for all to authenticated using (true) with check (true);

insert into filaments (
  sku, brand, material, color, spool_weight_g, quantity_spools, remaining_g,
  purchase_cost_per_spool, selling_price, stock_status
) values
('AVAILABLE-MATTE-ORANGE','Mixed/Unknown','PLA Matte','Orange',1000,1,1000,0,70,'available'),
('AVAILABLE-MATTE-RED','Mixed/Unknown','PLA Matte','Red',1000,1,1000,0,70,'available'),
('AVAILABLE-MATTE-BLACK','Mixed/Unknown','PLA Matte','Black',1000,4,4000,0,70,'available'),
('AVAILABLE-MATTE-WHITE','Mixed/Unknown','PLA Matte','White',1000,4,4000,0,70,'available'),
('AVAILABLE-HS-BLACK','Mixed/Unknown','PLA HS','Black',1000,2,2000,0,70,'available'),
('AVAILABLE-HS-WHITE','Mixed/Unknown','PLA HS','White',1000,2,2000,0,70,'available'),
('AVAILABLE-BASIC-SILVER','Mixed/Unknown','PLA Basic','Silver',1000,4,4000,0,70,'available'),
('AVAILABLE-BASIC-WHITE','Mixed/Unknown','PLA Basic','White',1000,2,2000,0,70,'available'),
('AVAILABLE-BASIC-BLACK','Mixed/Unknown','PLA Basic','Black',1000,1,1000,0,70,'available'),
('AVAILABLE-BASIC-RED','Mixed/Unknown','PLA Basic','Red',1000,2,2000,0,70,'available'),
('AVAILABLE-BASIC-GREEN','Mixed/Unknown','PLA Basic','Green',1000,3,3000,0,70,'available'),
('AVAILABLE-BASIC-BROWN','Mixed/Unknown','PLA Basic','Brown',1000,2,2000,0,70,'available'),
('AVAILABLE-BASIC-BLUE','Mixed/Unknown','PLA Basic','Blue',1000,4,4000,0,70,'available'),
('AVAILABLE-PETG-BLUE','Mixed/Unknown','PETG','Blue',1000,7,7000,0,75,'available'),
('AVAILABLE-PETG-WHITE','Mixed/Unknown','PETG','White',1000,2,2000,0,75,'available'),
('AVAILABLE-PETG-GREEN','Mixed/Unknown','PETG','Green',1000,4,4000,0,75,'available'),
('AVAILABLE-PETG-RED','Mixed/Unknown','PETG','Red',1000,3,3000,0,75,'available'),
('KR-PLA102Y-1CH','Kingroon','PLA+','Black',1000,10,0,26.34,70,'incoming'),
('KR-PLA101Y-1CH','Kingroon','PLA+','White',1000,10,0,26.34,70,'incoming'),
('KR-PLA117Y-1CH','Kingroon','PLA+','Gold',1000,10,0,26.34,70,'incoming'),
('KR-PLA105Y-1CH','Kingroon','PLA+','Gray',1000,5,0,26.34,70,'incoming'),
('KR-PLA110Y-1CH','Kingroon','PLA+','Silver',1000,5,0,26.34,70,'incoming'),
('KR-PLA103Y-1CH','Kingroon','PLA+','Red',1000,5,0,26.34,70,'incoming'),
('KR-PLA104Y-1CH','Kingroon','PLA+','Blue',1000,5,0,26.34,70,'incoming'),
('KR-PLA107Y-1CH','Kingroon','PLA+','Green',1000,5,0,26.34,70,'incoming'),
('KR-PLA112Y-1CH','Kingroon','PLA+','Purple',1000,5,0,26.34,70,'incoming'),
('KR-PLA109Y-1CH','Kingroon','PLA+','Orange',1000,5,0,26.34,70,'incoming'),
('KR-PLA111Y-1CH','Kingroon','PLA+','Pink',1000,5,0,26.34,70,'incoming'),
('KR-PLA114Y-1CH','Kingroon','PLA+','Brown',1000,5,0,26.34,70,'incoming'),
('KR-PLA108Y-1CH','Kingroon','PLA+','Yellow',1000,5,0,26.34,70,'incoming'),
('KR-PLA115Y-1CH','Kingroon','PLA+','Skin',1000,5,0,26.34,70,'incoming'),
('KR-PLA116Y-1CH','Kingroon','PLA+','Transparent White',1000,5,0,26.34,70,'incoming'),
('KR-PLA301Y-1CH','Kingroon','Matte PLA','Black',1000,10,0,26.34,70,'incoming'),
('KR-PLA302Y-1CH','Kingroon','Matte PLA','White',1000,10,0,26.34,70,'incoming'),
('KR-PLA303Y-1CH','Kingroon','Matte PLA','Gray',1000,5,0,26.34,70,'incoming'),
('KR-PLA304Y-1CH','Kingroon','Matte PLA','Blue',1000,5,0,26.34,70,'incoming'),
('KR-PLA305Y-1CH','Kingroon','Matte PLA','Red',1000,5,0,26.34,70,'incoming'),
('KR-PLA306Y-1CH','Kingroon','Matte PLA','Green',1000,5,0,26.34,70,'incoming'),
('KR-PLA307Y-1CH','Kingroon','Matte PLA','Skin',1000,5,0,26.34,70,'incoming'),
('KR-PLA308Y-1CH','Kingroon','Matte PLA','Yellow',1000,5,0,26.34,70,'incoming'),
('KR-PLA309Y-1CH','Kingroon','Matte PLA','Orange',1000,5,0,26.34,70,'incoming'),
('KR-PLA310Y-1CH','Kingroon','Matte PLA','Lilac Purple',1000,5,0,26.34,70,'incoming'),
('KR-PLA311Y-1CH','Kingroon','Matte PLA','Grass Green',1000,5,0,26.34,70,'incoming'),
('KR-PLA312Y-1CH','Kingroon','Matte PLA','Midnight Brown',1000,5,0,26.34,70,'incoming'),
('KR-PETG301Y-1CH','Kingroon','PETG Matte','Black',1000,10,0,26.34,75,'incoming'),
('KR-PETG302Y-1CH','Kingroon','PETG Matte','White',1000,5,0,26.34,75,'incoming'),
('KR-PETG303Y-1CH','Kingroon','PETG Matte','Gray',1000,5,0,26.34,75,'incoming'),
('KR-PETG304Y-1CH','Kingroon','PETG Matte','Blue',1000,5,0,26.34,75,'incoming'),
('KR-PETG305Y-1CH','Kingroon','PETG Matte','Red',1000,5,0,26.34,75,'incoming'),
('KR-PETG306Y-1CH','Kingroon','PETG Matte','Green',1000,5,0,26.34,75,'incoming'),
('KR-PETG307Y-1CH','Kingroon','PETG Matte','Skin',1000,5,0,26.34,75,'incoming'),
('KR-PETG308Y-1CH','Kingroon','PETG Matte','Yellow',1000,5,0,26.34,75,'incoming'),
('KR-PETG309Y-1CH','Kingroon','PETG Matte','Orange',1000,5,0,26.34,75,'incoming'),
('KR-PETG310Y-1CH','Kingroon','PETG Matte','Lilac Purple',1000,5,0,26.34,75,'incoming'),
('KR-PETG311Y-1CH','Kingroon','PETG Matte','Grass Green',1000,5,0,26.34,75,'incoming'),
('KR-PETG312Y-1CH','Kingroon','PETG Matte','Midnight Brown',1000,5,0,26.34,75,'incoming'),
('KR-Silk210Y-1CH','Kingroon','Silk Tricolor','Blue/Green/Orange',1000,5,0,26.34,90,'incoming'),
('KR-Silk204Y-1CH','Kingroon','Silk Tricolor','Gold/Green/Rose-Red',1000,5,0,26.34,90,'incoming'),
('KR-Silk202Y-1CH','Kingroon','Silk Tricolor','Red/Green/Blue',1000,5,0,26.34,90,'incoming'),
('KR-Silk213Y-1CH','Kingroon','Silk Tricolor','Gold/Green/Black',1000,5,0,26.34,90,'incoming'),
('KR-Silk214Y-1CH','Kingroon','Silk Tricolor','Gold/Green/Blue',1000,5,0,26.34,90,'incoming'),
('KR-Silk208Y-1CH','Kingroon','Silk Tricolor','Black/Blue/Purple',1000,5,0,26.34,90,'incoming'),
('KR-Silk215Y-1CH','Kingroon','Silk Tricolor','Purple-Red/Blue/Green',1000,5,0,26.34,90,'incoming'),
('KR-Silk209Y-1CH','Kingroon','Silk Tricolor','Red/Gold/Purple',1000,5,0,26.34,90,'incoming'),
('KR-Silk201Y-1CH','Kingroon','Silk Tricolor','Red/Yellow/Blue',1000,5,0,26.34,90,'incoming'),
('KR-Silk212Y-1CH','Kingroon','Silk Tricolor','Gold/Purple-Red/Blue',1000,5,0,26.34,90,'incoming'),
('KR-PLA901Y-1CH','Kingroon','PLA Marble','Marble',1000,5,0,26.34,80,'incoming')
on conflict (sku) do nothing;

create or replace function save_invoice(
  p_id uuid,
  p_number integer,
  p_date date,
  p_customer_name text,
  p_customer_phone text,
  p_notes text,
  p_total numeric,
  p_lines jsonb
)
returns setof invoices
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_old_lines jsonb := '[]'::jsonb;
  v_old_status text := 'Draft';
  v_new_status text := coalesce((
    select element ->> 'status'
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) element
    where element ->> 'itemId' = '__invoice_meta__'
    limit 1
  ), 'Unpaid');
  movement record;
begin
  if p_number < 1 then
    raise exception 'Invoice number must be positive';
  end if;

  if p_id is not null then
    select lines into v_old_lines from invoices where id = p_id for update;
    v_old_status := coalesce((
      select element ->> 'status'
      from jsonb_array_elements(coalesce(v_old_lines, '[]'::jsonb)) element
      where element ->> 'itemId' = '__invoice_meta__'
      limit 1
    ), 'Unpaid');

    if v_old_status in ('Unpaid', 'Paid') then
      for movement in
        select (element ->> 'filamentId')::uuid as filament_id,
               sum(coalesce((element ->> 'gramsPerUnit')::numeric, 0) * coalesce((element ->> 'qty')::numeric, 0)) as grams
        from jsonb_array_elements(coalesce(v_old_lines, '[]'::jsonb)) element
        where nullif(element ->> 'filamentId', '') is not null
        group by (element ->> 'filamentId')::uuid
      loop
        update filaments set remaining_g = remaining_g + movement.grams, updated_at = now() where id = movement.filament_id;
        insert into inventory_movements (filament_id, invoice_id, grams_delta, reason)
        values (movement.filament_id, p_id, movement.grams, 'Invoice stock reconciliation');
      end loop;
    end if;
  end if;

  if p_id is null then
    insert into invoices (number, date, customer_name, customer_phone, notes, total, lines)
    values (p_number, p_date, p_customer_name, p_customer_phone, p_notes, p_total, p_lines)
    returning id into v_id;
  else
    update invoices
    set number = p_number, date = p_date, customer_name = p_customer_name,
        customer_phone = p_customer_phone, notes = p_notes, total = p_total, lines = p_lines
    where id = p_id
    returning id into v_id;
  end if;

  if v_new_status in ('Unpaid', 'Paid') then
    for movement in
      select (element ->> 'filamentId')::uuid as filament_id,
             sum(coalesce((element ->> 'gramsPerUnit')::numeric, 0) * coalesce((element ->> 'qty')::numeric, 0)) as grams
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) element
      where nullif(element ->> 'filamentId', '') is not null
      group by (element ->> 'filamentId')::uuid
    loop
      update filaments
      set remaining_g = remaining_g - movement.grams, updated_at = now()
      where id = movement.filament_id
        and stock_status = 'available'
        and remaining_g >= movement.grams;
      if not found then
        raise exception 'Not enough available filament stock';
      end if;
      insert into inventory_movements (filament_id, invoice_id, grams_delta, reason)
      values (movement.filament_id, v_id, -movement.grams, 'Invoice finalized');
    end loop;
  end if;

  update settings
  set value = to_jsonb(greatest((value #>> '{}')::integer, p_number + 1))
  where key = 'invoice_no';

  return query select * from invoices where id = v_id;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'filaments'
  ) then
    alter publication supabase_realtime add table filaments;
  end if;
end;
$$;


insert into settings (key, value) values
  ('store_open', 'true'::jsonb),
  ('announcement_banner', '""'::jsonb)
on conflict (key) do nothing;

create or replace function public_site_settings()
returns table(store_open boolean, announcement text)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select (value #>> '{}')::boolean from settings where key = 'store_open'), true),
    coalesce((select value #>> '{}' from settings where key = 'announcement_banner'), '');
$$;

grant execute on function public_site_settings() to anon, authenticated;


alter table items add column if not exists public_visible boolean not null default false;

create or replace function public_printed_products()
returns table(id uuid, name text, name_ar text, category text, price numeric, description text, image_url text)
language sql
stable
security definer
set search_path = public
as $$
  select id, name, name_ar, category, price, description, image_url
  from items
  where public_visible = true
  order by created_at desc;
$$;

grant execute on function public_printed_products() to anon, authenticated;
-- Invoice payment details become real columns (they used to live inside the `lines` JSON),
-- and the invoice counter can no longer be lowered by a stale browser.
-- Safe to run more than once. Run it in Supabase SQL Editor AFTER the new app version is deployed.

alter table invoices add column if not exists status text not null default 'Unpaid';
alter table invoices add column if not exists due_date date;
alter table invoices add column if not exists discount numeric not null default 0;
alter table invoices add column if not exists payment_method text not null default '';
alter table invoices add column if not exists paid_date date;
alter table invoices add column if not exists payment_reference text not null default '';
alter table invoices add column if not exists stripe_link_id text not null default '';
alter table invoices add column if not exists stripe_link_url text not null default '';
alter table invoices add column if not exists stripe_link_amount numeric not null default 0;
alter table invoices add column if not exists stripe_payment_intent text not null default '';
alter table invoices add column if not exists stripe_refunded_amount numeric not null default 0;
alter table invoices add column if not exists refunded_date date;

-- Copy what is already stored in the old meta line into the new columns.
update invoices i
set status = coalesce(nullif(m.meta ->> 'status', ''), 'Unpaid'),
    due_date = case when m.meta ->> 'dueDate' ~ '^\d{4}-\d{2}-\d{2}$' then (m.meta ->> 'dueDate')::date end,
    discount = coalesce(nullif(m.meta ->> 'discount', '')::numeric, 0),
    payment_method = coalesce(m.meta ->> 'paymentMethod', ''),
    paid_date = case when m.meta ->> 'paidDate' ~ '^\d{4}-\d{2}-\d{2}$' then (m.meta ->> 'paidDate')::date end,
    payment_reference = coalesce(m.meta ->> 'paymentReference', ''),
    stripe_link_id = coalesce(m.meta ->> 'stripeLinkId', ''),
    stripe_link_url = coalesce(m.meta ->> 'stripeLinkUrl', ''),
    stripe_link_amount = coalesce(nullif(m.meta ->> 'stripeLinkAmount', '')::numeric, 0),
    stripe_payment_intent = coalesce(m.meta ->> 'stripePaymentIntent', ''),
    stripe_refunded_amount = coalesce(nullif(m.meta ->> 'stripeRefundedAmount', '')::numeric, 0),
    refunded_date = case when m.meta ->> 'refundedDate' ~ '^\d{4}-\d{2}-\d{2}$' then (m.meta ->> 'refundedDate')::date end
from (
  select inv.id, (
    select element from jsonb_array_elements(coalesce(inv.lines, '[]'::jsonb)) element
    where element ->> 'itemId' = '__invoice_meta__' limit 1
  ) as meta
  from invoices inv
) m
where i.id = m.id and m.meta is not null;

-- The old meta line is now redundant: remove it so there is one source of truth.
update invoices
set lines = coalesce((
  select jsonb_agg(element)
  from jsonb_array_elements(coalesce(lines, '[]'::jsonb)) element
  where element ->> 'itemId' <> '__invoice_meta__'
), '[]'::jsonb)
where lines @> '[{"itemId": "__invoice_meta__"}]'::jsonb;

create index if not exists invoices_status_idx on invoices (status);
create index if not exists invoices_paid_date_idx on invoices (paid_date);
create index if not exists invoices_stripe_link_id_idx on invoices (stripe_link_id) where stripe_link_id <> '';
create index if not exists invoices_stripe_payment_intent_idx on invoices (stripe_payment_intent) where stripe_payment_intent <> '';

-- Same inputs as before (the app still sends the meta line inside p_lines); the function now
-- stores that line in the real columns, and takes the old status from the column.
create or replace function save_invoice(
  p_id uuid,
  p_number integer,
  p_date date,
  p_customer_name text,
  p_customer_phone text,
  p_notes text,
  p_total numeric,
  p_lines jsonb
)
returns setof invoices
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_old_lines jsonb := '[]'::jsonb;
  v_old_status text := 'Draft';
  v_meta jsonb := coalesce((
    select element
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) element
    where element ->> 'itemId' = '__invoice_meta__'
    limit 1
  ), '{}'::jsonb);
  v_lines jsonb := coalesce((
    select jsonb_agg(element)
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) element
    where element ->> 'itemId' <> '__invoice_meta__'
  ), '[]'::jsonb);
  v_new_status text := coalesce(nullif(v_meta ->> 'status', ''), 'Unpaid');
  v_due date := case when v_meta ->> 'dueDate' ~ '^\d{4}-\d{2}-\d{2}$' then (v_meta ->> 'dueDate')::date end;
  v_paid date := case when v_meta ->> 'paidDate' ~ '^\d{4}-\d{2}-\d{2}$' then (v_meta ->> 'paidDate')::date end;
  v_refunded date := case when v_meta ->> 'refundedDate' ~ '^\d{4}-\d{2}-\d{2}$' then (v_meta ->> 'refundedDate')::date end;
  v_discount numeric := coalesce(nullif(v_meta ->> 'discount', '')::numeric, 0);
  v_link_amount numeric := coalesce(nullif(v_meta ->> 'stripeLinkAmount', '')::numeric, 0);
  v_refund_amount numeric := coalesce(nullif(v_meta ->> 'stripeRefundedAmount', '')::numeric, 0);
  movement record;
begin
  if p_number < 1 then
    raise exception 'Invoice number must be positive';
  end if;

  if p_id is not null then
    select lines, status into v_old_lines, v_old_status from invoices where id = p_id for update;
    v_old_status := coalesce(v_old_status, 'Unpaid');

    if v_old_status in ('Unpaid', 'Paid') then
      for movement in
        select (element ->> 'filamentId')::uuid as filament_id,
               sum(coalesce((element ->> 'gramsPerUnit')::numeric, 0) * coalesce((element ->> 'qty')::numeric, 0)) as grams
        from jsonb_array_elements(coalesce(v_old_lines, '[]'::jsonb)) element
        where nullif(element ->> 'filamentId', '') is not null
        group by (element ->> 'filamentId')::uuid
      loop
        update filaments set remaining_g = remaining_g + movement.grams, updated_at = now() where id = movement.filament_id;
        insert into inventory_movements (filament_id, invoice_id, grams_delta, reason)
        values (movement.filament_id, p_id, movement.grams, 'Invoice stock reconciliation');
      end loop;
    end if;
  end if;

  if p_id is null then
    insert into invoices (
      number, date, customer_name, customer_phone, notes, total, lines,
      status, due_date, discount, payment_method, paid_date, payment_reference,
      stripe_link_id, stripe_link_url, stripe_link_amount, stripe_payment_intent, stripe_refunded_amount, refunded_date
    ) values (
      p_number, p_date, p_customer_name, p_customer_phone, p_notes, p_total, v_lines,
      v_new_status, v_due, v_discount, coalesce(v_meta ->> 'paymentMethod', ''), v_paid, coalesce(v_meta ->> 'paymentReference', ''),
      coalesce(v_meta ->> 'stripeLinkId', ''), coalesce(v_meta ->> 'stripeLinkUrl', ''), v_link_amount,
      coalesce(v_meta ->> 'stripePaymentIntent', ''), v_refund_amount, v_refunded
    )
    returning id into v_id;
  else
    update invoices
    set number = p_number, date = p_date, customer_name = p_customer_name,
        customer_phone = p_customer_phone, notes = p_notes, total = p_total, lines = v_lines,
        status = v_new_status, due_date = v_due, discount = v_discount,
        payment_method = coalesce(v_meta ->> 'paymentMethod', ''), paid_date = v_paid,
        payment_reference = coalesce(v_meta ->> 'paymentReference', ''),
        stripe_link_id = coalesce(v_meta ->> 'stripeLinkId', ''),
        stripe_link_url = coalesce(v_meta ->> 'stripeLinkUrl', ''),
        stripe_link_amount = v_link_amount,
        stripe_payment_intent = coalesce(v_meta ->> 'stripePaymentIntent', ''),
        stripe_refunded_amount = v_refund_amount, refunded_date = v_refunded
    where id = p_id
    returning id into v_id;
  end if;

  if v_new_status in ('Unpaid', 'Paid') then
    for movement in
      select (element ->> 'filamentId')::uuid as filament_id,
             sum(coalesce((element ->> 'gramsPerUnit')::numeric, 0) * coalesce((element ->> 'qty')::numeric, 0)) as grams
      from jsonb_array_elements(v_lines) element
      where nullif(element ->> 'filamentId', '') is not null
      group by (element ->> 'filamentId')::uuid
    loop
      update filaments
      set remaining_g = remaining_g - movement.grams, updated_at = now()
      where id = movement.filament_id
        and stock_status = 'available'
        and remaining_g >= movement.grams;
      if not found then
        raise exception 'Not enough available filament stock';
      end if;
      insert into inventory_movements (filament_id, invoice_id, grams_delta, reason)
      values (movement.filament_id, v_id, -movement.grams, 'Invoice finalized');
    end loop;
  end if;

  update settings
  set value = to_jsonb(greatest((value #>> '{}')::integer, p_number + 1))
  where key = 'invoice_no';

  return query select * from invoices where id = v_id;
end;
$$;

-- The next free invoice number, computed in the database so a stale browser can never
-- hand out a number that is already used. Also heals the stored counter if it ever fell behind.
create or replace function next_invoice_no()
returns integer
language sql
volatile
security invoker
set search_path = public
as $$
  with next_no as (
    select greatest(
      coalesce((select (value #>> '{}')::integer from settings where key = 'invoice_no'), 1000),
      coalesce((select max(number) + 1 from invoices), 1000)
    ) as n
  ),
  healed as (
    update settings set value = to_jsonb((select n from next_no)) where key = 'invoice_no' returning 1
  )
  select n from next_no;
$$;
