/**
 * Uploads the Kaggaz Shop release folder (Velopack output of scripts/build-shop-agent-installer.ps1)
 * to a Cloudflare R2 bucket (S3-compatible API). The bucket's public URL is then:
 *   - the website download link base   (NEXT_PUBLIC_SHOP_APP_RELEASES_URL, apps/landing)
 *   - the Windows app's UpdateFeedUrl    (baked in by the installer script)
 *
 *   pnpm release:shop-agent [-- --dir artifacts/shop-agent/releases] [--prefix kagaz-shop] [--dry-run]
 *
 * Env (root .env): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
 * optional R2_PREFIX (folder inside the bucket) and SHOP_APP_RELEASES_URL (printed for checking).
 *
 * Order matters for clients mid-update: packages and the installer go up first, the feed index
 * files (releases.*.json, assets.*.json, RELEASES) last, so the feed never points at a package
 * that isn't there yet. Old packages are never deleted (Velopack needs them for deltas).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { cliArgs, loadRootEnv, REPO_ROOT } from './lib/common.js';

loadRootEnv();
const args = cliArgs({
  dir: { type: 'string', default: 'artifacts/shop-agent/releases' },
  prefix: { type: 'string', default: process.env.R2_PREFIX ?? '' },
  'dry-run': { type: 'boolean', default: false },
});

const CONTENT_TYPES: Record<string, string> = {
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.nupkg': 'application/octet-stream',
  '.json': 'application/json',
  '.zip': 'application/zip',
};

/** Feed index files: tiny, overwritten every release → must not be cached. */
const isIndex = (name: string) =>
  name === 'RELEASES' || /^(releases|assets)\..+\.json$/i.test(name);
/** Versioned packages never change once published → cache forever. */
const isVersionedPackage = (name: string) => name.endsWith('.nupkg');

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} (set it in the root .env — see .env.example)`);
  return v;
}

async function main(): Promise<void> {
  const dir = resolve(REPO_ROOT, args.dir);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile());
  } catch {
    throw new Error(
      `No release folder at ${dir}. Build it first: pwsh scripts/build-shop-agent-installer.ps1 -Version x.y.z`,
    );
  }
  if (!files.some((f) => f.endsWith('-Setup.exe'))) {
    throw new Error(`${dir} has no *-Setup.exe — is this a Velopack releases folder?`);
  }

  const ordered = [...files.filter((f) => !isIndex(f)), ...files.filter(isIndex)];
  const prefix = args.prefix.replace(/^\/+|\/+$/g, '');
  const key = (f: string) => (prefix ? `${prefix}/${f}` : f);

  const dryRun = args['dry-run'];
  const bucket = dryRun ? (process.env.R2_BUCKET ?? '<R2_BUCKET>') : need('R2_BUCKET');
  const s3 = dryRun
    ? null
    : new S3Client({
        region: 'auto',
        endpoint: `https://${need('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: need('R2_ACCESS_KEY_ID'),
          secretAccessKey: need('R2_SECRET_ACCESS_KEY'),
        },
      });

  console.log(
    `${dryRun ? '[dry run] ' : ''}Uploading ${ordered.length} files to r2://${bucket}/${prefix}`,
  );
  let uploaded = 0;
  let skipped = 0;
  for (const f of ordered) {
    const path = join(dir, f);
    const size = statSync(path).size;
    const cacheControl = isIndex(f)
      ? 'no-cache'
      : isVersionedPackage(f)
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=300';

    if (s3 && isVersionedPackage(f)) {
      // Versioned packages are immutable: skip ones already in the bucket with the same size.
      const head = await s3
        .send(new HeadObjectCommand({ Bucket: bucket, Key: key(f) }))
        .catch(() => null);
      if (head?.ContentLength === size) {
        skipped++;
        console.log(`  = ${key(f)} (already uploaded)`);
        continue;
      }
    }

    console.log(`  ↑ ${key(f)} (${(size / 1024 / 1024).toFixed(1)} MB, ${cacheControl})`);
    if (s3) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key(f),
          Body: readFileSync(path),
          ContentType: CONTENT_TYPES[extname(f).toLowerCase()] ?? 'application/octet-stream',
          CacheControl: cacheControl,
          ...(f.endsWith('-Setup.exe')
            ? { ContentDisposition: `attachment; filename="${f}"` }
            : {}),
        }),
      );
    }
    uploaded++;
  }

  const base = process.env.SHOP_APP_RELEASES_URL?.replace(/\/+$/, '');
  console.log(`Done: ${uploaded} uploaded, ${skipped} unchanged.`);
  if (base) {
    const setup = ordered.find((f) => f.endsWith('-Setup.exe'));
    console.log(`Download link: ${base}/${setup}`);
    console.log(`Update feed:   ${base}`);
  } else {
    console.log('Set SHOP_APP_RELEASES_URL in .env to print the public download link.');
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
