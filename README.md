# Handle Matrix

A bulk username availability checker for Instagram, Discord, Minecraft, and Roblox.

## Features

- Paste many usernames at once.
- Filter checks by platform.
- Validate platform-specific username rules before network checks.
- Run checks with a configurable delay to avoid hammering platform endpoints.
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
