# Releasing

**Pull request → merge to `main` → publish to npm.** Merging is the approval. A release is just a pull request that changes the package version. When it merges, `.github/workflows/release.yml` publishes that version to npm with trusted publishing (OIDC, no npm token, provenance attached automatically). Then it creates the `v<version>` tag and a GitHub Release.

The published package is `packages/javascript-excel`. The playground (`apps/playground`) and the workspace root are private and never published.

## 1. Add a changeset to your pull request

Every pull request that changes the published package adds a changeset:

```sh
npx changeset
```

Pick `javascript-excel`, choose the bump (patch, minor, major) and write one line for the changelog. This creates a small Markdown file in `.changeset/`; commit it with your change. Pull requests that only touch docs, CI or the playground need no changeset.

Merging a pull request with only a changeset publishes nothing. The version doesn't change until a release pull request.

## 2. Cut a release pull request

When a release makes sense (Afzal or the team lead decides):

```sh
git switch -c release-<version> origin/main
npm run version-packages     # changeset version + version constant + lockfile sync
git diff                     # review the version bump and CHANGELOG.md
```

`npm run version-packages` runs `changeset version`, which:
- consumes the pending changesets,
- bumps `packages/javascript-excel/package.json`,
- writes `packages/javascript-excel/CHANGELOG.md`,
- updates the playground's dependency on the package.

It then runs `scripts/reset-pre-counter.mjs`, which restarts the prerelease number at 0 when the prerelease tag changed (see [§3](#3-prereleases-pre-mode)), and `scripts/sync-version.mjs`, which sets the `VERSION` constant in `packages/javascript-excel/src/index.ts` to the new version (`changeset version` never edits source files). It fails if it can't find exactly one such constant, so renaming the constant can't silently break the sync.

Finally it runs `npm install --package-lock-only`. Without that step, `package-lock.json` would still list the old version, and `npm ci` (in CI and in the release job) would fail.

Open the pull request. Its **Release dry run** CI job shows what merging would do. The "Release preview" step says which version would be published, or "no release". The job also runs `npm publish --dry-run` with the dist-tag that would be used.

## 3. Prereleases (pre mode)

2.0 ships as prereleases on the `next` dist-tag, so `npm install javascript-excel` keeps getting 1.0.3 (`latest`) until 2.0.0 is final.

Pre mode is Changesets 3's own format. `.changeset/pre.json` holds just `{ "mode": "pre", "tag": "<tag>" }`. `changeset version` moves the changesets it consumed into `.changeset/pre/`, where later prereleases skip them and the final release picks them all up again. Don't edit or delete the files in `.changeset/pre/` by hand.

Any version with a prerelease part (`-alpha.1`, `-beta.0`, ...) is published with `--tag next` and marked as a prerelease on GitHub. A plain version (`2.0.0`) goes to `latest`.

### Entering pre mode

```sh
npx changeset pre enter alpha     # writes .changeset/pre.json; commit it
npm run version-packages          # 2.0.0-alpha.0, then alpha.1, alpha.2, ...
```

### Switching the tag (alpha → beta → rc)

`changeset pre enter` refuses to run while in pre mode, so a tag switch is a one-line edit:

1. On a branch, change `"tag"` in `.changeset/pre.json` (for example `"alpha"` → `"beta"`). Change nothing else, and don't bump the version. Open a pull request with that change. Merging it publishes nothing, because the version doesn't change.
2. Cut the next release pull request as usual (§2), with at least one pending changeset.

Changesets numbers the next prerelease from the current version (`prerelease[1] + 1`) and keeps counting across a tag switch: on its own, `changeset version` turns `2.0.0-alpha.7` into `2.0.0-beta.8`. `npm run version-packages` therefore runs `scripts/reset-pre-counter.mjs` right after it. The script compares the package version with the one committed at `HEAD`. When the prerelease tag differs, it rewrites the new version to `-<tag>.0` in every changed `package.json` (the package itself and the workspaces that depend on it) and in the `CHANGELOG.md` heading. The `VERSION` sync and the lockfile update then use that version. So the release after `2.0.0-alpha.7` is `2.0.0-beta.0`, and the ones after it are `beta.1`, `beta.2`, .... A release with the same tag, a first prerelease and a final version are left alone.

Checked with a dry run: on top of the switch to `"beta"`, one patch changeset and `npm run version-packages` give `2.0.0-beta.0` in `packages/javascript-excel/package.json`, `CHANGELOG.md` (`## 2.0.0-beta.0`), the `VERSION` constant, every workspace `package.json` that depends on the package, and `package-lock.json`.

### Exiting pre mode (the final 2.0.0)

```sh
git switch -c release-2.0.0 origin/main
npx changeset pre exit            # sets "mode": "exit" in .changeset/pre.json
npm run version-packages          # 2.0.0
```

With `"mode": "exit"`, `changeset version`:

- versions the package to the plain `2.0.0` (the reset script leaves final versions alone),
- writes one `## 2.0.0` CHANGELOG section with **every** changeset since pre mode was entered: those in `.changeset/pre/` and the new ones,
- deletes `.changeset/pre.json` and all of `.changeset/pre/`.

Dry run (from `2.0.0-alpha.7`, with one extra patch changeset): `2.0.0`, `pre.json` and the 26 files in `.changeset/pre/` deleted, and every entry listed under "Minor Changes" in `## 2.0.0`. None of those changesets is a major bump, because 2.0.0-alpha.0 was the baseline. Before merging the stable release pull request, add a short hand-written summary of the breaking changes from 1.x at the top of the `## 2.0.0` section. The release notes are that section.

Merging that pull request publishes `2.0.0` to `latest`. The prerelease versions stay on npm under `next`.

## 4. What happens on merge

On every push to `main`, the `Release` job (environment `npm`, `main` only) runs `scripts/release-check.mjs`. It publishes only if **both** hold:

1. the package version differs from the previous commit (`HEAD~1`), and
2. `javascript-excel@<version>` is not on npm yet.

Otherwise it stops with "no release" in the job summary. That covers docs and feature merges, re-runs after a successful publish, and the current `2.0.0-alpha.0` (never published, and the version hasn't changed).

For a release, the job then:
1. runs `npm ci`, sets up the Python tools the test suite needs in CI (openpyxl, as in `ci.yml`), then `npm run typecheck`, `npm test` and `npm run build`,
2. runs `npm publish ./packages/javascript-excel --tag next|latest`,
3. runs `gh release create v<version>`, which creates the tag on the merge commit. The notes are that version's section of `CHANGELOG.md`.

The job also checks that npm is at least 11.5.1, which trusted publishing requires. Node 26 ships a newer npm (11.x).

Re-running the job is safe:
- After a failed publish, the version is still unpublished, so the re-run publishes.
- After a successful publish but a failed tag/Release step, the re-run skips publishing and creates the missing tag and Release.
- Moving the package is not a release. When its `package.json` is new at its path (for example, moved from the repository root to `packages/<name>`) and that version is already on npm, nothing is published and no tag or GitHub Release is created.
- If everything already succeeded, the re-run does nothing.

### Recovery: run the release by hand

A re-run repeats the original push, so it can't help when the version is no longer "new" relative to `HEAD~1`. For example, the release job failed before publishing, and a fix for the job itself was merged afterwards. For that case, `release.yml` can also be started manually:

```sh
gh workflow run release.yml --ref main
```

(or Actions → Release → Run workflow, branch `main`.)

A manual run publishes the current version of `main` **if it is not on npm yet**, even when it did not change in the last commit. It also requires that version to have a `## <version>` section in the package `CHANGELOG.md`, that is, a version cut by `npm run version-packages`. Without one, the run fails with "manual run refused: CHANGELOG.md has no \"## <version>\" section …" and publishes and tags nothing, so a scaffold or hand-edited version can't be published by hand. If it is already on npm, nothing is published, and the run only creates the `v<version>` tag and GitHub Release if they are missing. npm errors other than "not found" still fail the job, as on a push. The run is limited to `main`, both by the job's `if` and by the `npm` environment's branch policy.

Trusted publishing checks the **workflow file name** (`release.yml`) and the environment (`npm`), not the event that started it. A manual run is the same file in the same environment, so it publishes exactly like a push. The tag and Release point at the commit that was built: the tip of `main` when the run started.

## 5. First release: one-time setup (Afzal)

Trusted publishing is configured on npmjs.com, not in this repository. **Do it on the same day as the first release merge**, because npm expires a trusted publisher config that goes unused for 2 days, and it doesn't validate the fields when you save.

1. npmjs.com → `javascript-excel` → Settings → **Trusted publishing** → GitHub Actions:
   - Organization or user: `securedeveloper`
   - Repository: `javascript-excel`
   - Workflow filename: `release.yml`
   - Environment: `npm`
2. Merge the release pull request and check that the `Release` job published.
3. Then, under package Settings → Publishing access, choose **Require two-factor authentication and disallow tokens**. Trusted publishing keeps working; tokens stop working.

The `npm` GitHub environment already exists and is limited to `main`. Error `ENEEDAUTH` or `E403` on publish usually means one of the four fields doesn't match exactly (it's case-sensitive).
