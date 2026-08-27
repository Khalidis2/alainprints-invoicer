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

