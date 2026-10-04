-- Card payments + email for website orders. Run once in Supabase → SQL Editor.
alter table store_orders add column if not exists payment_method text not null default 'whatsapp';
alter table store_orders add column if not exists payment_status text not null default 'unpaid'
  check (payment_status in ('unpaid', 'paid', 'refunded'));
alter table store_orders add column if not exists stripe_session_id text;
alter table store_orders add column if not exists stripe_payment_intent text;
alter table store_orders add column if not exists paid_at timestamptz;
create index if not exists store_orders_stripe_session_idx on store_orders(stripe_session_id);
create index if not exists store_orders_stripe_pi_idx on store_orders(stripe_payment_intent);
