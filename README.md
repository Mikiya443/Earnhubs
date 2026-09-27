# EarnHub

A get-paid-to (GPT) earning platform — offers, surveys, videos, daily check-ins, and referrals — with a full admin control panel. Built as a single Node.js + Express + EJS app with SQLite, so it deploys as one Railway service.

## Features

**Users**
- Sign up / log in
- Daily check-in bonus
- Complete offers, surveys, and videos for cash rewards
- Referral program with unique codes and bonuses
- Withdraw to OPay or bank transfer

**Admin (full control)**
- Dashboard with live stats (users, payouts, pending items)
- Manage users: search, ban/unban, manually adjust balances
- Manage offers/surveys/videos: create, enable/disable, delete
- Approve or reject pending offer/survey completions before payout
- Approve, reject, or mark withdrawal requests as paid
- Site-wide settings: check-in reward, referral bonus, minimum withdrawal, site name

## Local setup

```bash
npm install
cp .env.example .env   # edit values, especially SESSION_SECRET and ADMIN_PASSWORD
npm start
```

Visit `http://localhost:3000`. Log in to `/admin` with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from your `.env` (default: `admin@earnhub.local` / `ChangeMe123!`) — **change this password immediately after first login by adjusting it in the database, or set your own in `.env` before first run.**

## Deploying to Railway

1. Push this repo to GitHub.
2. In Railway, create a new project → Deploy from GitHub repo → select this repo.
3. Railway will detect the `Dockerfile` and build automatically.
4. Add environment variables in the Railway service settings:
   - `SESSION_SECRET` — a long random string
   - `ADMIN_EMAIL`, `ADMIN_PASSWORD` — your admin login
   - `PORT` — Railway sets this automatically, no action needed
5. **Attach a Volume** mounted at `/app/db` — this is important. SQLite writes to a file, and Railway containers are ephemeral; without a volume your data resets on every redeploy.
6. Generate a domain under Settings → Networking to get your public URL.

## Important next steps before going live

- **Payments**: this build tracks balances and withdrawal *requests* — it does not move real money. You (the admin) manually pay out via OPay/bank once you see a request in `/admin/withdrawals`, then mark it "paid." Wiring up OPay's API for automatic payouts is a natural next step.
- **Offer walls**: the "offers" table is currently manual — you add offers yourself in `/admin/offers`. To pull real, paying offers automatically, integrate an offerwall network (e.g., AdGate Media, OfferToro, CPAlead) via their postback/webhook APIs.
- **Fraud prevention**: add rate-limiting, device/IP fingerprinting, and CAPTCHA before scaling — GPT sites are frequently targeted by bots and duplicate-account abuse.
- **Database**: SQLite is fine for launch and low-moderate traffic. If you outgrow it, migrate to Postgres (Railway offers this as an add-on) — the query layer in `db/index.js` would need to swap to a Postgres client.
- **Security**: rotate `SESSION_SECRET`, use HTTPS (Railway provides this), and change the default admin password before sharing the site publicly.

## Project structure

```
server.js           entry point
db/index.js          schema + seeding
db/settings.js        settings helpers
routes/auth.js        register/login/logout
routes/user.js         dashboard, offers, check-in, referrals, withdraw
routes/admin.js        full admin control panel
middleware/auth.js      login/admin guards
views/                EJS templates (user-facing + views/admin/*)
public/css/style.css   styling
```
