# Paisa Pilot — spending analyzer

Android-first React Native app for reviewing payment alerts, organizing spending, and finding explainable savings ideas. The Node.js API stores per-user transactions in PostgreSQL; Supabase Auth provides email OTP and Google login.

## What is included

- Expo React Native app with a first-use name and income setup, dashboard, activity, category totals, expense entry, notification review, email OTP sign-in, Google OAuth, and authenticated sync. The app requires a signed-in account; there is no local-preview bypass. Email OTP and Google sign-in create a Supabase Auth user on first successful sign-in.
- The Home greeting uses the saved first name and opens Profile from the avatar. Profile is the single home for name, budget commitments, reminder schedule, optional alert capture and AI settings, data export/deletion, and sign-out. Sign-out stops capture and AI review and cancels reminders.
- Express/PostgreSQL transaction API. All transaction reads, writes, deletes, and summaries require a Supabase access token and are scoped to its verified user ID.
- On Android, Supabase refresh/access tokens are stored with Expo SecureStore (Android Keystore-backed encrypted storage). Web preview falls back to browser storage and is for development only.
- Local transaction caches, income, and monthly commitments are scoped to the signed-in Supabase user. Android encrypts these values with a separate AES-GCM key held by Android Keystore; earlier plaintext cache values are migrated when first read. Legacy transaction cache entries without an owner are not automatically assigned to an account.
- Idempotent sync using a per-user client reference, plus optional Supabase Realtime updates for transactions written from another signed-in device.
- On-device Android notification filtering for visible bank and payment alerts, with app/category clues for services such as Zepto, Zomato, BookMyShow, District, Myntra, and OTT services. Amount selection compares nearby debit and exclusion language, and confirmed wallet top-ups/card settlements are labeled as transfers rather than purchases. Matched alerts remain pending until the user reviews and adds them.
- Optional hybrid AI fallback for ambiguous monetary alerts. It is off by default, requires a separate in-app opt-in, redacts common Indian identifiers, encrypts its short on-device queue with Android Keystore, and sends only unmatched alert text to the authenticated API for structured classification. A database-backed quota allows at most 10 AI classifications per user per UTC day; AI never writes an expense and the user reviews every suggestion. No RAG/vector database is needed for short-alert extraction.
- Savings suggestions based on clear rules; they are prompts rather than financial advice.
- Monthly spending summaries net refunds and exclude transfers/income. Daily budgets reserve recurring bills and loan payments once; reviewed/categorized payments match those commitments so they are not counted twice. Unused discretionary budget rolls across the remaining calendar days. Credit-card commitments should be added only when the underlying card purchases are not already tracked.
- The Insights page includes a seven-day spending rhythm with total outflow, flexible everyday spend, matched commitments paid, and a light/moderate/high traffic level. Traffic compares flexible spend to that day’s rolling guide, so loan and bill payments in the first week remain visible without looking like discretionary overspending. AI may use a concise merchant-specific category only when the merchant is explicit in the alert; unclear categories remain Other.
- Monthly commitments are reserved once at the start of the month. Matching a bill or loan debit reduces the outstanding commitment without lowering the flexible daily budget a second time. Unspent flexible budget carries across remaining calendar days. Income, commitments, and notification preferences are protected and scoped to the signed-in account on this device.
- A visual walkthrough of setup, Home, Activity, Insights, Profile, budget entry, manual entry, and alert review is available at `mobile/public/ui-gallery.html` when the Expo web server is running.
- The Insights page provides CSV export and self-service spending-history deletion. Deletion removes transactions from the signed-in account and local plan data; it does not delete the Supabase login.

## Connect your Supabase project

1. Copy `mobile/.env.example` to `mobile/.env`. Fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from your Supabase project. The publishable key is intended for app use; never put a service-role key in the app.
2. Copy `api/.env.example` to `api/.env`. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to the project's public values. The Node API forwards each signed-in user's access token to Supabase, so it does not need a database password or service-role key.
3. In Supabase Auth, keep Email enabled and enable Google. For production email OTP, configure a verified custom SMTP provider, set sensible email/OTP rate limits, and make sure the email template contains the `{{ .Token }}` code. Add the app redirect URL `paisapilot://auth/callback` to the project's allowed redirects. Google OAuth also needs a production OAuth client configured in Supabase with the correct callback URL. Disable the Phone provider; this app no longer uses phone authentication.
4. For a fresh project, run `api/schema.sql`, then `api/migrations/001_user_scoping.sql`, `002_supabase_realtime.sql`, `003_transaction_timestamp.sql`, `004_ai_daily_quota.sql`, and `005_transaction_types.sql` in order in the Supabase SQL editor. They enable owner-scoped row access, transaction timestamps, Realtime, a shared per-user AI quota, and separate expense/refund/transfer/income types.
5. For browser preview set `EXPO_PUBLIC_API_URL=http://localhost:4000`. For the Android emulator use `http://10.0.2.2:4000`. A physical phone needs a reachable HTTPS API URL (or a development machine LAN address while developing).
6. Restart Expo after adding environment values so the public Expo variables are loaded.
7. For the Supabase Edge Function, keep `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_SUPABASE_URL` on the same project and use that project's publishable key. The `spending-api` handler verifies each user's bearer token with Supabase Auth. When deploying from the Supabase Dashboard, turn off the function's legacy **Verify JWT** gateway check; requests then reach the handler, where invalid or cross-project user sessions are still rejected. The checked-in `supabase/config.toml` records this setting for CLI deployments.

### Optional AI alert review

AI classification is disabled until both the server key and a Structured Outputs-compatible model are configured. For the Supabase Edge Function deployment, add `OPENAI_API_KEY` and `OPENAI_MODEL` under **Project Settings → Edge Functions → Secrets**, then deploy the updated `supabase/functions/spending-api` function. For a self-hosted Node API, set those same variables in `api/.env` using `api/.env.example`. Never put the OpenAI key in `mobile/.env` or an Expo public variable. The endpoint accepts only authenticated user requests, caps alert text and request frequency, redacts phone/email/UPI/PAN/account/card/reference identifiers, and does not store the original alert in Postgres. The model provider still receives the redacted snippet when AI fallback is enabled, subject to that provider's API data policies.

The app runs local rules first. Optional AI fallback processes queued alerts only while the signed-in app is active; local matching continues when the app is backgrounded. Every AI result requires user review before it affects spending totals. A deterministic regression corpus covers completed debits/receipts, account balances, payment dues, offers, refunds, salary credits, transfer settlements, and ambiguous multi-amount notices. The amount guard accepts only a clearly stronger nearby debit/payment cue; otherwise the model result is withheld. RAG is intentionally not used for this short extraction task: retrieval cannot prove a payment happened, adds cost, and can introduce stale or irrelevant examples. The daily quota migration must be applied before deploying the updated API/Edge Function; the server fails closed for AI classification if that quota protection is missing.

## Run the app and API

From the repository root:

```powershell
npm install
npm run start:api
```

In a second terminal, run the browser preview:

```powershell
npm run web --workspace mobile
```

Or start the Android app:

```powershell
npm start
```

For native notification capture, build the Android development app rather than Expo Go:

```powershell
cd mobile
npx expo prebuild --platform android
npx expo run:android
```

This requires Android Studio/SDK, a compatible JDK, and an emulator or attached Android device. The current development machine has no detected Android SDK/JDK/ADB, so the browser preview is available while native build tooling is set up.

## Data capture limits

Android notification access is optional and user-granted in Android Settings. It examines notifications on-device for likely debit alerts and stores matched candidates locally until the user reviews them. It does not read the SMS inbox. UPI and card payments are not universally exposed through a shared platform API; detection depends on a bank/card/payment notification being posted on the phone. App names are categorized only when present in that alert, so this is not a direct integration with Zepto, Zomato, BookMyShow, District, Myntra, or OTT accounts. Use statement import or manual entry for missing purchases.

The local Supabase URL and publishable key are configured in ignored `.env` files, and the Node API is running for development. Email OTP and Google sign-in create users in Supabase Auth; after login, the app syncs transactions with the authenticated user's ID and the API/RLS restricts each user to their own records. Sign-out disables the Android notification capture gate and clears unreviewed captured alerts. It does not delete previously saved expenses. Tracking starts with expenses entered in the app or reviewed Android payment notifications; Android notification access must be enabled by the user. Before production release, set production API hosting/HTTPS, verify Supabase redirect URLs and SMTP deliverability, configure Google OAuth for the released app, and build/sign the Android release package.
