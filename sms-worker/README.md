# EquipWorthy text-message reminders

A tiny service that texts your phone the Secret Lair reminders you set in EquipWorthy
(24 hours, 1 hour, 15 minutes and 5 minutes before a drop, and when it goes live),
even when the app is closed. Each text includes the link to the drop page.

It runs on **your own** Cloudflare account and sends through **your own** Twilio number,
so your keys never touch the EquipWorthy web app or anyone else's server.
It only ever texts the one number you set (`TO_NUMBER`).

**Cost:** Cloudflare's free plan is enough. Twilio is about $1.15 a month for a number,
plus about 1¢ per text (a busy month of drops is well under $1).

**Time:** about 15 minutes, plus waiting for Twilio to approve your number (see step 1).

## 1. Get a Twilio number

1. Sign up at [twilio.com](https://www.twilio.com/try-twilio) and verify your own phone number.
2. Buy a phone number with SMS (Console → Phone Numbers → Buy a number).
3. **US numbers need registration before they can text.** For personal use, the easiest
   route is a **toll-free number** plus *toll-free verification* (Console → Messaging →
   Regulatory compliance). It's free and usually approved within a few days. A local (10DLC)
   number needs A2P 10DLC registration instead, which has small one-time fees.
   While you're on a trial account, Twilio can only text your verified number, which is all
   this service needs.
4. Note your **Account SID** and **Auth Token** (Console home page) and your Twilio number
   in `+15551234567` form.

## 2. Deploy the service to Cloudflare

You need [Node.js 18+](https://nodejs.org) and a free [Cloudflare account](https://dash.cloudflare.com/sign-up).

```sh
git clone https://github.com/anewbyss/EQUIPWORTHY.git
cd EQUIPWORTHY/sms-worker
npm install
npx wrangler login
```

Create the storage for scheduled reminders:

```sh
npx wrangler kv namespace create REMINDERS
```

It prints an `id`. Paste that id into `wrangler.toml` in place of `PASTE_YOUR_KV_NAMESPACE_ID_HERE`.

Add your secrets. Each command asks you to paste a value:

```sh
npx wrangler secret put TWILIO_ACCOUNT_SID   # AC…
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put TWILIO_FROM          # your Twilio number, +15551234567
npx wrangler secret put TO_NUMBER            # YOUR mobile number, +15559876543
npx wrangler secret put APP_KEY              # a long random password, see below
```

For `APP_KEY`, use a long random string, for example the output of
`node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"`. Keep a copy for step 3.

Deploy:

```sh
npx wrangler deploy
```

It prints your service's address, like `https://equipworthy-sms.<you>.workers.dev`.
Open `<that address>/health` in a browser: you should see `"configured":true`.

## 3. Connect EquipWorthy

In EquipWorthy (web or iOS), open **Settings → Text messages**:

1. Paste the service address and your `APP_KEY`.
2. Tap **Save & send a test text**. A text should arrive within a few seconds.
3. Turn on **Text reminders**.

From then on, every drop you follow with a sale time is scheduled on the service. Changing a
drop's time, unfollowing it or marking it owned updates or cancels its texts. If you use
EquipWorthy on several devices, set this up on one of them; settings sync between devices
when sync is on.

## How it works

- `POST /reminders` (with `Authorization: Bearer APP_KEY`) stores or replaces reminders
  `{ reminders: [{ id, at, body, url }], remove: [id] }`. Only `https://` links are added.
- A cron trigger runs every minute and texts anything due. Reminders more than 2 hours late
  are dropped instead of sent. If Twilio fails, the reminder is retried the next minute.
- `POST /test` sends a test text. `GET /health` shows whether it's configured.
- Everything is stored in one KV entry, so the minute check costs one read (well inside
  Cloudflare's free limits).

To stop it, turn off text reminders in EquipWorthy, or run `npx wrangler delete` to remove the
service. Release your Twilio number in the Twilio console to stop its monthly charge.

## Development

```sh
npm test          # unit tests (no network needed)
npx wrangler dev  # run locally
```
