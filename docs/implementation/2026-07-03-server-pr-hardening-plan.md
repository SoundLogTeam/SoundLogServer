# 2026-07-03 Server PR hardening plan

## Goal

Make the server PR prove that removed Spotify/streaming metadata is gone from both source and runnable artifacts before merge.

## Findings

- `src`, `openapi`, and tests on the server PR no longer contain Spotify platform metadata.
- Local ignored `dist` artifacts still contained `open.spotify.com`, Spotify validators, and Spotify API test expectations before rebuild.
- The server PR currently has no PR check, so stale dist or metadata regression would not be caught on GitHub.

## Scope

1. Add a server-side audit script that scans runtime-relevant files for removed Spotify markers.
2. Run the audit in a new npm script.
3. Add a PR workflow that runs install, typecheck, build, mock-db API tests, and the Spotify metadata audit.
4. Build before auditing so generated `dist` no longer serves stale Spotify behavior.
5. Verify locally and push to the existing server PR branch.

## Non-goals

- Do not deploy or merge the server PR.
- Do not remove YouTube Music or Melon external search metadata.
- Do not change database schema in this slice.

## Verification

- `pnpm run typecheck`
- `pnpm run build`
- `USE_MOCK_DB=true pnpm run test:api`
- `pnpm run check:no-spotify-metadata`
- GitHub PR checks pass after push.
