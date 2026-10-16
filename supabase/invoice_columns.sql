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
