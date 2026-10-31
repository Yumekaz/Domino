# Public provenance fixture

These files are genuine, public GitHub API responses for
[`sindresorhus/yocto-queue`](https://github.com/sindresorhus/yocto-queue), fetched on
2026-10-31 from `https://api.github.com` with an unauthenticated request. They are
deterministic test fixtures for normalization and graph tests. They are **not** a claim
that live ingestion passed; the guarded live test re-fetches the same source.

Key real identifiers and links:

- Repository numeric ID: `315531538` (MIT, default branch `main`).
- Issue [#11](https://github.com/sindresorhus/yocto-queue/issues/11), database ID
  `2891449053`, closed by `sindresorhus` at `2025-03-06T12:27:37Z`.
- Issue discussion contains the maintainer's claim-bearing rationale in comment
  `2696500039` ("This is intended behavior … Maybe called `drain()`.").
- Pull request [#12](https://github.com/sindresorhus/yocto-queue/pull/12), body
  `Fixes #11`, head `87d4a591b6584b9120a16daea822c919ff36c1ee`, base
  `0ac610dfa4e5cbd929b2e9b8fc34f5417f2f788b`, merged at
  `2025-03-06T12:27:36Z` as `d631ea87f49443c4c8dbf84fd79bf600d11a5fac`.
- Changed files at the PR head include `index.js`, `index.d.ts`, `readme.md`,
  `test.js`; `index.js` blob SHA is `2fa5f670219c2726c212a93096245cda5a498bce`.
- Issue timeline contains a `cross-referenced` event for PR #12 and a `closed` event
  one second after the pull request merged.

The API's `Fixes #11` text alone is not promoted to a verified closing link by the
implementation. `CLOSES_ISSUE` requires the closing keyword plus the API
cross-reference event and the issue-closed transition, all preserved in the fixture.
