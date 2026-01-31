import { issuer } from "@openauthjs/openauth"
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare"
import { PasswordProvider } from "@openauthjs/openauth/provider/password"
import { GithubProvider } from "@openauthjs/openauth/provider/github"
import { GoogleProvider } from "@openauthjs/openauth/provider/google"
import { PasswordUI } from "./ui/password"  // Custom UI with resend on registration
import { subjects } from "./subjects"
import { Resend } from "resend"

/**
 * OpenAuth Issuer - With Password + GitHub + Google OAuth (Chunk 6)
 * 
 * This OpenAuth server configuration uses:
 * - CloudflareStorage: Persistent KV storage for tokens, keys, and password hashes
 * - PasswordProvider: Full email/password authentication with registration, login, and reset
 * - GithubProvider: GitHub OAuth authentication
 * - GoogleOidcProvider: Google OIDC authentication
 * - Resend: Email delivery for verification codes
 * 
 * Required secrets:
 * - RESEND_API_KEY: Your Resend API key
 * - GITHUB_CLIENT_SECRET: Your GitHub OAuth App client secret
 * - GOOGLE_CLIENT_SECRET: Your Google OAuth client secret
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
     * The key (e.g., "password") becomes part of the URL: /password/authorize
     */
    providers: {
      /**
       * Password Provider - full email/password authentication
       * 
       * Features:
       * - User registration with email verification
       * - Login with email/password
       * - Password reset via email code
       * - Secure password hashing (PBKDF2 with 600k iterations)
       * 
       * Codes are logged to console for now. In Chunk 4, we'll use Resend for email.
       */
      password: PasswordProvider(
        PasswordUI({
          /**
           * Called when a user needs to receive a verification code.
           * This is used for:
           * - Email verification during registration
           * - Password reset requests
           * 
           * Uses Resend to deliver emails. Falls back to console.log if RESEND_API_KEY is not set.
           * 
           * @param email - The user's email address
           * @param code - The verification code to send
           */
          sendCode: async (email, code) => {
            // Always log to console for debugging
            console.log("=".repeat(50))
            console.log("VERIFICATION CODE")
            console.log("=".repeat(50))
            console.log("Email:", email)
            console.log("Code:", code)
            console.log("=".repeat(50))

            // Send email via Resend if API key is available
            if (env.RESEND_API_KEY) {
              const resend = new Resend(env.RESEND_API_KEY)
              
              try {
                const result = await resend.emails.send({
                  from: env.EMAIL_FROM,
                  to: email,
                  subject: "Your verification code",
                  html: `
                    <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
                      <h2 style="color: #333; margin-bottom: 20px;">Verification Code</h2>
                      <p style="color: #666; margin-bottom: 20px;">
                        Use the following code to verify your email address:
                      </p>
                      <div style="background: #f4f4f4; padding: 20px; text-align: center; border-radius: 8px; margin-bottom: 20px;">
                        <span style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #333;">
                          ${code}
                        </span>
                      </div>
                      <p style="color: #999; font-size: 14px;">
                        This code expires in 10 minutes. If you didn't request this, you can ignore this email.
                      </p>
                    </div>
                  `,
                })
                
                console.log("Email sent via Resend:", result)
              } catch (error) {
                console.error("Failed to send email via Resend:", error)
                // Don't throw - the user can still see the code in logs during development
              }
            } else {
              console.log("RESEND_API_KEY not set - email not sent")
            }
          },
        })
      ),

      /**
       * GitHub OAuth Provider
       * 
       * Allows users to authenticate with their GitHub account.
       * Requires GITHUB_CLIENT_ID (env var) and GITHUB_CLIENT_SECRET (secret).
       * 
       * Callback URL: https://your-worker.workers.dev/github/callback
       */
      github: GithubProvider({
        clientID: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        scopes: ["read:user", "user:email"],
      }),

      /**
       * Google OAuth Provider
       * 
       * Allows users to authenticate with their Google account.
       * Requires GOOGLE_CLIENT_ID (env var) and GOOGLE_CLIENT_SECRET (secret).
       * 
       * Callback URL: https://your-worker.workers.dev/google/callback
       */
      google: GoogleProvider({
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        scopes: ["openid", "email", "profile"],
      }),
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
     * - Password hashes (stored securely with PBKDF2)
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
      // Handle password provider authentication
      if (value.provider === "password") {
        // value.email contains the authenticated user's email
        const email = value.email

        // In a real app, you'd look up or create the user in your database here
        // For now, we generate a random user ID
        // TODO: In production, look up user by email and return existing userID
        const userID = crypto.randomUUID()

        console.log("User authenticated via password:", { email, userID })

        // Return the subject that will be encoded in the JWT
        return ctx.subject("user", {
          userID,
          email,
        })
      }

      // Handle GitHub OAuth authentication
      if (value.provider === "github") {
        const accessToken = value.tokenset.access

        // Fetch user profile from GitHub API
        const userResponse = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `token ${accessToken}`,
            "User-Agent": "OpenAuth-Server",
            Accept: "application/vnd.github.v3+json",
          },
        })
        
        if (!userResponse.ok) {
          console.error("Failed to fetch GitHub user:", await userResponse.text())
          throw new Error("Failed to fetch GitHub user profile")
        }
        
        const userData = await userResponse.json() as {
          id: number
          login: string
          name: string | null
          email: string | null
          avatar_url: string
        }

        // Fetch user emails to get primary verified email (in case profile email is null/private)
        const emailsResponse = await fetch("https://api.github.com/user/emails", {
          headers: {
            Authorization: `token ${accessToken}`,
            "User-Agent": "OpenAuth-Server",
            Accept: "application/vnd.github.v3+json",
          },
        })

        let primaryEmail = userData.email
        if (emailsResponse.ok) {
          const emails = await emailsResponse.json() as Array<{
            email: string
            primary: boolean
            verified: boolean
          }>
          // Find the primary verified email
          const primary = emails.find((e) => e.primary && e.verified)
          if (primary) {
            primaryEmail = primary.email
          }
        }

        // TODO: In production, look up user by email or githubId in your database
        // to link accounts and return existing userID
        const userID = crypto.randomUUID()

        console.log("User authenticated via GitHub:", {
          userID,
          githubId: userData.id,
          username: userData.login,
          email: primaryEmail,
          name: userData.name,
        })

        // Return the subject that will be encoded in the JWT
        return ctx.subject("user", {
          userID,
          email: primaryEmail || undefined,
          githubId: String(userData.id),
          username: userData.login,
          name: userData.name || undefined,
          avatarUrl: userData.avatar_url,
        })
      }

      // Handle Google OAuth authentication
      if (value.provider === "google") {
        const accessToken = value.tokenset.access

        // Fetch user info from Google API
        const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        })

        if (!userInfoResponse.ok) {
          console.error("Failed to fetch Google user info:", await userInfoResponse.text())
          throw new Error("Failed to fetch Google user profile")
        }

        const userInfo = await userInfoResponse.json() as {
          id: string           // Google user ID
          email?: string
          verified_email?: boolean
          name?: string
          picture?: string
        }

        // TODO: In production, look up user by email or googleId in your database
        // to link accounts and return existing userID
        const userID = crypto.randomUUID()

        console.log("User authenticated via Google:", {
          userID,
          googleId: userInfo.id,
          email: userInfo.email,
          name: userInfo.name,
        })

        // Return the subject that will be encoded in the JWT
        return ctx.subject("user", {
          userID,
          email: userInfo.email,
          googleId: userInfo.id,
          name: userInfo.name,
          avatarUrl: userInfo.picture,
        })
      }

      // This shouldn't happen, but handle unknown providers
      throw new Error(`Unknown provider: ${(value as { provider: string }).provider}`)
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
      providers: ["password", "github", "google"],
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
