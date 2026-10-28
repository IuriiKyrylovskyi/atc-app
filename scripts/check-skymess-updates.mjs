#!/usr/bin/env node
/**
 * scripts/check-skymess-updates.mjs
 *
 * Runs on every atc-app launch (the dev scripts and the Vite dev server call
 * it) and reports skymess changes to the files atc-app was ported from, so
 * fixes made in skymess can be pulled over by hand.
 *
 * Strictly read-only towards skymess: it never fetches, pulls, checks out or
 * writes anything there. Local checks run with GIT_OPTIONAL_LOCKS=0 so git
 * does not even refresh skymess's index; the remote check uses `ls-remote`,
 * which only reads refs.
 *
 * Never blocks a launch: every failure is reported and the script exits 0.
 *
 * Config: .skymess-sync.json at the repo root. Override the local checkout
 * with SKYMESS_PATH, skip the network check with SKYMESS_SKIP_REMOTE=1, or
 * skip everything with SKYMESS_CHECK=0.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, '.skymess-sync.json');
const MAX_LISTED = 25;

const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const log = (s = '') => console.log(`[skymess-sync] ${s}`);

const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

function git(args, { timeout = 5000 } = {}) {
  return execFileSync('git', args, {
    env: gitEnv,
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function listOrSummary(lines) {
  const shown = lines.slice(0, MAX_LISTED).map((l) => `    ${l}`);
  if (lines.length > MAX_LISTED) shown.push(dim(`    … and ${lines.length - MAX_LISTED} more`));
  return shown.join('\n');
}

function checkLocal(manifest, repo) {
  const head = git(['-C', repo, 'rev-parse', 'HEAD']);
  const branch = git(['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD']);
  const files = manifest.files;

  // Commits since the sync point that touched a ported file.
  const commits = git(
    ['-C', repo, 'log', '--oneline', '--no-decorate', `${manifest.commit}..HEAD`, '--', ...files],
    { timeout: 10000 }
  )
    .split('\n')
    .filter(Boolean);

  // Ported files that differ from the sync point, committed or not.
  const changed = git(['-C', repo, 'diff', '--name-only', manifest.commit, '--', ...files], {
    timeout: 10000,
  })
    .split('\n')
    .filter(Boolean);

  if (!commits.length && !changed.length) {
    log(green(`up to date with skymess ${branch}@${head.slice(0, 7)}`));
    return;
  }

  log(yellow(`skymess changed since the port (${manifest.commit.slice(0, 7)} → ${branch}@${head.slice(0, 7)})`));
  if (commits.length) {
    log(`${commits.length} commit(s) touching ported files:`);
    console.log(listOrSummary(commits));
  }
  if (changed.length) {
    log(`${changed.length} ported file(s) differ (including uncommitted edits):`);
    console.log(listOrSummary(changed));
  }
  log(dim(`review: git -C ${repo} diff ${manifest.commit.slice(0, 7)} -- <file>`));
  log(dim('after syncing, set "commit" in .skymess-sync.json to the new skymess commit'));
}

function isAncestor(repo, sha, of) {
  if (!repo) return null;
  try {
    git(['-C', repo, 'merge-base', '--is-ancestor', sha, of]);
    return true;
  } catch (err) {
    // Exit 1 = not an ancestor. Anything else (sha not in the local clone) = unknown.
    return err.status === 1 ? false : null;
  }
}

function checkRemote(manifest, repo) {
  const refs = git(['ls-remote', manifest.remote, `refs/heads/${manifest.branch}`, 'refs/heads/main'], {
    timeout: 8000,
  })
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, ref] = line.split('\t');
      return { sha, name: ref.replace('refs/heads/', '') };
    });

  // A remote branch is only news if it holds commits the sync point lacks.
  // A sha the local clone does not know yet is newer by definition.
  const newer = refs.filter(
    (r) => r.sha !== manifest.commit && isAncestor(repo, r.sha, manifest.commit) !== true
  );
  if (!newer.length) {
    log(green('remote has nothing newer'));
    return;
  }
  for (const r of newer) {
    log(yellow(`remote ${r.name} has commits not in the port (at ${r.sha.slice(0, 7)}, synced ${manifest.commit.slice(0, 7)})`));
  }
}

function main() {
  if (process.env.SKYMESS_CHECK === '0') return;
  if (!existsSync(MANIFEST)) {
    log('no .skymess-sync.json, skipping');
    return;
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const repo = path.resolve(ROOT, process.env.SKYMESS_PATH || manifest.localPath);
  const hasLocal = existsSync(path.join(repo, '.git'));

  if (hasLocal) {
    try {
      checkLocal(manifest, repo);
    } catch (err) {
      log(yellow(`local check failed: ${err.message.split('\n')[0]}`));
    }
  } else {
    log(dim(`local checkout not found at ${repo} (set SKYMESS_PATH)`));
  }

  if (process.env.SKYMESS_SKIP_REMOTE === '1') return;
  try {
    checkRemote(manifest, hasLocal ? repo : null);
  } catch {
    log(dim('remote check skipped (offline or no access)'));
  }
}

try {
  main();
} catch (err) {
  log(yellow(`check failed: ${err instanceof Error ? err.message : String(err)}`));
}
process.exit(0);
