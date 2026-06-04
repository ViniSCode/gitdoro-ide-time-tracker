import * as vscode from 'vscode';

const TOKEN_KEY = 'gitdoro-api-token';
const TOKEN_FALLBACK_KEY = 'gitdoro-api-token-fallback';
const API_BASE = 'https://www.gitdoro.com';
const AUTH_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

export class AuthManager {
  private context: vscode.ExtensionContext;
  private token: string | null = null;
  private awaitingAuth: boolean = false;
  private authTimeoutHandle: NodeJS.Timeout | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Opens the browser to start the Gitdoro auth flow.
   * Shows a follow-up message with manual token option if deep link fails.
   */
  async login(): Promise<void> {
    // Deduplicate: don't open a second browser window if already waiting
    if (this.awaitingAuth) {
      const action = await vscode.window.showInformationMessage(
        'Gitdoro is already waiting for login. Didn\'t work?',
        'Try Again',
        'Enter Token Manually'
      );
      if (action === 'Try Again') {
        this.awaitingAuth = false;
        await this.login();
      } else if (action === 'Enter Token Manually') {
        await this.promptManualToken();
      }
      return;
    }

    this.awaitingAuth = true;

    // Auto-clear awaiting state after timeout
    if (this.authTimeoutHandle) clearTimeout(this.authTimeoutHandle);
    this.authTimeoutHandle = setTimeout(() => {
      this.awaitingAuth = false;
      this.authTimeoutHandle = null;
    }, AUTH_TIMEOUT_MS);

    const uriScheme = vscode.env.uriScheme;
    const extId = this.context.extension.id;
    const authUrl = `${API_BASE}/extension/auth?redirect=${encodeURIComponent(uriScheme)}&extId=${encodeURIComponent(extId)}`;
    
    await vscode.env.openExternal(vscode.Uri.parse(authUrl));

    // Use withProgress to show a non-blocking "waiting" state
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Gitdoro: Waiting for authentication...",
      cancellable: true
    }, async (progress, token) => {
      token.onCancellationRequested(() => {
        this.awaitingAuth = false;
        if (this.authTimeoutHandle) {
          clearTimeout(this.authTimeoutHandle);
          this.authTimeoutHandle = null;
        }
      });

      // Poll or wait for this.awaitingAuth to become false
      while (this.awaitingAuth && !token.isCancellationRequested) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    });
  }

  /**
   * Prompt the user to paste a token manually.
   */
  async promptManualToken(): Promise<boolean> {
    const token = await vscode.window.showInputBox({
      prompt: 'Paste your Gitdoro token from the browser',
      placeHolder: 'Paste token here...',
      password: true,
      ignoreFocusOut: true,
      validateInput: (text) => {
        return text.trim().length > 0 ? null : 'Token cannot be empty';
      }
    });

    if (!token) {
      this.awaitingAuth = false;
      return false;
    }

    return this.handleAuthCallback(token.trim());
  }

  /**
   * Validates the token before storing it.
   */
  async handleAuthCallback(token: string): Promise<boolean> {
    this.awaitingAuth = false;
    if (this.authTimeoutHandle) {
      clearTimeout(this.authTimeoutHandle);
      this.authTimeoutHandle = null;
    }

    // Step 1: Validate the token with a real API call
    try {
      const response = await fetch(`${API_BASE}/api/extension/auth/validate`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        vscode.window.showErrorMessage(
          `Gitdoro: ${errorData.error || 'Token is invalid or expired. Please try logging in again.'}`
        );
        return false;
      }
    } catch (err) {
      console.warn('Gitdoro: Could not validate token (network error), storing anyway:', err);
    }

    // Step 2: Store the token with fallback
    const stored = await this.storeToken(token);
    if (!stored) {
      vscode.window.showErrorMessage(
        'Gitdoro: Failed to save token. Please try again or restart your editor.'
      );
      return false;
    }

    this.token = token;
    vscode.window.showInformationMessage('Gitdoro: Successfully signed in! ✓');
    
    // Trigger initialization
    await vscode.commands.executeCommand('gitdoro.initialize');
    
    return true;
  }

  /**
   * Store token in secrets with globalState fallback.
   */
  private async storeToken(token: string): Promise<boolean> {
    try {
      await this.context.secrets.store(TOKEN_KEY, token);
      const readback = await this.context.secrets.get(TOKEN_KEY);
      if (readback === token) {
        await this.context.globalState.update(TOKEN_FALLBACK_KEY, undefined);
        return true;
      }
    } catch (err) {
      console.warn('Gitdoro: Secrets storage failed, using fallback:', err);
    }

    try {
      await this.context.globalState.update(TOKEN_FALLBACK_KEY, token);
      return true;
    } catch (err) {
      console.error('Gitdoro: All storage methods failed:', err);
      return false;
    }
  }

  /**
   * Retrieve the token from secrets or globalState fallback.
   */
  private async retrieveToken(): Promise<string | null> {
    try {
      const secretToken = await this.context.secrets.get(TOKEN_KEY);
      if (secretToken) return secretToken;
    } catch (err) {
      console.warn('Gitdoro: Secrets read failed:', err);
    }

    const fallbackToken = this.context.globalState.get<string>(TOKEN_FALLBACK_KEY);
    if (fallbackToken) return fallbackToken;

    return null;
  }

  /**
   * Check if user is logged in.
   */
  async isLoggedIn(): Promise<boolean> {
    if (this.token) return true;
    const stored = await this.retrieveToken();
    if (stored) {
      this.token = stored;
      return true;
    }
    return false;
  }

  /**
   * Get the current auth token.
   */
  async getToken(): Promise<string | null> {
    if (this.token) return this.token;
    const stored = await this.retrieveToken();
    if (stored) {
      this.token = stored;
    }
    return this.token;
  }

  /**
   * Logout: clear all stored tokens.
   */
  async logout(): Promise<void> {
    try { await this.context.secrets.delete(TOKEN_KEY); } catch {}
    try { await this.context.globalState.update(TOKEN_FALLBACK_KEY, undefined); } catch {}
    this.token = null;
    this.awaitingAuth = false;
    if (this.authTimeoutHandle) {
      clearTimeout(this.authTimeoutHandle);
      this.authTimeoutHandle = null;
    }
    vscode.window.showInformationMessage('Gitdoro: Signed out.');
  }

  /**
   * Make an authenticated request to the Gitdoro API.
   */
  async apiRequest(path: string, options: { method?: string; body?: any } = {}): Promise<any> {
    const token = await this.getToken();
    if (!token) {
      vscode.window.showWarningMessage('Gitdoro: Please sign in first.');
      return null;
    }

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });

      if (response.status === 401) {
        await this.logout();
        vscode.window.showWarningMessage('Gitdoro: Session expired. Please sign in again.');
        return null;
      }

      return await response.json();
    } catch (err) {
      console.error('Gitdoro API request failed:', err);
      return null;
    }
  }
}
