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
- Phases 2 to 8: selling screen, offline and sync, payments, hardware, refunds/staff/audit, reports, trial.

## Where things are

- `src/main/` the Windows program: opens the window; later the local database, printer and cash drawer.
- `src/preload/` the small safe bridge between the program and the screen.
- `src/renderer/src/` the screens (React). `lib/supabase.ts` is the database connection.
- The database tables live in the **retail-aid** repo: `supabase/migrations/20260717000058_phase60.sql`.
