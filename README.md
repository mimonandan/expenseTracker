# Paisa Pilot — spending analyzer

Android-first React Native app for reviewing payment alerts, organizing spending, and finding explainable savings ideas. The Node.js API stores per-user transactions in PostgreSQL; Supabase Auth provides email OTP and Google login.

## What is included

- Expo React Native app with dashboard, activity, category totals, expense entry, notification review, email OTP sign-in, Google OAuth, authenticated sync, and explicit sign-out. The app requires a signed-in account; there is no local-preview bypass. Email OTP and Google sign-in create a Supabase Auth user on first successful sign-in.
- Express/PostgreSQL transaction API. All transaction reads, writes, deletes, and summaries require a Supabase access token and are scoped to its verified user ID.
- On Android, Supabase refresh/access tokens are stored with Expo SecureStore (Android Keystore-backed encrypted storage). Web preview falls back to browser storage and is for development only.
- Idempotent sync using a per-user client reference, plus optional Supabase Realtime updates for transactions written from another signed-in device.
- On-device Android notification filtering that recognizes merchant names including Zepto, Zomato, BookMyShow, District, Myntra, and OTT services when those names appear in a debit alert. Alerts remain pending until the user reviews and adds them.
- Savings suggestions based on clear rules; they are prompts rather than financial advice.

## Connect your Supabase project

1. Copy `mobile/.env.example` to `mobile/.env`. Fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from your Supabase project. The publishable key is intended for app use; never put a service-role key in the app.
2. Copy `api/.env.example` to `api/.env`. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to the project's public values. The Node API forwards each signed-in user's access token to Supabase, so it does not need a database password or service-role key.
3. In Supabase Auth, keep Email enabled and enable Google. For production email OTP, configure a verified custom SMTP provider, set sensible email/OTP rate limits, and make sure the email template contains the `{{ .Token }}` code. Add the app redirect URL `paisapilot://auth/callback` to the project's allowed redirects. Google OAuth also needs a production OAuth client configured in Supabase with the correct callback URL. Disable the Phone provider; this app no longer uses phone authentication.
4. The transaction schema and `api/migrations/002_supabase_realtime.sql` have been applied to this project. They enable owner-scoped row-level access and Realtime for each user's transactions. For a fresh project, run `api/schema.sql` followed by the migration in the Supabase SQL editor.
5. For browser preview set `EXPO_PUBLIC_API_URL=http://localhost:4000`. For the Android emulator use `http://10.0.2.2:4000`. A physical phone needs a reachable HTTPS API URL (or a development machine LAN address while developing).
6. Restart Expo after adding environment values so the public Expo variables are loaded.

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
