/**
 * packages/app/src/services/levelManager.ts
 *
 * Implements the tutor's "Incomplete levels.json" security strategy:
 *
 *   • App ships with levels_basic.json  (Levels 1–FREE_LEVEL_LIMIT, bundled)
 *   • levels_full.json is hosted on Supabase Storage (private bucket)
 *   • Only authenticated premium users can download it via a signed URL
 *   • Once downloaded it's cached locally — no re-download on next boot
 *
 * WHY this is more secure than gating in code:
 *   If all level data ships in the app, a hacker can extract the file.
 *   If the file physically doesn't exist on the device, there's nothing to hack.
 *
 * SECURITY FIX: this used to also fetch('/atc-app_levels_full.json') as a
 * "dev helper" fallback with no dev-only gate at all. Since Vite's public/
 * dir is copied verbatim into production builds, that file — if ever
 * committed — was served at the site root to EVERY user, free or not,
 * completely bypassing the RLS policy below. That file and fetch call are
 * both gone now. Local dev override is VITE_USE_LOCAL_FULL_LEVELS only (see
 * getLevelData), which dynamically imports levels_full_example.json so it's
 * excluded from production bundles rather than statically bundled always.
 *
 * SETUP REQUIRED in Supabase:
 *   1. Create a private Storage bucket called 'game_assets'
 *   2. Upload levels_full.json to that bucket (scripts/upload-paid-levels.ts)
 *   3. Add the RLS policy from SUPABASE_SETUP.md (premium users only) —
 *      also covers backgrounds/ (see BACKGROUND_ASSETS.md), same bucket
 */
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import { useMonetizationStore } from '@/stores/monetization';

// Bundled free levels — always available, no network needed
import basicLevels from '@/assets/levels_basic.json';
import { ENV } from '@/config/env';
// levels_full_example.json is NOT statically imported here on purpose — a
// static import bundles it into every production build regardless of the
// VITE_USE_LOCAL_FULL_LEVELS check below (Vite can't tree-shake a JSON import
// away just because a runtime env check happens to be false). It's loaded via
// dynamic import() only inside the two branches that actually use it, so it's
// a separate lazy chunk that's simply never requested when the flag is off.

const FULL_LEVELS_BUCKET = 'game_assets';
const FULL_LEVELS_FILE = 'levels_full.json';
const FULL_LEVELS_CACHE_PATH = 'atc-app_levels_full.json'; // written to device storage

/** Shape expected from both level JSON files */
export type LevelData = typeof basicLevels;

export class LevelManager {
  /**
   * Main entry point — returns the correct level data for the current user.
   *
   * Free user  → bundled levels_basic.json (instant, no network)
   * Premium    → cached levels_full.json or downloads from Supabase Storage
   *
   * Always falls back gracefully to basic levels on any error.
   */
  static async getLevelData(): Promise<LevelData> {
    const monetization = useMonetizationStore();

    // Free user: immediately return bundled levels — no network call needed
    if (!monetization.isPremium) {
      console.log('📦 Loading free levels (bundled)');
      return basicLevels as LevelData;
    }

    // Premium user: try local cache first
    const cached = await LevelManager.readCachedLevels();
    if (cached) {
      console.log('📦 Loading full levels (cached locally)');
      return cached;
    }

    // Not cached yet — allow local override for development, otherwise download
    if (ENV.VITE_USE_LOCAL_FULL_LEVELS === 'true') {
      console.log('📦 Using local full levels (VITE_USE_LOCAL_FULL_LEVELS)');
      const { default: fullExample } = await import('@/assets/levels_full_example.json');
      const text = JSON.stringify(fullExample);
      await LevelManager.writeCachedLevels(text);
      return fullExample as LevelData;
    }

    console.log('⬇️ Downloading full levels from Supabase Storage…');
    return await LevelManager.downloadAndCacheLevels();
  }

  /**
   * Try to read the previously downloaded full levels from device storage.
   * Returns null if not cached yet.
   */
  private static async readCachedLevels(): Promise<LevelData | null> {
    // On web/Electron, use localStorage instead of Capacitor Filesystem
    if (!Capacitor.isNativePlatform()) {
      try {
        const raw = localStorage.getItem('atc-app_levels_full');
        return raw ? (JSON.parse(raw) as LevelData) : null;
      } catch {
        return null;
      }
    }

    // Mobile: use Capacitor Filesystem (sandboxed, not accessible via Files app)
    try {
      const file = await Filesystem.readFile({
        path: FULL_LEVELS_CACHE_PATH,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });
      return JSON.parse(file.data as string) as LevelData;
    } catch {
      return null; // File doesn't exist yet
    }
  }

  /**
   * Download levels_full.json from the private Supabase Storage bucket.
   *
   * This request is authenticated: Supabase checks the user's JWT and the
   * RLS policy (must have is_premium = true) before allowing the download.
   * A free user calling this gets a 403 — the file never reaches their device.
   */
  private static async downloadAndCacheLevels(): Promise<LevelData> {
    try {
      // Development helper: if the env var is set the caller should have
      // already taken the local path in `getLevelData`. This check remains
      // so CI or other environments can still opt into the local file.
      if (ENV.VITE_USE_LOCAL_FULL_LEVELS === 'true') {
        console.log(
          '📦 downloadAndCacheLevels: VITE_USE_LOCAL_FULL_LEVELS detected — using bundled example'
        );
        const { default: fullExample } = await import('@/assets/levels_full_example.json');
        const text = JSON.stringify(fullExample);
        await LevelManager.writeCachedLevels(text);
        return fullExample as LevelData;
      }
      const { data, error } = await supabase.storage
        .from(FULL_LEVELS_BUCKET)
        .download(FULL_LEVELS_FILE);

      if (error || !data) {
        console.error('❌ Supabase Storage download failed:', error?.message);
        console.warn('⚠️ Falling back to basic levels');
        return basicLevels as LevelData;
      }

      const text = await data.text();
      const parsed = JSON.parse(text) as LevelData;

      // Cache locally so next boot skips the download
      await LevelManager.writeCachedLevels(text);
      console.log('✅ Full levels downloaded and cached');

      return parsed;
    } catch (err) {
      console.error('❌ Level download unexpected error:', err);
      return basicLevels as LevelData;
    }
  }

  /**
   * Write the downloaded JSON to local device storage.
   */
  private static async writeCachedLevels(jsonText: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      try {
        localStorage.setItem('atc-app_levels_full', jsonText);
      } catch {
        console.warn('⚠️ Could not cache levels in localStorage');
      }
      return;
    }

    try {
      await Filesystem.writeFile({
        path: FULL_LEVELS_CACHE_PATH,
        directory: Directory.Data,
        data: jsonText,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    } catch (err) {
      console.warn('⚠️ Could not cache full levels to filesystem:', err);
    }
  }

  /**
   * Clear the local cache — call this if you push a new levels_full.json
   * and need users to re-download it (e.g., after a content update).
   *
   * You can trigger this by checking a version field in the JSON vs.
   * a version stored in localStorage/Supabase.
   */
  static async clearCache(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      localStorage.removeItem('atc-app_levels_full');
      return;
    }

    try {
      await Filesystem.deleteFile({
        path: FULL_LEVELS_CACHE_PATH,
        directory: Directory.Data,
      });
      console.log('🗑️ Full levels cache cleared');
    } catch {
      // File may not exist — not an error
    }
  }
}
