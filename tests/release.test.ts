// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertPackagePair,
  assertPublishContext,
  packageNames,
  publishPackages,
  readRegistryPackage,
  readRelease,
  type RegistryPackage,
  type ReleasePackage,
} from '../scripts/release.ts';

const packages: ReleasePackage[] = packageNames.map((name, index) => ({
  name,
  version: '0.2.0',
  filename: `${name.replace('@', '').replace('/', '-')}-0.2.0.tgz`,
  sha256: String(index).repeat(64),
  integrity: `sha512-${Buffer.alloc(64, index).toString('base64')}`,
}));

function fixture() {
  const registry = new Map<string, RegistryPackage>(
    packageNames.map((name) => [
      name,
      {
        name,
        versions: { '0.1.0': { dist: { integrity: 'previous-version' } } },
        'dist-tags': { latest: '0.1.0' },
      },
    ]),
  );
  const events: string[] = [];
  const read = vi.fn(async (name: string) => {
    events.push(`read:${name}`);
    return structuredClone(registry.get(name) ?? null);
  });
  const publish = vi.fn(async (pkg: ReleasePackage) => {
    events.push(`publish:${pkg.name}`);
    registry.get(pkg.name)!.versions[pkg.version] = { dist: { integrity: pkg.integrity } };
    registry.get(pkg.name)!['dist-tags'].latest = pkg.version;
  });
  const wait = vi.fn(async () => {});
  return { registry, events, read, publish, wait };
}

describe('release publication', () => {
  it('checks both packages, publishes core, verifies core, then publishes React', async () => {
    const dependencies = fixture();
    await publishPackages(packages, dependencies);
    expect(dependencies.events.slice(0, 6)).toEqual([
      'read:@openai/auth',
      'read:@openai/auth-react',
      'publish:@openai/auth',
      'read:@openai/auth',
      'publish:@openai/auth-react',
      'read:@openai/auth-react',
    ]);
  });

  it('recovers a partial release using the matching retained core archive', async () => {
    const dependencies = fixture();
    await dependencies.publish(packages[0]!);
    dependencies.publish.mockClear();
    await publishPackages(packages, dependencies);
    expect(dependencies.publish.mock.calls.map(([pkg]) => pkg.name)).toEqual([
      '@openai/auth-react',
    ]);
  });

  it('verifies an already published pair without publishing it again', async () => {
    const dependencies = fixture();
    for (const pkg of packages) {
      await dependencies.publish(pkg);
    }
    dependencies.publish.mockClear();
    await publishPackages(packages, dependencies);
    expect(dependencies.publish).not.toHaveBeenCalled();
  });

  it.each(packageNames)('requires manual first publication of %s', async (name) => {
    const dependencies = fixture();
    dependencies.registry.delete(name);
    await expect(publishPackages(packages, dependencies)).rejects.toThrow('first publication');
    expect(dependencies.publish).not.toHaveBeenCalled();
  });

  it.each(packageNames)(
    'checks existing %s integrity before publishing either package',
    async (name) => {
      const dependencies = fixture();
      dependencies.registry.get(name)!.versions['0.2.0'] = {
        dist: { integrity: 'different-archive' },
      };
      await expect(publishPackages(packages, dependencies)).rejects.toThrow('published integrity');
      expect(dependencies.publish).not.toHaveBeenCalled();
    },
  );

  it('does not publish React when core never becomes visible', async () => {
    const dependencies = fixture();
    dependencies.publish.mockImplementation(async () => {});
    await expect(publishPackages(packages, dependencies)).rejects.toThrow(
      'registry integrity and latest',
    );
    expect(dependencies.publish.mock.calls.map(([pkg]) => pkg.name)).toEqual(['@openai/auth']);
  });

  it('waits for matching registry integrity and the latest tag', async () => {
    const dependencies = fixture();
    const publish = dependencies.publish.getMockImplementation()!;
    dependencies.publish.mockImplementation(async (pkg) => {
      await publish(pkg);
      dependencies.registry.get(pkg.name)!['dist-tags'].latest = '0.1.0';
    });
    dependencies.wait.mockImplementation(async () => {
      for (const pkg of packages) {
        if (dependencies.registry.get(pkg.name)!.versions[pkg.version]) {
          dependencies.registry.get(pkg.name)!['dist-tags'].latest = pkg.version;
        }
      }
    });
    await publishPackages(packages, dependencies);
    expect(dependencies.wait).toHaveBeenCalledTimes(2);
  });

  it('does not move latest backward when another release is newer', async () => {
    const dependencies = fixture();
    dependencies.registry.get('@openai/auth-react')!['dist-tags'].latest = '0.3.0';
    await expect(publishPackages(packages, dependencies)).rejects.toThrow('older version');
    expect(dependencies.publish).not.toHaveBeenCalled();
  });

  it('stops on a registry failure before making a publication request', async () => {
    const dependencies = fixture();
    dependencies.read.mockRejectedValue(new Error('registry unavailable'));
    await expect(publishPackages(packages, dependencies)).rejects.toThrow('registry unavailable');
    expect(dependencies.publish).not.toHaveBeenCalled();
  });
});

describe('release identity and permissions', () => {
  it.each([
    ['GITHUB_ACTIONS', 'false'],
    ['GITHUB_REPOSITORY', 'example/fork'],
    ['GITHUB_REF', 'refs/heads/topic'],
    ['REPOSITORY_VISIBILITY', 'private'],
    ['NPM_PUBLISH_ENABLED', 'false'],
    ['ACTIONS_ID_TOKEN_REQUEST_TOKEN', ''],
  ])('rejects publication with %s=%s', (key, value) => {
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'openai/auth-javascript',
      GITHUB_REF: 'refs/heads/main',
      REPOSITORY_VISIBILITY: 'public',
      NPM_PUBLISH_ENABLED: 'true',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example.test/',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic-test-value',
      [key!]: value,
    };
    expect(() => assertPublishContext(env)).toThrow();
  });

  it('rejects reversed packages, mixed versions, prereleases, and unsafe archive paths', () => {
    expect(() => assertPackagePair([...packages].reverse())).toThrow();
    for (const change of [
      { version: '0.3.0' },
      { version: '0.2.0-beta.1' },
      { filename: '../outside.tgz' },
    ]) {
      expect(() => assertPackagePair([packages[0]!, { ...packages[1]!, ...change }])).toThrow();
    }
  });

  it('rejects a source commit mismatch before reading archives', () => {
    const directory = mkdtempSync(join(tmpdir(), 'auth-release-test-'));
    try {
      writeFileSync(
        join(directory, 'release.json'),
        JSON.stringify({ sourceCommit: 'a'.repeat(40), packages }),
      );
      expect(() => readRelease(directory, 'b'.repeat(40))).toThrow('source commit');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects modified archive bytes before inspecting or publishing them', () => {
    const directory = mkdtempSync(join(tmpdir(), 'auth-release-test-'));
    try {
      const bytes = Buffer.from('original archive');
      const records = packages.map((pkg) => ({
        ...pkg,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      }));
      writeFileSync(
        join(directory, 'release.json'),
        JSON.stringify({ sourceCommit: 'a'.repeat(40), packages: records }),
      );
      writeFileSync(join(directory, records[0]!.filename), 'modified archive');
      expect(() => readRelease(directory, 'a'.repeat(40))).toThrow('Archive SHA-256');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('registry responses', () => {
  it('treats only an HTTP 404 as absent', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
    await expect(readRegistryPackage('@openai/auth', request)).resolves.toBeNull();
  });

  it.each([401, 403, 429, 500, 503])(
    'fails on HTTP %s instead of treating the package as absent',
    async (status) => {
      const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }));
      await expect(readRegistryPackage('@openai/auth', request)).rejects.toThrow(`HTTP ${status}`);
    },
  );

  it('fails on transport errors and mismatched package identities', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('connection failed'));
    await expect(readRegistryPackage('@openai/auth', request)).rejects.toThrow('connection failed');
    request.mockResolvedValueOnce(
      Response.json({ name: 'different-package', versions: {}, 'dist-tags': {} }),
    );
    await expect(readRegistryPackage('@openai/auth', request)).rejects.toThrow('package identity');
  });
});
