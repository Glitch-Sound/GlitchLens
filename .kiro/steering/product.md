# Product Overview

GlitchLens は、VS Code 上で現在読んでいる関数を中心に、静的解析によって関数内の処理フローと推定呼び出し順を Mermaid のシーケンス図として可視化する拡張機能です。コードを実行したりトレースを収集したりするのではなく、ローカルのソースコードから即時に理解の手がかりを作ることを目的にします。

現時点の実装は VS Code 拡張テンプレートに近く、`package.json` の説明が製品意図の主な根拠です。今後の実装では、この方向性を保ちながら機能を具体化します。

## Product Principles

- **Function-first**: 対象はコードベース全体ではなく、現在読んでいる関数を中心にする。
- **Local-first**: ソースコードを外部へ送信せず、基本的にローカル解析で完結させる。
- **Mermaid-first**: 出力は Mermaid sequence diagram として再利用しやすい形を優先する。
- **Immediate over complete**: 完全性より即時性を優先し、不明な呼び出しは `unknown` または `unresolved` として明示する。

## Core Capabilities

- 現在の関数を起点に、静的処理フローと推定呼び出し順を抽出する
- 分岐、ループ、例外処理、`await`、`return` を処理フローとして扱う
- TypeScript と JavaScript を初期対応言語とする
- CodeLens またはカーソル位置から解析し、WebView へ Mermaid 図を表示する
- Mermaid コピーと、図から該当コードへのジャンプを中核体験にする
- 解析できない呼び出しや型情報が不足した箇所を、隠さず `unknown` / `unresolved` として示す

## Target Use Cases

- unfamiliar な関数で、処理順序と呼び出し関係の見取り図を短時間で得たい
- レビュー時に、分岐や例外処理を含む静的処理フローを図で確認したい
- デバッグや調査の前段階として、推定呼び出し順の仮説を作りたい
- ドキュメントや説明用に Mermaid 図を再利用したい

## Language Scope

初期対応は TypeScript と JavaScript に集中します。Python、Java、Go、C# は将来対応候補として扱い、初期設計では parser や解析器を差し替えやすい境界を意識します。

## Future Capabilities

以下は中核体験と区別し、将来機能として扱います。

- Sequence Diff
- Test Hints
- レイヤー分類
- アーキテクチャ違反検出

## Value Proposition

GlitchLens の価値は、コード理解の初動を短くすることです。静的なソース閲覧だけでは追いにくい処理順序や呼び出し関係を、VS Code 内で可視化可能な Mermaid 図に変換することで、調査・レビュー・説明の往復を減らします。

製品判断では「開発者がエディタから離れず、すぐに読める図を得られること」を優先します。

updated_at: 2026-07-11

---
_Focus on patterns and purpose, not exhaustive feature lists_
