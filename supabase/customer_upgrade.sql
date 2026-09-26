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
