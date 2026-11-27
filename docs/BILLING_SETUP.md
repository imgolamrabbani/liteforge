# LiteForge — Polar.sh Billing & License Key Setup ($0/mo MoR)

LiteForge reuses the live **$0/month Polar.sh** organization **`bani`** (`c9b3a57f-c07f-4f81-b9b8-aa9f5b497a1e`) and Polar's public Customer Portal License Keys API. **Zero secret API keys are shipped in the VS Code extension.**

---

## Step 1: Create the LiteForge License Key Benefit
1. Open [polar.sh/dashboard/bani](https://polar.sh/dashboard/bani) → **Products → Benefits → + New Benefit**.
2. Select **License Keys** and configure:
   - **Description:** `LiteForge Pro License (Up to 3 machines)`
   - **Prefix:** `LITEFORGE`
   - **Activation Limit:** `3` (allows use across up to 3 personal machines; seats can be freed anytime via `LiteForge: Deactivate License`)
   - **Expiration:** `Never` (Polar automatically revokes keys on canceled monthly subscriptions)
3. Save the benefit.

---

## Step 2: Create LiteForge Pro Products
Go to **Products → + New Product** in `bani` and create:

1. **LiteForge Pro — Early Bird (Perpetual One-Time)**
   - **Pricing:** One-time purchase — **$19 USD** (Standard later: **$24 USD**)
   - **Benefits:** Attach `LiteForge Pro License (Up to 3 machines)`
2. **LiteForge Pro — Monthly (Optional)**
   - **Pricing:** Recurring Monthly — **$5 USD / month**
   - **Benefits:** Attach `LiteForge Pro License (Up to 3 machines)`

---

## Step 3: Generate Checkout Links
1. Go to **Products → Checkout Links → + New Checkout Link**.
2. Generate links for:
   - **LiteForge Pro — Early Bird ($19)** → set as `POLAR_CHECKOUT_URL_EARLY_BIRD` / `POLAR_CHECKOUT_URL_LIFETIME`
   - **LiteForge Pro — Monthly ($5/mo)** → set as `POLAR_CHECKOUT_URL_MONTHLY`
3. Copy `.env.example` to `.env` inside `products/liteforge/` and paste the live `https://buy.polar.sh/...` URLs.
4. Wire the checkout URLs into `products/liteforge/app/package.json`, `products/liteforge/app/src/extension.ts`, and `products/liteforge/website/index.html` before packaging `.vsix`.

---

## Step 4: Verify Activation Flow
1. Issue a test key from **Products → Benefits → License Keys** in Polar Dashboard.
2. In VS Code, run **Command Palette → `LiteForge: Activate Pro License`** and paste the `LITEFORGE-...` key.
3. Verify Inline Editing, Schema/ERD Inspector, 2-File DB Diff, and Full `.sql` Dump unlock immediately, and `LiteForge: Deactivate License` frees the machine slot.
