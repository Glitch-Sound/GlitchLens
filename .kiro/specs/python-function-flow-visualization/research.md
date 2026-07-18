# Research & Design Decisions

## Summary

- **Feature**: python-function-flow-visualization
- **Discovery Scope**: Extension（軽量統合調査）
- **Key Findings**:
  - Python Analyzer は Call の `calleeName` だけを生成し、`participant` を供給していないため、共通 Renderer では resolved call も `Unknown` に集約される。
  - Python の Await は Call の後に node を置いており、既存 Renderer が Await → Call edge で判定する `await` message 表示と一致しない。
  - Python の Return / Throw はキーワードを含む全文を保持しており、共通 formatter によるキーワード付与と重複する可能性がある。

## Research Log

### TypeScript と Python の共通描画契約

- **Sources Consulted**: `src/analyzers/python/pythonAnalyzer.ts`、`src/analyzers/typescript/typescriptAnalyzer.ts`、`src/flow-model/flowParticipant.ts`、`src/flow-model/flowNode.ts`、`src/renderer/mermaidRenderer.ts`、`src/test/pythonFunctionFlow.test.ts`、`src/test/typescriptFlowExtractor.test.ts`
- **Findings**:
  - TypeScript Analyzer は単一 identifier receiver を participant に変換し、先頭大文字を class、それ以外を instance とする。直接 Call は操作名を保持する一方、participant は `Unknown` を使う。
  - MermaidRenderer は participant key でライフラインを集約し、Call の incoming edge の source が Await の場合にだけ `await ` を付与する。Return / Throw のキーワードも renderer 側で付与する。
  - Python Analyzer の現行 Call は participant 未設定で、`results.append()` と `logger.error()` のような別 receiver が同じ Unknown ライフラインになる。Await / Return / Throw の node 内容と edge 順序も renderer の前提と一致しない。
- **Implications**:
  - 修正責務は Python Analyzer の Common Flow Model 変換とその test に閉じ、Renderer / WebView に言語分岐を追加しない。
  - 不明な主体は source URI、モジュール名、enclosing class で補完せず、共通の Unknown / Unresolved を使う。

## Design Decisions

### Decision: Python は既存 FlowParticipant と edge 意味論を供給する

- **Alternatives Considered**:
  1. Python 専用の MermaidRenderer / WebView 表示規則を追加する。
  2. Renderer が Python の `calleeName` や source URI から participant を推測する。
  3. Python Analyzer が既存 `FlowParticipant` と Await / terminal の edge 意味論を出力する。
- **Selected Approach**: 3 を採用する。
- **Rationale**: Common Flow Model first と Renderer independence を維持し、同一 Mermaid text が表示と Clipboard で再利用される既存契約を保てる。
- **Trade-offs**: Python の動的 receiver は完全に同定しない。表示情報を推測する代わりに Unknown / Unresolved と diagnostic を残す。

### Synthesis

- **Generalization**: participant、awaited-call、terminal label は言語別 UI の問題ではなく、Analyzer が満たす共通 Flow Model contract の問題である。
- **Build vs. Adopt**: 新規ライブラリは導入しない。既存の `@lezer/python`、FlowParticipant、MermaidRenderer を使用する。
- **Simplification**: 新しい adapter、participant 種別、Renderer 分岐、型推論は追加しない。PythonAnalyzer と既存 test fixture の変更に限定する。

## Risks & Mitigations

- participant を class / instance と誤認するリスク — 単一識別子だけを静的候補にし、chain / computed / dynamic receiver はフォールバックする。
- Await の edge 変更が実行順を壊すリスク — node order、Await → Call edge、Mermaid message、SourceMap を同じ fixture で検証する。
- terminal label の修正が既存表示を壊すリスク — Return / Throw の式と message を個別に検証し、TypeScript Renderer 回帰を維持する。
- Analyzer version 更新漏れのリスク — parser / 変換意味論の変更では既存 cache key の analyzer version を更新する。

### Decision: 共通 root の表示名を `self` として受け入れる

- **Context**: 共通 Requirement 16 が、空の左端ライフラインを表示名 `self` へ変更した。
- **Sources Consulted**: `src/renderer/mermaidRenderer.ts`、`src/integration/webviewMermaid.js`、共通仕様の Requirement 16。
- **Findings**: Renderer は内部 participant ID `root` を message、SourceMap、WebView の装飾識別に使用している。Python Analyzer は root participant を生成せず、共通 Renderer の出力を利用する。
- **Selected Approach**: Python 固有の participant、Renderer、WebView 分岐を追加せず、共通 Renderer が出力する `participant root as self` をそのまま利用する。
- **Follow-up**: Python Flow Model を入力とした Renderer 回帰で、`self` の表示、操作名、Unknown / Unresolved、コピー対象 Mermaid text の一致を確認する。

### Decision: 活性化命令は共通 Mermaid テキストの契約として扱う

- **Context**: WebView が描画直前にのみ `activate` / `deactivate` を補完しており、画面上の活性化と Clipboard の Mermaid テキストが一致しない。
- **Sources Consulted**: `src/renderer/mermaidRenderer.ts`、`src/integration/webviewMermaid.js`、`src/integration/visualizationView.ts`、`src/test/mermaidRenderer.test.ts`、`src/test/visualizationView.test.ts`。
- **Findings**:
  - `MermaidRenderer` の `RenderContext` は Mermaid の行、SourceMap、処理 Note の行番号を一元的に管理している。
  - WebView の `buildMermaidRenderText()` は正規 Mermaid テキストを別の描画用文字列へ変換するため、Clipboard が保持する文字列と分岐する。
  - Python の Flow Model は既存の共通 Renderer を入力として利用するため、Python 専用の活性化ロジックを追加しても言語横断の不一致を解消できない。
- **Alternatives Considered**:
  1. WebView の変換済み文字列を Clipboard へ返す。
  2. Python Analyzer が活性化専用データを出力する。
  3. 共通 Renderer が活性化命令を含む正規 Mermaid テキストを生成し、WebView と Clipboard がその文字列を共有する。
- **Selected Approach**: 3 を採用する。共通仕様が `MermaidRenderer` 内で活性化命令を生成し、WebView は文字列を変更せずに描画する。Python 仕様は、その共通契約を Python Flow Model の回帰 fixture で検証する。
- **Rationale**: Common Flow Model first、Renderer independence、Mermaid-first、および表示とコピーの完全一致を同時に保てる。
- **Trade-offs**: 共通 Renderer の行生成時に活性化命令を扱うため、SourceMap と process note の Mermaid 行番号を正規テキスト基準で回帰検証する必要がある。
- **Follow-up**: 共通 `function-flow-visualization` 仕様で Renderer / WebView の改修を設計・実装した後、Python の Call / Await / Return / Throw fixture で完全一致を確認する。

### Decision: Python return は共通 caller contract を利用する

- **Context**: Python の `results.append(); return results` で、共通 Renderer が `results` を関数 return の送信元として表示する。
- **Sources Consulted**: `src/analyzers/python/pythonAnalyzer.ts`、`src/renderer/mermaidRenderer.ts`、`src/test/pythonFunctionFlow.test.ts`、共通 Requirement 17。
- **Findings**:
  - PythonAnalyzer は Return node の式と edge を既存 Common Flow Model に出力済みであり、呼び出し元情報を持たない。
  - 問題は Python AST の変換ではなく、Return node を描画する共通 Renderer の送信元・送信先選択にある。
  - Python call participant の activation 終了は、対象関数の return sender を決める根拠にはならない。
- **Selected Approach**: PythonAnalyzer は変更せず、共通 Renderer の固定 caller を利用する。Python 仕様は通常 Call、await、nested Call、Unknown / Unresolved、partial result の return 回帰を所有する。
- **Rationale**: Python 専用の FlowParticipant、caller 推測、Mermaid / WebView 分岐を追加せず、TypeScript / JavaScript と同じ return 契約を利用できる。
- **Follow-up**: Python fixture の旧 `callee-->>root: return` 期待値を `root-->>caller: return` と否定 assertion へ置換し、SourceMap と activation の順序を確認する。

## References

- [Lezer Python](https://github.com/lezer-parser/python) — Python 構文解析の既存基盤
- [Mermaid Sequence Diagram](https://mermaid.js.org/syntax/sequenceDiagram.html) — 既存 Renderer が出力するシーケンス図構文

### Decision: Python は共通 synthetic entry contract を利用する

- **Context**: Python の図でも、固定 `caller` と `self` の関係を return だけでなく呼び出し開始から追跡できる必要がある。
- **Sources Consulted**: `src/analyzers/python/pythonAnalyzer.ts`、`src/renderer/mermaidRenderer.ts`、`src/test/pythonFunctionFlow.test.ts`、共通 Requirement 16 / 17。
- **Selected Approach**: PythonAnalyzer は caller、synthetic node、または entry edge を生成せず、共通 Renderer が固定 `caller->>root: invoke` を出力する。Python spec は共通 entry の順序・一意性・表示／コピー一致を fixture で検証する。
- **Rationale**: Python 固有の Renderer / WebView / Clipboard 分岐、caller 名推測、SourceMap の架空エントリを追加せず、TypeScript / JavaScript と同じ Mermaid contract を維持できる。
- **Follow-up**: 通常 Call、await、partial、unknown / unresolved を含む Python fixture で、entry が本体より前に一度だけ現れ、return と activation の既存契約を壊さないことを確認する。
