import { issuer } from "@openauthjs/openauth"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
import { CodeProvider } from "@openauthjs/openauth/provider/code"
import { CodeUI } from "@openauthjs/openauth/ui/code"
import { subjects } from "./subjects"
import { Hono } from "hono"

/**
 * OpenAuth Issuer - With CloudflareStorage (Chunk 2)
 * 
 * This OpenAuth server configuration uses:
 * - CloudflareStorage: Persistent KV storage for tokens, keys, and codes
 * - CodeProvider: Simple email/phone code-based authentication
 * 
 * The auth codes are logged to the console for testing purposes.
 * In production, you'll send these via email/SMS (Chunk 4).
 */

/**
 * Create the issuer app with access to the Cloudflare KV binding.
 * 
 * We need to create the issuer inside a function that has access to `env`
 * because CloudflareStorage requires the KV namespace binding.
 */
function createApp(env: Env) {
  const app = issuer({
    /**
     * Authentication providers
     * Each provider handles a different authentication method.
     * The key (e.g., "code") becomes part of the URL: /code/authorize
     */
    providers: {
      /**
       * Code Provider - sends verification codes to email/phone
       * Codes are logged to console for now. In Chunk 4, we'll use Resend for email.
       */
      code: CodeProvider(
        CodeUI({
          /**
           * Called when a user needs to receive a verification code.
           * @param claims - The user's claims (e.g., { email: "user@example.com" })
           * @param code - The verification code to send
           */
          sendCode: async (claims, code) => {
            // For now, just log to console - check Worker logs to see the code
            console.log("=".repeat(50))
            console.log("VERIFICATION CODE")
            console.log("=".repeat(50))
            console.log("Claims:", JSON.stringify(claims, null, 2))
            console.log("Code:", code)
            console.log("=".repeat(50))
          },
        })
      ),
    },

    /**
     * Subject schemas - defines the shape of JWT payloads
     * Imported from ./subjects.ts
     */
    subjects,

    /**
     * Storage adapter - CloudflareStorage using KV
     * 
     * This provides persistent storage for:
     * - JWT signing keys (so tokens remain valid after restarts)
     * - Refresh tokens
     * - Authorization codes (short-lived, 60 seconds)
     * - Password hashes (when PasswordProvider is added)
     */
    storage: CloudflareStorage({
      namespace: env.OPENAUTH_KV,
    }),

    /**
     * Success callback - called after a user successfully authenticates
     * This is where you:
     * 1. Look up or create the user in your database
     * 2. Return a subject with the user's properties
     * 
     * The returned subject properties are encoded in the JWT access token.
     */
    success: async (ctx, value) => {
      // For now, we only have the "code" provider
      if (value.provider === "code") {
        // value.claims contains { email: string } or { phone: string }
        const email = value.claims.email

        // In a real app, you'd look up or create the user in your database here
        // For now, we generate a random user ID
        const userID = crypto.randomUUID()

        console.log("User authenticated:", { email, userID })

        // Return the subject that will be encoded in the JWT
        return ctx.subject("user", {
          userID,
          email,
        })
      }

      // This shouldn't happen, but handle unknown providers
      throw new Error(`Unknown provider: ${value.provider}`)
    },
  })

  /**
   * Add a root route to return server info instead of 404
   */
  app.get("/", (c) => {
    return c.json({
      name: "OpenAuth Server",
      version: "1.0.0",
      status: "healthy",
      storage: "CloudflareKV",
      endpoints: {
        authorize: "/authorize",
        token: "/token",
        jwks: "/.well-known/jwks.json",
        metadata: "/.well-known/oauth-authorization-server",
      },
      providers: ["code"],
    })
  })

  return app
}

/**
 * Cloudflare Workers entry point
 * 
 * We use the standard Workers fetch handler pattern to get access to `env`,
 * which contains the KV namespace binding (OPENAUTH_KV).
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const app = createApp(env)
    return app.fetch(request, env, ctx)
  },
}
