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
  bar, and sends waiting sales in the background. The Cash button completes a sale for the exact amount for now.
- Phases 4 to 8: payments, hardware, refunds/staff/audit, reports, trial.

`npm test` runs the checks on the money, VAT and basket sums.

## Where things are

- `src/main/` the Windows program: opens the window and owns the local database (`db.ts`); later the printer
  and cash drawer.
- `src/preload/` the small safe bridge between the program and the screen.
- `src/renderer/src/` the screens (React). `lib/supabase.ts` is the database connection.
- `src/shared/` the sums with no screen attached: money, VAT, basket, product look-up. `test/` checks them.
- The database tables live in the **retail-aid** repo: `supabase/migrations/20260717000058_phase60.sql`.
