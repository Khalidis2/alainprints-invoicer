# alainprints — Item Catalog & Invoice Maker

A web app for **alainprints**: a saved item catalog (name, category, price,
description) and an invoice maker that auto-fills the date and invoice
number, takes customer info, and prints/saves a PDF invoice. Invoice history
is searchable and reprintable.

Data is stored in **Supabase** (Postgres) and synced in realtime, so the
catalog, invoice history, and invoice counter are the same whether you're on
PC #1 or PC #2 — add an item on one, it shows up on the other automatically.

## 1. Create the Supabase project (one-time)

1. Go to [supabase.com](https://supabase.com) → New project (free tier is enough).
2. Once it's ready, open **SQL Editor → New query**, paste in the contents of
   [`supabase/schema.sql`](./supabase/schema.sql), and run it. This creates
   the `items`, `invoices`, and `settings` tables.
3. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **anon public** key

> **Security note:** the schema opens read/write to anyone holding the anon
> key, since this app has no login screen — it's meant for internal use by
> you and your team, not the public. Don't publish the anon key or repo
> publicly if you'd rather keep it private. If this ever needs to be
> customer-facing, add real auth (Supabase Auth, same as `store-platform`)
> before opening it up.

## 2. Run it locally

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
cp .env.example .env
# then paste your Supabase URL + anon key into .env
npm run dev
```

Do this on **both PCs**, pointing `.env` at the same Supabase project — that's
what makes them share data.

## 3. Host it online (recommended for 2 PCs)

Local dev servers only run while your terminal is open. To have one URL both
PCs (and your phone) can always reach:

```bash
cd alainprints-invoicer
git init && git add . && git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/alainprints-invoicer.git
git push -u origin main
```

Then in Vercel:
1. **Add New → Project**, import the repo.
2. Framework preset: **Vite** (auto-detected).
3. Under **Environment Variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy.

You'll get a `*.vercel.app` URL — open it on both PCs (and your phone) and
they'll all read/write the same Supabase data, live.

## Project structure

```
alainprints-invoicer/
├── supabase/schema.sql        # run once in Supabase SQL editor
├── .env.example                # copy to .env locally, or set in Vercel
├── src/
│   ├── App.jsx                 # tabs, loads data, realtime subscription
│   ├── lib/
│   │   ├── supabaseClient.js   # Supabase client (reads .env vars)
│   │   ├── storage.js          # all DB reads/writes + realtime subscribe
│   │   └── helpers.js          # formatting, categories, seed data
│   └── components/
│       ├── ItemsMenu.jsx       # catalog: add/edit/delete items
│       ├── InvoiceBuilder.jsx  # build + generate an invoice
│       ├── InvoicePrint.jsx    # printable invoice layout (shared)
│       └── InvoiceHistory.jsx  # past invoices, reopen to reprint
```

## Notes

- **Offline**: with Supabase, the app needs an internet connection to load
  and save data (unlike an earlier localStorage-only version, which worked
  fully offline but didn't sync between devices).
- **Categories**: edit `CATEGORIES` in `src/lib/helpers.js`.
- **Branding**: colors and the spool icon live in `App.jsx` and
  `InvoicePrint.jsx`.
