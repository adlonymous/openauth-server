# OpenAuth Server on Cloudflare Workers

A self-hosted [OpenAuth](https://openauth.js.org/) authentication server running on Cloudflare Workers. Provides OAuth 2.0 / OpenID Connect compatible authentication with multiple providers.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/adlonymous/openauth-server)

## Features

- **Multiple Auth Providers**
  - Email/Password with verification codes
  - GitHub OAuth
  - Google OAuth
  - Solana SIWS (Sign In With Solana) wallet authentication
- **Provider Selection UI** - Users choose their preferred auth method
- **Email Delivery** - Verification codes sent via [Resend](https://resend.com)
- **Persistent Storage** - Uses Cloudflare KV for tokens, keys, and password hashes
- **Keep-Alive System** - Durable Object pings every 10 seconds to reduce cold starts
- **Edge Deployment** - Runs globally on Cloudflare's edge network with Smart Placement

## Live Demo

**Server:** https://openauth-server.adlonymous.workers.dev

**Test the auth flow:**
```
https://openauth-server.adlonymous.workers.dev/authorize?response_type=code&client_id=web&redirect_uri=https://example.com/callback
```

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

# Set up local secrets for development
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your secrets

# Deploy
npm run deploy

# Add production secrets
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

## Configuration

### Environment Variables

Set in `wrangler.jsonc` under `vars`:

| Variable | Description | Required |
|----------|-------------|----------|
| `EMAIL_FROM` | Sender address for emails, e.g., `App <noreply@yourdomain.com>` | Yes |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID | For GitHub auth |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | For Google auth |
| `SOLANA_CHAIN_ID` | Solana network: `mainnet`, `devnet`, or `testnet` | No (defaults to `mainnet`) |

### Secrets

| Secret | Description | Required |
|--------|-------------|----------|
| `RESEND_API_KEY` | Resend API key for sending emails | For password auth |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret | For GitHub auth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | For Google auth |

Add secrets using:
```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

## Provider Setup

### Password (Email/Password)

1. Create an account at [resend.com](https://resend.com)
2. [Verify your domain](https://resend.com/domains) to send from your own email address
3. [Create an API key](https://resend.com/api-keys) with "Sending access" permission
4. Add the API key as a secret

### GitHub OAuth

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set the callback URL to: `https://your-worker.workers.dev/github/callback`
4. Copy the Client ID to `wrangler.jsonc` vars
5. Add the Client Secret as a wrangler secret

### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create OAuth 2.0 credentials (Web application)
3. Add authorized redirect URI: `https://your-worker.workers.dev/google/callback`
4. Copy the Client ID to `wrangler.jsonc` vars
5. Add the Client Secret as a wrangler secret

### Solana (SIWS)

No additional setup required! The Solana provider uses the [Sign In With Solana](https://phantom.app/learn/developers/sign-in-with-solana) standard and works with any Wallet Standard compatible wallet (Phantom, Solflare, Backpack, etc.).

## Development

```bash
# Install dependencies
npm install

# Copy example env file
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your secrets

# Start local development server
npm run dev

# Build wallet client bundle (for Solana SIWS)
npm run build:wallet

# View logs (in another terminal)
npx wrangler tail
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Server info and health check |
| `GET /authorize` | Provider selection page |
| `GET /password/authorize` | Password authentication flow |
| `GET /github/authorize` | GitHub OAuth flow |
| `GET /google/authorize` | Google OAuth flow |
| `GET /solana/authorize` | Solana wallet authentication |
| `POST /token` | Exchange authorization code for tokens |
| `GET /.well-known/jwks.json` | JSON Web Key Set for token verification |
| `GET /.well-known/oauth-authorization-server` | OAuth metadata |

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Client App     │────▶│  OpenAuth Server │────▶│  Resend     │
│  (your app)     │◀────│  (this worker)   │     │  (emails)   │
└─────────────────┘     └──────────────────┘     └─────────────┘
                               │    │
                    ┌──────────┘    └──────────┐
                    ▼                          ▼
             ┌──────────────┐          ┌──────────────┐
             │ Cloudflare KV│          │ OAuth APIs   │
             │  (storage)   │          │ GitHub/Google│
             └──────────────┘          └──────────────┘
                    │
                    ▼
             ┌──────────────┐
             │ KeepAlive DO │
             │ (warm-up)    │
             └──────────────┘
```

## Project Structure

```
openauth-server/
├── src/
│   ├── index.ts           # Main issuer configuration & exports
│   ├── subjects.ts        # JWT payload schemas
│   ├── keep-alive.ts      # Durable Object for cold start prevention
│   ├── providers/
│   │   └── solana.ts      # SIWS (Sign In With Solana) provider
│   ├── ui/
│   │   ├── password.tsx   # Password auth UI
│   │   └── solana.tsx     # Wallet selection UI
│   └── wallet-client/
│       ├── index.ts       # Browser wallet bundle source
│       └── build.mjs      # esbuild script for wallet bundle
├── public/
│   └── wallet-client.js   # Built browser bundle for wallet connections
├── wrangler.jsonc         # Cloudflare Worker config
├── worker-configuration.d.ts # TypeScript types for Env
├── package.json
└── tsconfig.json
```

## Keep-Alive System

OpenAuth loads signing keys from KV storage on cold start, which can take 3-10 seconds. To minimize this latency:

1. **Durable Object** (`KeepAlive`) pings the worker every 10 seconds
2. **Cron trigger** (every minute) ensures the DO stays initialized
3. **Smart Placement** positions the worker closer to KV storage

This keeps the worker warm and signing keys pre-loaded, resulting in sub-second response times for most requests.

**Cost:** Free tier (well under limits)
- ~260K DO requests/month (within 1M free)
- Minimal KV reads (within 100K free)

## Customization

### Adding Allowed Domains

Edit the `allow` callback in `src/index.ts`:

```typescript
allow: async (input) => {
  const allowedDomains = [
    "yourdomain.com",
    "app.yourdomain.com",
  ]
  // ... validation logic
}
```

### Custom JWT Claims

Edit `src/subjects.ts` to modify the user data included in tokens:

```typescript
export const subjects = createSubjects({
  user: object({
    userID: string(),
    email: optional(string()),
    walletAddress: optional(string()),
    // Add your custom fields here
  }),
})
```

### Adding More Providers

OpenAuth supports many providers out of the box. See the [OpenAuth documentation](https://openauth.js.org/) for:
- Discord
- Twitter/X
- Apple
- Microsoft
- And more...

## License

MIT

## Links

- [OpenAuth Documentation](https://openauth.js.org/)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Resend](https://resend.com/)
- [Sign In With Solana](https://phantom.app/learn/developers/sign-in-with-solana)
