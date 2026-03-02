import * as vscode from 'vscode';
import { AuthManager } from './auth';

interface GitExtensionApi {
  getAPI(version: number): GitApi;
}

interface GitApi {
  repositories: GitRepository[];
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    remotes: Array<{ name: string; fetchUrl?: string; pushUrl?: string }>;
    HEAD: { name?: string } | undefined;
  };
}

interface ProjectInfo {
  name: string;
  isGitRepo: boolean;
  remoteUrl: string | null;
  owner: string | null;
  repo: string | null;
  localPath: string;
  gitdoroProjectId: string | null;
}

export class ProjectManager {
  private auth: AuthManager;
  private currentProject: ProjectInfo | null = null;

  constructor(auth: AuthManager) {
    this.auth = auth;
  }

  /**
   * Detect the current project from the active workspace.
   * Uses the Git extension API to find the remote, or falls back to folder name.
   */
  async detectProject(): Promise<ProjectInfo | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.currentProject = null;
      return null;
    }

    const rootFolder = workspaceFolders[0];
    const folderName = rootFolder.name;
    const localPath = rootFolder.uri.fsPath;

    // Try to get Git info
    const gitInfo = this.getGitRemoteInfo();

    const project: ProjectInfo = {
      name: gitInfo?.repo || folderName,
      isGitRepo: !!gitInfo,
      remoteUrl: gitInfo?.remoteUrl || null,
      owner: gitInfo?.owner || null,
      repo: gitInfo?.repo || null,
      localPath,
      gitdoroProjectId: null
    };

    // Try to match with existing Gitdoro project
    await this.syncWithGitdoro(project);

    this.currentProject = project;
    return project;
  }

  /**
   * Get the current project name for display.
   */
  getCurrentProjectName(): string | null {
    return this.currentProject?.name || null;
  }

  /**
   * Get the full current project info.
   */
  getCurrentProject(): ProjectInfo | null {
    return this.currentProject;
  }

  /**
   * Extract owner/repo from a Git remote URL.
   * Supports HTTPS and SSH formats.
   */
  parseGitRemoteUrl(url: string): { owner: string; repo: string } | null {
    // HTTPS: https://github.com/owner/repo.git or https://github.com/owner/repo.app.git
    const httpsMatch = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/i);
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }
    // SSH: git@github.com:owner/repo.git
    const sshMatch = url.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }
    return null;
  }

  /**
   * Use the VS Code Git extension to get remote info.
   */
  private getGitRemoteInfo(): { remoteUrl: string; owner: string; repo: string } | null {
    try {
      const gitExtension = vscode.extensions.getExtension<GitExtensionApi>('vscode.git');
      if (!gitExtension || !gitExtension.isActive) return null;

      const git = gitExtension.exports.getAPI(1);
      if (!git.repositories || git.repositories.length === 0) return null;

      const repository = git.repositories[0];
      const remotes = repository.state.remotes;
      if (!remotes || remotes.length === 0) return null;

      // Prefer 'origin', fall back to first remote
      const origin = remotes.find(r => r.name === 'origin') || remotes[0];
      const remoteUrl = origin.fetchUrl || origin.pushUrl;
      if (!remoteUrl) return null;

      const parsed = this.parseGitRemoteUrl(remoteUrl);
      if (!parsed) return null;

      return {
        remoteUrl,
        owner: parsed.owner,
        repo: parsed.repo
      };
    } catch {
      return null;
    }
  }

  /**
   * Sync the detected project with Gitdoro's backend.
   * Matches by GitHub remote URL or creates a new local project.
   */
  private async syncWithGitdoro(project: ProjectInfo): Promise<void> {
    const isLoggedIn = await this.auth.isLoggedIn();
    if (!isLoggedIn) return;

    try {
      const result = await this.auth.apiRequest('/api/extension/sync-project', {
        method: 'POST',
        body: {
          name: project.name,
          isGitRepo: project.isGitRepo,
          remoteUrl: project.remoteUrl,
          owner: project.owner,
          repo: project.repo,
          localPath: project.localPath
        }
      });

      if (result?.projectId) {
        project.gitdoroProjectId = result.projectId;
      }
    } catch {
      // Silently fail — we'll retry on next sync
      console.error('Gitdoro: Failed to sync project');
    }
  }
}
