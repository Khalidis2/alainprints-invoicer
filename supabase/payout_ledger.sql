create table if not exists payout_ledger (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('payout', 'purchase', 'cash_back')),
  amount numeric(12,2) not null check (amount > 0),
  entry_date date not null default (now() at time zone 'Asia/Dubai')::date,
  note text not null default '',
  status text not null default 'done' check (status in ('in_transit', 'done', 'failed')),
  stripe_payout_id text unique,
  bank_last4 text,
  created_at timestamptz not null default now()
);
create index if not exists payout_ledger_date_idx on payout_ledger (entry_date desc, created_at desc);
alter table payout_ledger enable row level security;
drop policy if exists "authenticated access" on payout_ledger;
create policy "authenticated access" on payout_ledger for all to authenticated using (true) with check (true);
create or replace function upsert_payout(
  p_payout_id text, p_amount numeric, p_date date, p_status text, p_last4 text, p_note text
) returns void language sql as $$
  insert into payout_ledger (kind, amount, entry_date, status, stripe_payout_id, bank_last4, note)
  values ('payout', p_amount, p_date, p_status, p_payout_id, p_last4, p_note)
  on conflict (stripe_payout_id) do update
    set amount = excluded.amount, entry_date = excluded.entry_date,
        status = excluded.status, bank_last4 = excluded.bank_last4;
$$;
revoke execute on function upsert_payout(text, numeric, date, text, text, text) from anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'payout_ledger') then
    alter publication supabase_realtime add table payout_ledger;
  end if;
end $$;
