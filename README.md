# GlitchLens

GlitchLens is a VS Code extension that visualizes the static flow of the function you are reading as a Mermaid `sequenceDiagram`.

It runs local static analysis for TypeScript and JavaScript files. It does not execute the target code, trace runtime behavior, call LLMs, or send source code or analysis results to external services.

## Features

- Start visualization from the command palette with `GlitchLens: Visualize Function Flow`.
- Start visualization from CodeLens on TypeScript, JavaScript, TSX, and JSX functions.
- Extract calls, branches, loops, `await`, `return`, `throw`, and `try` / `catch` / `finally` flow from the selected function.
- Show unknown or unresolved calls and partial analysis results instead of hiding incomplete static analysis.
- Display the Mermaid diagram in a VS Code Webview and copy the current Mermaid text.

## Supported Languages

- TypeScript
- JavaScript
- TypeScript React
- JavaScript React

Python, Sequence Diff, Test Hints, Layer Classification, Architecture Rules, PNG / SVG export, and Markdown insertion are outside the current MVP scope.

## Extension Settings

This extension contributes the following settings:

- `glitchlens.codeLens.enabled`: Show CodeLens actions for visualizing function flow.
- `glitchlens.supportedLanguages`: Language identifiers supported by GlitchLens function flow analysis.

## Workspace Trust

GlitchLens is limited in Restricted Mode. Function flow commands, CodeLens, visualization, and Mermaid clipboard copy are disabled until the workspace is trusted.

## Development

Common validation commands:

```bash
npm run check-types
npm run lint
npm run compile
npm run test:unit
npm run test:integration
git diff --check
```
