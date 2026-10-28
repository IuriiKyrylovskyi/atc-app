# HOW TO: Test premium on an Android device

Step by step test of the premium flow on a physical Android phone: restore by alias + password, relaunch, and score/progress sync. Run it after any change to the Edge Functions, the security SQL or `monetization.ts`. First run: 2026-10-25 (Xiaomi, Android 13 / MIUI 14); results are in `docs/plans/FIX_PREMIUM.md`, Progress "production rollout".

All commands run from the monorepo root (`/Users/ky/Projects/sky_mess/game`) unless noted.

---

## 0. Before you start

You need:

- A **physical** Android phone. The emulator has no signed-in Google account, so Play Billing answers `BILLING_UNAVAILABLE`.
- Android Studio and `adb` (`adb version` works).
- A premium test account: alias + password from the developer notes. **Never** put the password in a document, chat, screenshot or commit.
- Access to the Supabase SQL editor (project `boajtcfnyxaedanykfil`).
- `VITE_SHOW_DEBUG=true` in `packages/app/.env.local` for the test build (it shows the debug overlay). It must be `false` for any release build.

Do **not** use `pnpm run dev:android`. It runs a bare app build without `CAPACITOR_PLATFORM`, so the RevenueCat and AdMob stubs get bundled and purchases silently do nothing. It is also Windows-only.

---

## 1. Connect the phone

1. Phone: Settings → About phone → tap the build number 7 times (Developer options on).
2. Developer options: turn on **USB debugging**. On Xiaomi / MIUI also turn on **Install via USB** and **USB debugging (Security settings)** (MIUI may ask for a Mi account sign-in).
3. Plug the phone in and accept the "Allow USB debugging?" prompt.
4. Check:
   ```bash
   adb devices
   ```
   Pass: the phone is listed as `device` (not `unauthorized`).

## 2. Build and install

1. Build the web app for Android and sync it into the native project:
   ```bash
   pnpm run android:dev
   pnpm --filter @atc-app/mobile exec cap open android
   ```
2. Android Studio: select the phone in the device list → **Run ▶**.
3. If a dialog says **"The device already has an application with the same package but a different signature"**: the phone has the Play Store build (signed by Google), and this is a debug build (signed with your local key). Press **OK** to uninstall the old app. Only the app's local data on this phone is lost; the account and the store purchase are on the server and in the Google account. Have the test credentials ready first.
4. If nothing installs after that, press **Run ▶** again and watch the phone: MIUI shows an "Install via USB?" prompt that must be accepted within a few seconds. `INSTALL_FAILED_USER_RESTRICTED` means **Install via USB** is off (step 1.2).
5. Command-line alternative to Android Studio:
   ```bash
   cd packages/mobile/android && ./gradlew installDebug && cd -
   ```
6. Ignore Android Studio's "Android Gradle plugin upgrade available" popup during tests; upgrading changes native build files.

## 3. Check the build (optional, 10 seconds)

The bundle must contain the real RevenueCat plugin, not the web stub:

```bash
grep -lF 'Not available on web' packages/mobile/android/app/src/main/assets/public/assets/*.js | wc -l
```

Pass: `0`. Anything else means the stubs were bundled (wrong build script); rebuild with step 2.

## 4. Start the log capture

A fresh install is already clean. For an existing install, clear it first:

```bash
adb shell pm clear com.atcapp.app
```

In a second terminal, record the log for the whole test:

```bash
adb logcat -v time -T 1 > /tmp/atc-app_android_test.txt
```

Stop it with `Ctrl+C` after step 7.

## 5. Restore by alias + password

1. Open the app → open the Paywall → **Already purchased? Restore your account**.
2. Enter the test alias + password → Restore.
3. Pass:
   - the app shows premium (Profile: "★ Premium Unlocked");
   - debug overlay → **Copy** contains `restoreAccount:restore-key {"ok":true,"success":true,"error":null}`;
   - no RevenueCat `logIn` after the restore (decision D13: a restored device keeps its own RevenueCat customer).
4. **Do not paste the whole Copy output anywhere.** It contains the password in clear (`userPassword`) and the live Supabase session (`sb-…-auth-token`, access **and refresh** token); anyone with the refresh token can act as this device. Share only the LOGS section.
5. **Wrong pair.** Also on a phone whose Google account owns the product: Premium account → **Switch to another account**, then a made-up alias + any password → Restore. Pass: "No user found, check your spelling", the device stays free, and the log has `restoreAccount:restore-key {"ok":true,"success":false,"error":"not_found"}` with **no** `claimPurchase:start` after it.
6. **Automatic restore of the purchase's account (best effort on Android, D9).** Same unlinked phone → Paywall → **Try to restore your data automatically**. Pass: the app is premium on the account that bought on this phone, and the log has `claimPurchase:response {"transportError":null,"success":true,"error":null}`. If the store restore fails (Billing 8, see the Android limitation in `docs/PURCHASE_FLOW_INSTRUCTIONS.md`), restore with alias + password instead.
7. **Busy paywall.** Press Restore Account (or Try to restore automatically) and, while it runs, tap outside the panel, tap other buttons and press Back. Pass: the pressed button shows a spinner, every other control is dimmed and does nothing, the paywall does not close, and the panel still scrolls. The log shows `backdrop click ignored (request in progress)` for the outside taps.

## 6. Relaunch

1. Swipe ATC-APP away from the recent apps, open it again.
2. Pass: still premium without typing anything. The log shows `Monetization ready | platform: android | premium: true`.

## 7. Score and progress sync

1. Play **one shift to the end** (completion screen), then go back to the main menu.
2. Supabase SQL editor:
   ```sql
   select level_id, max_planes, updated_at from public.account_scores order by updated_at desc limit 5;
   select left(id::text, 8) as device, last_passed_level, updated_at from public.profiles order by updated_at desc limit 3;
   ```
3. Pass: a new `account_scores` row for the shift just played, and the device's `last_passed_level` filled in (for example `yssy:1`).
4. Note: `max_planes` counts **landed** planes only. A shift completed through waypoint passes scores 0 (correct while landing traffic is not implemented yet). The log line `Level N complete — X landed, Y waypoint passes` shows the split.

## 8. Read the log

```bash
grep "Capacitor/Console" /tmp/atc-app_android_test.txt | grep -iE "⚠️|error|denied|42501|42P17|account_scores|scores.flush|unauthorized"
```

Pass: no `permission denied`, `42501`, `42P17`, `Could not load account_scores` or `scores.flush` lines. Known harmless noise: `Canvas mismatch … resizing`, `Texture downscaled`, `requestFullscreen … user gesture`.

## 9. Server-side policy tests (optional, rolled back)

These run as the test device in the SQL editor and end with a deliberate error that carries the result and **undoes everything**. A red error with `PASSED` / the expected value is the pass.

1. Find the device uid: the Profile screen shows its first 8 characters (`ID: dba3859b…`); the full uid is the newest row of:
   ```sql
   select id, updated_at from public.profiles order by updated_at desc limit 3;
   ```
2. Test 1, a best score never goes down (replace `<DEVICE_UID>`; the device needs a row for `yssy:red-eye`, or change the level id to one from step 7):
   ```sql
   do $$
   declare v int;
   begin
     perform set_config('request.jwt.claims',
       json_build_object('sub', '<DEVICE_UID>', 'role', 'authenticated')::text, true);
     set local role authenticated;
     insert into public.account_scores (account_id, level_id, max_planes, opened, available, updated_at)
     select account_id, 'yssy:red-eye', 5, true, false, now() from public.profiles where id = auth.uid()
     on conflict (account_id, level_id) do update set max_planes = excluded.max_planes;
     update public.account_scores set max_planes = 1
     where level_id = 'yssy:red-eye' and account_id = (select account_id from public.profiles where id = auth.uid());
     select max_planes into v from public.account_scores
     where level_id = 'yssy:red-eye' and account_id = (select account_id from public.profiles where id = auth.uid());
     raise exception 'TEST 1 (rolled back): max_planes = % (expected 5)', v;
   end $$;
   ```
   Pass: `TEST 1 (rolled back): max_planes = 5 (expected 5)`.
3. Test 2, a device cannot change its own `account_id`:
   ```sql
   do $$
   begin
     perform set_config('request.jwt.claims',
       json_build_object('sub', '<DEVICE_UID>', 'role', 'authenticated')::text, true);
     set local role authenticated;
     begin
       update public.profiles set account_id = null where id = auth.uid();
       raise exception 'TEST 2 FAILED: the device could change its account_id (rolled back)';
     exception when insufficient_privilege then
       raise exception 'TEST 2 PASSED (rolled back): %', sqlerrm;
     end;
   end $$;
   ```
   Pass: `TEST 2 PASSED (rolled back): permission denied for table profiles`.

## 10. After the test

1. To get the Play Store build back: uninstall the debug build, then install from the Play test track (the same signature mismatch applies in reverse).
2. Set `VITE_SHOW_DEBUG=false` before any release build (`pnpm run android:bundle`).
3. Add a Progress line to `docs/plans/FIX_PREMIUM.md`: date, device, build, uid prefix, and pass/fail for steps 5 to 9.

---

## Troubleshooting

| Symptom                                                   | Likely cause                                                                                                  | What to do                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Paywall has no offerings, `BILLING_UNAVAILABLE` in logcat | Emulator, or no Google account on the phone                                                                   | Use a physical phone signed in to Play                                                                                         |
| Purchases or restore silently do nothing                  | Stubs bundled (built with `dev:android` or a bare app build)                                                  | Step 3, then rebuild with `android:dev`                                                                                        |
| Restore says "Network error"                              | A non-2xx from the Edge Function                                                                              | Overlay Copy shows `restoreAccount:restore-key:http-error` with status and body; check Supabase → Edge Functions → Invocations |
| Restore answers `unauthorized`                            | The app has no valid session (for example its auth user was deleted)                                          | Close and reopen the app (a new anonymous session is created), then restore again                                              |
| Restore answers `not_found`                               | Wrong alias/password, or the account was deleted                                                              | Check the credentials; after a delete, restore needs the store purchase (see `FIX_PREMIUM.md` 2.7 to 2.10)                     |
| Restore answers `already_linked`                          | This device is linked to another account                                                                      | Paywall → "Switch to another account", then restore                                                                            |
| Restore says "Too many attempts" (`rate_limited`)         | 5 wrong passwords or recovery words for this alias in an hour, or 15 from this network, or 5 from this device | Wait the time shown, or for a test account clear it: `delete from public.credential_attempts where alias = '<ALIAS>';`         |
| No `account_scores` row after a finished shift            | Policy or grant problem                                                                                       | Step 8 log lines; `supabase/functions/harden_supabase/verify_hardening.sql` block 2                                            |
| "This item is already yours" on buy, but no premium       | Owned purchase without an account row (Play Billing 8 limitation, `FIX_PREMIUM.md`)                           | Restore by alias + password; otherwise support Transfer (task 2.8)                                                             |
| Old alias/password restored after reinstall               | Android Auto Backup restored app data                                                                         | `adb shell dumpsys package com.atcapp.app \| grep -i ALLOW_BACKUP` must print nothing                                         |
