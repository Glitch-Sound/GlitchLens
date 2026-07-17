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

## References

- [Lezer Python](https://github.com/lezer-parser/python) — Python 構文解析の既存基盤
- [Mermaid Sequence Diagram](https://mermaid.js.org/syntax/sequenceDiagram.html) — 既存 Renderer が出力するシーケンス図構文
