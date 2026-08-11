-- Run this in the Supabase SQL editor AFTER schema.sql, to add an optional
-- Arabic name field to items. Safe to run once.

alter table items add column if not exists name_ar text;
