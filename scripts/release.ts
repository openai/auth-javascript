import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { assertPackageSources, inspectPackedPackage } from './package-contents.ts';

export const packageNames = ['@openai/auth', '@openai/auth-react'] as const;
const directories = ['core', 'react'];
const registry = 'https://registry.npmjs.org/';
const repository = 'openai/auth-javascript';
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export interface ReleasePackage {
  name: string;
  version: string;
  filename: string;
  sha256: string;
  integrity: string;
}

export interface Release {
  sourceCommit: string;
  packages: ReleasePackage[];
}

export interface RegistryPackage {
  name: string;
  versions: Record<string, { dist: { integrity: string } }>;
  'dist-tags': Record<string, string>;
}

type ReadRegistry = (name: string) => Promise<RegistryPackage | null>;
const readJSON = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (bytes: Buffer, algorithm: string, encoding: 'hex' | 'base64') =>
  createHash(algorithm).update(bytes).digest(encoding);

export function assertPackagePair(packages: ReleasePackage[]): void {
  assert.equal(packages.length, 2, 'A release must contain exactly two SDK packages.');
  for (const [index, pkg] of packages.entries()) {
    assert.equal(pkg.name, packageNames[index], 'Publish core before React.');
    assert.match(pkg.version, stableVersion, 'Automation supports stable versions only.');
    assert.equal(pkg.version, packages[0]!.version, 'SDK versions must match.');
    assert.equal(pkg.filename, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`);
    assert.match(pkg.sha256, /^[a-f0-9]{64}$/);
    assert.match(pkg.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
  }
}

export function readRelease(
  directory: string,
  sourceCommit: string,
  root = process.cwd(),
): Release {
  const release = readJSON(join(directory, 'release.json')) as Release;
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(release.sourceCommit, sourceCommit, 'Archive source commit does not match.');
  assertPackagePair(release.packages);
  assertPackageSources(root);
  for (const [index, pkg] of release.packages.entries()) {
    const archive = join(directory, pkg.filename);
    const file = lstatSync(archive);
    assert(file.isFile() && !file.isSymbolicLink(), 'A release archive must be an ordinary file.');
    const bytes = readFileSync(archive);
    assert.equal(hash(bytes, 'sha256', 'hex'), pkg.sha256, 'Archive SHA-256 does not match.');
    assert.equal(
      `sha512-${hash(bytes, 'sha512', 'base64')}`,
      pkg.integrity,
      'Archive integrity does not match.',
    );
    const source = join(root, 'packages', directories[index]!);
    const manifest = readJSON(join(source, 'package.json'));
    assert.equal(manifest.name, pkg.name);
    assert.equal(manifest.version, pkg.version);
    inspectPackedPackage(
      archive,
      manifest,
      readFileSync(join(source, 'LICENSE'), 'utf8'),
      readFileSync(join(source, 'NOTICE'), 'utf8'),
    );
  }
  return release;
}

export async function readRegistryPackage(
  name: string,
  request: typeof fetch = fetch,
): Promise<RegistryPackage | null> {
  assert(packageNames.includes(name as (typeof packageNames)[number]));
  const response = await request(`${registry}${encodeURIComponent(name)}`, {
    headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) {
    return null;
  }
  assert(response.ok, `Registry request for ${name} failed with HTTP ${response.status}.`);
  const metadata = (await response.json()) as RegistryPackage;
  assert.equal(metadata.name, name, 'Registry package identity does not match.');
  assert(metadata.versions && typeof metadata.versions === 'object');
  assert(metadata['dist-tags'] && typeof metadata['dist-tags'] === 'object');
  return metadata;
}

function requireExistingPackage(
  metadata: RegistryPackage | null,
  name: string,
): asserts metadata is RegistryPackage {
  assert(
    metadata && Object.keys(metadata.versions).length > 0,
    `${name}: the first publication must be completed manually before enabling OIDC releases.`,
  );
}

function checkPublishedVersion(pkg: ReleasePackage, metadata: RegistryPackage | null): boolean {
  const existing = metadata?.versions[pkg.version];
  if (!existing) {
    return false;
  }
  assert.equal(
    existing.dist.integrity,
    pkg.integrity,
    `${pkg.name}: published integrity does not match the retained archive.`,
  );
  return metadata?.['dist-tags'].latest === pkg.version;
}

function preventDowngrade(pkg: ReleasePackage, metadata: RegistryPackage): void {
  const latest = metadata['dist-tags'].latest;
  assert(
    latest && stableVersion.test(latest),
    `${pkg.name}: latest must identify a stable version.`,
  );
  const current = latest.split('.').map(Number);
  const target = pkg.version.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (current[index]! !== target[index]!) {
      assert(
        current[index]! < target[index]!,
        `${pkg.name}: refusing to move latest to an older version.`,
      );
      return;
    }
  }
}

export async function publishPackages(
  packages: ReleasePackage[],
  dependencies: {
    read: ReadRegistry;
    publish: (pkg: ReleasePackage) => Promise<void>;
    wait?: () => Promise<void>;
  },
): Promise<void> {
  assertPackagePair(packages);
  const metadata = await Promise.all(packages.map((pkg) => dependencies.read(pkg.name)));
  // Validate both existing versions before making any publication request.
  for (const [index, pkg] of packages.entries()) {
    const existing = metadata[index]!;
    requireExistingPackage(existing, pkg.name);
    preventDowngrade(pkg, existing);
    checkPublishedVersion(pkg, existing);
  }
  for (const [index, pkg] of packages.entries()) {
    if (!metadata[index]!.versions[pkg.version]) {
      await dependencies.publish(pkg);
    }
    let verified = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      verified = checkPublishedVersion(pkg, await dependencies.read(pkg.name));
      if (verified) {
        break;
      }
      if (attempt < 11) {
        await (dependencies.wait?.() ?? setTimeout(5000));
      }
    }
    assert(
      verified,
      `${pkg.name}: registry integrity and latest were not verified. Retain the archives and rerun the failed job.`,
    );
  }
  await verifyPublishedPackages(packages, dependencies.read);
}

export async function verifyPublishedPackages(
  packages: ReleasePackage[],
  read: ReadRegistry = readRegistryPackage,
): Promise<void> {
  assertPackagePair(packages);
  for (const pkg of packages) {
    assert(
      checkPublishedVersion(pkg, await read(pkg.name)),
      `${pkg.name}: registry verification failed.`,
    );
  }
}

export function assertPublishContext(env: NodeJS.ProcessEnv): void {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Automated publication must run in GitHub Actions.');
  assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.equal(env.GITHUB_REF, 'refs/heads/main');
  assert.equal(
    env.REPOSITORY_VISIBILITY,
    'public',
    'Publication is disabled for a private repository.',
  );
  assert.equal(env.NPM_PUBLISH_ENABLED, 'true', 'Publication must be explicitly enabled.');
  assert(
    env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    'The publishing job needs OIDC permission.',
  );
}

function github(path: string) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }));
}

function checkReleaseCommit(sourceCommit: string): void {
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  const comparison = github(`repos/${repository}/compare/${sourceCommit}...main`);
  assert(
    ['ahead', 'identical'].includes(comparison.status),
    'Release commit must belong to protected main.',
  );
  const runs = github(
    `repos/${repository}/actions/workflows/ci.yml/runs?event=push&branch=main&head_sha=${sourceCommit}&per_page=1`,
  ).workflow_runs;
  assert.equal(runs[0]?.head_sha, sourceCommit, 'No main CI run exists for this release commit.');
  assert.equal(runs[0]?.status, 'completed', 'Release CI is still running.');
  assert.equal(runs[0]?.conclusion, 'success', 'Release CI must pass before publication.');
}

function pack(directory: string, sourceCommit: string): void {
  assert.equal(
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    '',
    'Pack from a clean source checkout.',
  );
  assertPackageSources(process.cwd());
  mkdirSync(directory, { recursive: true });
  assert.equal(
    readdirSync(directory).length,
    0,
    'Use an empty output directory; preserve existing release artifacts.',
  );
  const packages: ReleasePackage[] = [];
  for (const name of directories) {
    const source = join('packages', name);
    const manifest = readJSON(join(source, 'package.json'));
    assert.match(manifest.version, stableVersion, 'Automation supports stable versions only.');
    const filename = `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`;
    execFileSync('pnpm', ['--dir', source, 'pack', '--out', join(directory, filename)], {
      stdio: 'inherit',
    });
    const bytes = readFileSync(join(directory, filename));
    packages.push({
      name: manifest.name,
      version: manifest.version,
      filename,
      sha256: hash(bytes, 'sha256', 'hex'),
      integrity: `sha512-${hash(bytes, 'sha512', 'base64')}`,
    });
  }
  writeFileSync(
    join(directory, 'release.json'),
    `${JSON.stringify({ sourceCommit, packages }, null, 2)}\n`,
  );
  readRelease(directory, sourceCommit);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const directory = resolve(process.argv[3] ?? 'artifacts/release');
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(sourceCommit, process.env.SOURCE_COMMIT ?? sourceCommit);
  if (command === 'check-ci') {
    checkReleaseCommit(sourceCommit);
  } else if (command === 'check-publish-plan') {
    for (const name of directories) {
      const manifest = readJSON(join('packages', name, 'package.json'));
      assert.match(manifest.version, stableVersion);
      const metadata = await readRegistryPackage(manifest.name);
      requireExistingPackage(metadata, manifest.name);
      assert(
        !metadata.versions[manifest.version],
        'A target version already exists. Recover with the retained artifacts by rerunning the original failed job; do not rebuild.',
      );
    }
  } else if (command === 'pack') {
    pack(directory, sourceCommit);
  } else if (command === 'inspect') {
    readRelease(directory, sourceCommit);
  } else if (command === 'publish' || command === 'verify') {
    const release = readRelease(directory, sourceCommit);
    if (command === 'verify') {
      await verifyPublishedPackages(release.packages);
    } else {
      assertPublishContext(process.env);
      assert.equal(
        github(`repos/${repository}`).private,
        false,
        'Repository is currently private.',
      );
      checkReleaseCommit(sourceCommit);
      await publishPackages(release.packages, {
        read: readRegistryPackage,
        publish: async (pkg) => {
          execFileSync(
            'npm',
            [
              'publish',
              join(directory, pkg.filename),
              '--access',
              'public',
              '--tag',
              'latest',
              '--ignore-scripts',
              '--provenance',
              '--registry',
              registry,
            ],
            { stdio: 'inherit' },
          );
        },
      });
    }
  } else {
    throw new Error(
      'Usage: node scripts/release.ts <check-ci|check-publish-plan|pack|inspect|publish|verify> [artifact-directory]',
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
