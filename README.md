# MetalERP Security Testing Snapshot

This repository contains the application source used for the isolated MetalERP
bug-bounty environment. It is deliberately detached from production Git history
and excludes production data, internal audit documents, import artifacts, and
historical data migrations.

## Environment

Create a local `.env` from `.env.example` and use credentials belonging only to
the dedicated security-testing Supabase project:

```env
VITE_SUPABASE_URL=https://YOUR_TEST_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_TEST_PUBLISHABLE_KEY
```

Never use production URLs, keys, database passwords, API keys, or service-role
credentials in this repository or its deployments.

## Development

```bash
npm ci
npm run test
npm run build
npm run dev
```

## Database

The production migration history is not included because it contains historical
operational data. See `supabase/migrations/README.md` before connecting a test
Supabase project.

## Security Testing

Only the separately published bounty application and its dedicated Supabase
project are authorized testing targets. Production systems are out of scope.
