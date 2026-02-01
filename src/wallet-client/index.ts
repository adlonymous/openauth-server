/**
 * SIWS Wallet Client - Browser Bundle
 *
 * Uses Solana ConnectorKit to:
 * 1. Detect available Solana wallets
 * 2. Connect to selected wallet
 * 3. Perform SIWS signing (signIn or signMessage fallback)
 * 4. POST result to callback endpoint
 *
 * This file is bundled with esbuild for browser use.
 * Run: node src/wallet-client/build.mjs
 */

import {
  ConnectorClient,
  getDefaultConfig,
  createConnectorId,
  type WalletConnectorMetadata,
} from "@solana/connector/headless"
import type {
  SolanaSignInInput,
  SolanaSignInOutput,
} from "@solana/wallet-standard-features"
import { createSignInMessageText } from "@solana/wallet-standard-util"

// ============================================================================
// Types
// ============================================================================

/** Config injected by server into window.__SIWS_CONFIG__ */
interface SIWSConfig {
  signInInput: SolanaSignInInput
  callbackUrl: string
  redirectUrl: string
}

/** Result returned from connectAndSign */
export interface SIWSResult {
  success: boolean
  redirectUrl?: string
  error?: string
}

/** Curated list of supported wallets */
const SUPPORTED_WALLETS = ["Phantom", "Solflare", "Backpack"]

/** Connection timeout in milliseconds */
const CONNECTION_TIMEOUT_MS = 30000

// Global config from server
declare global {
  interface Window {
    __SIWS_CONFIG__?: SIWSConfig
    __SIWS_CLIENT__?: SIWSWalletClient
  }
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Create a promise that rejects after a timeout
 */
function createTimeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms)
  })
}

/**
 * Race a promise against a timeout
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([promise, createTimeout(ms, message)])
}

// ============================================================================
// Wallet Client
// ============================================================================

class SIWSWalletClient {
  private client: ConnectorClient
  private config: SIWSConfig

  constructor(config: SIWSConfig) {
    this.config = config
    this.client = new ConnectorClient(
      getDefaultConfig({
        appName: "OpenAuth",
        autoConnect: false,
        enableMobile: false, // Deferred to future chunk
        wallets: {
          // Only show curated wallets
          allowList: SUPPORTED_WALLETS,
        },
      })
    )
  }

  /**
   * Get list of available wallets (filtered to supported list)
   */
  getWallets(): WalletConnectorMetadata[] {
    const allWallets = this.client.getSnapshot().connectors
    return allWallets.filter((w) =>
      SUPPORTED_WALLETS.some((name) =>
        w.name.toLowerCase().includes(name.toLowerCase())
      )
    )
  }

  /**
   * Subscribe to wallet list changes
   * @returns Unsubscribe function
   */
  onWalletsChange(
    callback: (wallets: WalletConnectorMetadata[]) => void
  ): () => void {
    return this.client.subscribe((state) => {
      const filtered = state.connectors.filter((w) =>
        SUPPORTED_WALLETS.some((name) =>
          w.name.toLowerCase().includes(name.toLowerCase())
        )
      )
      callback(filtered)
    })
  }

  /**
   * Connect to wallet and perform SIWS signing
   * @param walletName - Name of wallet to connect (e.g., "Phantom")
   * @returns Result object with success status
   */
  async connectAndSign(walletName: string): Promise<SIWSResult> {
    try {
      // 1. Connect to wallet with timeout
      await withTimeout(
        this.client.connectWallet(createConnectorId(walletName)),
        CONNECTION_TIMEOUT_MS,
        "Connection timed out. Please try again."
      )

      const state = this.client.getSnapshot()
      
      // Check if we're connected (session only exists when status is 'connected')
      if (state.wallet.status !== "connected") {
        return { success: false, error: "Failed to connect wallet" }
      }

      const session = state.wallet.session
      const sessionAccount = session.selectedAccount
      
      // Get the underlying wallet object for accessing features
      const wallet = this.client.getConnector(session.connectorId)
      if (!wallet) {
        return { success: false, error: "Wallet not found" }
      }
      
      // Get the WalletAccount for signing (has publicKey, address, etc.)
      const account = sessionAccount.account

      // 2. Perform SIWS signing with timeout
      let output: SolanaSignInOutput

      // Try native signIn first (Phantom, Solflare, Backpack support this)
      if (wallet.features["solana:signIn"]) {
        const signInFeature = wallet.features["solana:signIn"] as {
          // signIn takes multiple inputs and returns an array of outputs
          signIn: (...inputs: readonly SolanaSignInInput[]) => Promise<readonly SolanaSignInOutput[]>
        }

        const outputs = await withTimeout(
          signInFeature.signIn(this.config.signInInput),
          CONNECTION_TIMEOUT_MS,
          "Sign-in timed out. Please try again."
        )
        
        // Get the first (and only) output
        if (!outputs || outputs.length === 0) {
          return { success: false, error: "Wallet returned no sign-in result" }
        }
        output = outputs[0]
      }
      // Fallback to signMessage
      else if (wallet.features["solana:signMessage"]) {
        const signMessageFeature = wallet.features["solana:signMessage"] as {
          signMessage: (input: {
            message: Uint8Array
            account: typeof account
          }) => Promise<{ signature: Uint8Array }>
        }

        // Construct SIWS message text manually
        const messageText = createSignInMessageText({
          ...this.config.signInInput,
          domain: this.config.signInInput.domain!,
          address: account.address,
        })
        const messageBytes = new TextEncoder().encode(messageText)

        const { signature } = await withTimeout(
          signMessageFeature.signMessage({
            message: messageBytes,
            account,
          }),
          CONNECTION_TIMEOUT_MS,
          "Signing timed out. Please try again."
        )

        output = {
          account,
          signature,
          signedMessage: messageBytes,
        }
      } else {
        return { success: false, error: "Wallet does not support signing" }
      }

      // 3. POST to callback endpoint
      const response = await fetch(this.config.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: output.account.address,
          publicKey: Array.from(output.account.publicKey),
          signature: Array.from(output.signature),
          signedMessage: Array.from(output.signedMessage),
        }),
      })

      // Parse the response
      const responseData = (await response.json().catch(() => ({}))) as {
        success?: boolean
        redirectUrl?: string
        error?: string
      }

      if (!response.ok || !responseData.success) {
        return {
          success: false,
          error: responseData.error || `Verification failed (${response.status})`,
        }
      }

      // 4. Return success with redirect URL from server (includes auth code)
      return {
        success: true,
        redirectUrl: responseData.redirectUrl,
      }
    } catch (error) {
      // Handle user rejection
      const errorMessage =
        error instanceof Error ? error.message : String(error)

      if (
        errorMessage.includes("rejected") ||
        errorMessage.includes("cancelled") ||
        errorMessage.includes("denied") ||
        errorMessage.includes("User rejected")
      ) {
        return { success: false, error: "Sign-in was cancelled" }
      }

      // Handle timeout
      if (errorMessage.includes("timed out")) {
        return { success: false, error: errorMessage }
      }

      return { success: false, error: errorMessage }
    }
  }

  /**
   * Disconnect current wallet
   */
  async disconnect(): Promise<void> {
    try {
      await this.client.disconnectWallet()
    } catch {
      // Ignore disconnect errors
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.client.destroy()
  }
}

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  const config = window.__SIWS_CONFIG__

  if (!config) {
    console.error("[SIWS] Config not found on window.__SIWS_CONFIG__")
    return
  }

  // Create and expose client
  const client = new SIWSWalletClient(config)
  window.__SIWS_CLIENT__ = client

  // Dispatch ready event for UI to listen to
  window.dispatchEvent(
    new CustomEvent("siws:ready", {
      detail: { wallets: client.getWallets() },
    })
  )
})
