import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { AuthManager } from './auth';
import { ProjectManager } from './projectManager';
import { StatusBarManager } from './statusbar';

type TrackerState = 'idle' | 'running' | 'paused';

const HEARTBEAT_INTERVAL_MS = 60_000; // 1 minute
const BLUR_PAUSE_DELAY_MS = 5 * 60_000; // 5 minutes
const MAX_VALID_GAP_MS = 10 * 60_000; // 10 minutes — max elapsed between checkpoints
const MAX_SESSION_SECONDS = 12 * 60 * 60; // 12 hours — absolute session cap

export class Tracker {
  private auth: AuthManager;
  private projectManager: ProjectManager;
  private statusBar: StatusBarManager;

  private state: TrackerState = 'idle';
  private sessionStartTime: number = 0;
  private accumulatedSeconds: number = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private blurTimeout: NodeJS.Timeout | null = null;
  private autoTrackTimeout: NodeJS.Timeout | null = null;
  private sessionId: string | null = null;
  private sessionStartedAt: string | null = null; // ISO string of actual session start

  constructor(auth: AuthManager, projectManager: ProjectManager, statusBar: StatusBarManager) {
    this.auth = auth;
    this.projectManager = projectManager;
    this.statusBar = statusBar;
  }

  /**
   * Start the timer.
   */
  async start(): Promise<void> {
    const isLoggedIn = await this.auth.isLoggedIn();
    if (!isLoggedIn) {
      vscode.window.showWarningMessage('Gitdoro: Please sign in first.');
      await this.auth.login();
      return;
    }

    // Ensure project is detected (it's ok if it remains null for non-repo folders)
    if (!this.projectManager.getCurrentProject()) {
      await this.projectManager.detectProject();
    }

    if (this.state === 'paused') {
      // Resume from pause — keep accumulated time and same sessionId
      this.state = 'running';
      this.sessionStartTime = Date.now();
    } else {
      this.state = 'running';
      this.sessionStartTime = Date.now();
      this.accumulatedSeconds = 0;
      this.sessionId = crypto.randomUUID();
      this.sessionStartedAt = new Date().toISOString();
    }

    const projectName = this.projectManager.getCurrentProjectName();
    this.statusBar.startTicking(this.accumulatedSeconds, projectName);
    this.startHeartbeat();

    vscode.window.showInformationMessage(
      `Gitdoro: Timer started${projectName ? ` for ${projectName}` : ''}`
    );
  }

  /**
   * Pause the timer.
   */
  async pause(): Promise<void> {
    if (this.state !== 'running') return;

    this.accumulateTime();
    this.state = 'paused';
    this.statusBar.stopTicking();
    this.statusBar.update('paused', this.projectManager.getCurrentProjectName());
    this.stopHeartbeat();
    this.clearAutoTrackTimeout();

    // Send a sync to save progress
    await this.syncToGitdoro('paused');

    vscode.window.showInformationMessage('Gitdoro: Timer paused.');
  }

  /**
   * Stop the timer completely — saves the session to Gitdoro.
   */
  async stop(): Promise<void> {
    if (this.state === 'idle') return;

    if (this.state === 'running') {
      this.accumulateTime();
    }

    this.state = 'idle';
    this.statusBar.stopTicking();
    this.statusBar.resetElapsed();
    this.stopHeartbeat();
    this.clearBlurTimeout();
    this.clearAutoTrackTimeout();

    // Final sync
    await this.syncToGitdoro('stopped');

    const projectName = this.projectManager.getCurrentProjectName();
    this.statusBar.update('idle', projectName);

    this.accumulatedSeconds = 0;
    this.sessionId = null;
    this.sessionStartedAt = null;

    vscode.window.showInformationMessage('Gitdoro: Timer stopped. Session saved.');
  }

  /**
   * Is the timer currently running?
   */
  isRunning(): boolean {
    return this.state === 'running';
  }

  /**
   * Is the timer currently paused?
   */
  isPaused(): boolean {
    return this.state === 'paused';
  }

  /**
   * Is auto-track enabled in settings?
   */
  isAutoTrackEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('gitdoro');
    return config.get<boolean>('autoTrack', false);
  }

  getAutoTrackDelayMs(): number {
    const config = vscode.workspace.getConfiguration('gitdoro');
    const minutes = config.get<number>('autoTrackDelay', 0);
    return Math.max(0, minutes) * 60_000;
  }

  isPauseOnBlurEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('gitdoro');
    return config.get<boolean>('pauseOnBlur', true);
  }

  getPauseOnBlurDelayMs(): number {
    const config = vscode.workspace.getConfiguration('gitdoro');
    const minutes = config.get<number>('pauseOnBlurDelay', 5);
    return Math.max(0, minutes) * 60_000;
  }

  /**
   * Called when VS Code window gains focus (for auto-track).
   */
  async onWindowFocused(): Promise<void> {
    this.clearBlurTimeout();

    if (this.state === 'paused' || this.state === 'idle') {
      const delayMs = this.getAutoTrackDelayMs();
      if (delayMs > 0) {
        this.clearAutoTrackTimeout();
        this.autoTrackTimeout = setTimeout(async () => {
          await this.resumeOrStart();
        }, delayMs);
      } else {
        await this.resumeOrStart();
      }
    }
  }

  private async resumeOrStart(): Promise<void> {
    if (this.state === 'paused') {
      // Resume timer automatically
      this.state = 'running';
      this.sessionStartTime = Date.now();
      this.statusBar.startTicking(this.accumulatedSeconds, this.projectManager.getCurrentProjectName());
      this.startHeartbeat();
    } else if (this.state === 'idle') {
      // Auto-start on first focus
      await this.start();
    }
  }

  /**
   * Called when VS Code window loses focus (for auto-track).
   * Waits configured delay before pausing.
   */
  onWindowBlurred(): void {
    if (this.state !== 'running') return;

    this.clearAutoTrackTimeout();

    if (!this.isPauseOnBlurEnabled()) {
      return;
    }

    this.clearBlurTimeout();
    const delayMs = this.getPauseOnBlurDelayMs();
    this.blurTimeout = setTimeout(async () => {
      if (this.state === 'running') {
        await this.pause();
      }
    }, delayMs);
  }

  /**
   * Add elapsed time since last checkpoint to accumulated total.
   * Caps the delta to MAX_VALID_GAP_MS to prevent inflated values
   * from system suspend/sleep/hibernate.
   */
  private accumulateTime(): void {
    if (this.sessionStartTime > 0) {
      const now = Date.now();
      const rawElapsed = now - this.sessionStartTime;

      // If gap > 10 min, system likely suspended — cap the delta
      const validElapsed = rawElapsed > MAX_VALID_GAP_MS
        ? Math.floor(MAX_VALID_GAP_MS / 1000)
        : Math.floor(rawElapsed / 1000);

      this.accumulatedSeconds = Math.min(
        this.accumulatedSeconds + validElapsed,
        MAX_SESSION_SECONDS // Absolute cap at 12 hours
      );
      this.sessionStartTime = now;
    }
  }

  /**
   * Start the periodic heartbeat to sync data to Gitdoro.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(async () => {
      if (this.state === 'running') {
        this.accumulateTime();
        await this.syncToGitdoro('running');
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stop the heartbeat interval.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Clear the blur timeout.
   */
  private clearBlurTimeout(): void {
    if (this.blurTimeout) {
      clearTimeout(this.blurTimeout);
      this.blurTimeout = null;
    }
  }

  /**
   * Clear the auto-track timeout.
   */
  private clearAutoTrackTimeout(): void {
    if (this.autoTrackTimeout) {
      clearTimeout(this.autoTrackTimeout);
      this.autoTrackTimeout = null;
    }
  }

  /**
   * Sync current tracking data to Gitdoro API.
   * Works even without a project — sends as "unassigned" session.
   */
  private async syncToGitdoro(status: 'running' | 'paused' | 'stopped'): Promise<void> {
    const isLoggedIn = await this.auth.isLoggedIn();
    if (!isLoggedIn) return;

    // Skip sync if we have zero seconds
    if (this.accumulatedSeconds <= 0 && status !== 'running') return;

    const project = this.projectManager.getCurrentProject();
    const projectName = project?.name || null;

    try {
      this.statusBar.update('syncing', projectName);

      await this.auth.apiRequest('/api/extension/sync', {
        method: 'POST',
        body: {
          sessionId: this.sessionId,
          projectId: project?.gitdoroProjectId || null,
          projectName: projectName || 'Unassigned',
          elapsedSeconds: this.accumulatedSeconds,
          status,
          isGitRemote: project?.isGitRepo || false,
          remoteUrl: project?.remoteUrl || null,
          owner: project?.owner || null,
          repo: project?.repo || null,
          startedAt: this.sessionStartedAt || null,
        }
      });

      // If stopped, reset accumulated
      if (status === 'stopped') {
        this.accumulatedSeconds = 0;
      }

      // Restore status bar state after sync
      if (this.state === 'running') {
        this.statusBar.update('running', projectName);
      } else if (this.state === 'paused') {
        this.statusBar.update('paused', projectName);
      } else {
        this.statusBar.update('idle', projectName);
      }
    } catch {
      console.error('Gitdoro: Sync failed, will retry on next heartbeat.');
      // Restore status bar
      if (this.state === 'running') {
        this.statusBar.update('running', projectName);
      }
    }
  }
}
