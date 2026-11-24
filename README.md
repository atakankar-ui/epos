# Till (EPOS)

A touchscreen till for independent UK shops. It is a Windows desktop app (Electron + React + TypeScript)
and shares its database with Retail Aid, so a price changed in Retail Aid is the price the till charges.

## Run it on your PC

You need [Node.js](https://nodejs.org) (the LTS version) installed once. Then, in this folder:

```bash
npm install
```

```bash
npm run dev
```

A window opens. Sign in with a shop's Retail Aid email and password; use a **test shop** while the till
is being built. `npm run build` checks the code and builds it; `npm start` runs that built copy.

## What is built so far

- **Phase 1, setup (done):** the app, the sign-in, and a connection-check page that shows the shop, its
  products, and whether the till's database tables are in place.
- **Phase 2, selling screen (done):** basket on the left, keypad and buttons on the right. Scan (or type a
  barcode and press Enter), search by name, change quantity, void a line or the whole sale, live total with VAT
  by rate. A product with no VAT code is sold at 0% VAT; a product with no price asks the cashier for one.
- **Phase 3, offline and sync (done):** the till keeps its own copy of the products and every sale in a
  database file on the PC. It opens and sells with no internet, shows Online or "Offline · cash only" in the top
  bar, and sends waiting sales in the background.
- **Phase 4, payments (cash done, card half done):** the Pay button opens a payment page. Cash: type what the
  customer gave or tap Exact / £5 / £10 / £20 / £50, and the till shows the change. Card: the till's side is
  built (send the amount, wait, approved / declined / cancelled, off when offline), but the server part that
  talks to Stripe is not written yet, so the Card button says "not set up".
- **Phase 5, hardware (built, not yet tried on a real printer):** receipts in ESC/POS, the cash drawer opened
  through the printer on cash sales, and a printer section in Setup (USB printer installed in Windows, or a
  network printer; paper width; test receipt; open drawer; what the receipt says). A printer fault never blocks
  a sale.
- **Phase 6, staff, refunds and audit (done):** staff sign in with their own PIN (managed in Setup). Voids ask
  for a reason. Price changes, refunds and opening the drawer with no sale need a manager's PIN and a reason.
  Refunds are by receipt, by line and quantity, in cash. Every one of these is written to the audit log.
- Phases 7 and 8: reports, trial.

`npm test` runs the checks on the money, VAT and basket sums.

## Where things are

- `src/main/` the Windows program: opens the window and owns the local database (`db.ts`); later the printer
  and cash drawer.
- `src/preload/` the small safe bridge between the program and the screen.
- `src/renderer/src/` the screens (React). `lib/supabase.ts` is the database connection.
- `src/shared/` the sums with no screen attached: money, VAT, basket, product look-up. `test/` checks them.
- The database tables live in the **retail-aid** repo: `supabase/migrations/20260717000058_phase60.sql`.
