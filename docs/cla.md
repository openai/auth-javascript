# Contributor license agreement

Contributors must read the [OpenAI individual CLA](../CLA.md). The CLA Assistant
asks each unsigned contributor to post this exact comment on their pull request:

```text
I have read the CLA Document and I hereby sign the CLA
```

Only the contributor can give this consent. Do not post a signature or create a
signature record for someone else. Contact the maintainers for a corporate
agreement. Keep confidential agreements and personal contact details out of GitHub.

## Agreement and records

The workflow links to the agreement at immutable commit
`1bfe84032a308369234761aaf767a1cb32a307fc`. Its text matches `CLA.md`. The project
name is the only change to the approved OpenAI agreement template.

The `cla-signatures` branch stores `signatures/cla-v1.json`. It starts with an
empty `signedContributors` array. The action records GitHub identity and the
signing comment. No personal access token or external signature service is used.
Keep this branch and its history. Disable force pushes and deletion, but permit
the action to update the signature file without a pull request.

The allowlist contains only `dependabot[bot]`, `github-actions[bot]`, and
`openai-sdks[bot]`. Collaborator status does not exempt a person. Changes to
agreement terms require legal review and an explicit decision about renewed
consent; do not reuse these records for different terms.

## Activate enforcement

1. Merge `.github/workflows/cla.yml` onto `main` after review. Both event handlers
   need the workflow on the default branch. Never add a PR-head checkout to it.
2. Open a PR with an unsigned author. Confirm that `cla` fails and the bot links
   to the pinned agreement. Add the observed `cla` check from GitHub Actions to
   the required checks for `main`, preserving `check` and the existing PR review
   requirements. Require code-owner review for the protected configuration.
3. A willing contributor must read the agreement and post the signing comment.
   Confirm the record's numeric GitHub ID and original comment, and confirm that
   the original PR check is rerun and passes. Never fabricate a test signature.
4. Confirm that an unrelated signer does not satisfy the author's requirement,
   an unsigned author added by a later commit fails again, and a previous signer
   is recognized on another PR. Ordinary issue comments must do nothing.
5. Confirm that a closed, unmerged PR remains unlocked and a merged PR is locked.
   Retain the PR, comment, and check links as acceptance evidence.

Do not require an unobserved check before the workflow is on `main`; that would
block the setup PR itself. Workflow source and an empty storage branch do not
establish that enforcement is active.

## Maintainer review

This uses the same pinned [CLA Assistant action](https://github.com/contributor-assistant/github-action/tree/ca4a40a7d1004f18d9960b404b97e5f30a505a08)
as [OpenAI Codex](https://github.com/openai/codex/blob/main/.github/workflows/cla.yml).
Upstream archived the action in March 2026. The pin prevents an unexpected update;
it does not establish ongoing maintenance.

The action inspects only the first 100 commits and first page of comments. It can
fall back from an unmapped author to the committer, and does not collect co-author
trailers. Inspect all contributors, including co-authors and copied patches,
before approving a PR. Resolve unmapped authors and large PRs with the maintainers.

A repository writer or another writable workflow can change the signature file.
For outside contributors, verify the original GitHub-authenticated signing
comment and identity before merge. A green check or JSON record alone is not
proof of consent or employer authorization.

Signature writes are serialized. GitHub can replace a queued run; comment
`recheck` if a PR remains pending. Investigate long-discussion pagination limits
instead of recording consent manually. Review signature visibility before making
the repository public.
