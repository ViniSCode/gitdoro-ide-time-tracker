import * as vscode from 'vscode';

const TOKEN_KEY = 'gitdoro-api-token';
const API_BASE = 'https://www.gitdoro.com';

export class AuthManager {
  private context: vscode.ExtensionContext;
  private token: string | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Opens the browser to start the Gitdoro auth flow.
   * The web app will redirect back via vscode:// URI scheme with a token.
   */
  async login(): Promise<void> {
    // Use vscode.env.uriScheme to detect the actual IDE (vscode, cursor, antigravity, etc.)
    const uriScheme = vscode.env.uriScheme;
    const authUrl = `${API_BASE}/extension/auth?redirect=${encodeURIComponent(uriScheme)}`;
    await vscode.env.openExternal(vscode.Uri.parse(authUrl));
    vscode.window.showInformationMessage('Gitdoro: Complete sign-in in your browser...');
  }

  /**
   * Called when the browser redirects back with a token via URI handler.
   */
  async handleAuthCallback(token: string): Promise<void> {
    try {
      await this.context.secrets.store(TOKEN_KEY, token);
      this.token = token;
      vscode.window.showInformationMessage('Gitdoro: Successfully signed in!');
      // Trigger a re-initialization
      vscode.commands.executeCommand('gitdoro.showMenu');
    } catch (err) {
      vscode.window.showErrorMessage('Gitdoro: Failed to save auth token.');
    }
  }

  /**
   * Check if user is logged in (has a stored token).
   */
  async isLoggedIn(): Promise<boolean> {
    if (this.token) return true;
    const stored = await this.context.secrets.get(TOKEN_KEY);
    if (stored) {
      this.token = stored;
      return true;
    }
    return false;
  }

  /**
   * Get the current auth token. Returns null if not logged in.
   */
  async getToken(): Promise<string | null> {
    if (this.token) return this.token;
    const stored = await this.context.secrets.get(TOKEN_KEY);
    if (stored) {
      this.token = stored;
    }
    return this.token;
  }

  /**
   * Logout: clear stored token.
   */
  async logout(): Promise<void> {
    await this.context.secrets.delete(TOKEN_KEY);
    this.token = null;
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
