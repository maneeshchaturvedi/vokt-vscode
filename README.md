# Vokt - Behavioral Drift Detection for VS Code

Vokt detects behavioral drift in your code by comparing implementations against behavioral specifications. This VS Code extension provides real-time drift detection via LSP integration with the Vokt CLI.

## Prerequisites

You must have the [Vokt CLI](https://devtools.stackshala.com) installed and available in your PATH:

```bash
# Install Vokt CLI
brew install maneeshchaturvedi/vokt/vokt
```

## Installation

Download the latest `.vsix` from [GitHub Releases](https://github.com/maneeshchaturvedi/vokt-vscode/releases).

**Via command line:**

```bash
# Download latest release
curl -LO https://github.com/maneeshchaturvedi/vokt-vscode/releases/latest/download/vokt-vscode-0.1.0.vsix

# Install
code --install-extension vokt-vscode-0.1.0.vsix
```

**Via VS Code UI:**

1. Download `.vsix` from releases page
2. Extensions → "..." menu → "Install from VSIX..."
3. Select downloaded file

## Features

- **Real-time drift detection** - Get instant feedback when code behavior diverges from specifications
- **Inlay hints** - See behavioral constraints inline in your code
- **Spec tree view** - Browse all behavioral specifications in the Explorer sidebar
- **Quick actions** - Generate specs, acknowledge intentional changes, view diffs
- **Status bar integration** - See spec coverage at a glance
- **Semantic highlighting** - Visual distinction for constrained code sections

## Supported Languages

- Go
- Python
- TypeScript
- JavaScript
- Java
- Rust

## Commands

| Command                                | Description                                       |
| -------------------------------------- | ------------------------------------------------- |
| `Vokt: Show Specification`             | View the behavioral spec for the current function |
| `Vokt: Generate Spec for Current File` | Generate a new spec for the current file          |
| `Vokt: Mark as Intended`               | Acknowledge a drift as an intentional change      |
| `Vokt: Restart LSP Server`             | Restart the Vokt language server                  |
| `Vokt: Refresh Specs`                  | Reload all specifications                         |
| `Vokt: Show Git Diff`                  | View git diff for current file                    |

## Configuration

| Setting                             | Default  | Description                                            |
| ----------------------------------- | -------- | ------------------------------------------------------ |
| `vokt.serverPath`                   | `"vokt"` | Path to the Vokt CLI executable                        |
| `vokt.trace.server`                 | `"off"`  | Trace LSP communication (`off`, `messages`, `verbose`) |
| `vokt.diagnostics.enabled`          | `true`   | Enable/disable drift detection                         |
| `vokt.diagnostics.debounceMs`       | `500`    | Debounce delay before running diagnostics              |
| `vokt.filter.ignoreComments`        | `true`   | Ignore comment-only changes                            |
| `vokt.filter.ignoreWhitespace`      | `true`   | Ignore whitespace-only changes                         |
| `vokt.filter.ignoreFormatting`      | `true`   | Ignore formatting-only changes                         |
| `vokt.inlayHints.enabled`           | `true`   | Show inlay hints for constraints                       |
| `vokt.semanticHighlighting.enabled` | `true`   | Highlight constrained code sections                    |
| `vokt.autoGenerateSpecs`            | `true`   | Auto-generate specs for files without one              |
| `vokt.statusBar.enabled`            | `true`   | Show status bar item                                   |

## How It Works

1. **Specs live in `.vokt/`** - Behavioral specifications are stored in a `.vokt` directory at your project root
2. **LSP integration** - The extension communicates with `vokt lsp` for real-time analysis
3. **Drift detection** - When code changes violate behavioral specs, diagnostics appear in the Problems panel
4. **Acknowledge or fix** - Either update your spec (intentional change) or fix your code (unintentional drift)

## Troubleshooting

### Extension not activating

- Ensure the Vokt CLI is installed: `vokt --version`
- Check that `vokt` is in your PATH, or set `vokt.serverPath` to the full path
- Look for errors in VS Code Output panel (View > Output > Vokt)

### No diagnostics appearing

- Verify your project has a `.vokt` directory with specs
- Check `vokt.diagnostics.enabled` is `true`
- Try running `Vokt: Restart LSP Server`

## License

MIT - see [LICENSE](LICENSE) for details.

## Links

- [Vokt CLI](https://devtools.stackshala.com)
- [Report Issues](https://github.com/maneeshchaturvedi/vokt-vscode/issues)
