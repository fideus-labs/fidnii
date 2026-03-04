---
# Serena MCP Server - TypeScript/JavaScript Code Analysis
# Language Server Protocol (LSP)-based tool for deep TypeScript/JavaScript code analysis
#
# Documentation: https://github.com/oraios/serena
#
# Capabilities:
#   - Semantic code analysis using LSP (go to definition, find references, etc.)
#   - Symbol lookup and cross-file navigation
#   - Type inference and structural analysis
#   - Deeper insights than text-based grep approaches
#
# Usage:
#   imports:
#     - shared/mcp/serena-ts.md

tools:
  serena: ["typescript"]
---

## Serena TypeScript/JavaScript Code Analysis

The Serena MCP server is configured for TypeScript/JavaScript code analysis in this workspace:
- **Workspace**: `${{ github.workspace }}`
- **Memory**: `/tmp/gh-aw/cache-memory/serena/`

### Project Activation

Before analyzing code, activate the Serena project:
```
Tool: activate_project
Args: { "path": "${{ github.workspace }}" }
```

### Analysis Constraints

1. **Only analyze `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` files** — Ignore all other file types
2. **Skip test files** — Never analyze files matching `*.test.ts`, `*.spec.ts`, `*.test.js`, `*.spec.js`, or files in `test/`, `tests/`, `__tests__/`, `spec/` directories
3. **Focus on source files** — Primary analysis area is `src/` and application source directories
4. **Use Serena for semantic analysis** — Leverage LSP capabilities for deeper insights
