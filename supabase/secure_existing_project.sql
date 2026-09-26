begin;

drop policy if exists "anon full access" on public.items;
drop policy if exists "anon full access" on public.invoices;
drop policy if exists "anon full access" on public.settings;
drop policy if exists "authenticated access" on public.items;
drop policy if exists "authenticated access" on public.invoices;
drop policy if exists "authenticated access" on public.settings;

create policy "authenticated access" on public.items
for all to authenticated using (true) with check (true);

create policy "authenticated access" on public.invoices
for all to authenticated using (true) with check (true);

create policy "authenticated access" on public.settings
for all to authenticated using (true) with check (true);

commit;
