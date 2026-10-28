(+) long touch on plane icon -> popup appears to increase or decrease speed (min, normal, max for each type of aircraft)
(+) when plane is waypoined -> light blue bootom shape icon under main plane icon
(+) when plane is rw-ed -> white bootom shape icon under main plane icon

- controls/score on game scene
- flight academy (tutorials)
- split game levels configs for descktop/tablet/phones
- create bg with adjusted images for descktop/tablet/phones
- level settings -> increase/decrease amount of traffic under controll manually in levels.config.ts
- level settings -> ability to set wpt only/rw only/combined traffic manually in levels.config.ts
- on game rules presentation provide real facts with (\*). for instance, explaining which colors of plane can land on defined RW give real world explanation like "not every type of aircraft is able and allowed to land on every RW. RW length, it's concrete strength are tacken into account. even ground vheicles availability can influence it. if there is no appropriate traps to disambark passengers the companies do not plan flights to those airports"
- provide fake STAR points, switch on/off in settings (with explanation in settings why you can use it - to oder approaching traffic)
- emergency traffic. when emergency show countdown to make landing within
- replace native 'confirm' modals (done for the EXIT flow — see .kilo/plans/1792543038585-fix-exit-close-app-flow.md)
- keep connected to rw plane -1 lavel (when it blinks over rw it conflicts with 0 level)
- listening for Audio Interruptions (AVAudioSession)
  If your app is a game, media player, or recorder, and you simply need to pause audio or stop recording when an incoming call arrives, you can observe
- create menu and pages items in STRIP way looking with cool animation (animation can be disabled due to annoying)
- fix planes icons on main logo
- adjust/scale rw width
- store each level bgs on separate DB
- create page if DB is paused (start btn is 'Starting')
- adjust planes speeds on descktops and mobiles
- recreate full paid modal
- 'Start game' is continue last level
- hover -> touch start/end events on mobiles
- 'Want my home base here' menu
- check App on start on updates and ask for dowloads
- split Airports for superbase folders (50mbt limit)
- Home button on Airports
- exit on mobiles
- play on 1 device at once (1 active session) // check implementation
- store user progress on DB
- for free user if his score good in comparison with global one provide modal that says smth like that 'Let people know about your achivment! Start to play premium game' and 2 buttons 'go' or 'no way'
- to score board add text 'the aliases you can see in the score board are a fancy work of users imagination. we do not responsible on it. if there is any user name will harm/violet/destroy/matuk or other abuser way text we will defenetely delete your subscribtion.' also this text should be added on alias providing as well.
- app checks for updtes on start
- Back button should redirect to -1 route page. if -1 route page is game scene go to main (Home) page
- for premium users change strip 'GO PRO' to questionary to go to page for voting for new airports, planes etc
- provide info to user: 'forever access - means unlim access till game exists' (in policy for instance)
- 1. Test the Version Endpoint:

# Verify the version.json is accessible

curl https://raw.githubusercontent.com/IuriiKyrylovskyi/atc-app/main/packages/app/public/version.json 2. Test Each Platform
Electron (Desktop):

Build a signed release: pnpm run dist:electron
Install it, then publish a pre-release to GitHub with a higher version
Verify auto-updater detects and downloads the update

- disable strips animation on start (in settings)
- capacitor native audio // check if neeeded
- app autoupdates on start (implemented, tested on android - not working)
- files audit - minimize app bundle size
- there is profile check 'is_premium'on page load. show crownIcon on START GAME button if is_premium
- Fix: RevenueCat Web Billing Error 8101 (Paddle sandbox checkout/start fails)
  (/Users/ky/Projects/sky_mess/game/.kilo/plans/1790630017265-fix-rc-error-8101-sandbox.md)
- ui fixes (text appears before images on page change/first page render)
- fix vue-tsc
- app autoupdate
- all platform EXIT (done — Android/Electron close, iOS goodbye overlay, web has no EXIT affordance; see .kilo/plans/1792543038585-fix-exit-close-app-flow.md)
- BACK logic
- total sound volume
- sound on mac
- images sync with other on page on loading (loading screens), optimize sizes
- strip animation on mobiles
- strip touch events
- show in red color invalid input char on alias/pass
- planes in the vicinity of screen (now they counted out of visible range)
- do not play strip clicks when they are covered with modal Paywall
- provide 'Check your internet connection'/'Slow internet connection' info modal and app logic for it
- if 'current' = set + Selected pkg: $rc_lifetime add 'Delete account' button on Paywall
- fix all game scales up on modal open on ios — DONE: iOS Safari auto-zooms the viewport to any focused <input> whose font-size is below 16 CSS px, and leaves the zoom stuck after the field is blurred. The paywall's alias/password/confirm inputs were 14px, so focusing them zoomed the whole document on menu pages (where the game never boots and never installs the restrictive viewport meta). Fix: (a) `packages/app/index.html` ships `maximum-scale=1.0,user-scalable=no,viewport-fit=cover` at the source; (b) `.restore-key-input` is now 16px; (c) `resetViewportMeta()` re-asserts the non-zoomable meta + `scrollTo(0,0)` on paywall close (Paywall.vue visibility watcher) and on restore-modal close paths (App.vue skipRestore / submitRestoreAlias success).

- remove digital signs on all images (plane icons, bg, any app images) !!!

- electron / electron + ios: 'Swipe up from the bottom to close the app' is blocker for app closing. remove screen. app should be closed on EXIT

- ===== RISKS ======
- The real risk is unbounded growth if a bot or spammy traffic generates anonymous signups faster than anyone cleans up. Then auth.users + profiles + accounts all grow without limit. - handle it
  (What you can do about it (ranked by effort)

1. Prune orphans periodically (cheap, no schema change). A scheduled job (or a trigger-based cleanup) deletes profiles whose account_id points at an accounts row with alias IS NULL AND is_premium = false AND created_at < now() - interval '30 days'. But you can't cascade-delete auth.users from Postgres easily — that's a Supabase Admin API call. So you'd clean profiles + accounts and leave auth.users rows, which is mostly harmless.

2. Make the trigger lazy (the previous answer's variant). Don't create profiles/accounts rows at signup. Only create them in claim_account / link_account (purchase or restore). Then free users who never pay generate zero server rows. This directly answers your concern — the tables only grow for users who do something premium. Cost: three RPCs need upsert logic.

3. Don't create the accounts row eagerly. Keep profiles (it's the auth side-effect you can't avoid), but drop the accounts insert from handle_new_user. Then accounts only grows for premium users. claim_account's defensive branch already handles the "profile has no account" case, so this is a one-line trigger change.

4. Enforce anonymous session stickiness client-side. Not a server fix, but you could persist the anonymous id in localStorage yourself and pass it as appUserID to RevenueCat on first launch, so even after a reinstall the RC identity survives. Doesn't stop profile-row growth, but reduces the "lost progress on reinstall" pain that motivates restores.)

- ==== PAYMENT ====
- ROGER -> triger payment and close popup (now - close popup)

# Production monetization setup

- prod RC

  - Connect Paddle under RC dashboard → Web → Billing (prod mode)
  - Set live VITE*RC_WEB_BILLING_PUBLIC_KEY from RC dashboard → Web → Billing → Paddle config (pdl_live_apikey*... key, not a pub\_ key — RC Web SDK accepts Paddle keys directly)
  - Verify RC iOS/Android production API keys (VITE*RC_IOS_KEY, VITE_RC_ANDROID_KEY) are live (appl*\_/goog\_\_) not test\_\*
  - Confirm default_v2 offering has Paddle/lifetime package attached in production
  - Flip VITE_RC_WEB_SANDBOX=false before release

- prod Paddle

  - Activate Paddle account (supports Ukraine without a local entity; Stripe does not)
  - Create matching lifetime product + price in Paddle production
  - Complete Paddle domain approval (checkout.paddle.com, cdn.paddle.com)
  - Test card 4242 4242 4242 4242 — switch to real transaction in prod
  - Confirm VITE*RC_WEB_BILLING_PUBLIC_KEY (live, pdl*...) is set in .env.local

  - provide 'secret word' to RC account to be able to restore/transfer premium

# \***\*\_\_\_\_\*\***What's left before the appeal

- Splash: ls, Contents.json and git status for the Splash image set (the three commands from before).
- WebP: the two find commands, and whether any image looks missing in the game.
- Webhook no_match: the near-match SQL result, the revenuecat-webhook code (without secrets), and where the app sets the RevenueCat user ID. This blocks the purchase test.
- Build 116: set Version 0.0.116 and Build 116, run pnpm run ios:release, upload to TestFlight.
