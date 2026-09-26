-- Run once in the invoicer Supabase SQL Editor.
-- Exposes only safe, sellable stock fields to the public PrintTools3D store.

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
  with normalized as (
    select
      brand,
      case
        when material in ('PLA Basic', 'PLA HS', 'PLA+') then 'PLA'
        when material in ('PLA Matte', 'Matte PLA') then 'PLA Matte'
        when material in ('PETG', 'PETG Matte') then 'PETG'
        when material in ('Silk Tricolor', 'PLA Marble') then 'PLA'
        else material
      end as public_material,
      case
        when material = 'Silk Tricolor' then 'Silk ' || color
        when material = 'PLA Marble' then 'Marble'
        else color
      end as public_color,
      remaining_g,
      spool_weight_g,
      selling_price
    from filaments
    where stock_status = 'available'
      and remaining_g >= spool_weight_g
      and selling_price > 0
  )
  select
    string_agg(distinct brand, ' / ' order by brand) as brand,
    public_material as material,
    public_color as color,
    floor(sum(remaining_g) / max(spool_weight_g))::integer as stock,
    max(selling_price) as price
  from normalized
  group by public_material, public_color
  having floor(sum(remaining_g) / max(spool_weight_g)) > 0
  order by public_material, public_color;
$$;

revoke all on function public_store_stock() from public;
grant execute on function public_store_stock() to anon, authenticated;
