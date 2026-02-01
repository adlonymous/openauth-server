/**
 * Solana SIWS (Sign In With Solana) Provider
 *
 * Implements the Phantom SIWS standard (EIP-4361 style) for Solana wallet authentication.
 *
 * Flow:
 * 1. GET /solana/authorize - Generate SolanaSignInInput, store nonce in KV, render UI
 * 2. POST /solana/callback - Verify signature, complete authentication
 *
 * References:
 * - Phantom SIWS: https://github.com/phantom/sign-in-with-solana
 * - Supabase Auth SIWS: https://github.com/supabase/auth
 */

import type { Provider } from "@openauthjs/openauth/provider/provider"
import { Storage } from "@openauthjs/openauth/storage/storage"
import type {
  SolanaSignInInput,
  SolanaSignInOutput,
} from "@solana/wallet-standard-features"
import { verifySignIn, parseSignInMessage } from "@solana/wallet-standard-util"

/**
 * Configuration options for the Solana SIWS provider
 */
export interface SolanaProviderConfig {
  /**
   * Function to render the wallet connection UI
   *
   * @param signInInput - The SIWS input to be signed by the wallet
   * @param callbackUrl - URL to POST the signed message to
   * @param redirectUrl - URL to redirect after successful authentication
   */
  ui: (
    signInInput: SolanaSignInInput,
    callbackUrl: string,
    redirectUrl: string
  ) => Response | Promise<Response>

  /**
   * Statement shown in the SIWS message
   * @default "Sign in with your Solana wallet"
   */
  statement?: string

  /**
   * Chain ID for the Solana network
   * Can also be set via SOLANA_CHAIN_ID environment variable
   * @default "mainnet"
   */
  chainId?: "mainnet" | "devnet" | "testnet"

  /**
   * Nonce expiry time in seconds
   * @default 600 (10 minutes)
   */
  nonceExpiry?: number
}

/**
 * Generate a random alphanumeric nonce
 *
 * Per Phantom SIWS spec: minimum 8 alphanumeric characters
 * We use 16 characters for additional security
 */
function generateNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let nonce = ""
  for (let i = 0; i < 16; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return nonce
}

/**
 * Create a Solana SIWS (Sign In With Solana) provider for OpenAuth
 *
 * This provider implements the Phantom SIWS standard, which is based on
 * EIP-4361 (Sign In With Ethereum) adapted for Solana.
 *
 * @example
 * ```typescript
 * import { SolanaProvider } from "./providers/solana"
 * import { SolanaUI } from "./ui/solana"
 *
 * const app = issuer({
 *   providers: {
 *     solana: SolanaProvider({
 *       ui: SolanaUI(),
 *       statement: "Sign in to MyApp",
 *       chainId: "mainnet",
 *     }),
 *   },
 *   // ... other config
 * })
 * ```
 */
export function SolanaProvider(
  config: SolanaProviderConfig
): Provider<{ address: string }> {
  const nonceExpiry = config.nonceExpiry ?? 600 // 10 minutes default

  return {
    type: "solana",

    init(routes, ctx) {
      /**
       * GET /solana/authorize
       *
       * Initiates the SIWS authentication flow:
       * 1. Generates a unique nonce
       * 2. Creates SolanaSignInInput matching Phantom/EIP-4361 spec
       * 3. Stores nonce in KV with TTL for replay prevention
       * 4. Stores signInInput in encrypted cookie
       * 5. Renders the wallet connection UI
       */
      routes.get("/authorize", async (c) => {
        const url = new URL(c.req.url)
        const nonce = generateNonce()
        const now = new Date()
        const expirationTime = new Date(now.getTime() + nonceExpiry * 1000)

        // Get chainId from config or environment variable
        const env = c.env as { SOLANA_CHAIN_ID?: string }
        const chainId =
          config.chainId ??
          (env.SOLANA_CHAIN_ID as "mainnet" | "devnet" | "testnet") ??
          "mainnet"

        // Create SolanaSignInInput matching Phantom/EIP-4361 spec
        // See: https://github.com/phantom/sign-in-with-solana#sign-in-input-fields
        const signInInput: SolanaSignInInput = {
          // Required fields (wallet will use these if not provided, but we provide them)
          domain: url.host,
          // Optional fields
          statement: config.statement ?? "Sign in with your Solana wallet",
          uri: url.origin,
          version: "1",
          chainId,
          nonce,
          issuedAt: now.toISOString(),
          expirationTime: expirationTime.toISOString(),
        }

        // Store nonce in KV with TTL for replay prevention
        // Key format: ["solana", "nonce", "<nonce-value>"]
        // TTL is in seconds
        await Storage.set(
          ctx.storage,
          ["solana", "nonce", nonce],
          { issuedAt: signInInput.issuedAt },
          nonceExpiry
        )

        // Store signInInput in encrypted cookie for callback verification
        await ctx.set(c, "provider", nonceExpiry, signInInput)

        // Build callback URL for the wallet client to POST to
        const callbackUrl = `${url.origin}/solana/callback`

        // Get redirect URL from OAuth flow query params
        const redirectUrl = c.req.query("redirect_uri") ?? url.origin

        // Render the wallet connection UI
        return ctx.forward(
          c,
          await config.ui(signInInput, callbackUrl, redirectUrl)
        )
      })

      /**
       * POST /solana/callback
       *
       * Handles the callback from the wallet client after signing:
       * 1. Parses the signed message and signature from request body
       * 2. Retrieves and validates the stored nonce
       * 3. Verifies the signature using @solana/wallet-standard-util
       * 4. Validates domain and expiration time
       * 5. Calls ctx.success() to complete authentication
       *
       * Expected request body:
       * {
       *   address: string,           // Base58 wallet address
       *   publicKey: number[],       // Uint8Array as number array
       *   signature: number[],       // Uint8Array as number array
       *   signedMessage: number[],   // Uint8Array as number array
       * }
       */
      routes.post("/callback", async (c) => {
        try {
          // 1. Parse JSON body
          const body = (await c.req.json()) as {
            address: string
            publicKey: number[]
            signature: number[]
            signedMessage: number[]
          }

          console.log("SIWS callback received:", {
            address: body.address,
            hasPublicKey: !!body.publicKey,
            hasSignature: !!body.signature,
            hasSignedMessage: !!body.signedMessage,
          })

          // Validate required fields
          if (
            !body.address ||
            !body.publicKey ||
            !body.signature ||
            !body.signedMessage
          ) {
            return c.json({ error: "Missing required fields" }, 400)
          }

          // 2. Get signInInput from encrypted cookie
          const input = await ctx.get<SolanaSignInInput>(c, "provider")
          if (!input) {
            return c.json(
              { error: "Session expired. Please try again." },
              400
            )
          }

          // 3. Verify nonce exists in KV (prevents replay attacks)
          const storedNonce = await Storage.get(ctx.storage, [
            "solana",
            "nonce",
            input.nonce!,
          ])
          if (!storedNonce) {
            return c.json({ error: "Invalid or expired nonce" }, 400)
          }

          // Delete nonce immediately to prevent replay
          await Storage.remove(ctx.storage, ["solana", "nonce", input.nonce!])

          // 4. Reconstruct SolanaSignInOutput from JSON body
          const output: SolanaSignInOutput = {
            account: {
              address: body.address,
              publicKey: new Uint8Array(body.publicKey),
              chains: [`solana:${input.chainId ?? "mainnet"}`],
              features: [],
            },
            signature: new Uint8Array(body.signature),
            signedMessage: new Uint8Array(body.signedMessage),
          }

          // 5. Verify signature using wallet-standard-util
          // This parses the signed message, compares fields, and verifies the Ed25519 signature
          if (!verifySignIn(input, output)) {
            console.error("SIWS signature verification failed", {
              address: body.address,
              inputDomain: input.domain,
              inputNonce: input.nonce,
            })
            return c.json({ error: "Signature verification failed" }, 401)
          }

          // 6. Additional validations (like Supabase Auth does)
          const parsed = parseSignInMessage(output.signedMessage)
          if (!parsed) {
            return c.json({ error: "Invalid message format" }, 400)
          }

          // Verify domain matches the request host
          const expectedDomain = new URL(c.req.url).host
          if (parsed.domain !== expectedDomain) {
            console.error("SIWS domain mismatch", {
              expected: expectedDomain,
              received: parsed.domain,
            })
            return c.json({ error: "Domain mismatch" }, 401)
          }

          // Check expiration time hasn't passed
          if (
            parsed.expirationTime &&
            new Date(parsed.expirationTime) < new Date()
          ) {
            return c.json({ error: "Message expired" }, 401)
          }

          // Check notBefore time if present
          if (parsed.notBefore && new Date(parsed.notBefore) > new Date()) {
            return c.json({ error: "Message not yet valid" }, 401)
          }

          // 7. Success! Complete the authentication
          console.log("SIWS authentication successful", {
            address: body.address,
            domain: parsed.domain,
          })

          // ctx.success() returns a redirect Response
          // We need to extract the redirect URL and return it as JSON
          // so the client-side JavaScript can do the redirect
          const successResponse = await ctx.success(c, { address: body.address })
          
          console.log("Success response status:", successResponse.status)
          console.log("Success response headers:", Object.fromEntries(successResponse.headers.entries()))
          
          // Get the redirect URL from the Location header
          const redirectUrl = successResponse.headers.get("Location")
          
          if (redirectUrl) {
            console.log("Returning redirect URL:", redirectUrl)
            return c.json({ success: true, redirectUrl })
          }
          
          console.log("No Location header, returning original response")
          // Fallback: if no redirect, return the response as-is
          return successResponse
        } catch (error) {
          console.error("SIWS callback error:", error)
          return c.json({ error: "Authentication failed" }, 500)
        }
      })
    },
  }
}
