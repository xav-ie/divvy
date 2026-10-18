# Changesets

Each user-facing change adds a note here with `npx changeset` (pick patch,
minor or major and describe the change for the changelog). Every push to
`main` keeps one "chore: version packages" PR up to date with the next
version and its changelog; merging it tags `v<version>`, creates the GitHub
release and deploys the Worker.
