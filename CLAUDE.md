# Vercel deployments: keep them minimal (free Hobby plan)

The owner is on Vercel's free tier. Every push to GitHub starts a build. This includes any branch, because branches get preview builds too. So deploys are a limited resource.

1. **Batch the work.** Make all requested changes locally, build and test them, then push **once**. Do not push after each small tweak.
2. **Push to `main` only.** Do not create or push feature or backup branches (each one builds a preview). Keep any scratch branches local.
3. **Never push a broken build.** Run `npm run build` (and a type check where there is one) before every push. A failed deploy still uses a build.
4. **Only deploy when asked or when a batch is finished.** If the owner has not said to deploy, finish the work and say it is ready. Ask "deploy now?" instead of pushing after every message.
5. **Commits that change no app code** (notes, README, CLAUDE.md, SQL files kept for the record) must carry `[vercel skip]` in the commit message so they do not build.
6. **Fix forward carefully.** If a deploy fails, find the real cause first (read the error), fix it once, rebuild locally, then push once. No trial-and-error pushes.
7. **Invoicer only:** Vercel Hobby allows at most **12 serverless functions** (files in `api/` that do not start with `_`). Count them before adding one. If at the limit, fold new work into an existing function or a `_helper.js` file.
8. Never push just to "check" something. Test locally (mock backends / Playwright) first.
