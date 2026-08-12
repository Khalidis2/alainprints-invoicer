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
  number integer not null,
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
