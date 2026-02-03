import * as vscode from 'vscode';
import * as path from 'path';
import { exec, ChildProcess } from 'child_process';

// Default timeout for git operations (10 seconds)
const DEFAULT_GIT_TIMEOUT_MS = 10000;

/**
 * Execute a command with timeout support.
 * Kills the process if it exceeds the timeout.
 */
function execWithTimeout(
    command: string,
    options: { cwd?: string; timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
    const timeout = options.timeout ?? DEFAULT_GIT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
        let killed = false;

        const timer = setTimeout(() => {
            killed = true;
            if (childProcess) {
                childProcess.kill('SIGTERM');
                // Force kill after 1 second if still running
                setTimeout(() => {
                    if (childProcess && !childProcess.killed) {
                        childProcess.kill('SIGKILL');
                    }
                }, 1000);
            }
            reject(new Error(`Git command timed out after ${timeout}ms: ${command}`));
        }, timeout);

        const childProcess: ChildProcess = exec(command, { cwd: options.cwd }, (error, stdout, stderr) => {
            clearTimeout(timer);
            if (killed) {
                return; // Already rejected via timeout
            }
            if (error) {
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

export interface GitDiff {
    filePath: string;
    additions: number;
    deletions: number;
    hunks: GitHunk[];
}

export interface GitHunk {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: GitDiffLine[];
}

export interface GitDiffLine {
    type: 'add' | 'delete' | 'context';
    content: string;
    oldLineNumber?: number;
    newLineNumber?: number;
}

export interface GitFileStatus {
    path: string;
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
    staged: boolean;
}

export class GitIntegration implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private gitApi: GitAPI | undefined;

    constructor() {
        this.initGitApi();
    }

    private async initGitApi(): Promise<void> {
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (gitExtension) {
            if (!gitExtension.isActive) {
                await gitExtension.activate();
            }
            this.gitApi = gitExtension.exports.getAPI(1);
        }
    }

    async getRepository(uri: vscode.Uri): Promise<Repository | undefined> {
        if (!this.gitApi) {
            await this.initGitApi();
        }
        return this.gitApi?.getRepository(uri);
    }

    async getDiff(filePath: string): Promise<GitDiff | undefined> {
        const uri = vscode.Uri.file(filePath);
        const repo = await this.getRepository(uri);

        if (!repo) {
            return undefined;
        }

        try {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
            if (!workspaceFolder) {
                return undefined;
            }

            const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
            const { stdout } = await execWithTimeout(
                `git diff HEAD -- "${relativePath}"`,
                { cwd: workspaceFolder.uri.fsPath }
            );

            return this.parseDiff(filePath, stdout);
        } catch (error) {
            console.error('Failed to get git diff:', error);
            return undefined;
        }
    }

    async getDiffWithBase(filePath: string, baseBranch: string = 'main'): Promise<GitDiff | undefined> {
        const uri = vscode.Uri.file(filePath);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

        if (!workspaceFolder) {
            return undefined;
        }

        try {
            const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
            const { stdout } = await execWithTimeout(
                `git diff ${baseBranch}...HEAD -- "${relativePath}"`,
                { cwd: workspaceFolder.uri.fsPath }
            );

            return this.parseDiff(filePath, stdout);
        } catch (error) {
            console.error('Failed to get git diff with base:', error);
            return undefined;
        }
    }

    async getFileAtCommit(filePath: string, commitRef: string = 'HEAD'): Promise<string | undefined> {
        const uri = vscode.Uri.file(filePath);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

        if (!workspaceFolder) {
            return undefined;
        }

        try {
            const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
            const { stdout } = await execWithTimeout(
                `git show ${commitRef}:"${relativePath}"`,
                { cwd: workspaceFolder.uri.fsPath }
            );

            return stdout;
        } catch {
            // File may not exist at that commit
            return undefined;
        }
    }

    async getModifiedFiles(): Promise<GitFileStatus[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        try {
            const { stdout } = await execWithTimeout('git status --porcelain', {
                cwd: workspaceFolder.uri.fsPath,
            });

            const files: GitFileStatus[] = [];
            const lines = stdout.split('\n').filter((l) => l.trim());

            for (const line of lines) {
                const staged = line[0] !== ' ' && line[0] !== '?';
                const statusChar = staged ? line[0] : line[1];
                const filePath = line.substring(3).trim();

                let status: GitFileStatus['status'];
                switch (statusChar) {
                    case 'M':
                        status = 'modified';
                        break;
                    case 'A':
                        status = 'added';
                        break;
                    case 'D':
                        status = 'deleted';
                        break;
                    case 'R':
                        status = 'renamed';
                        break;
                    case '?':
                        status = 'untracked';
                        break;
                    default:
                        status = 'modified';
                }

                files.push({
                    path: path.join(workspaceFolder.uri.fsPath, filePath),
                    status,
                    staged,
                });
            }

            return files;
        } catch (error) {
            console.error('Failed to get modified files:', error);
            return [];
        }
    }

    async getLastCommitInfo(filePath: string): Promise<CommitInfo | undefined> {
        const uri = vscode.Uri.file(filePath);
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

        if (!workspaceFolder) {
            return undefined;
        }

        try {
            const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
            const { stdout } = await execWithTimeout(
                `git log -1 --format="%H|%an|%ae|%ai|%s" -- "${relativePath}"`,
                { cwd: workspaceFolder.uri.fsPath }
            );

            const [hash, author, email, date, message] = stdout.trim().split('|');
            if (!hash) {
                return undefined;
            }

            return {
                hash,
                author,
                email,
                date: new Date(date),
                message,
            };
        } catch {
            return undefined;
        }
    }

    private parseDiff(filePath: string, diffOutput: string): GitDiff {
        const hunks: GitHunk[] = [];
        let additions = 0;
        let deletions = 0;

        const lines = diffOutput.split('\n');
        let currentHunk: GitHunk | undefined;
        let oldLine = 0;
        let newLine = 0;

        for (const line of lines) {
            if (line.startsWith('@@')) {
                // Parse hunk header: @@ -start,count +start,count @@
                const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
                if (match) {
                    if (currentHunk) {
                        hunks.push(currentHunk);
                    }
                    currentHunk = {
                        oldStart: parseInt(match[1], 10),
                        oldCount: parseInt(match[2] || '1', 10),
                        newStart: parseInt(match[3], 10),
                        newCount: parseInt(match[4] || '1', 10),
                        lines: [],
                    };
                    oldLine = currentHunk.oldStart;
                    newLine = currentHunk.newStart;
                }
            } else if (currentHunk) {
                if (line.startsWith('+') && !line.startsWith('+++')) {
                    currentHunk.lines.push({
                        type: 'add',
                        content: line.substring(1),
                        newLineNumber: newLine++,
                    });
                    additions++;
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                    currentHunk.lines.push({
                        type: 'delete',
                        content: line.substring(1),
                        oldLineNumber: oldLine++,
                    });
                    deletions++;
                } else if (line.startsWith(' ')) {
                    currentHunk.lines.push({
                        type: 'context',
                        content: line.substring(1),
                        oldLineNumber: oldLine++,
                        newLineNumber: newLine++,
                    });
                }
            }
        }

        if (currentHunk) {
            hunks.push(currentHunk);
        }

        return {
            filePath,
            additions,
            deletions,
            hunks,
        };
    }

    async openDiffView(filePath: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);

        try {
            await vscode.commands.executeCommand('git.openChange', uri);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open diff view: ${error}`);
        }
    }

    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }
}

export interface CommitInfo {
    hash: string;
    author: string;
    email: string;
    date: Date;
    message: string;
}

// VS Code Git Extension API types
interface GitAPI {
    getRepository(uri: vscode.Uri): Repository | undefined;
    repositories: Repository[];
}

interface Repository {
    rootUri: vscode.Uri;
    state: RepositoryState;
    diff(cached?: boolean): Promise<string>;
}

interface RepositoryState {
    HEAD: Branch | undefined;
    workingTreeChanges: Change[];
    indexChanges: Change[];
}

interface Branch {
    name: string;
    commit: string;
}

interface Change {
    uri: vscode.Uri;
    status: number;
}
