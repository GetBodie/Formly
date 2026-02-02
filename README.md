# Tax Intake Agent

Automated document collection system for tax accountants. Collects client tax documents, classifies them using AI, and tracks completion status.

## Architecture

- **API** (`apps/api`) - Hono backend with Prisma ORM
- **Web** (`apps/web`) - React SPA with Vite
- **Database** - PostgreSQL

### Data Flow

1. **Engagement Creation** - Accountant creates engagement with client info and storage folder URL
2. **Intake Processing** - Typeform webhook receives client responses, LLM generates document checklist
3. **Document Collection** - Cron polls storage (SharePoint, Google Drive, or Dropbox), downloads and classifies documents
4. **Reconciliation** - Matches documents to checklist items, calculates completion percentage
5. **Brief Generation** - When complete, generates prep brief for accountant

## Development

```bash
# Start all services (API + Web + PostgreSQL)
./bin/dev

# Start with Cloudflare tunnel for webhooks
./bin/dev --tunnel

# Stop services
docker compose down

# View logs
docker compose logs -f api
docker compose logs -f web
```

### Services

| Service    | URL                          |
|------------|------------------------------|
| API        | http://localhost:3009        |
| Web        | http://localhost:3010        |
| PostgreSQL | localhost:5432               |
| Tunnel     | https://xxx.ngrok-free.app   |

### Database

```bash
docker compose exec api npx prisma studio      # Visual database browser
docker compose exec api npx prisma db push     # Push schema changes
docker compose exec api npx prisma generate    # Regenerate client
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Required
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
MISTRAL_API_KEY=...
TYPEFORM_WEBHOOK_SECRET=...
CRON_SECRET=...
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@yourdomain.com
ACCOUNTANT_EMAIL=accountant@example.com

# Storage (configure at least one)
# SharePoint
AZURE_TENANT_ID=...
AZURE_CLIENT_ID=...
AZURE_CLIENT_SECRET=...

# Google Drive
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=...

# Dropbox
DROPBOX_APP_KEY=...
DROPBOX_APP_SECRET=...
DROPBOX_ACCESS_TOKEN=...
```

## Deployment

Deploys to Render on push to main:

```bash
git push origin main
```

See `render.yaml` for service configuration.
