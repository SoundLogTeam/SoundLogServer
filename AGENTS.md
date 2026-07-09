# Soundlog Server Agent Rules

- Do not merge GitHub pull requests unless the user's latest message explicitly asks to merge that exact PR.
- PR creation, CI verification, reviewer assignment, issue closing, or "finish the task" does not imply merge approval.
- If a merge request is ambiguous, ask for confirmation before using any merge UI, GitHub API, or commands such as `gh pr merge`.

## Product Platform Direction

- Soundlog is a mobile app product. We do not intend to ship or maintain a public web deployment as a product surface.
- Server API contracts should prioritize the iOS/Android app experience. Do not add web-specific API behavior unless the user explicitly asks for web support.
- Web export or browser checks from the app repository are compatibility checks, not product deployment requirements.
