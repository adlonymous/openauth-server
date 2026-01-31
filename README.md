# OpenAuth Server on Cloudflare Workers

A self-hosted [OpenAuth](https://openauth.js.org/) authentication server running on Cloudflare Workers. Provides OAuth 2.0 / OpenID Connect compatible authentication with multiple providers.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/adlonymous/openauth-server)

## Features

- **Password Authentication** - Email/password with verification codes
- **Email Delivery** - Verification codes sent via [Resend](https://resend.com)
- **Persistent Storage** - Uses Cloudflare KV for tokens, keys, and password hashes
- **Edge Deployment** - Runs globally on Cloudflare's edge network

## Quick Start

### Option 1: Deploy to Cloudflare (Recommended)

Click the "Deploy to Cloudflare" button above. You'll be prompted to:
1. Connect your GitHub account
2. Configure the required secrets (see below)
3. Deploy!

### Option 2: Manual Deployment

```bash
# Clone the repository
git clone https://github.com/adlonymous/openauth-server.git
cd openauth-server

# Install dependencies
npm install

# Create KV namespace (if you don't have one already)
npx wrangler kv namespace create OPENAUTH_KV
# Copy the returned ID and update wrangler.jsonc kv_namespaces[0].id

# Update wrangler.jsonc vars.EMAIL_FROM with your verified domain
# e.g., "MyApp <noreply@mydomain.com>"

# Set up local secrets for development
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your Resend API key

# Deploy
npm run deploy

# Add production secrets
npx wrangler secret put RESEND_API_KEY
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `EMAIL_FROM` | Sender address for emails, e.g., `App <noreply@yourdomain.com>` | Yes |

Set in `wrangler.jsonc` under `vars`:
```json
{
  "vars": {
    "EMAIL_FROM": "MyApp <noreply@mydomain.com>"
  }
}
```

### Secrets

| Secret | Description | Required |
|--------|-------------|----------|
| `RESEND_API_KEY` | Your Resend API key for sending emails | Yes |

Add secrets using:
```bash
npx wrangler secret put RESEND_API_KEY
```

### Resend Setup

1. Create an account at [resend.com](https://resend.com)
2. [Verify your domain](https://resend.com/domains) to send from your own email address
3. [Create an API key](https://resend.com/api-keys) with "Sending access" permission
4. Add the API key as a secret (see above)

> **Note:** Without a verified domain, Resend only allows sending to your own email address.

## Development

```bash
# Install dependencies
npm install

# Copy example env file
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your Resend API key

# Start local development server
npm run dev

# View logs (in another terminal)
npx wrangler tail
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Server info and health check |
| `GET /.well-known/jwks.json` | JSON Web Key Set for token verification |
| `GET /.well-known/oauth-authorization-server` | OAuth metadata |
| `GET /password/authorize` | Start password authentication flow |
| `POST /token` | Exchange authorization code for tokens |

## Testing the Auth Flow

Start an OAuth flow by visiting:
```
https://your-worker.workers.dev/password/authorize?client_id=test&redirect_uri=https://example.com/callback&response_type=code
```

> **Note:** For a complete flow, you'll need a client application to receive the authorization code and exchange it for tokens.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Client App     │────▶│  OpenAuth Server │────▶│  Resend     │
│  (your app)     │◀────│  (this worker)   │     │  (emails)   │
└─────────────────┘     └──────────────────┘     └─────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │ Cloudflare KV│
                        │  (storage)   │
                        └──────────────┘
```

## Project Structure

```
openauth-server/
├── src/
│   ├── index.ts        # Main issuer configuration
│   ├── subjects.ts     # JWT payload schemas
│   └── ui/
│       └── password.tsx # Custom password UI
├── wrangler.jsonc      # Cloudflare Worker config
├── package.json
└── tsconfig.json
```

## Customization

### Adding OAuth Providers

Coming soon: GitHub, Google, Solana (SIWS), and Privy providers.

### Custom JWT Claims

Edit `src/subjects.ts` to modify the user data included in tokens:

```typescript
export const subjects = createSubjects({
  user: object({
    userID: string(),
    email: optional(string()),
    // Add your custom fields here
  }),
})
```

## License

MIT

## Links

- [OpenAuth Documentation](https://openauth.js.org/)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Resend](https://resend.com/)
