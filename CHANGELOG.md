# Change Log

All notable changes to the "glitchlens" extension will be documented in this file.

## [Unreleased]

- Replaced the template command with Function Flow Visualization for TypeScript and JavaScript.
- Added local static analysis, Mermaid sequence diagram rendering, VS Code Webview display, and Mermaid text copy.
- Added Workspace Trust guards and validation for local-only operation with no LLM, telemetry, external upload, runtime trace, or target-code execution path.
- Improved Webview rendering with the bundled official Mermaid renderer and fallback Mermaid text display when rendering fails.
- Improved Mermaid sequence diagram readability by applying distinct accent colors to loop, alt, opt, critical, and option blocks.
- Hid the Source locations list from the Marketplace-facing Webview while keeping SourceMap data internal.
- Improved Mermaid UI readability with brighter lifelines, activation display, await and return styling, and root participant emphasis.
- Improved Mermaid layout with root participant always activated, higher-contrast lifelines, restored control block accents, and more resilient labels.
- Fixed Mermaid Webview scaling and participant label overflow by preserving Mermaid's SVG text layout and max-width behavior.
- Centered participant names horizontally and vertically inside actor boxes.
- Fixed participant text overflow beyond actor box boundaries for long function names.
