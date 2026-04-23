#!/usr/bin/env node
/**
 * Mirror ./docs into the GitHub wiki repo.
 *
 *   node scripts/sync-wiki.mjs          # auto-commit & push if changes
 *   node scripts/sync-wiki.mjs --dry    # only print what would change
 *   node scripts/sync-wiki.mjs --local  # populate a local dir, skip push
 *
 * Requires the wiki to have been initialized once via the GitHub UI.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const WIKI_REMOTE = 'https://github.com/ffondacci/firescore.wiki.git';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const LOCAL = args.has('--local');

/**
 * Mapping: source filename (without extension) → wiki page name.
 * Every docs/*.md that should be mirrored must be listed here.
 * docs/README.md is NOT mirrored as a page; it is replaced by a
 * generated Home.md at the wiki root.
 */
const PAGE_MAP = {
  'getting-started': 'Getting-Started',
  firestore: 'Firestore',
  storage: 'Storage',
  auth: 'Auth',
  'retry-policy': 'Retry-Policy',
  'storage-policy': 'Storage-Policy',
  pagination: 'Pagination',
  listeners: 'Listeners',
  logging: 'Logging',
  recipes: 'Recipes',
  testing: 'Testing',
};

function run(cmd, cwd, { allowFailure = false } = {}) {
  const [bin, ...rest] = cmd;
  const result = spawnSync(bin, rest, { cwd, stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0 && !allowFailure) {
    process.stderr.write(result.stderr || result.stdout || '');
    throw new Error(`Command failed: ${cmd.join(' ')}`);
  }
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Rewrite internal `./foo.md` links to wiki-style `Foo-Bar` links. */
function rewriteLinks(content) {
  return content.replace(
    /\((?:\.\/)?([a-z0-9][a-z0-9-]*)\.md(#[-A-Za-z0-9_]+)?\)/g,
    (match, name, anchor) => {
      const mapped = PAGE_MAP[name];
      if (!mapped) return match; // leave unknown links alone (e.g. external ./CHANGELOG.md)
      return `(${mapped}${anchor ?? ''})`;
    },
  );
}

function readDoc(baseName) {
  const srcPath = path.join(DOCS_DIR, `${baseName}.md`);
  return fs.readFileSync(srcPath, 'utf8');
}

function buildHome() {
  return [
    '# firescore wiki',
    '',
    '> Typed Node.js wrapper around `firebase-admin` and `@google-cloud/storage`.',
    '> Multi-instance, retry & storage policies, pluggable logger, cursor pagination and real-time listeners.',
    '',
    'Start here → **[Getting Started](Getting-Started)**',
    '',
    '## Reference',
    '',
    '- [Firestore (`FirestoreWrapper`)](Firestore)',
    '- [Storage (`FirStorageWrapper`)](Storage)',
    '- [Auth (`FirUserWrapper`)](Auth)',
    '',
    '## Concepts',
    '',
    '- [Retry policy](Retry-Policy)',
    '- [Storage policy](Storage-Policy)',
    '- [Pagination](Pagination)',
    '- [Listeners](Listeners)',
    '- [Logging](Logging)',
    '',
    '## Guides',
    '',
    '- [Recipes](Recipes) — common patterns combining the APIs',
    '- [Testing](Testing) — running the suite locally, credentials, emulator',
    '',
    '---',
    '',
    '**Source of truth:** these pages mirror the [`docs/` folder](https://github.com/ffondacci/firescore/tree/main/docs) of the repo. Edits should be made there and mirrored via `npm run docs:sync-wiki`.',
    '',
    '**Issues / contributions:** [github.com/ffondacci/firescore](https://github.com/ffondacci/firescore)',
    '',
  ].join('\n');
}

function buildSidebar() {
  return [
    '**[🏠 Home](Home)**',
    '',
    '**Start**',
    '- [Getting Started](Getting-Started)',
    '',
    '**Reference**',
    '- [Firestore](Firestore)',
    '- [Storage](Storage)',
    '- [Auth](Auth)',
    '',
    '**Concepts**',
    '- [Retry policy](Retry-Policy)',
    '- [Storage policy](Storage-Policy)',
    '- [Pagination](Pagination)',
    '- [Listeners](Listeners)',
    '- [Logging](Logging)',
    '',
    '**Guides**',
    '- [Recipes](Recipes)',
    '- [Testing](Testing)',
    '',
  ].join('\n');
}

function buildFooter() {
  return '[firescore on GitHub](https://github.com/ffondacci/firescore) · [Issues](https://github.com/ffondacci/firescore/issues) · pages mirrored from [`docs/`](https://github.com/ffondacci/firescore/tree/main/docs)\n';
}

async function main() {
  if (!fs.existsSync(DOCS_DIR)) {
    throw new Error(`docs/ not found at ${DOCS_DIR}`);
  }

  let wikiDir;
  if (LOCAL) {
    wikiDir = path.join(REPO_ROOT, '.wiki-build');
    fs.rmSync(wikiDir, { recursive: true, force: true });
    fs.mkdirSync(wikiDir, { recursive: true });
    console.log(`[sync-wiki] --local: output at ${wikiDir} (no clone/push)`);
  } else {
    wikiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'firescore-wiki-'));
    console.log(`[sync-wiki] cloning ${WIKI_REMOTE} into ${wikiDir}`);
    const clone = run(['git', 'clone', WIKI_REMOTE, wikiDir], process.cwd(), {
      allowFailure: true,
    });
    if (clone.code !== 0) {
      process.stderr.write(clone.stderr);
      throw new Error(
        'Cannot clone the wiki. Initialize it first by creating any page at ' +
          'https://github.com/ffondacci/firescore/wiki',
      );
    }
  }

  // Build content in-memory, then write.
  const writes = new Map();
  writes.set('Home.md', buildHome());
  writes.set('_Sidebar.md', buildSidebar());
  writes.set('_Footer.md', buildFooter());

  for (const [baseName, wikiName] of Object.entries(PAGE_MAP)) {
    const raw = readDoc(baseName);
    writes.set(`${wikiName}.md`, rewriteLinks(raw));
  }

  // Write files.
  for (const [file, content] of writes) {
    const target = path.join(wikiDir, file);
    fs.writeFileSync(target, content);
  }

  // Remove any stray *.md files in the wiki that we didn't produce
  // (except hidden _* support files we own and .git).
  const known = new Set(writes.keys());
  for (const entry of fs.readdirSync(wikiDir)) {
    if (entry === '.git') continue;
    if (!entry.endsWith('.md')) continue;
    if (!known.has(entry)) {
      const stray = path.join(wikiDir, entry);
      console.log(`[sync-wiki] removing stray page ${entry}`);
      fs.rmSync(stray);
    }
  }

  if (LOCAL) {
    console.log(`[sync-wiki] wrote ${writes.size} files to ${wikiDir}`);
    return;
  }

  // Stage & diff.
  run(['git', 'add', '-A'], wikiDir);
  const status = run(['git', 'status', '--porcelain'], wikiDir).stdout.trim();
  if (!status) {
    console.log('[sync-wiki] wiki already up to date — nothing to push.');
    return;
  }

  console.log('[sync-wiki] changes staged:\n' + status);

  if (DRY) {
    console.log('[sync-wiki] --dry: not committing.');
    return;
  }

  const msg = `Sync docs/ → wiki (${new Date().toISOString()})`;
  run(
    [
      'git',
      '-c',
      'user.name=firescore docs sync',
      '-c',
      'user.email=noreply@users.github.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      msg,
    ],
    wikiDir,
  );
  run(['git', 'push'], wikiDir);
  console.log('[sync-wiki] pushed.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
