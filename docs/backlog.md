# Till backlog

Agreed with Atakan on 25 Nov 2026 after the first install. Everything here is wanted unless marked otherwise.
Order of work: 1) design pass, 2) counter features, 3) Till reports page in Retail Aid, 4) the rest, in the
order the first shop asks for it.

## 1. Design pass

- [x] Selling screen redesign: bright scheme, product buttons, compact keypad with Misc item, Cash and Card
      on the selling screen, Menu in the top bar (v0.10.0). Atakan expects to keep adjusting it.
- [ ] Polish the payment, sign-in, Setup and report pages to match (they have the new colours, not a new layout).

## 2. At the counter

- [ ] Quick-tap buttons the shop chooses and arranges itself (name, colour, tab, order). v0.10.0 has a first
      version with no setup: a "No barcode" tab (products with a price and no barcode) and a "Most sold" tab.
- [x] Discounts: percentage or amount off a line or the whole sale (v0.11.0)
- [ ] Multi-buy offers (3 for £2.50) (needs a database change)
- [x] Park a sale and bring it back (v0.11.0)
- [ ] Age check prompt for alcohol and tobacco (needs a database change)
- [x] Split payment (part cash, part card) (v0.11.0)
- [x] Refunds without a receipt (v0.11.0)
- [ ] Cashback, "paid out" from the drawer, and cash lifts to the safe
- [ ] Customer-facing display (second screen showing the total)
- [ ] Gift receipt (no prices) and email receipt
- [ ] Deposit / bottle-scheme returns
- [ ] Reprint any past receipt

## 3. Products at the till

- [ ] Add or fix a product on the spot when a barcode is not found (name, price, VAT)
- [ ] Weighed and price-embedded barcodes (deli and produce labels)
- [ ] Case and multi-pack barcodes that sell as several units

## 4. Control and safety

- [ ] Staff permissions beyond cashier and manager (for example, who may void)
- [ ] Auto-lock after each sale or when idle, and a PIN on Setup
- Not wanted: a reminder when a day has been open over 24 hours
- Not wanted: manager limits on large refunds, big discounts, too many voids

## 5. Back office (in Retail Aid)

- [ ] Till reports page (view Z reports)
- [ ] Sales reports: by day, hour, product, category, staff member
- [ ] Margin on what actually sold, using Retail Aid's costs
- [ ] Stock control, switched on per shop, using the movements the till already records
- [ ] End-of-period VAT summary for the accountant

## 6. Running it across shops

- [ ] Automatic updates and a signed installer
- [ ] Backup and move of a till to a new PC
- [ ] Combined Z report for shops with several tills
- [ ] Link to a card machine, per provider, when a shop asks (today: separate card machine, any provider)

## Housekeeping

- [ ] Practice records in the REAL shop (Atakan Supermarket) from the first install on 25 Nov 2026: Till 1, one
      trading day, 3 sales (£771.08), 1 refund, a few audit entries, 2 staff. To be cleared with a one-off,
      dry-run-tested database clean-up before that shop goes live on the till. Only on Atakan's say-so.
- [ ] VAT codes for the roughly 36,000 products that have none (sold at 0% until set).
- [ ] Merge https://github.com/atakankar-ui/retail-aid/pull/1 when Atakan says so.
