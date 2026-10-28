# Migrating paid backgrounds to `game_assets`

One-time steps to move off the old public `level-backgrounds` bucket
(`level-{N}@1x.jpg` / `@2x.jpg`, no access control) onto the private
`game_assets` bucket, in the new manifest-driven naming convention.

## 1. Regenerate paid backgrounds in the new format

Your paid-level raw source images (levels 4+, or whatever is above your
`freeLevelLimit`) need to go through the updated `process-backgrounds.ts`.
They'll be written to `./dist_remote_assets/backgrounds/` instead of
`packages/app/src/assets/backgrounds/` automatically, based on the level
number parsed from the filename.

```bash
pnpm build:levels          # e.g. ts-node scripts/process-backgrounds.ts ./raw_assets/*.png
```

Check the console output — each level should log either:

```
→ level-4: routing to REMOTE (paid, not bundled) — ./dist_remote_assets/backgrounds
```

or `BUNDLED (free)`. If a paid level shows up as bundled, your raw asset
filename doesn't match `level-<n>` — rename it and re-run.

## 2. Upload to Supabase Storage

Requires the service role key (server-side only — this is a build/CI step,
never run from the app):

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
pnpm upload:paid-backgrounds
```

This uploads every file under `dist_remote_assets/backgrounds/` to the
`game_assets` bucket under a `backgrounds/` prefix, e.g.:

```
game_assets/backgrounds/16x9/level-4@1x.webp
game_assets/backgrounds/16x9/level-4.png             (1x fallback, bare name)
game_assets/backgrounds/manifest-paid.json
```

`manifest-paid.json` is uploaded **last**, after every binary — so a client
never sees a manifest entry pointing at a file that isn't there yet.

No new RLS policy is needed: the existing `game_assets` policy from
`SUPABASE_SETUP.md` ("Premium users can download assets") applies to every
object in the bucket, including this new `backgrounds/` prefix.

## 3. Verify access control

```bash
# Should succeed only when your test user's profile.is_premium = true
curl -H "Authorization: Bearer <user_jwt>" \
  "https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/game_assets/backgrounds/manifest-paid.json"
```

A free user's JWT should get a 403 here, the same as it already does for
`levels_full.json`.

## 4. Retire the old bucket

Once you've confirmed the app is pulling paid backgrounds from `game_assets`
(check the network tab or `backgroundAssetService.ts` console logs), delete
the `level-backgrounds` bucket in the Supabase dashboard — **Storage →
level-backgrounds → Settings → Delete bucket**. There's no code path left
that references it after this change; it existed only for the old
`getPublicUrl()` call that's now removed from `GameScene.ts`.

## 5. Add to your Security Checklist

Append to `SUPABASE_SETUP.md`'s existing checklist:

```
- [ ] Paid backgrounds uploaded to game_assets/backgrounds/ (not a separate public bucket)
- [ ] manifest-paid.json uploaded and confirmed reachable only by premium users
- [ ] Old public `level-backgrounds` bucket deleted
```
