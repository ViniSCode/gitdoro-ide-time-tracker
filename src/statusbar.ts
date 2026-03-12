import * as vscode from 'vscode';

type StatusState = 'idle' | 'running' | 'paused' | 'syncing' | 'logged-out';

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private actionItem: vscode.StatusBarItem;
  private elapsedSeconds: number = 0;
  private timerInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.actionItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99
    );
    this.statusBarItem.command = 'gitdoro.showMenu';
    this.statusBarItem.tooltip = 'Gitdoro — Click for options';
    this.statusBarItem.show();
    
    this.actionItem.command = 'gitdoro.toggleAction';
    
    this.update('logged-out', null);
  }

  /**
   * Update the status bar display based on current state.
   */
  update(state: StatusState, projectName: string | null): void {
    const project = projectName ? ` · ${projectName}` : '';

    switch (state) {
      case 'logged-out':
        this.statusBarItem.text = '$(clock) Gitdoro';
        this.statusBarItem.tooltip = 'Click to sign in to Gitdoro';
        this.statusBarItem.backgroundColor = undefined;
        this.actionItem.hide();
        this.stopTickInterval();
        break;

      case 'idle':
        this.statusBarItem.text = `$(clock) Gitdoro${project}`;
        this.statusBarItem.tooltip = 'Click to start tracking';
        this.statusBarItem.backgroundColor = undefined;
        this.actionItem.text = '$(play)';
        this.actionItem.tooltip = 'Start Timer';
        this.actionItem.show();
        this.stopTickInterval();
        break;

      case 'running':
        this.statusBarItem.text = `$(play) ${this.formatTime(this.elapsedSeconds)}${project}`;
        this.statusBarItem.tooltip = 'Timer running — click for options';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.actionItem.text = '$(debug-stop)';
        this.actionItem.tooltip = 'Stop Timer';
        this.actionItem.show();
        break;

      case 'paused':
        this.statusBarItem.text = `$(debug-pause) ${this.formatTime(this.elapsedSeconds)}${project}`;
        this.statusBarItem.tooltip = 'Timer paused — click to resume';
        this.statusBarItem.backgroundColor = undefined;
        this.actionItem.text = '$(debug-stop)';
        this.actionItem.tooltip = 'Stop Timer';
        this.actionItem.show();
        break;

      case 'syncing':
        this.statusBarItem.text = `$(sync~spin) Syncing...${project}`;
        this.statusBarItem.tooltip = 'Syncing with Gitdoro...';
        this.statusBarItem.backgroundColor = undefined;
        this.actionItem.hide();
        break;
    }
  }

  /**
   * Start the visual tick counter (updates every second).
   */
  startTicking(initialSeconds: number, projectName: string | null): void {
    this.elapsedSeconds = initialSeconds;
    this.stopTickInterval();
    this.update('running', projectName);
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds++;
      this.update('running', projectName);
    }, 1000);
  }

  /**
   * Stop the visual tick counter.
   */
  stopTicking(): void {
    this.stopTickInterval();
  }

  /**
   * Get the current elapsed seconds displayed.
   */
  getElapsedSeconds(): number {
    return this.elapsedSeconds;
  }

  /**
   * Reset the elapsed counter.
   */
  resetElapsed(): void {
    this.elapsedSeconds = 0;
  }

  getStatusBarItem(): vscode.StatusBarItem {
    return this.statusBarItem;
  }

  getActionItem(): vscode.StatusBarItem {
    return this.actionItem;
  }

  private stopTickInterval(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  private formatTime(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
}
