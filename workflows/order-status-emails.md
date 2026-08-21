# Workflow: Order Status Emails

## Objective
Keep customers automatically informed by email whenever their order reaches
a new status — no manual sending required. Covers all four order statuses:
**Processing** (Order Confirmed), **Shipped**, **Delivered**, **Cancelled**.

## When it runs
There are exactly two triggers in the codebase. Nothing else should call
these emails directly — if a new trigger point is needed, wire it through
`sendOrderStatusEmail`, don't duplicate the template logic.

| Trigger | File | What happens |
|---|---|---|
| Payment succeeds | `backend/lib/orderFulfillment.js` → `fulfillOrderPayment()` | Sends the **Order Confirmed** email once, right after stock is decremented and the order is marked `paid`. |
| Staff changes order status | `backend/routes/orders.js` → `PATCH /api/orders/:id/status` | Sends the matching email for whichever status the admin panel just set (`Processing`, `Shipped`, `Delivered`, or `Cancelled`). |

Both call sites are fire-and-forget (`sendOrderStatusEmail(...)` is not
awaited before responding, and payment fulfillment doesn't await it either)
so a slow or failing email provider never blocks checkout or the admin's
"save" action.

## Required inputs / configuration
Set these in `backend/.env`:

| Variable | Required | Notes |
|---|---|---|
| `SMTP_HOST` | No | If unset, emails are **not sent** — see "Local dev / no SMTP configured" below. |
| `SMTP_PORT` | No | Defaults to `587`. Use `465` for implicit TLS. |
| `SMTP_USER` / `SMTP_PASS` | No (required if your provider needs auth) | Gmail: use an App Password, not your normal password. |
| `SMTP_FROM` | No | Defaults to `Ennys <hello@ennys.co.uk>`. |

Any standard SMTP provider works — Gmail (App Password), SendGrid, Resend,
Mailgun, Postmark, etc. There's no provider-specific code; it's plain
`nodemailer` SMTP.

## Tools involved
- `backend/lib/mailer.js` — sends via `nodemailer`, or previews to disk if
  `SMTP_HOST` isn't set (see below). Don't call `nodemailer` directly from
  anywhere else — go through `sendMail()` here.
- `backend/lib/orderEmailTemplates.js` — builds the `{ to, subject, html }`
  for a given order + status. This is where the four templates
  (`STATUS_CONTENT`) live, along with the shared branded layout
  (`baseLayout`) and the order-summary table.
- `backend/lib/orderNotifications.js` — the only thing the rest of the app
  calls (`sendOrderStatusEmail(orderId, status)`). Swallows and logs errors
  so a broken SMTP config never surfaces as a customer-facing 500.

## Expected output
- **SMTP configured:** the customer receives an email within seconds of the
  status change, matching the store's branding (dark header, status-coloured
  heading/icon, order number, itemised order summary, delivery address if
  present, contact-email footer).
- **SMTP not configured (local dev):** no email is sent. Instead, an HTML
  file is written to `backend/.tmp/emails/<timestamp>-<email>.html` and a
  line is logged to the server console:
  `[mailer] SMTP not configured — email saved to ...`
  Open that file directly in a browser to see exactly what the customer
  would have received. This folder is gitignored and disposable — safe to
  delete anytime.
- **No customer email on the order:** the email is silently skipped (checked
  in `buildOrderStatusEmail`) — this shouldn't happen in practice since
  checkout requires an email, but guards against bad data.

## How to test a status email end-to-end
1. Make sure the backend is running (`npm start` from `backend/`, port 4000).
2. Log in to `/admin` and change an order's status (Orders & Sales →
   open an order → change status), **or** hit the API directly:
   ```
   PATCH /api/orders/:id/status
   { "status": "Shipped" }
   ```
3. If `SMTP_HOST` isn't set, check `backend/.tmp/emails/` for the new file
   and open it in a browser.
4. If `SMTP_HOST` is set, check the inbox of the order's `customer_email`.

## How to add a fifth status (or edit copy)
Everything for a status lives in one place: the `STATUS_CONTENT` object in
`backend/lib/orderEmailTemplates.js` (`emoji`, `heading`, `accent` colour,
`subject(order)`, `message(order)`). Add a new key there — no other file
needs to change, since `orderNotifications.js` and the two trigger points
already forward whatever status string they're given.

Note: the `orders.status` column is constrained by a `CHECK` in
`backend/migrations/001_init.sql` to `Processing|Shipped|Delivered|Cancelled`
— a genuinely new order status (not just new copy) needs a DB migration
first, plus updating the `valid` array in `routes/orders.js`.

## Known limitations / things to revisit
- Emails are sent from whatever `SMTP_FROM` is configured — there's no
  per-status "from name" override.
- No unsubscribe/preference mechanism — these are transactional emails tied
  to an order the customer placed, not marketing.
- No retry queue: if `sendMail` throws (e.g. SMTP provider is down), the
  error is logged and the email is simply not sent. For a store this size
  that's an acceptable trade-off, but revisit if email delivery becomes
  business-critical.
