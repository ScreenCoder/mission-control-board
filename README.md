# Mission Control Board

A deployable mission-control dashboard for status snapshots, security findings, and kanban workflow.

## Modes

- **Local dynamic mode**: the original Node server can read local OpenClaw state.
- **Vercel/static mode**: the deployed app reads `public/data/status.json` and stores kanban state in browser localStorage.

## Local preview

Open `public/index.html` with a static server, or keep using the local OpenClaw-backed server if desired.

## Deploy

```bash
vercel
vercel --prod
```

## Refreshing the published snapshot

Update `public/data/status.json` from your local OpenClaw environment, commit, and redeploy.
