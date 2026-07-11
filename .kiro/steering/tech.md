# Technology Stack

## Architecture

GlitchLens は VS Code Extension API を UI・エディタ統合の境界として扱う TypeScript 製拡張です。拡張のエントリーポイントは `src/extension.ts` で、VS Code コマンド登録、CodeLens、WebView、Clipboard、コードジャンプなどの editor-facing な機能を接続します。

Core logic は可能な限り VS Code API に依存させません。言語別 Analyzer は解析結果を直接 Mermaid へ変換せず、まず言語非依存の共通処理フローモデルへ変換します。Mermaid Renderer、WebView 表示、Clipboard、コードジャンプは、この共通モデルを利用します。

ビルド成果物は `dist/extension.js` にまとめ、`vscode` は実行環境が提供する外部依存として bundle から除外します。

## Core Technologies

- **Language**: TypeScript with strict type checking
- **Runtime**: VS Code extension host / Node.js environment
- **VS Code API**: `@types/vscode` と `engines.vscode` に合わせて実装する
- **Bundler**: esbuild
- **Module Target**: TypeScript `module: Node16`, `target: ES2022`
- **Initial Analyzer Targets**: TypeScript / JavaScript

## Key Libraries

- **vscode API**: コマンド、UI、extension lifecycle の中心
- **TypeScript Compiler API or equivalent**: TypeScript / JavaScript の静的解析基盤として採用候補
- **esbuild**: extension entry を CommonJS bundle に変換する
- **ESLint + typescript-eslint**: TypeScript ソースの品質チェック
- **Mocha + @vscode/test-cli / @vscode/test-electron**: VS Code extension test の実行基盤

初期段階では、過剰なフレームワークや依存ライブラリを導入しません。解析、モデル化、描画の境界を保ちながら、必要性が明確になった依存だけを追加します。

## Core Model

共通処理フローモデルは、呼び出し関係だけではなく、処理順序・制御構造・ソース位置を保持する中核の domain contract です。Mermaid 生成、WebView 表示、コードジャンプに加えて、将来の Sequence Diff や Test Hints などの下流機能の基盤になります。

共通処理フローモデルは、言語別 Analyzer と表示機能の間に置く安定した contract です。少なくとも次の概念を表現できるようにします。

- `Call`
- `Branch`
- `Loop`
- `Await`
- `Return`
- `Throw`
- `Try/Catch`
- `Source Location`
- `Diagnostic`

Analyzer は不明な呼び出しを無理に解決しません。`unknown` / `unresolved` として `Diagnostic` 付きで保持します。部分的に解析できる場合は全体を失敗させず、部分結果と diagnostics を返します。

## Analyzer Boundaries

対象コードは実行しません。TypeScript / JavaScript Analyzer は静的解析だけで処理フローと推定呼び出し順を構築します。

言語別 Analyzer の責務は、言語固有 AST や symbol 情報を共通処理フローモデルへ変換することです。Mermaid の構文、WebView の DOM、Clipboard、VS Code command は Analyzer に持ち込みません。

将来の言語追加では、既存 Renderer や WebView を変更せずに Analyzer を追加できる境界を維持します。

## Development Standards

### Type Safety

TypeScript の `strict` を前提にします。Core logic では明示的な domain 型、戻り値型、diagnostic 型を活用し、曖昧な `any` を安易に使いません。VS Code API の型は UI・エディタ統合層に閉じ込め、core model や Analyzer の contract を editor 非依存に保ちます。

### Code Quality

ESLint は flat config で管理されています。現行ルールでは import 名の命名、波括弧、厳密等価、throw literal、セミコロンを警告します。警告は放置せず、実装時に解消する前提で扱います。

### Testing

テストは core logic の単体テストと VS Code 統合テストを分離します。Analyzer、共通処理フローモデル、Mermaid Renderer は VS Code を起動せずに検証できる形を優先します。CodeLens、WebView、Clipboard、コードジャンプのような VS Code API に依存する挙動は VS Code test runner で検証します。

### Performance and Responsiveness

解析処理は Extension Host を長時間ブロックしない設計にします。キャンセル可能な処理、解析結果のキャッシュ、ドキュメント変更時のキャッシュ無効化を考慮します。部分結果を返せる設計は、体感速度と失敗時の回復性を高めるための技術方針です。

### Security and Trust

ソースコードや解析結果を外部へ送信しません。LLM 連携を導入する場合も、明示的なオプション機能として core path から分離します。

WebView では Content Security Policy を設定します。Workspace Trust を考慮し、信頼されていない workspace で実行する機能、表示する内容、利用する API を慎重に制御します。

## Development Environment

### Required Tools

- Node.js / npm
- VS Code extension development environment
- TypeScript, ESLint, esbuild は npm scripts 経由で使用する

### Common Commands

```bash
npm run check-types
npm run lint
npm run compile
npm test
npm run package
```

## Key Technical Decisions

- **VS Code command-first integration**: ユーザー操作は `package.json` の `contributes.commands` と `vscode.commands.registerCommand` を対応させて実装する。
- **VS Code API as boundary**: VS Code API は UI・エディタ統合層に置き、core logic は editor 非依存に保つ。
- **Common flow model first**: Analyzer は Mermaid を直接生成せず、言語非依存の共通処理フローモデルを返す。
- **Stable Flow Model Contract**: 共通処理フローモデルは、言語別 Analyzer と Mermaid Renderer、WebView、Sequence Diff、Test Hints などの下流機能を接続する安定した契約として扱う。新しい言語を追加する場合は、既存の Renderer や UI を変更するのではなく、Analyzer が共通処理フローモデルへ変換することで対応できる設計を維持する。
- **Static analysis only by default**: 対象コードは実行せず、外部送信もしない。
- **Partial results over hard failure**: 解決不能な呼び出しは diagnostics として残し、可能な範囲の結果を返す。
- **Bundle for extension distribution**: 配布時は esbuild で単一の extension bundle を作り、VS Code が提供する `vscode` module は external にする。
- **Strict TypeScript by default**: 解析や図生成の中核は型で壊れ方を抑え、早い段階で `tsc --noEmit` に検出させる。

updated_at: 2026-07-11

---
_Document standards and patterns, not every dependency_
