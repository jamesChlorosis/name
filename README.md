# Handle Matrix

A bulk username availability checker for Instagram, Discord, Minecraft, Roblox, Medium, and LinkedIn public profile URLs.

## Features

- Paste many usernames at once.
- Filter checks by platform.
- Validate platform-specific username rules before network checks.
- Run large batches through a bounded worker pool with configurable concurrency and per-probe timeout.
- Display available, taken, invalid, checking, and uncertain results in a clean table.
- Suggest alternative handles when a checked username is taken.
- Export visible results as CSV.

## Commands

```bash
npm install
npm run dev
npm run build
npm run lint
```

The local development server includes a small Vite middleware API at `/api/check` so browser CORS does not block the platform checks.

LinkedIn commonly blocks automated public-profile probes. When that happens, the app keeps the result as `uncertain` and includes the `linkedin.com/in/...` URL so it can be opened manually.

Medium checks are conservative for claimability: local validation rejects common reserved paths and unsupported claim characters, and the scanner only marks a name available when reliable lookup signals agree.
