# Ennys

Birmingham's Afro-Caribbean online superstore — a full-stack e-commerce site
with a customer storefront and a separate admin back office, built on
Express and SQLite.

## Overview

- **Customer storefront** — browse the catalogue, pick product variations
  (weight, colour, quantity, size, flavour — each with its own price/stock),
  cart, checkout via Stripe, accounts with order history.
- **Admin dashboard** (`/admin`, session-gated) — catalogue & variations
  management, orders & fulfillment, returns, customers, promotions, CMS-
  editable site content, store settings.
- **Order status emails** — customers automatically get a branded email when
  their order is confirmed, shipped, delivered, or cancelled. See
  [workflows/order-status-emails.md](workflows/order-status-emails.md).

## Tech stack

- **Node.js** ≥ 22.5.0, **Express 4**
- **SQLite** via Node's built-in `node:sqlite` — no native build step, no
  separate database server to run
- **express-session** — two independent session scopes (admin vs. customer),
  so an admin login never overlaps with a shopper's
- **Stripe** for payments — falls back to mock payment intents when no keys
  are configured, so checkout is fully testable without a Stripe account
- **Nodemailer** for transactional email — falls back to writing emails to
  `backend/.tmp/emails/` when no SMTP is configured, so the order-status flow
  is testable without a mail provider
- **Puppeteer** — renders the printable order invoice and drives the
  responsive QA screenshot script

## Project structure

```
backend/
  server.js         Express entrypoint — mounts every route, serves storefront + admin
  db.js             SQLite connection, schema bootstrap, small migrations
  migrations/       SQL schema (001_init.sql)
  routes/           API routes (storefront, checkout, admin catalogue/orders/customers/…)
  lib/              Business logic: variations, order fulfillment, order emails, etc.
  middleware/       Auth guards, file uploads, error handling
  public/
    store/          Customer-facing HTML/CSS/JS (the actual storefront pages)
    uploads/        Uploaded product/CMS images (gitignored)
  views/            Admin dashboard + invoice — auth-gated, not statically served
  scripts/          One-off/maintenance scripts (product import, demo seed, QA screenshots)
  data/             SQLite database file (gitignored)
workflows/          Written SOPs for recurring processes (e.g. order status emails)
```

## Getting started

```bash
cd backend
npm install
cp .env.example .env   # then fill in the values below
npm start               # → http://localhost:4000
```

### Environment variables

Copy `backend/.env.example` to `backend/.env` and fill in:

| Variable | Required | Notes |
|---|---|---|
| `PORT` | No | Defaults to `4000`. |
| `SESSION_SECRET` | Yes | Long random string — admin session signing. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Yes | Seeds the single admin account on every server start. |
| `CUSTOMER_SESSION_SECRET` | Yes | Separate signing secret for customer accounts. |
| `STRIPE_PUBLISHABLE_KEY` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | No | From the [Stripe test dashboard](https://dashboard.stripe.com/test/apikeys). Without these, checkout uses mock payment intents. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | No | Any SMTP provider (Gmail app password, SendGrid, Resend, …). Without these, order status emails are written to `backend/.tmp/emails/` instead of sent. |

### First run

- Storefront: [http://localhost:4000/](http://localhost:4000/)
- Admin dashboard: [http://localhost:4000/admin](http://localhost:4000/admin) — log in with `ADMIN_USERNAME`/`ADMIN_PASSWORD` from `.env`
- The database and its schema are created automatically on first start — no separate migration step needed

## Scripts

Run from `backend/`:

| Command | What it does |
|---|---|
| `npm start` | Starts the server. |
| `npm run import` | Imports the real product catalogue from `Enny Prod List (2).xlsx` (project root) into the database — handles known quirks in that export (see comments at the top of `scripts/import-products.js`). |
| `npm run seed` | Seeds demo orders and activity-log entries into an existing database, for local testing. |
| `node scripts/qa-screenshots.js` | Screenshots every storefront page at three breakpoints and flags horizontal overflow. Requires the server to already be running. |

## Key features

- **Product variations** — any product can have attribute-based variations
  (Weight, Colour, Quantity, Size, Flavour, or a custom attribute), each with
  its own price, stock, and SKU. The storefront product page updates price
  and stock live as a customer changes their selection.
- **Order lifecycle** — `Processing → Shipped → Delivered` or `Cancelled`,
  managed from the admin Orders view, with an automatic customer email at
  each transition.
- **CMS-editable content** — homepage hero, announcement bar, footer, FAQ,
  About Us, and Delivery & Returns copy are all editable from the admin
  panel rather than hardcoded.
- **Promotions** — promo codes with usage tracking, applied at checkout.

## Notes

- The SQLite database (`backend/data/ennys.db`) and uploaded images
  (`backend/public/uploads/`) are gitignored — this repo is code only, not a
  data snapshot.
- `backend/.env` is gitignored; only `backend/.env.example` (placeholder
  values) is committed.
