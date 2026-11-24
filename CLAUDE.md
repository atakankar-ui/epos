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

- **Local storage** is `src/main/db.ts`: SQLite through Node's built-in `node:sqlite` (no native module to
  compile), file `till.sqlite` in Electron's userData. It holds the binding (shop + till), the product copy and
  every sale with its sent/waiting state. The screen reaches it only through `window.till.local` (preload IPC).
- **Start-up is local first** (`App.tsx`): a bound till opens from the local file with no internet and no
  session. Sign-in + `Connect` (register a `tills` row, download products) happen once per PC.
- **Sync** is `src/renderer/src/lib/sync.ts`, run from `Till.tsx` every 15 s, after each sale and on
  online/offline events: upsert sale, then lines, then payment with ignore-duplicates; mark sent only when all
  three are in. No connection = stop and retry later; a refusal from the database = keep the sale, record the
  reason, retry every round, show it in Setup. Products refresh every 10 minutes, but never when the sign-in's
  `current_org()` is not this till's shop.

- **Payments** are `screens/Tender.tsx`. Cash is complete. Card: `lib/card.ts` calls an edge function named
  `till-card` with `{action: 'start', sale_id, till_id, amount_pence}` -> `{payment_intent_id}`, then polls
  `{action: 'status', payment_intent_id, till_id}` -> `{state: waiting|approved|declined|cancelled, brand, last4,
  message}`, and `{action: 'cancel', ...}`. **That function does not exist yet** (needs Atakan's Stripe decisions:
  whose Stripe account per shop, which reader; plus a `stripe_reader_id` per till). Until then the Card button
  answers "not set up". The sale id is made before the card is taken and sent with `start`, so the function must
  use it as the idempotency key and store it on the PaymentIntent.

- **Hardware**: `shared/receipt.ts` builds a receipt as plain lines; `shared/escpos.ts` turns lines into text
  (preview, tests) or ESC/POS bytes (PC437, so `£` is 0x9C). `main/printer.ts` sends bytes: network printers by
  TCP 9100; Windows-installed (USB) printers RAW through winspool via a PowerShell script (no native module);
  `TILL_PRINT_TO_FILE=<folder>` writes jobs to files for tests. `main/hardware.ts` holds the IPC
  (`window.till.hardware`): settings per PC in local meta `hardware`, shop receipt details cached in
  `shop_details` (source of truth: `shop_settings` table, Buyer-only to change). The drawer kick goes at the
  start of the cash sale's print job. **The Windows USB path has never run on a real Windows PC or printer.**

- **Staff** (`shared/staff.ts`, `lib/staff.ts`, `screens/StaffCard.tsx`): rows in `staff` (Buyer-only to change),
  PIN stored as PBKDF2-SHA256 salt + hash, cached in local meta `staff` for offline checks. With no staff the till
  opens without a PIN and manager-only actions are refused; once any exist `StaffGate` locks the till.
- **Approvals and audit** (`screens/Approval.tsx`, `shared/audit.ts`): pages call `tools.ask({title, manager,
  reasons})` then `tools.log(...)` (both from `Till.tsx`). Manager-only: price override, refund, no-sale drawer.
  Void line / void sale: any staff, reason required. Audit entries and refunds go into the local `outbox` table
  and are synced after sales, in order (a refund needs its sale on the server first).
- **Refunds** (`shared/refund.ts`, `screens/Refund.tsx`): by receipt number (this till's records, else the
  database when online), per line and quantity, never more than sold minus already refunded, cash only, own
  number run `T1-R000001`. No refund without a receipt yet; card refunds wait for the Stripe function.

- **Trading days and reports** (`shared/report.ts`, `screens/Reports.tsx`): local `days` table, at most one open;
  `StartDay` (float) shows whenever none is. The local database stamps `day_session_id` on each sale and refund.
  `buildReport` works from the day's local sales, refunds and audit entries (all pence) and `reportLines` prints
  it. X: logged as audit `x_report` with the report in `details`. Z: `closeDay` fixes the report, queues
  `day_close` (an update of `day_sessions` that only applies while `closed_at` is null) and logs `z_report`.
  Sync order: `day_open` rows, then sales, then everything else in order. Reports need a manager once staff exist.
  The saved report JSON (`version: 1`) is what a future Retail Aid screen should read; none exists yet.

- **Installer**: electron-builder, NSIS, x64, unsigned (`build` in `package.json`, `npm run dist:win`). It cannot
  be built in a Linux cloud session (needs wine); `.github/workflows/build-windows.yml` builds it on
  `windows-latest` for any `v*` tag and attaches `Till-Setup-<version>.exe` to a GitHub Release. Everything the
  app needs is bundled into `out/`, so there are no runtime `dependencies`. Installed, the data folder is
  `%APPDATA%/Till` (from `productName`: do not rename it, or tills lose their binding and unsent sales).
  No auto-update yet. The trial checklist is `docs/trial-checklist.md`.

## Rules that must hold

- Offline first: a sale is saved on the till before anything else and is never lost or rejected by sync. The till
  makes the sale's id, so sending it twice is harmless.
- Stock control is off by default (`shop_settings.stock_control_enabled`); when off the till never checks, blocks
  or warns about stock. The database writes a `stock_movements` row for every sold or refunded line regardless.
- Sales, payments, refunds and the audit log are add-only. The audit log cannot be changed by anyone.
- A product with no VAT code is sold at 0% VAT, silently (Atakan's decision, 24 Nov 2026; `VAT_WHEN_UNKNOWN`).
  A product with no price asks the cashier to key one; it is not written back to the product.
- Voided lines stay in the basket, struck through, so Phase 6 can write them to the audit log.
- While the payment page is open the basket is frozen: typed or scanned digits are cash given, never new items.
- A card sale is saved only after the reader says approved. Declined, cancelled or unknown saves nothing.
- Printing and the drawer happen after the sale is saved and can never block or undo it; a failure is shown to
  the cashier with a Print receipt button. Opening the drawer with no sale outside Setup is a Phase 6 manager action.
- The audit entry is written before the action takes effect; if it cannot be written, the action does not happen.
  Audit entries are insert-only locally too.
- A closed day is never changed, locally or in the database. Selling needs an open day.
- Money is VAT-inclusive pounds in the database (`numeric(10,2)`); do the sums in whole pence in the app.
- Card payments (Stripe Terminal, server-driven) need internet and a server-side secret: that secret goes in a
  Supabase edge function, never in this app.

## Working on it

- `npm run dev` to run. Before any push: `npm test` and `npm run build` (type-check + build) must pass, and in a
  cloud session `npm run e2e` (drives the real app like a cashier with stubbed database replies; see
  `test/e2e/till.e2e.cjs`; pass a folder to save screenshots). Look at the screenshots, not just the pass line.
- Logic with no screen lives in `src/shared/` (money, basket, products, sale rows) and is unit-tested in `test/`,
  as is the local database (`test/db.test.ts`, against a real file).
- Cloud sessions cannot reach `*.supabase.co` from the shell or from the launched app (only through the Supabase
  MCP), have no shop login, and have no till hardware. Test screens by launching Electron under `xvfb-run` with
  Playwright and stubbing the Supabase replies. Real sign-in, printer, drawer, card reader and the Windows
  installer need Atakan's PC.
- Develop against a shop whose name contains "test".
