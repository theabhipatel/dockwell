DockWell is **pay-as-you-go**. A workspace buys credits in US dollars, and every API and playground request draws them down at the model's price. There are no plans or subscriptions. This page explains how charging works, how to add credits with Stripe, and the controls that keep spending in check.

Billing belongs to the **workspace**. Everyone in it shares one balance. Two permissions control access: **View billing** (see the balance, ledger, payments and invoices) and **Manage billing and add credits** (everything else on this page).

## Exact accounting

All money is stored as **integers in micro-dollars** (1 US dollar = 1,000,000 micro-dollars). Floating point is never used for money, so balances never drift by rounding errors.

- Prices are micro-dollars per 1M tokens.
- Each request's cost is computed with integer arithmetic and rounded **up** to the next micro-dollar, so a request is never undercharged.
- Small costs are shown with full precision, for example `$0.000124`.

## How a request is charged

### Reservations

Before a request runs, DockWell **reserves** the most it could cost:

```text
reservation = (upper estimate of input tokens x input price)
            + (max_tokens x n x output price)
```

The reservation is held against the workspace's balance in a single atomic database update. Your **available balance** is the balance minus everything currently reserved. If the available balance can't cover the reservation, the request is refused with `429 insufficient_quota`.

This is what makes parallel requests safe: a hundred requests sent at the same moment can never spend more than the workspace has.

> [!TIP]
> The reservation uses `max_tokens`. If you leave it out, DockWell uses the server default (4096 by default) or the room left in the model's context. Setting `max_tokens` to what you really need keeps reservations small, so more requests fit in a low balance.

### The exact charge

When the reply finishes, DockWell reads the real token usage reported by the engine and charges the **exact** cost. The rest of the reservation is released at the same moment.

| Outcome | Charged |
|---|---|
| Success | Exactly the tokens used, at the model's price. |
| Failed (engine error, unreachable, rejected) | Nothing. The reservation is released in full. |
| Cancelled mid-stream (you closed the connection) | The tokens generated up to that point. |
| Free model | Nothing. |

Every charge appears in the credit ledger with the model, input and output tokens, and whether it came from the API or the playground. If a request process crashes before it can settle, housekeeping releases its reservation after 30 minutes (`RESERVATION_TTL_MINUTES`).

## The Billing page

The **Billing** page shows:

- the **balance**, the amount **reserved** by requests in flight, and the **available** balance;
- **spend this month** (calendar month, UTC) and your monthly limit, if any;
- the **Add credits** button, saved card and auto recharge settings;
- payment history, the credit ledger and billing details.

## Adding credits

Credits are bought with **Stripe Checkout**, Stripe's hosted payment page. DockWell never sees card numbers.

1. On the **Billing** page, select **Add credits**.
2. Pick a preset amount ($5, $10, $25, $50 or $100 by default) or enter a custom amount.
3. Leave **Save card for future payments** on if you want to use auto recharge later.
4. Select **Continue to payment**. You're taken to Stripe.
5. Pay, and you're sent back to the Billing page.

The platform admin sets the presets and the minimum and maximum top-up. The defaults are a minimum of **$5** and a maximum of **$1,000** per payment.

### Credits arrive by webhook

Credits are added **only when Stripe's webhook confirms the payment**, never from the browser redirect. Usually this takes a second or two, so the balance updates almost as soon as you're back. For payment methods that settle later, credits arrive when Stripe confirms the payment.

Each payment can only ever be credited once. Webhooks are verified by Stripe's signature, each event is processed once, and each credit is tied to its Stripe payment, so a retried or duplicated webhook never adds credit twice.

> [!NOTE]
> If you paid but the balance didn't change, the server isn't receiving Stripe's webhooks. Ask the platform admin to check the Stripe status in the admin area. See the [FAQ](/docs/faq).

### Payment history, receipts and invoices

Every payment is listed with its amount, status and date:

| Status | Meaning |
|---|---|
| Pending | Checkout started but not finished. |
| Succeeded | Paid and credited. |
| Failed | The payment didn't go through. The reason is shown. |
| Expired | The checkout page was left without paying. |
| Refunded / Partially refunded | Some or all of the payment was returned. |

For each successful payment you can open the **Stripe receipt**, view the **invoice** online and download it as a **PDF**. Stripe creates an invoice for every Checkout payment, using your billing details.

## Saved card and auto recharge

If you saved a card at checkout, the Billing page shows its brand, last four digits and expiry. You can remove it at any time, which also turns auto recharge off.

**Auto recharge** tops up the balance automatically: when the balance falls below a threshold, DockWell charges the saved card a fixed amount.

| Setting | Default |
|---|---|
| When balance falls below | $5.00 |
| Add this amount | $20.00 (kept within the platform's minimum and maximum top-up) |

- Only one auto recharge runs at a time. Credits arrive by webhook, like any payment.
- If a charge fails, people with **Manage billing** are notified. After **three failures in a row**, auto recharge is turned off.
- The platform admin can disable auto recharge for the whole install.

## Spend limit and alert

Two settings on the Billing page control monthly spending:

| Setting | Effect |
|---|---|
| **Monthly spend limit** | A hard stop. Once reached, every request in the workspace gets `429 spend_limit_reached` until next month or until you raise it. |
| **Alert threshold** | A warning. When spend this month passes it, people with **Manage billing** get an email and an in-app notification, once per month. |

Months are calendar months in UTC. Projects and keys can have their own spend limits too. See [Rate limits](/docs/rate-limits#spend-limits).

## Balance emails

People with **Manage billing** get notified (in the app, and by email unless they turned billing emails off) when:

| Event | When |
|---|---|
| **Low balance** | The balance drops below the low balance threshold ($1.00 by default, adjustable on the Billing page). |
| **Out of credits** | The balance reaches zero. API and playground requests stop until credits are added. |
| **Payment succeeded** | Credits were added. |
| **Payment failed** | A checkout or auto recharge payment failed. |

Each balance alert fires once, and is re-armed when you top up above the threshold.

## The credit ledger

The ledger is a complete, append-only record of every change to the balance, with the running balance after each entry:

| Kind | What it is |
|---|---|
| Grant | The starter credit. |
| Purchase | Credits bought through Stripe Checkout. |
| Auto recharge | Credits added by auto recharge. |
| Charge | A request (API or playground), with model and tokens. |
| Refund | Credits removed because a payment was refunded. |
| Adjustment | A grant or deduction by a platform admin, with their reason. |

You can export the ledger as CSV for accounting.

## Refunds

Refunds are issued by the platform admin, through Stripe. When Stripe confirms a refund, the refunded amount is removed from the workspace's balance and recorded in the ledger. A refund made directly in the Stripe dashboard is handled the same way.

## Billing details and tax id

Under **Billing details** you can set the name, billing email, address and tax id (type and value, for example an EU VAT number) used on invoices. DockWell passes them to Stripe, which shows them on every invoice. Stripe checks the tax id format and rejects invalid values.

## The starter credit

New accounts receive **$3.00** of free credit by default, once per account and once per email address, after the email is verified. It goes to the first workspace the account creates. See the [Quick start](/docs/quick-start#your-starter-credit).

## Test mode

On the public demo and on local installs, Stripe runs in **test mode**: no real money moves. Use Stripe's test card `4242 4242 4242 4242` with any future expiry date and any CVC. If Stripe isn't configured at all, **Add credits** explains that payments aren't set up on this server.
