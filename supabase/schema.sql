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

create policy "anon full access" on items for all
  using (true) with check (true);
create policy "anon full access" on invoices for all
  using (true) with check (true);
create policy "anon full access" on settings for all
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
