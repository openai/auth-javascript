# Releasing the SDK

This guide covers stable releases of `@openai/auth` and `@openai/auth-react` from
`openai/auth-javascript`. Both packages use the same version. The React archive
must depend on that exact core version.

## Prepare the version

Use the Node.js and pnpm versions specified by `.nvmrc` and `package.json`.
Follow [Contributing](contributing.md) to install dependencies and browser binaries.

For changes with pending Changesets, prepare a version PR:

```sh
pnpm version:packages
pnpm install --lockfile-only
```

Review both package versions, generated changelogs, dependency ranges, and lockfile.
Merge the version PR after its required checks and reviews pass. For an initial
release, use the reviewed package versions without adding an artificial version bump.

Use a clean checkout of the release commit on `main`. Check that required CI
passed for that exact commit. Run the release checks from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm playground:build
pnpm check:distribution
git status --short
```

Resolve unexpected source changes before packing. Review the distribution inventory
and notices when dependencies or emitted code change. CI and package tests use
synthetic identities. They do not establish a working production authentication flow.

## Pack and inspect the release

Keep these variables in the same shell for the remaining commands:

```sh
test -z "$(git status --porcelain)"
SDK_RELEASE_VERSION=$(node -p "require('./packages/core/package.json').version")
SDK_RELEASE_SHA=$(git rev-parse HEAD)
SDK_RELEASE_DIR="$PWD/artifacts/release-$SDK_RELEASE_VERSION"
node scripts/release.ts pack "$SDK_RELEASE_DIR"
```

This command requires a clean checkout and an empty output directory. It checks
source manifests before packing, uses pnpm to resolve workspace dependencies,
and inspects both actual archives with the package-content guards. It writes
`release.json` with the source commit, package versions, SHA-256 hashes, and
SHA-512 integrity values. It preserves existing release artifacts.

Review both archive file lists, manifests, READMEs, licenses, and notices. Retain
the archives, `release.json`, check results, and distribution inventory together.
Publish these inspected archives. If source or package bytes change, repeat
validation and packing before publication.

## Publish the package pair

Check publication authorization, npm scope access, and the intended version.
For the first publication of a package, an authorized maintainer uses token-based
npm authentication. Keep credentials in the approved credential store or runner secret
store. Never include token values in source, command history, logs, or release records.

Use the public npm registry explicitly. Check whether each version already exists:

```sh
npm whoami --registry https://registry.npmjs.org/
npm view "@openai/auth@$SDK_RELEASE_VERSION" version dist.integrity --json --registry https://registry.npmjs.org/
npm view "@openai/auth-react@$SDK_RELEASE_VERSION" version dist.integrity --json --registry https://registry.npmjs.org/
```

An authentication or network error does not establish that a version is absent.
If a version exists, compare its integrity with `release.json`. Do not overwrite
an existing version. Investigate an integrity mismatch before continuing.

The commands below publish stable releases to `latest`. Use a separately approved
dist-tag for prereleases. Publish core first:

```sh
npm publish "$SDK_RELEASE_DIR/openai-auth-$SDK_RELEASE_VERSION.tgz" --access public --tag latest --ignore-scripts --registry https://registry.npmjs.org/
```

Check that the core version is visible and its `dist.integrity` matches the
recorded integrity. Then publish React:

```sh
npm publish "$SDK_RELEASE_DIR/openai-auth-react-$SDK_RELEASE_VERSION.tgz" --access public --tag latest --ignore-scripts --registry https://registry.npmjs.org/
```

If publication stops after one package, inspect both registry versions. Retry only
the missing package with its retained archive after checking the existing package.
Do not rebuild, change versions, or announce completion during this recovery.

## Check and record the release

Compare both registry versions and `dist.integrity` values with `release.json`.
Check that both packages' `latest` tags point to the intended stable version:

```sh
npm view "@openai/auth@$SDK_RELEASE_VERSION" version dist.integrity --json --registry https://registry.npmjs.org/
npm view "@openai/auth-react@$SDK_RELEASE_VERSION" version dist.integrity --json --registry https://registry.npmjs.org/
npm view @openai/auth dist-tags --json --registry https://registry.npmjs.org/
npm view @openai/auth-react dist-tags --json --registry https://registry.npmjs.org/
```

Install the exact registry versions in a fresh application outside this workspace.
Check imports and the intended application integration. Use registry packages,
without local archives, workspace links, or dependency overrides.

After both packages pass verification, create Changesets-compatible tags at
`SDK_RELEASE_SHA`: `@openai/auth@<version>` and `@openai/auth-react@<version>`.
Push only those tags. If a tag exists, check its commit instead of replacing it.
Create release notes that identify both packages, versions, changes, and migration steps.
Retain the source commit, archive hashes, and registry verification results.

## Automate subsequent releases

[Release](../.github/workflows/release.yml) runs after successful push CI on
`main`, or through a manual dispatch from `main`. It verifies CI for the exact
source commit. Changesets 3 selects whether to prepare a version PR or publish
versions that are absent from npm.

Both switches below start at `false`. Private visibility also blocks the packing
and publishing jobs. Version PR automation can be enabled while the repo is private.

| Setting                               | Required value or scope                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Variable `RELEASE_AUTOMATION_ENABLED` | Set to `true` after the release App is available.                                                                |
| Variable `NPM_PUBLISH_ENABLED`        | Keep `false` until publication is authorized and the setup below is complete.                                    |
| Variable `OPENAI_SDKS_APP_CLIENT_ID`  | The client ID of the approved `openai-sdks` App.                                                                 |
| Secret `OPENAI_SDKS_APP_PRIVATE_KEY`  | Available in environment `release`, or through the existing organization secret scoped to this repo.             |
| App installation                      | Include this repo. Tokens request repository-specific contents access and, for version PRs, pull-request access. |
| Environment `release`                 | Permit deployments from the `main` branch only.                                                                  |
| Environment `npm-publish`             | Permit `main` only. Require an Identity Platform reviewer and prevent self-review.                               |
| npm trusted publishers                | Both packages: owner `openai`, repo `auth-javascript`, workflow `release.yml`, environment `npm-publish`.        |

An organization administrator must grant access to the App and its organization
secret. Repository admin access alone cannot do this. Preserve the read-only
default `GITHUB_TOKEN` permissions and the setting that prevents Actions from
creating or approving PRs with that token. The App token creates version PRs and
allows their normal CI events to run.

The `Immutable SDK release tags` ruleset prevents updates and deletion of
`@openai/auth@*` and `@openai/auth-react@*` tags, with no bypass actors. It permits
new tags. Keep these rules when enabling publication.

Before enabling npm publication:

1. Complete and verify the manual first publication of **both** packages. The
   publisher refuses to bootstrap a package that is absent from npm.
2. Configure each package's [npm trusted publisher](https://docs.npmjs.com/trusted-publishers/)
   with the exact values above and allow direct publication with `npm publish`.
   New configurations default to staged publication. The pinned Node runtime
   includes an OIDC-capable npm. No npm token is needed in GitHub.
3. Complete the separately authorized public-repository transition. Automatic
   publication requires a public repo and uses npm provenance.
4. Verify environment protections, App access, required CI, code-owner review,
   and the [CLA acceptance checks](cla.md). Then explicitly enable
   `NPM_PUBLISH_ENABLED`.

### Release sequence

1. Pending Changesets produce a draft version PR. The action runs
   `pnpm version:packages:ci` to update both versions, changelogs, and lockfile.
   Review and merge this PR through the protected-branch process.
2. Successful CI for that main commit permits a fresh build and archive audit.
   The workflow retains the archives and `release.json` in an immutable GitHub
   artifact for 90 days. Later jobs receive that exact artifact ID.
3. An Identity Platform reviewer approves `npm-publish`. The publishing job
   installs no dependencies and performs no build. It checks archive digests,
   the source commit, live repository visibility, and exact CI result, then
   publishes through OIDC. Core must be visible with matching integrity and
   `latest` before React is published.
4. A separate job installs the exact registry versions into a fresh consumer.
   It checks ESM, CommonJS, client creation, React rendering, and CSS. These
   synthetic checks do not establish a production authentication flow.
5. After verification, the App creates both Changesets-compatible package tags
   and GitHub releases. Each release retains its archive and the shared integrity
   manifest. Existing tags and assets must match; they are not replaced.

### Recover a failed release

Inspect both registry versions and the retained manifest first. Rerun the
**failed jobs of the original run**, which reuses the successful pack job's
artifact ID. An existing version is skipped only if its integrity matches.
Registry access failures and mismatches stop publication.

Do not rerun all jobs or start a fresh build after partial publication. The
packing preflight rejects an existing target version to preserve the original
artifacts during recovery. A consumer or GitHub-record failure can also be retried
from the original run after npm publication has completed.

Keep the archives before their 90-day retention expires. If they are no longer
available, recover the retained approved archives before continuing; do not
rebuild and assume the bytes match. Use the manual verification steps above for
registry or integration issues that require maintainer investigation.
