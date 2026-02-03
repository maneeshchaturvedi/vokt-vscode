import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getClient } from './client';

export class VoktSpecsTreeProvider
    implements vscode.TreeDataProvider<SpecTreeItem>
{
    private _onDidChangeTreeData = new vscode.EventEmitter<
        SpecTreeItem | undefined | null | void
    >();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private workspaceRoot: string | undefined;
    private specs: SpecInfo[] = [];

    constructor(workspaceRoot: string | undefined) {
        this.workspaceRoot = workspaceRoot;
        this.loadSpecs();
    }

    refresh(): void {
        this.loadSpecs();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SpecTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SpecTreeItem): Promise<SpecTreeItem[]> {
        if (!this.workspaceRoot) {
            return [];
        }

        if (!element) {
            // Root level - show categories
            return this.getRootItems();
        }

        if (element.contextValue === 'category') {
            // Show specs in category
            return this.getSpecsInCategory(element.label as string);
        }

        if (element.contextValue === 'spec') {
            // Show spec details
            return this.getSpecDetails(element);
        }

        return [];
    }

    private getRootItems(): SpecTreeItem[] {
        const items: SpecTreeItem[] = [];

        // Count specs by status
        const withSpec = this.specs.filter((s) => s.hasSpec).length;
        const withDrift = this.specs.filter((s) => s.hasDrift).length;
        const withoutSpec = this.specs.filter((s) => !s.hasSpec).length;

        if (withSpec > 0) {
            items.push(
                new SpecTreeItem(
                    `With Specs (${withSpec})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    'category',
                    undefined,
                    'with-spec'
                )
            );
        }

        if (withDrift > 0) {
            items.push(
                new SpecTreeItem(
                    `With Drift (${withDrift})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    'category',
                    undefined,
                    'with-drift'
                )
            );
        }

        if (withoutSpec > 0) {
            items.push(
                new SpecTreeItem(
                    `Without Specs (${withoutSpec})`,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'category',
                    undefined,
                    'without-spec'
                )
            );
        }

        if (items.length === 0) {
            items.push(
                new SpecTreeItem(
                    'No specs found',
                    vscode.TreeItemCollapsibleState.None,
                    'info'
                )
            );
        }

        return items;
    }

    private getSpecsInCategory(category: string): SpecTreeItem[] {
        let filtered: SpecInfo[];

        if (category.startsWith('With Specs')) {
            filtered = this.specs.filter((s) => s.hasSpec && !s.hasDrift);
        } else if (category.startsWith('With Drift')) {
            filtered = this.specs.filter((s) => s.hasDrift);
        } else if (category.startsWith('Without Specs')) {
            filtered = this.specs.filter((s) => !s.hasSpec);
        } else {
            filtered = [];
        }

        return filtered.map((spec) => {
            const item = new SpecTreeItem(
                spec.fileName,
                vscode.TreeItemCollapsibleState.Collapsed,
                'spec',
                spec
            );

            if (spec.hasDrift) {
                item.iconPath = new vscode.ThemeIcon(
                    'warning',
                    new vscode.ThemeColor('problemsWarningIcon.foreground')
                );
            } else if (spec.hasSpec) {
                item.iconPath = new vscode.ThemeIcon(
                    'file-code',
                    new vscode.ThemeColor('symbolIcon.fileForeground')
                );
            } else {
                item.iconPath = new vscode.ThemeIcon('file');
            }

            item.description = spec.relativePath;
            item.tooltip = this.getSpecTooltip(spec);

            if (spec.filePath) {
                item.command = {
                    command: 'vscode.open',
                    title: 'Open File',
                    arguments: [vscode.Uri.file(spec.filePath)],
                };
            }

            return item;
        });
    }

    private getSpecDetails(element: SpecTreeItem): SpecTreeItem[] {
        const spec = element.specInfo;
        if (!spec) {
            return [];
        }

        const items: SpecTreeItem[] = [];

        if (spec.specPath) {
            const specItem = new SpecTreeItem(
                'Specification',
                vscode.TreeItemCollapsibleState.None,
                'detail'
            );
            specItem.iconPath = new vscode.ThemeIcon('file-code');
            specItem.description = path.basename(spec.specPath);
            specItem.command = {
                command: 'vscode.open',
                title: 'Open Spec',
                arguments: [vscode.Uri.file(spec.specPath)],
            };
            items.push(specItem);
        }

        if (spec.version) {
            const versionItem = new SpecTreeItem(
                'Version',
                vscode.TreeItemCollapsibleState.None,
                'detail'
            );
            versionItem.description = `v${spec.version}`;
            versionItem.iconPath = new vscode.ThemeIcon('versions');
            items.push(versionItem);
        }

        if (spec.lastUpdated) {
            const dateItem = new SpecTreeItem(
                'Last Updated',
                vscode.TreeItemCollapsibleState.None,
                'detail'
            );
            dateItem.description = new Date(spec.lastUpdated).toLocaleDateString();
            dateItem.iconPath = new vscode.ThemeIcon('calendar');
            items.push(dateItem);
        }

        if (spec.driftCount && spec.driftCount > 0) {
            const driftItem = new SpecTreeItem(
                'Drift Issues',
                vscode.TreeItemCollapsibleState.None,
                'detail'
            );
            driftItem.description = `${spec.driftCount} issue${spec.driftCount > 1 ? 's' : ''}`;
            driftItem.iconPath = new vscode.ThemeIcon(
                'warning',
                new vscode.ThemeColor('problemsWarningIcon.foreground')
            );
            items.push(driftItem);
        }

        return items;
    }

    private getSpecTooltip(spec: SpecInfo): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown(`**${spec.fileName}**\n\n`);

        if (spec.hasSpec) {
            tooltip.appendMarkdown(`$(check) Has behavioral specification\n\n`);
            if (spec.specPath) {
                tooltip.appendMarkdown(`Spec: \`${path.basename(spec.specPath)}\`\n\n`);
            }
        } else {
            tooltip.appendMarkdown(`$(x) No behavioral specification\n\n`);
        }

        if (spec.hasDrift) {
            tooltip.appendMarkdown(
                `$(warning) **${spec.driftCount || 0} drift issue(s) detected**\n\n`
            );
        }

        if (spec.version) {
            tooltip.appendMarkdown(`Version: v${spec.version}\n\n`);
        }

        return tooltip;
    }

    private async loadSpecs(): Promise<void> {
        if (!this.workspaceRoot) {
            this.specs = [];
            return;
        }

        const client = getClient();
        if (client && client.isRunning()) {
            try {
                const response = await client.sendRequest<{ specs: SpecInfo[] }>(
                    'vokt/listSpecs',
                    {}
                );
                this.specs = response?.specs || [];
                return;
            } catch {
                // Fall back to file system scanning
            }
        }

        // Fallback: scan .vokt directory
        this.specs = await this.scanSpecsDirectory();
    }

    private async scanSpecsDirectory(): Promise<SpecInfo[]> {
        const specs: SpecInfo[] = [];

        if (!this.workspaceRoot) {
            return specs;
        }

        const voktDir = path.join(this.workspaceRoot, '.vokt');
        const specsDir = path.join(voktDir, 'specs');
        const linksFile = path.join(voktDir, 'links.json');

        // Load links if available
        let links: Record<string, string> = {};
        try {
            if (fs.existsSync(linksFile)) {
                const content = fs.readFileSync(linksFile, 'utf-8');
                links = JSON.parse(content);
            }
        } catch {
            // Ignore parse errors
        }

        // Scan specs directory
        if (fs.existsSync(specsDir)) {
            const specFiles = fs.readdirSync(specsDir);
            for (const specFile of specFiles) {
                if (specFile.endsWith('.yaml') || specFile.endsWith('.yml')) {
                    // Find corresponding source file
                    const specPath = path.join(specsDir, specFile);
                    const sourcePath = Object.entries(links).find(
                        ([, sp]) => sp === specPath
                    )?.[0];

                    specs.push({
                        fileName: sourcePath ? path.basename(sourcePath) : specFile,
                        filePath: sourcePath,
                        specPath,
                        relativePath: sourcePath
                            ? path.relative(this.workspaceRoot!, sourcePath)
                            : specFile,
                        hasSpec: true,
                        hasDrift: false, // Would need to check with LSP
                    });
                }
            }
        }

        return specs;
    }
}

export class SpecTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly specInfo?: SpecInfo,
        public readonly categoryId?: string
    ) {
        super(label, collapsibleState);
    }
}

export interface SpecInfo {
    fileName: string;
    filePath?: string;
    specPath?: string;
    relativePath: string;
    hasSpec: boolean;
    hasDrift: boolean;
    version?: number;
    lastUpdated?: string;
    driftCount?: number;
}
