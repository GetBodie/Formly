# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
docker compose up -d          # Start PostgreSQL
npm run dev                   # Start Next.js dev server (localhost:3000)

# Database
npx prisma generate           # Regenerate Prisma client after schema changes
npx prisma db push            # Push schema to database (dev only)

# Build & Lint
npm run build
npm run lint
```

## Architecture

Tax Intake Agent - an automated document collection system for tax accountants.

### Data Flow

1. **Engagement Creation** → UI creates engagement with client info, storage folder URL (SharePoint or Google Drive), Typeform ID
2. **Intake Processing** → Typeform webhook receives client responses, LLM generates document checklist
3. **Document Collection** → Cron polls storage (SharePoint or Google Drive), downloads new files, LLM classifies each document
4. **Reconciliation** → LLM matches documents to checklist items, calculates completion percentage
5. **Brief Generation** → When 100% complete, accountant can generate prep brief via LLM

### Status Flow

`PENDING` → `INTAKE_DONE` → `COLLECTING` → `READY`

### Single Model Design

All data lives in one `Engagement` model with JSONB columns:
- `intakeData` - Raw Typeform responses
- `checklist` - Generated document checklist (`ChecklistItem[]`)
- `documents` - Classified documents (`Document[]`)
- `reconciliation` - Matching results and completion status

### Key Files

- `src/lib/openai.ts` - Four LLM functions: `generateChecklist`, `classifyDocument`, `reconcile`, `generatePrepBrief`
- `src/lib/storage/` - Storage provider abstraction (SharePoint & Google Drive)
- `src/app/api/webhooks/typeform/route.ts` - Receives intake form submissions, triggers checklist generation
- `src/app/api/cron/poll-storage/route.ts` - Polls storage every 5 min, processes new documents

### Background Processing

Uses Vercel's `waitUntil()` for background work (no queue system). Cron job configured in `vercel.json`.

## Environment Variables

Required in `.env`:
- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` - For GPT-4o structured outputs
- `MISTRAL_API_KEY` - For Mistral OCR document extraction
- `TYPEFORM_WEBHOOK_SECRET` - HMAC signature verification
- `CRON_SECRET` - Vercel cron authorization
- `RESEND_API_KEY` - For sending emails via Resend
- `EMAIL_FROM` - Sender email address (e.g., noreply@yourdomain.com)
- `ACCOUNTANT_EMAIL` - Email address for accountant notifications

### Storage Provider (configure one or more)

**SharePoint:**
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`

**Google Drive:**
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` - e.g., `tax-agent@project.iam.gserviceaccount.com`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` - Private key (use `\n` for newlines)

**Dropbox:**
- `DROPBOX_APP_KEY` - App key from Dropbox App Console
- `DROPBOX_APP_SECRET` - App secret
- `DROPBOX_ACCESS_TOKEN` - Long-lived access token (or use refresh token)
- `DROPBOX_REFRESH_TOKEN` - Optional, for token refresh

## Learnings & Gotchas

### Hosting Platform Comparison

When migrating from Vercel, consider these alternatives:

| Platform | Free Postgres | Free Cron | Best For |
|----------|--------------|-----------|----------|
| Vercel | No (need Neon/Supabase) | 2 jobs, 1x/day max | Next.js apps |
| Railway | Yes ($5/mo credit) | Yes | Simple backend apps |
| Fly.io | No (removed) | DIY in container | Long-running processes, WebSockets |
| Render | 90 days only | Paid only | Simple deploy, native cron (paid) |
| Cloudflare Workers | D1 (SQLite) free | Yes, free | Edge compute, requires code rewrite |

**Railway** is the easiest path for backend apps with cron jobs and Postgres.

### Typeform API

**Creating Forms Programmatically**: When using the Typeform Create API:
- Welcome/thank you screens go in separate `welcome_screens` and `thankyou_screens` arrays
- Each choice option requires a `ref` property (not just `label`)
- Number validations go in `validations`, not `properties`
- Logic jumps are easier to configure in the Typeform UI after creation

**Webhook Setup**: After creating a form via API, configure the webhook manually:
1. Go to Connect > Webhooks in Typeform
2. Add your endpoint URL (e.g., `https://yourdomain.com/api/webhooks/typeform`)
3. Generate and save the webhook secret to `TYPEFORM_WEBHOOK_SECRET`

### Monorepo Migration Pattern (Next.js → Hono + React)

If migrating from Next.js to a simpler backend (Hono/Express) + React SPA:

**Directory Structure:**
```
apps/
  api/           # Hono backend
    src/
      routes/    # API endpoints
      agents/    # Background processing
      lib/       # Shared utilities
      index.ts   # Entry point with scheduler
    Dockerfile
  web/           # React frontend (Vite)
    src/
      pages/
      components/
    Dockerfile
packages/
  shared/        # Shared types, utilities
```

**Key Patterns:**
- Use `node-cron` for scheduling in Hono instead of Vercel cron
- Extract Next.js API routes to Hono routes (`app.get()`, `app.post()`)
- Move `src/lib/` to `apps/api/src/lib/` (business logic)
- Create React SPA pages from Next.js pages (remove `use client`, add React Router)
- Use Docker Compose for local dev with both services

### Docker Local Development

**Prisma Client Generation**: Always regenerate Prisma client before building:
```bash
cd apps/api && npx prisma generate
```

**Database Sync Issues**: If you get "column not found" errors, ensure schema is synced:
```bash
npx prisma db push
```
