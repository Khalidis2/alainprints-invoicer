-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query)
-- for a fresh project. Creates the tables the app needs and opens them up
-- for read/write using the anon key, since this is a small internal tool
-- with no login screen (see README security note).

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Custom',
  price numeric not null default 0,
  description text default '',
  created_at timestamptz default now()
);

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

-- Row Level Security: enabled, with an open policy for the anon key.
-- This is fine for a private internal tool where only you have the URL/key.
-- If this ever becomes customer-facing, add real auth before opening it up.

alter table items enable row level security;
alter table invoices enable row level security;
alter table settings enable row level security;

create policy "anon full access" on items for all
  using (true) with check (true);
create policy "anon full access" on invoices for all
  using (true) with check (true);
create policy "anon full access" on settings for all
  using (true) with check (true);
