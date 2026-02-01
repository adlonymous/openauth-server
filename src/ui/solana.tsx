/**
 * Solana SIWS Wallet Selection UI
 *
 * Renders a wallet selection page that:
 * 1. Loads the bundled wallet client (wallet-client.js)
 * 2. Displays available Solana wallets
 * 3. Handles connection and signing
 * 4. Shows loading/error states
 */
/** @jsxImportSource hono/jsx */

import type { SolanaSignInInput } from "@solana/wallet-standard-features"
import { Layout } from "@openauthjs/openauth/ui/base"

/**
 * Default copy text for the UI
 */
const DEFAULT_COPY = {
  title: "Connect Wallet",
  description: "Sign in with your Solana wallet",
  connecting: "Connecting...",
  no_wallets:
    "No Solana wallets detected. Please install Phantom, Solflare, or Backpack.",
  error_cancelled: "Sign-in was cancelled",
  error_failed: "Authentication failed",
  button_retry: "Try Again",
  back_link: "← Back to login options",
}

type SolanaUICopy = typeof DEFAULT_COPY

/**
 * Configuration options for the Solana UI
 */
export interface SolanaUIOptions {
  /** Override default copy text */
  copy?: Partial<SolanaUICopy>
}

/**
 * Create a Solana wallet selection UI function
 *
 * @example
 * ```typescript
 * import { SolanaUI } from "./ui/solana"
 *
 * const ui = SolanaUI({
 *   copy: { title: "Connect Your Wallet" }
 * })
 * ```
 */
export function SolanaUI(options?: SolanaUIOptions) {
  const copy = {
    ...DEFAULT_COPY,
    ...options?.copy,
  }

  /**
   * Render the wallet selection page
   *
   * @param signInInput - SIWS input to be signed
   * @param callbackUrl - URL to POST signed message to
   * @param redirectUrl - URL to redirect after success
   */
  return async (
    signInInput: SolanaSignInInput,
    callbackUrl: string,
    redirectUrl: string
  ): Promise<Response> => {
    // Config to inject into the page
    const config = {
      signInInput,
      callbackUrl,
      redirectUrl,
    }

    const jsx = (
      <Layout>
        <div data-component="form">
          {/* Header */}
          <h2
            style={{
              marginBottom: "8px",
              fontSize: "18px",
              fontWeight: "600",
            }}
          >
            {copy.title}
          </h2>
          <p
            style={{
              color: "#666",
              marginBottom: "24px",
              fontSize: "14px",
            }}
          >
            {copy.description}
          </p>

          {/* Wallet list - populated by JavaScript */}
          <div
            id="wallet-list"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div
              style={{
                textAlign: "center",
                padding: "20px",
                color: "#666",
              }}
            >
              Loading wallets...
            </div>
          </div>

          {/* Error container - hidden by default */}
          <div
            id="error-container"
            style={{
              display: "none",
              marginTop: "16px",
            }}
          >
            <div
              data-component="alert"
              id="error-message"
              style={{
                padding: "12px",
                backgroundColor: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "6px",
                color: "#dc2626",
                fontSize: "14px",
              }}
            ></div>
            <button
              data-component="button"
              id="retry-button"
              style={{ marginTop: "12px", width: "100%" }}
            >
              {copy.button_retry}
            </button>
          </div>

          {/* Back link */}
          <div data-component="form-footer" style={{ marginTop: "24px" }}>
            <a data-component="link" href="../authorize">
              {copy.back_link}
            </a>
          </div>
        </div>

        {/* Inject config for wallet client */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__SIWS_CONFIG__ = ${JSON.stringify(config)};`,
          }}
        />

        {/* Load bundled wallet client */}
        <script src="/wallet-client.js"></script>

        {/* UI Logic */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function() {
  var copy = ${JSON.stringify(copy)};
  var walletListEl = document.getElementById('wallet-list');
  var errorContainerEl = document.getElementById('error-container');
  var errorMessageEl = document.getElementById('error-message');
  var retryButtonEl = document.getElementById('retry-button');
  
  // Render wallet buttons
  function renderWallets(wallets) {
    if (!wallets || wallets.length === 0) {
      walletListEl.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">' + copy.no_wallets + '</div>';
      return;
    }
    
    walletListEl.innerHTML = wallets.map(function(wallet) {
      return '<button ' +
        'data-component="button" ' +
        'data-wallet="' + escapeHtml(wallet.name) + '" ' +
        'style="display: flex; align-items: center; gap: 12px; justify-content: flex-start; width: 100%; padding: 12px 16px;"' +
      '>' +
        '<img src="' + escapeHtml(wallet.icon) + '" alt="" style="width: 28px; height: 28px; border-radius: 6px;" onerror="this.style.display=\\'none\\'" />' +
        '<span style="font-size: 15px;">' + escapeHtml(wallet.name) + '</span>' +
      '</button>';
    }).join('');
    
    // Add click handlers
    var buttons = walletListEl.querySelectorAll('[data-wallet]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', handleWalletClick);
    }
  }
  
  // Escape HTML to prevent XSS
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  
  // Show error message
  function showError(message) {
    errorContainerEl.style.display = 'block';
    errorMessageEl.textContent = message;
  }
  
  // Hide error message
  function hideError() {
    errorContainerEl.style.display = 'none';
  }
  
  // Handle wallet button click
  async function handleWalletClick(e) {
    var button = e.currentTarget;
    var walletName = button.dataset.wallet;
    var originalHtml = button.innerHTML;
    
    // Disable all buttons
    var allButtons = walletListEl.querySelectorAll('button');
    for (var i = 0; i < allButtons.length; i++) {
      allButtons[i].disabled = true;
    }
    
    // Show connecting state
    button.innerHTML = '<span style="font-size: 15px;">' + copy.connecting + '</span>';
    hideError();
    
    try {
      var result = await window.__SIWS_CLIENT__.connectAndSign(walletName);
      
      if (result.success) {
        // Redirect on success
        window.location.href = result.redirectUrl;
      } else {
        // Show error
        showError(result.error || copy.error_failed);
        
        // Re-enable buttons
        for (var i = 0; i < allButtons.length; i++) {
          allButtons[i].disabled = false;
        }
        button.innerHTML = originalHtml;
      }
    } catch (error) {
      showError(error.message || copy.error_failed);
      
      // Re-enable buttons
      for (var i = 0; i < allButtons.length; i++) {
        allButtons[i].disabled = false;
      }
      button.innerHTML = originalHtml;
    }
  }
  
  // Retry button handler
  retryButtonEl.addEventListener('click', function() {
    window.location.reload();
  });
  
  // Wait for wallet client to be ready
  window.addEventListener('siws:ready', function(e) {
    var wallets = e.detail.wallets;
    renderWallets(wallets);
    
    // Also subscribe to changes (in case wallets load later)
    if (window.__SIWS_CLIENT__) {
      window.__SIWS_CLIENT__.onWalletsChange(renderWallets);
    }
  });
  
  // Handle case where client is already ready
  if (window.__SIWS_CLIENT__) {
    renderWallets(window.__SIWS_CLIENT__.getWallets());
  }
})();
            `,
          }}
        />
      </Layout>
    )

    return new Response(jsx.toString(), {
      headers: {
        "Content-Type": "text/html",
      },
    })
  }
}
