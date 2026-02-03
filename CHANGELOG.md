# Changelog

All notable changes to the Vokt VS Code extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-02-03

### Added

- Initial release of Vokt VS Code extension
- LSP integration with Vokt CLI for real-time behavioral drift detection
- Support for Go, Python, TypeScript, JavaScript, Java, and Rust
- Commands:
  - Show Specification - view behavioral spec for current function
  - Generate Spec for Current File - create new behavioral spec
  - Mark as Intended - acknowledge intentional behavioral changes
  - Restart LSP Server - restart the language server
  - Refresh Specs - reload all specifications
  - Show Git Diff - view git changes
- Specs tree view in Explorer sidebar
- Status bar integration showing spec coverage
- Inlay hints for behavioral constraints
- Semantic highlighting for constrained code sections
- Configurable filtering for comments, whitespace, and formatting changes
- Debounced diagnostics for better performance while typing
