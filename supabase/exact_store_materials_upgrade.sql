create or replace function store_public_material(p_material text)
returns text
language sql
immutable
as $$
  select trim(p_material);
$$;

create or replace function store_public_color(p_material text, p_color text)
returns text
language sql
immutable
as $$
  select trim(p_color);
$$;

create or replace function public_store_stock()
returns table (
  brand text,
  material text,
  color text,
  stock integer,
  price numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    string_agg(distinct f.brand, ' / ' order by f.brand) as brand,
    trim(f.material) as material,
    trim(f.color) as color,
    sum(floor(f.remaining_g / f.spool_weight_g))::integer as stock,
    max(f.selling_price) as price
  from filaments f
  where f.stock_status = 'available'
    and f.remaining_g >= f.spool_weight_g
    and f.selling_price > 0
  group by trim(f.material), trim(f.color)
  having sum(floor(f.remaining_g / f.spool_weight_g)) > 0
  order by trim(f.material), trim(f.color);
$$;

revoke all on function public_store_stock() from public;
grant execute on function public_store_stock() to anon, authenticated;
