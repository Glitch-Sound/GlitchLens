# Research & Design Decisions

## Summary

- **Feature**: python-function-flow-visualization
- **Discovery Scope**: Extension
- **Key Findings**:
  - Python の既存 Analyzer は `MemberExpression` の receiver を破棄して最後のメソッド名だけを `calleeName` へ保存している。
  - 共通 Renderer は `calleeName` を participant label と同一視しているため、Python 専用表示ではなく共通 Flow Model contract の変更が必要である。
  - `@lezer/python`、既存の SourceLocation、MermaidRenderer を使えば、新規依存や実行時型解決なしに主体名候補を扱える。

## Research Log

### Python call extraction and common rendering

- **Context**: Requirement 6 により、Python のライフラインを関数名ではなく責務主体として表示する必要がある。
- **Sources Consulted**: `src/analyzers/python/pythonAnalyzer.ts`、`src/flow-model/flowNode.ts`、`src/flow-model/flowModel.ts`、`src/renderer/mermaidRenderer.ts`、`src/test/pythonFunctionFlow.test.ts`
- **Findings**:
  - Python の Name と MemberExpression は receiver / class / module 候補を構文から得られるが、現状は `calleeName` だけへ縮約している。
  - 共通 Renderer は root function 名と call の `calleeName` を participant に使い、異なる主体の同名メソッドも統合する。
  - Source URI の basename は、クラスや receiver を特定できない場合の module fallback 候補になる。
- **Implications**:
  - Python Analyzer は AST 型を公開せず、共通 `FlowParticipant` の plain data を生成する。
  - participant label の重複排除は Python Analyzer ではなく共通 Renderer が key に基づいて担う。

## Design Decisions

### Decision: Python は共通 participant contract だけを供給する

- **Alternatives Considered**:
  1. Python WebView に専用の participant 表示規則を追加する。
  2. Python Analyzer がメソッド名だけを出力し、Renderer が文字列を推測する。
  3. Python Analyzer が共通 `FlowParticipant` を出力し、共通 Renderer がすべての言語を同じ規則で描画する。
- **Selected Approach**: 3 を採用する。
- **Rationale**: Common Flow Model first と Renderer independence を維持し、Python 固有の UI 分岐を増やさない。
- **Trade-offs**: Python の動的 receiver は完全に同定しないため、Unknown / Unresolved へ明示的にフォールバックする。
- **Follow-up**: MemberExpression、クラスメソッド、top-level function、chain call の fixture を追加して優先順位を検証する。

## Risks & Mitigations

- receiver をクラス名と誤認するリスク — 構文上の候補だけを instance / role として保持し、型名を推測しない。
- module fallback が過度に適用されるリスク — target source がない場合の caller source 利用をテストで固定し、Unknown / Unresolved の条件を明示する。
- 共通 contract 変更が既存言語へ波及するリスク — TypeScript / JavaScript / Python の Renderer と clipboard 回帰を同じ test suite で確認する。

## References

- [Lezer Python](https://github.com/lezer-parser/python) — Python 構文木の既存解析基盤
- [Mermaid Sequence Diagram](https://mermaid.js.org/syntax/sequenceDiagram.html) — participant と message の表示構文
