# Till trial checklist

For trying the till in the shop before relying on it. Work down the list and tick each line. If something
goes wrong, write down what you pressed and the exact words on screen (a phone photo is perfect).

**Use a test shop first** (a shop whose name contains "test"), so practice sales stay out of the real figures.
Do the whole list there once, then connect the till to the real shop.

## 1. Install

- [ ] On the till PC, download `Till-Setup-….exe` from the latest release on GitHub (or carry it over on a USB stick).
- [ ] Run it. Windows will say "Windows protected your PC" because the installer is not signed yet: choose
      **More info**, then **Run anyway**.
- [ ] The till opens and a **Till** shortcut is on the desktop.
- [ ] Press **F11**: the till goes full-screen. Press it again to come back.

## 2. Connect to the shop (needs internet, once)

- [ ] Sign in with the shop's Retail Aid login. For day-to-day use, prefer a login that belongs only to this shop.
- [ ] It says "Setting up this till", downloads the products and shows **Start the day**.
- [ ] The top bar shows the right shop name and a till name (Till 1, Till 2 …). A test shop shows TEST SHOP.

## 3. Setup (press Menu, top right, then Setup)

- [ ] **What the receipt says**: fill in shop name, address, VAT number and bottom message. Save. (Needs a Buyer login.)
- [ ] **Staff and PINs**: add yourself as a Manager and at least one Cashier.
- [ ] **Receipt printer**: choose the printer. Press **Print test receipt**.
  - [ ] It prints.
  - [ ] The £ sign is a £, not a strange letter.
  - [ ] The long row of dashes fits on one line. If it wraps, change **Paper width** and test again.
- [ ] **Test drawer**: the cash drawer opens.
- [ ] **Product check**: read the numbers. Products with no price will ask the cashier for one; products with
      no VAT code are sold at 0% VAT.

## 4. Start the day and sign in

- [ ] Go back to the till. Type the float (5000 means £50.00) and press **Start the day**.
- [ ] "Who is using the till?" shows your staff. A wrong PIN is refused. The right PIN lets you in.

## 5. Selling

- [ ] Scan 5 different real products. For each one: is the name right? Is the price the shelf price?
- [ ] Scan the same product twice: the quantity becomes 2 on one line.
- [ ] Scan a product from a multi-pack or with a short barcode (8 digits), if you sell any.
- [ ] Scan something that is not in the system: it says "No product with barcode …" and adds nothing.
- [ ] Tap the **Search** tab, type part of a name, tap the product.
- [ ] **No barcode** tab: products that have a price but no barcode show as buttons. Tap one to sell it.
- [ ] **Most sold** tab: after a few sales, the till's best sellers show here.
- [ ] Tap a line, type 3, press **Qty**. Try **+ 1** and **− 1**.
- [ ] Type 150 and press **Misc item** (beside the number pad): a £1.50 line appears.
- [ ] **Void line**: asks why, strikes the line through, total drops.
- [ ] **Void sale**: asks why, clears the basket.
- [ ] The total and the VAT lines at the bottom look right for what is in the basket.
- [ ] Speed: does a scan feel instant? Scan 20 items quickly, one after another. None missed, none doubled?

## 6. Cash payment

- [ ] Press **Cash**, then **Exact**: drawer opens, receipt prints, "Change to give £0.00".
- [ ] Another sale: type what the customer gave (2000 for £20): the change is right, and matches the receipt.
- [ ] Try a quick button (£5, £10, £20).
- [ ] Read one receipt carefully: shop name, address, VAT number, date and time, receipt number, every item
      and price, total, cash given, change, VAT by rate.
- [ ] **Print a copy** prints a second one marked COPY without opening the drawer.

## 6b. Card payment (with the shop's own card machine)

- [ ] Press **Card**: the till shows the amount in large type.
- [ ] Type that amount into the card machine and pay with a real card (a small amount you can refund).
- [ ] Press **Yes, approved**: the receipt prints and says Card. The cash drawer stays shut.
- [ ] Try once more and press **No, declined or cancelled**: nothing is saved and the basket is still there.
- [ ] Refund the card sale: **Menu → Refund**, find the receipt, **Refund … to the card**. Do the refund on the
      card machine, then press **Yes, refunded**.

## 7. Manager actions (sign in as the Cashier for these)

- [ ] Tap a line, type a lower price (99), press **Price**: it asks for a manager. Enter the manager PIN and a
      reason. The line shows the new price and "was …".
- [ ] **Menu → Open drawer (no sale)**: asks for a manager and a reason, then the drawer opens.
- [ ] **Menu → Refund**: find an earlier receipt, refund one item. Manager PIN, reason, drawer opens, refund
      slip prints. Try to refund the same item again: it is not offered.
- [ ] **Menu → Lock the till**: back to "Who is using the till?".

## 7b. Discounts, split payment, parked sales, refund with no receipt

- [ ] Tap a line, press **Discount**, choose 10%: manager PIN and reason; the line shows the saving.
- [ ] Type 150, press **Discount**, choose **The whole sale** and **£1.50 off**: the total drops by £1.50.
- [ ] Press **Cash**, type less than the total (500), press **Take £5.00 cash, rest later**, then **Card** for
      the rest. The receipt shows both payments.
- [ ] Scan two items, press **Park**. Serve another customer. Press **Parked**, tap the sale: it comes back.
- [ ] With a sale parked, try a Z report: the till refuses until the parked sale is finished or voided.
- [ ] Scan an item a customer is returning with no receipt. **Menu → Refund the items in the basket (no
      receipt)**: manager PIN, reason, drawer opens, slip says "No receipt".

## 8. No internet

- [ ] Unplug the network cable or switch Wi-Fi off. Within about 15 seconds the top bar turns amber:
      **Offline · cash only**.
- [ ] Make 3 cash sales. Each saves and prints. The top bar counts them as "waiting to send".
- [ ] Press Card: it still works (the card machine has its own connection) and says so.
- [ ] Close the till completely and open it again, still offline: it opens straight to the till, and the
      waiting count is still there.
- [ ] Switch the internet back on: the light goes green and the waiting count clears by itself.
- [ ] **Pull the power plug** in the middle of a quiet moment (not mid-print). Switch on again: the till opens
      and nothing is lost.

## 9. End of day

- [ ] **Menu → Reports → X report**: prints. Check the sales total against your own count of the practice sales.
- [ ] Count the cash in the drawer. **Menu → Reports → Z report**, type the counted total: the report shows
      "Exactly right", "Over by" or "Short by", and the difference is what you expect.
- [ ] Run the card machine's own end-of-day report and type its total when the till asks: the Z report shows
      "They match", or by how much the two differ.
- [ ] The till now asks to **Start the day** again. **Past reports** shows the Z report you just made.

## 10. Check the records arrived (Atakan, with Claude)

- [ ] Ask Claude to do a read-only check of the test shop: the number of sales, refunds, log entries and the
      Z report in the database match what was done on the till.

## 11. Before going live in the real shop

- [ ] **Menu → Setup → Disconnect** the till from the test shop (only possible when nothing is waiting to send).
- [ ] Sign in with the real shop's login and repeat sections 3 and 4.
- [ ] Make one real sale and one real refund of it, and check both receipts.
- [ ] Keep the old till or a cash book next to it for the first week, and compare the Z report to it each night.

## Not in this version

- A link between the till and the card machine: the cashier types the amount into the card machine by hand.
- Multi-buy offers, age checks, weighed items, loyalty, customer accounts, stock levels.
- Viewing Z reports inside the Retail Aid app.
