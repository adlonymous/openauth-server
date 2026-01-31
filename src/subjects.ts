import { createSubjects } from "@openauthjs/openauth/subject"
import { object, string, optional } from "valibot"

/**
 * Define the shape of data that will be encoded in your JWTs.
 * 
 * This schema is shared between the issuer (auth server) and all client applications.
 * When a user authenticates, the success callback returns a subject with these properties,
 * which are then encoded into the access token JWT.
 * 
 * You can add more subject types as needed (e.g., "admin", "service", etc.)
 */
export const subjects = createSubjects({
  /**
   * Standard user subject - used for human users authenticating via any provider
   */
  user: object({
    /** Unique user identifier - generated or from your database */
    userID: string(),
    /** User's email address (if available from the auth provider) */
    email: optional(string()),
    /** Solana wallet address (if authenticated via SIWS) */
    walletAddress: optional(string()),
    /** GitHub user ID (if authenticated via GitHub) */
    githubId: optional(string()),
    /** Username/login (GitHub, etc.) */
    username: optional(string()),
    /** Display name */
    name: optional(string()),
    /** Avatar/profile picture URL */
    avatarUrl: optional(string()),
  }),
})
