# Research & Design Decisions

## Summary

- **Feature**: `function-flow-visualization`
- **Discovery Scope**: Extension / Integration-focused discovery
- **Key Findings**:
  - 既存コードは VS Code 拡張テンプレートに近く、`src/extension.ts` と `package.json` の command contribution が主な統合点である。
  - Steering は `VS Code Integration -> Application -> Language Analyzer -> Common Flow Model -> Renderer` の依存方向を要求しているため、設計はこの境界を最優先する。
  - VS Code API は CodeLens、Command、Webview、Clipboard、CancellationToken、Workspace Trust を提供するが、これらは Integration 層へ閉じ込める。

## Research Log

### 既存コードと統合点
- **Context**: Function Flow Visualization は既存 VS Code extension への大きな機能追加であり、既存実装の影響範囲を確認した。
- **Sources Consulted**: `package.json`, `src/extension.ts`, `tsconfig.json`, `src/test/extension.test.ts`
- **Findings**:
  - `package.json` は `glitchlens.helloWorld` のみを contribution している。
  - `src/extension.ts` は template の command registration のみを持つ。
  - TypeScript は `strict` 有効で、bundle は esbuild によって `dist/extension.js` へ生成される。
- **Implications**:
  - 既存機能との互換性リスクは低い。
  - `extension.ts` は thin entry とし、VS Code Integration module へ登録処理を移す。
  - 新規ファイルは責務別レイヤーに分け、既存 template logic は置き換える。

### VS Code API の公式確認
- **Context**: CodeLens、表示 UI、Clipboard、キャンセル、Workspace Trust の設計制約を確認した。
- **Sources Consulted**:
  - VS Code API reference: CodeLensProvider / Clipboard / CancellationToken
  - VS Code Webview guide
  - VS Code Workspace Trust guide
- **Findings**:
  - CodeLens provider は VS Code API の language feature として登録され、token によるキャンセルを受け取れる。
  - Webview はローカルリソースアクセス範囲を `localResourceRoots` で制限でき、CSP を併用することが推奨される。
  - Clipboard は VS Code API で提供されるため、Integration 層に閉じ込められる。
  - Workspace Trust は untrusted workspace で機能を制限・非表示にするための API と contribution 指針を持つ。
- **Implications**:
  - CodeLens 生成は軽量にし、重い解析は command 実行後に行う。
  - 表示 UI は VS Code 上の可視化手段として設計し、初期実装では Webview adapter が担当する。
  - Webview adapter は CSP、nonce、ローカルリソース制限を必須設計とする。
  - 解析中断には `CancellationToken` を Integration から Application へ adapter 変換して渡す。

### TypeScript Analyzer の解析基盤
- **Context**: 初期対応は TypeScript / JavaScript に限定され、対象コードを実行しない静的解析が必要。
- **Sources Consulted**:
  - TypeScript Compiler API documentation
  - `package.json` の `typescript` devDependency
- **Findings**:
  - TypeScript Compiler API は SourceFile、Program、AST traversal、JavaScript parsing の基盤を提供する。
  - プロジェクトには TypeScript が既に devDependency として存在する。
- **Implications**:
  - 初期 Analyzer は TypeScript Compiler API を採用候補ではなく主要設計基盤として扱う。
  - Analyzer は `typescript` 型に依存してよいが、VS Code API と Renderer には依存しない。
  - AST や Symbol 情報は Common Flow Model へ閉じ込め、外部へ公開しない。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Layered Architecture | Integration, Application, Analyzer, Model, Renderer を一方向依存にする | Steering と一致し、責務境界が明確 | ファイル数は増える | 採用 |
| Direct Analyzer to Mermaid | Analyzer が Mermaid を直接生成する | 初期実装は短い | 言語追加や表示変更で Analyzer が肥大化 | 不採用 |
| Webview-centric UI | Webview が解析・描画の中心になる | UI 実装がまとまる | VS Code API と core logic が混ざる | 不採用 |

## Design Decisions

### Decision: Common Flow Model を Stable Contract にする
- **Context**: Requirements はユーザー可視の振る舞いを要求し、steering は Common Flow Model を唯一の中間表現と定義している。
- **Alternatives Considered**:
  1. Analyzer 結果を Renderer が直接読む。
  2. Analyzer が Mermaid テキストを返す。
  3. Analyzer が Common Flow Model を返し、Renderer がそれだけを読む。
- **Selected Approach**: Analyzer は Common Flow Model と diagnostic 情報を返し、Renderer と表示 UI は Common Flow Model のみを入力にする。
- **Rationale**: 言語固有 AST と表示責務を分離でき、将来機能も同じ入力にできる。
- **Trade-offs**: 初期設計で domain model 型を定義する必要がある。
- **Follow-up**: Model schema の変更時は Renderer、Analyzer、表示 UI の traceability を再検証する。

### Decision: VS Code API は Integration 層に隔離する
- **Context**: Core logic を VS Code API 非依存にする steering がある。
- **Alternatives Considered**:
  1. Core service が `vscode.TextDocument` や `vscode.CancellationToken` を直接受け取る。
  2. Integration 層で plain data に変換する。
- **Selected Approach**: Integration 層が source text、file name、language id、cursor offset、cancellation adapter を作り Application へ渡す。
- **Rationale**: Analyzer と Renderer の単体テストが VS Code 起動なしで可能になる。
- **Trade-offs**: Adapter 変換の薄いコードが必要。
- **Follow-up**: VS Code API 型が core package に import されていないことを lint/review で確認する。

### Decision: 表示 UI は adapter として扱う
- **Context**: Requirements は「VS Code 上で可視化結果を表示する」とし、表示方式は design に委ねている。
- **Alternatives Considered**:
  1. Webview 固定の requirements/design にする。
  2. 初期表示 adapter を Webview とし、Application は表示方式を知らない。
- **Selected Approach**: 初期設計では Webview adapter を使うが、Application は visualization payload を返すだけにする。
- **Rationale**: Requirements の表示方式非依存性を保ちながら、VS Code 拡張として現実的な初期 UI を定義できる。
- **Trade-offs**: Webview 固有の CSP と message handling は Integration 層に寄る。
- **Follow-up**: Webview 以外の表示方法へ変更する場合も Renderer と Analyzer は再利用する。

## Risks & Mitigations

- TypeScript AST 解析の範囲が拡大しすぎる — この spec は対象関数内の静的処理フローに限定し、呼び出し先内部の深度解析は行わない。
- CodeLens が重くなる — CodeLens provider は対象関数候補の検出だけに留め、詳細解析は command 実行後に行う。
- Webview セキュリティ — CSP、nonce、`localResourceRoots` 制限、外部送信禁止を設計に含める。
- 大きな関数で応答性が落ちる — cancellation、部分結果、キャッシュ、応答性優先の制限を設計に含める。

## References

- [VS Code API Reference](https://code.visualstudio.com/api/references/vscode-api) — CodeLensProvider、Clipboard、CancellationToken の設計確認
- [VS Code Webview Guide](https://code.visualstudio.com/api/extension-guides/webview) — Webview、localResourceRoots、CSP の設計確認
- [VS Code Workspace Trust Guide](https://code.visualstudio.com/api/extension-guides/workspace-trust) — Restricted Mode と trust gating の設計確認
- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) — SourceFile、Program、AST traversal の解析基盤確認
