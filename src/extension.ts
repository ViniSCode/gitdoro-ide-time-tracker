import * as vscode from 'vscode';
import { AuthManager } from './auth';
import { ProjectManager } from './projectManager';
import { StatusBarManager } from './statusbar';
import { Tracker } from './tracker';

let authManager: AuthManager;
let statusBar: StatusBarManager;
let projectManager: ProjectManager;
let tracker: Tracker;

const UTM_BASE = 'utm_source=vscode&utm_medium=extension';

export function activate(context: vscode.ExtensionContext) {
  console.log('Gitdoro extension activating...');

  // Initialize core modules
  authManager = new AuthManager(context);
  statusBar = new StatusBarManager();
  projectManager = new ProjectManager(authManager);
  tracker = new Tracker(authManager, projectManager, statusBar);

  // ── Welcome notification (one-time, after first install) ──
  const WELCOME_SHOWN_KEY = 'gitdoro-welcome-shown';
  const welcomeShown = context.globalState.get<boolean>(WELCOME_SHOWN_KEY);
  if (!welcomeShown) {
    showWelcomeNotification(context, WELCOME_SHOWN_KEY);
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('gitdoro.login', () => authManager.login()),
    vscode.commands.registerCommand('gitdoro.startTimer', () => tracker.start()),
    vscode.commands.registerCommand('gitdoro.pauseTimer', () => tracker.pause()),
    vscode.commands.registerCommand('gitdoro.stopTimer', () => tracker.stop()),
    vscode.commands.registerCommand('gitdoro.toggleAction', async () => {
      const isLoggedIn = await authManager.isLoggedIn();
      if (!isLoggedIn) return;
      if (tracker.isRunning() || tracker.isPaused()) {
        await tracker.stop();
      } else {
        await tracker.start();
      }
    }),
    vscode.commands.registerCommand('gitdoro.openDashboard', () => {
      vscode.env.openExternal(vscode.Uri.parse(
        `https://www.gitdoro.com/dashboard?${UTM_BASE}&utm_campaign=dashboard`
      ));
    }),

    // Manual token entry — fallback when deep link doesn't work
    vscode.commands.registerCommand('gitdoro.enterToken', async () => {
      await authManager.promptManualToken();
    }),

    // Internal initialization command
    vscode.commands.registerCommand('gitdoro.initialize', async () => {
      await initializeExtension();
    }),
  );

  // Handle URI callbacks (deep link from browser auth)
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri: vscode.Uri) {
        console.log('Gitdoro: URI handler received:', uri.toString());

        if (uri.path === '/auth') {
          const params = new URLSearchParams(uri.query);
          const token = params.get('token');
          if (token) {
            await authManager.handleAuthCallback(token);
          } else {
            console.error('Gitdoro: URI handler received auth callback without token');
            vscode.window.showErrorMessage('Gitdoro: Auth callback received but no token was included.');
          }
        }
      }
    })
  );

  // Status bar click → quick pick menu
  context.subscriptions.push(
    vscode.commands.registerCommand('gitdoro.showMenu', async () => {
      const isLoggedIn = await authManager.isLoggedIn();
      if (!isLoggedIn) {
        const choice = await vscode.window.showQuickPick(
          [
            { label: '🔑 Login to Gitdoro', description: 'Opens browser to sign in' },
            { label: '📋 Enter Token Manually', description: 'Paste a token from the website' },
          ],
          { placeHolder: 'Gitdoro — Not signed in' }
        );
        if (choice?.label.includes('Login')) {
          await authManager.login();
        } else if (choice?.label.includes('Token')) {
          await authManager.promptManualToken();
        }
        return;
      }

      const isRunning = tracker.isRunning();
      const isPaused = tracker.isPaused();
      const items: vscode.QuickPickItem[] = [];

      if (isRunning) {
        items.push({ label: '⏸ Pause Timer' }, { label: '⏹ Stop Timer' });
      } else if (isPaused) {
        items.push({ label: '▶ Resume Timer' }, { label: '⏹ Stop Timer' });
      } else {
        items.push({ label: '▶ Start Timer' });
      }

      items.push({ label: '📊 View Reports' });

      const config = vscode.workspace.getConfiguration('gitdoro');
      const autoTrack = config.get<boolean>('autoTrack', false);
      const pauseOnBlur = config.get<boolean>('pauseOnBlur', true);

      items.push({
        label: autoTrack ? '✅ Disable Auto Track' : '⬛ Enable Auto Track',
        description: 'Automatically starts the timer when VS Code is focused'
      });

      items.push({
        label: pauseOnBlur ? '✅ Disable Focus Toggle' : '⬛ Enable Focus Toggle',
        description: 'Automatically pauses the timer when VS Code loses focus'
      });

      items.push({ label: '🔓 Logout' });

      const choice = await vscode.window.showQuickPick(items, {
        placeHolder: `Gitdoro — ${projectManager.getCurrentProjectName() || 'No project detected'}`
      });

      if (!choice) return;
      const label = choice.label;

      if (label.includes('Start') || label.includes('Resume')) await tracker.start();
      else if (label.includes('Pause Timer')) await tracker.pause();
      else if (label.includes('Stop')) await tracker.stop();
      else if (label.includes('Reports')) {
        vscode.env.openExternal(vscode.Uri.parse(
          `https://www.gitdoro.com/dashboard/reports?${UTM_BASE}&utm_campaign=reports`
        ));
      }
      else if (label.includes('Auto Track')) {
        await config.update('autoTrack', !autoTrack, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Gitdoro: Auto Track ${!autoTrack ? 'enabled' : 'disabled'}.`);
        if (!autoTrack && vscode.window.state.focused) {
          tracker.onWindowFocused();
        }
      }
      else if (label.includes('Focus Toggle')) {
        await config.update('pauseOnBlur', !pauseOnBlur, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Gitdoro: Focus Toggle ${!pauseOnBlur ? 'enabled' : 'disabled'}.`);
      }
      else if (label.includes('Logout')) {
        await tracker.stop();
        await authManager.logout();
        statusBar.update('logged-out', null);
      }
    })
  );

  context.subscriptions.push(statusBar.getStatusBarItem());
  context.subscriptions.push(statusBar.getActionItem());

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => projectManager.detectProject())
  );

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((e) => {
      if (!tracker.isAutoTrackEnabled()) return;
      if (e.focused) {
        tracker.onWindowFocused();
      } else {
        tracker.onWindowBlurred();
      }
    })
  );

  initializeExtension();
}

async function initializeExtension() {
  const isLoggedIn = await authManager.isLoggedIn();
  if (isLoggedIn) {
    await projectManager.detectProject();
    statusBar.update('idle', projectManager.getCurrentProjectName());
    if (tracker.isAutoTrackEnabled() && vscode.window.state.focused) {
      tracker.onWindowFocused();
    }
  } else {
    statusBar.update('logged-out', null);
  }
}

async function showWelcomeNotification(context: vscode.ExtensionContext, key: string) {
  const action = await vscode.window.showInformationMessage(
    '⚡ Gitdoro installed! Track focus sessions with GitHub-style heatmaps and dev reports — 100% free.',
    'Create Free Account',
    'Learn More'
  );

  if (action === 'Create Free Account') {
    vscode.env.openExternal(vscode.Uri.parse(
      `https://gitdoro.com/login?${UTM_BASE}&utm_campaign=welcome`
    ));
  } else if (action === 'Learn More') {
    vscode.env.openExternal(vscode.Uri.parse(
      `https://gitdoro.com?${UTM_BASE}&utm_campaign=welcome`
    ));
  }

  await context.globalState.update(key, true);
}

export async function deactivate() {
  if (tracker && (tracker.isRunning() || tracker.isPaused())) {
    await tracker.stop();
  }
}
