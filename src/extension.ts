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
    })
  );

  // Handle URI callbacks (deep link from browser auth)
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        if (uri.path === '/auth') {
          const token = new URLSearchParams(uri.query).get('token');
          if (token) {
            authManager.handleAuthCallback(token).then(() => {
              // Re-init after login
              initializeExtension();
            });
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
          ['🔑 Login to Gitdoro'],
          { placeHolder: 'Gitdoro — Not signed in' }
        );
        if (choice) await authManager.login();
        return;
      }

      const isRunning = tracker.isRunning();
      const isPaused = tracker.isPaused();
      const items: string[] = [];

      if (isRunning) {
        items.push('⏸ Pause Timer', '⏹ Stop Timer');
      } else if (isPaused) {
        items.push('▶ Resume Timer', '⏹ Stop Timer');
      } else {
        items.push('▶ Start Timer');
      }

      items.push('📊 View Reports', '🔓 Logout');

      const choice = await vscode.window.showQuickPick(items, {
        placeHolder: `Gitdoro — ${projectManager.getCurrentProjectName() || 'No project detected'}`
      });

      if (!choice) return;
      if (choice.includes('Start') || choice.includes('Resume')) await tracker.start();
      else if (choice.includes('Pause')) await tracker.pause();
      else if (choice.includes('Stop')) await tracker.stop();
      else if (choice.includes('Reports')) {
        vscode.env.openExternal(vscode.Uri.parse(
          `https://www.gitdoro.com/dashboard/reports?${UTM_BASE}&utm_campaign=reports`
        ));
      }
      else if (choice.includes('Logout')) {
        await tracker.stop();
        await authManager.logout();
        statusBar.update('logged-out', null);
      }
    })
  );

  // Add status bar to subscriptions
  context.subscriptions.push(statusBar.getStatusBarItem());
  context.subscriptions.push(statusBar.getActionItem());

  // Auto-detect project on workspace change
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => projectManager.detectProject())
  );

  // Auto-track: listen for window focus changes
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

  // Initialize: detect project and update status bar
  initializeExtension();
}

async function initializeExtension() {
  const isLoggedIn = await authManager.isLoggedIn();
  if (isLoggedIn) {
    await projectManager.detectProject();
    statusBar.update('idle', projectManager.getCurrentProjectName());

    // Handle auto-start on activation if window is already focused
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

  // Mark as shown regardless of action (don't annoy users)
  await context.globalState.update(key, true);
}

export async function deactivate() {
  // Auto-stop timer when VS Code closes — must return promise
  // so VS Code waits for the final sync HTTP request to complete
  if (tracker && (tracker.isRunning() || tracker.isPaused())) {
    await tracker.stop();
  }
}
