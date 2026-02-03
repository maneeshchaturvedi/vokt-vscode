import * as vscode from 'vscode';
import { State } from 'vscode-languageclient';

export class VoktStatusBar implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private connected: boolean = false;
    private hasSpec: boolean = false;
    private coverage: number = 0;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'vokt.showSpec';
        this.updateDisplay();
        this.statusBarItem.show();
    }

    setConnected(connected: boolean): void {
        this.connected = connected;
        this.updateDisplay();
    }

    updateState(state: State): void {
        switch (state) {
            case State.Running:
                this.connected = true;
                break;
            case State.Starting:
                this.connected = false;
                this.statusBarItem.text = '$(sync~spin) Vokt';
                this.statusBarItem.tooltip = 'Vokt LSP server starting...';
                return;
            case State.Stopped:
                this.connected = false;
                break;
        }
        this.updateDisplay();
    }

    updateCoverage(hasSpec: boolean, coverage: number): void {
        this.hasSpec = hasSpec;
        this.coverage = coverage;
        this.updateDisplay();
    }

    private updateDisplay(): void {
        if (!this.connected) {
            this.statusBarItem.text = '$(warning) Vokt';
            this.statusBarItem.tooltip = 'Vokt LSP server not connected';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground'
            );
            return;
        }

        this.statusBarItem.backgroundColor = undefined;

        if (!this.hasSpec) {
            this.statusBarItem.text = '$(file-code) Vokt: No Spec';
            this.statusBarItem.tooltip =
                'No behavioral spec for current file\nClick to generate one';
            this.statusBarItem.command = 'vokt.generateSpec';
            return;
        }

        // Show coverage status
        const icon = this.getCoverageIcon();
        this.statusBarItem.text = `${icon} Vokt: ${this.coverage}%`;
        this.statusBarItem.tooltip = this.getTooltip();
        this.statusBarItem.command = 'vokt.showSpec';
    }

    private getCoverageIcon(): string {
        if (this.coverage >= 80) {
            return '$(check)';
        } else if (this.coverage >= 50) {
            return '$(warning)';
        } else {
            return '$(alert)';
        }
    }

    private getTooltip(): string {
        let tooltip = `Behavioral Spec Coverage: ${this.coverage}%\n\n`;

        if (this.coverage >= 80) {
            tooltip += 'Good coverage! Most behaviors are specified.';
        } else if (this.coverage >= 50) {
            tooltip += 'Moderate coverage. Consider adding more specifications.';
        } else {
            tooltip += 'Low coverage. Many behaviors are unspecified.';
        }

        tooltip += '\n\nClick to view specification';

        return tooltip;
    }

    show(): void {
        this.statusBarItem.show();
    }

    hide(): void {
        this.statusBarItem.hide();
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}

export class VoktDriftStatusBar implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private driftCount: number = 0;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            99
        );
        this.statusBarItem.command = 'workbench.action.problems.focus';
        this.updateDisplay();
    }

    updateDriftCount(count: number): void {
        this.driftCount = count;
        this.updateDisplay();

        if (count > 0) {
            this.statusBarItem.show();
        } else {
            this.statusBarItem.hide();
        }
    }

    private updateDisplay(): void {
        if (this.driftCount === 0) {
            this.statusBarItem.text = '$(check) No Drift';
            this.statusBarItem.tooltip = 'No behavioral drift detected';
            this.statusBarItem.backgroundColor = undefined;
        } else {
            this.statusBarItem.text = `$(alert) ${this.driftCount} Drift${this.driftCount > 1 ? 's' : ''}`;
            this.statusBarItem.tooltip = `${this.driftCount} behavioral drift${this.driftCount > 1 ? 's' : ''} detected\nClick to view problems`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground'
            );
        }
    }

    show(): void {
        this.statusBarItem.show();
    }

    hide(): void {
        this.statusBarItem.hide();
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}
