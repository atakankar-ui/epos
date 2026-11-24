# Till (EPOS): notes for Claude

Atakan's till app for independent UK shops, first for a friend's new shop. Atakan is **not a programmer** and
mostly works from his phone: plain language, small steps, ask before big decisions or anything that costs money.
Build one phase at a time and end each with: what was built, what to test, decisions needed.

## How it fits together

- Electron + React + TypeScript (electron-vite). `src/main` (Windows program), `src/preload` (bridge, sandboxed,
  context-isolated), `src/renderer` (screens).
- Shares the Retail Aid Supabase project `gobbuzoypsfbrkayfuod`. A shop is a row in `orgs` (there is no `shops`
  table); every till table has `org_id` and per-shop RLS. Only the public publishable key is in the app; never
  the `service_role` key.
- **Database changes live in the `retail-aid` repo** (`supabase/migrations/`), follow its CLAUDE.md rules:
  numbered migration with a proof block, rolled-back trial first, applied only when Atakan says so, never post
  data-changing SQL in chat. Till tables came in `20260717000058_phase60.sql`.
- Product fields the till reads: `barcode`, `till_name` (else `name`), `retail_price` (VAT-inclusive),
  `vat_rate` (generated from `vat_code`; empty for most products today).

## Rules that must hold

- Offline first: a sale is saved on the till before anything else and is never lost or rejected by sync. The till
  makes the sale's id, so sending it twice is harmless.
- Stock control is off by default (`shop_settings.stock_control_enabled`); when off the till never checks, blocks
  or warns about stock. The database writes a `stock_movements` row for every sold or refunded line regardless.
- Sales, payments, refunds and the audit log are add-only. The audit log cannot be changed by anyone.
- A product with no VAT code is sold at 0% VAT, silently (Atakan's decision, 24 Nov 2026; `VAT_WHEN_UNKNOWN`).
  A product with no price asks the cashier to key one; it is not written back to the product.
- Voided lines stay in the basket, struck through, so Phase 6 can write them to the audit log.
- Money is VAT-inclusive pounds in the database (`numeric(10,2)`); do the sums in whole pence in the app.
- Card payments (Stripe Terminal, server-driven) need internet and a server-side secret: that secret goes in a
  Supabase edge function, never in this app.

## Working on it

- `npm run dev` to run. Before any push: `npm test` and `npm run build` (type-check + build) must pass, and in a
  cloud session `npm run e2e` (drives the real app like a cashier with stubbed database replies; see
  `test/e2e/selling.e2e.cjs`). Look at the screenshot it can save, not just the pass line.
- Logic with no screen lives in `src/shared/` (money, basket, products) and is unit-tested in `test/`.
- Cloud sessions cannot reach `*.supabase.co` from the shell or from the launched app (only through the Supabase
  MCP), have no shop login, and have no till hardware. Test screens by launching Electron under `xvfb-run` with
  Playwright and stubbing the Supabase replies. Real sign-in, printer, drawer, card reader and the Windows
  installer need Atakan's PC.
- Develop against a shop whose name contains "test".
