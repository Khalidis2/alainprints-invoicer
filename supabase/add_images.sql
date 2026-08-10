-- Run this in the Supabase SQL editor AFTER schema.sql, to add image
-- support to items. Safe to run once.

-- 1. Add an image_url column to items
alter table items add column if not exists image_url text;

-- 2. Create a public storage bucket for item photos
insert into storage.buckets (id, name, public)
values ('item-images', 'item-images', true)
on conflict (id) do nothing;

-- 3. Open it up for read/upload/delete via the anon key (same trust model
-- as the rest of this app — see the security note in README.md)
create policy "public read item images" on storage.objects for select
  using (bucket_id = 'item-images');

create policy "anon upload item images" on storage.objects for insert
  with check (bucket_id = 'item-images');

create policy "anon delete item images" on storage.objects for delete
  using (bucket_id = 'item-images');
