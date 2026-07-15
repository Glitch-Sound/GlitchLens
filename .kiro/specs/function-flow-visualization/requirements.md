# Requirements Document

## Introduction

Function Flow Visualization は、TypeScript / JavaScript を用いて VS Code 上で開発するエンジニア、コードレビュアー、レガシーコードの保守開発者が、現在読んでいる関数の静的処理フローと推定呼び出し順を短時間で把握できるようにする機能です。

この機能は、CodeLens またはカーソル位置から対象関数を特定し、対象コードを実行せずに静的解析を行い、Mermaidシーケンス図 として VS Code 上に可視化結果を表示します。ユーザー価値は Mermaid 生成そのものではなく、初見コード理解、レビュー、設計確認、ドキュメント化の初動を速くすることにあります。

## Boundary Context

- **In scope**: CodeLens またはカーソル位置からの対象関数特定、TypeScript / JavaScript の静的解析、関数内の処理順序の保持、Call / Branch / Loop / Await / Return / Throw / Try/Catch の表現、Mermaidシーケンス図 表示、Mermaid テキストのコピー、unknown / unresolved と未解析箇所の明示、部分結果表示、シーケンス図のボタン・マウスホイール・トラックパッド／タッチデバイスのピンチによる表示倍率操作。
- **Out of scope**: Sequence Diff、Test Hints、Layer Classification、Architecture Rules、PNG / SVG 出力、Markdown への直接挿入、TypeScript / JavaScript 以外の言語対応、LLM 連携、実行時トレース、動的呼び出しの完全解決、呼び出し先関数内部の再帰的な深度解析。
- **Adjacent expectations**: この仕様は、ソースコードや解析結果を外部へ送信しないローカルの静的解析体験を前提とし、対象関数の理解に必要な範囲の静的処理フローを表示する。

## Requirements

### Requirement 1: 対象関数の特定

**Objective:** As a VS Code 上の TypeScript / JavaScript 開発者, I want CodeLens またはカーソル位置から対象関数を特定したい, so that 現在読んでいる関数の理解をすぐに開始できる

#### Acceptance Criteria

1. When ユーザーが対応言語の関数に表示された CodeLens を実行する, the GlitchLens extension shall その関数を解析対象として特定する
2. When ユーザーが対応言語の関数内にカーソルを置いて可視化を開始する, the GlitchLens extension shall カーソル位置を含む最も近い対象関数を解析対象として特定する
3. If カーソル位置または CodeLens から対象関数を特定できない, then the GlitchLens extension shall 解析を開始せず、対象関数を選択できないことをユーザーに通知する
4. If 対象ファイルが TypeScript または JavaScript ではない, then the GlitchLens extension shall この仕様の解析対象外であることをユーザーに通知する

### Requirement 2: 静的処理フローの抽出

**Objective:** As a コードレビュアー, I want 対象関数の静的処理フローと推定呼び出し順を抽出したい, so that コードを実行せずに処理の見通しを得られる

#### Acceptance Criteria

1. When 対象関数の解析が開始される, the GlitchLens extension shall 対象コードを実行せずに静的解析を行う
2. When 対象関数に複数の処理要素が含まれる, the GlitchLens extension shall 関数内の処理順序を保持した解析結果を生成する
3. When 対象関数に呼び出しが含まれる, the GlitchLens extension shall 推定呼び出し順として Call を抽出する
4. When 対象関数に分岐、ループ、await、return、throw、try/catch が含まれる, the GlitchLens extension shall Branch、Loop、Await、Return、Throw、Try/Catch として識別する
5. The GlitchLens extension shall 呼び出し先関数内部の再帰的な深度解析を行わない

### Requirement 3: 元コードと可視化結果の対応付け

**Objective:** As a コードリーディングを行う開発者, I want 可視化結果が元コードの処理順序と対応していることを確認したい, so that 図を見ながら対象関数の処理を追跡できる

#### Acceptance Criteria

1. When 可視化結果が生成される, the GlitchLens extension shall 対象コードの処理順序を保持した表示を提供する
2. When ユーザーが可視化結果を確認する, the GlitchLens extension shall 元コード内の処理を追跡できる情報を表示する
3. When 呼び出し順序が表示される, the GlitchLens extension shall 推定呼び出し順として一貫した順序で表示する
4. If 静的解析で順序を確定できない箇所がある, then the GlitchLens extension shall その箇所を確定済みの処理順序と区別できるように表示する

### Requirement 4: Mermaidシーケンス図 の生成と VS Code 上の表示

**Objective:** As a 初見コードを読むエンジニア, I want 静的処理フローを Mermaidシーケンス図 として見たい, so that 関数理解とドキュメント化の初動を速くできる

#### Acceptance Criteria

1. When 対象関数の解析結果が利用可能になる, the GlitchLens extension shall Mermaidシーケンス図 テキストを生成する
2. When Mermaidシーケンス図 テキストが生成される, the GlitchLens extension shall VS Code 上で可視化結果を表示する
3. When 可視化結果が表示される, the GlitchLens extension shall 対象関数の静的処理フローをユーザーが視覚的に確認できる状態にする
4. When 可視化結果に `loop`、`alt`、`opt`、`critical`、`option` が含まれる, the GlitchLens extension shall WebView 上で種類別のアクセント色を枠線とラベルへ適用し、枠線を実線かつ視認可能な太さで表示する
5. If Mermaidシーケンス図 として表現可能な部分結果が存在する, then the GlitchLens extension shall 完全な解析に失敗した場合でも表現可能な範囲を VS Code 上に表示する

### Requirement 5: Mermaid テキストのコピー

**Objective:** As a ドキュメント化を行う開発者, I want 表示された Mermaid テキストをコピーしたい, so that 説明やレビュー資料へ再利用できる

#### Acceptance Criteria

1. When VS Code 上に Mermaid 図が表示されている, the GlitchLens extension shall Mermaid テキストをクリップボードへコピーする操作を提供する
2. When ユーザーがコピー操作を実行する, the GlitchLens extension shall 現在表示されている図に対応する Mermaidシーケンス図 テキストをクリップボードへ保存する
3. If コピー可能な Mermaid テキストが存在しない, then the GlitchLens extension shall コピーできない理由をユーザーに通知する

### Requirement 6: 未解決要素と部分結果の扱い

**Objective:** As a レガシーコードの保守開発者, I want 解決できない呼び出しや解析できなかった箇所が明示されるようにしたい, so that 不完全な解析でも安全に読み進められる

#### Acceptance Criteria

1. If 呼び出し先を静的に解決できない, then the GlitchLens extension shall その呼び出しを unknown または unresolved として表示する
2. If unknown または unresolved が発生する, then the GlitchLens extension shall ユーザーが未解決要素を認識できる表示を提供する
3. If 対象関数の一部だけ解析可能である, then the GlitchLens extension shall 全体を失敗させず、解析できた範囲を表示する
4. When 部分結果が表示される, the GlitchLens extension shall ユーザーが解析できた範囲と解析できなかった箇所を区別できるように表示する
5. The GlitchLens extension shall 動的呼び出しの完全解決を保証しない

### Requirement 7: 安全性とローカル処理

**Objective:** As a ソースコードを扱う開発者, I want 解析がローカルで完結することを期待したい, so that 機密コードや解析結果を外部へ送信せずに利用できる

#### Acceptance Criteria

1. When 対象関数の解析が行われる, the GlitchLens extension shall ソースコードを外部サービスへ送信しない
2. When 解析結果または Mermaid テキストが生成される, the GlitchLens extension shall 解析結果を外部サービスへ送信しない
3. The GlitchLens extension shall LLM 連携をこの仕様の機能として提供しない
4. The GlitchLens extension shall 対象コードを実行時トレースによって解析しない

### Requirement 8: 応答性とユーザー通知

**Objective:** As a VS Code 上で作業中のエンジニア, I want 可視化操作が作業を妨げず、通常的な規模の関数ではすぐに結果を確認できることを期待したい, so that コード理解のために自然に利用できる

#### Acceptance Criteria

1. When ユーザーが通常的な規模の関数で可視化を開始する, the GlitchLens extension shall ユーザーが即時に静的処理フローを確認できる応答性を提供する
2. When ユーザーが可視化を開始する, the GlitchLens extension shall 解析中であることをユーザーが認識できる状態にする
3. While 解析が進行中である, the GlitchLens extension shall ユーザーが VS Code 上の通常の編集操作を継続できる状態を保つ
4. If 対象関数が大きいまたは複雑で完全な解析ができない, then the GlitchLens extension shall 完全な解析よりも応答性を優先して可能な範囲の部分結果を提示する
5. If 解析を完了できない, then the GlitchLens extension shall 失敗理由または解析できなかった箇所をユーザーに提示する

### Requirement 9: Mermaidシーケンス図の表示倍率・移動・余白

**Objective:** As a シーケンス図を読む開発者, I want 図の初期表示を安定させ、必要に応じて拡大縮小・移動したい, so that 関数規模に左右されず処理フローを読みやすく確認できる

#### Acceptance Criteria

1. When Mermaidシーケンス図が表示される, the GlitchLens extension shall UI上の表示倍率を100%として初期表示する
2. When Mermaidシーケンス図が表示倍率100%で表示される, the GlitchLens extension shall 関数の参加者数、メッセージ数、ラベル長、SVGの自然サイズに関係なく、文字、枠、線を同じ基準サイズで表示する
3. When 初期表示倍率100%のシーケンス図が表示される, the GlitchLens extension shall UI上の倍率表示と内部の描画倍率を分離し、現在の100%表示より少しだけ縮小した見た目で表示する
4. The GlitchLens extension shall 初期表示の内部描画倍率を固定値として管理し、後から調整できる状態にする
5. When 表示倍率100%のシーケンス図が表示領域を超える, the GlitchLens extension shall 図を自動縮小せず、固定された外側viewport内のスクロールによって図全体を閲覧できるようにする
6. When ユーザーが縮小操作を行う, the GlitchLens extension shall 外側viewportの幅、高さ、スクロール領域を維持したまま、viewport内のシーケンス図の内容だけを縮小する
7. When ユーザーがFit操作を行う, the GlitchLens extension shall 外側viewportを縮小せず、内側のシーケンス図全体がviewport内に収まる倍率を計算して適用する
8. When ユーザーがFit操作後に拡大または縮小操作を行う, the GlitchLens extension shall 現在の表示倍率を基準に表示倍率を変更する
9. When ユーザーが100%へのリセット操作を行う, the GlitchLens extension shall 初期表示の内部描画倍率、UI上の倍率表示、図のスクロール位置および移動位置を初期状態へ戻す
10. The GlitchLens extension shall 外側viewportと内側シーケンス図の表示用ラッパーを分離し、外側viewportにはズーム用transformを適用しない
11. When ユーザーが倍率変更、Fit、パン、またはスクロール操作を行う, the GlitchLens extension shall Mermaidテキストのコピー内容、SourceMap、SVG装飾、コピー機能、コードジャンプ機能に影響を与えない
12. When ユーザーが拡大操作を行う, the GlitchLens extension shall シーケンス図を一定の縦横比を維持したまま拡大する
13. When ユーザーが縮小操作を行う, the GlitchLens extension shall シーケンス図を一定の縦横比を維持したまま縮小する
14. The GlitchLens extension shall 拡大縮小の最小倍率と最大倍率を設け、範囲外の倍率を適用しない
15. When ユーザーがリセット操作を行う, the GlitchLens extension shall 初期表示倍率と初期表示位置へ戻す
16. When シーケンス図が表示領域を超える, the GlitchLens extension shall ユーザーが図をドラッグして表示位置を移動できるようにする
17. While ユーザーが図をドラッグしている, the GlitchLens extension shall 意図しないテキスト選択やページ全体のスクロールを発生させない
18. When Mermaidシーケンス図が表示される, the GlitchLens extension shall 特に縦方向のメッセージ、participant、activation、制御ブロック間に現状より十分な視覚的余白を提供する
19. If Mermaidの描画に失敗する, then the GlitchLens extension shall 既存のMermaidテキストfallbackを表示し、倍率・移動操作を要求しない
20. When ユーザーがシーケンス図上でマウスホイールを操作する, the GlitchLens extension shall ホイール操作の方向と量に応じて表示倍率を変更し、図の縦横比を維持する
21. When ユーザーがトラックパッドまたはタッチデバイス上でピンチ操作する, the GlitchLens extension shall ピンチ操作の拡大縮小に応じて表示倍率を連続的に変更し、図の縦横比を維持する
22. While ユーザーがシーケンス図上でズーム操作を行っている, the GlitchLens extension shall 設定された最小倍率と最大倍率を超える表示倍率を適用せず、通常の縦方向スクロールを継続できる状態を保つ

#### Requirements Change Notes

- 初期表示倍率を「自然サイズに左右されない固定倍率」から明示的な100%へ変更した。100%を図内要素の基準サイズとして扱うためである。
- `useMaxWidth: true` や SVG の `width:100%` による自動縮小を100%表示へ適用しない要件を追加した。大規模な図はスクロールで閲覧する。
- Fitを100%とは分離し、表示領域に収めるための自動縮小操作として定義した。
- 拡大・縮小はFit後を含めて現在倍率を基準に行い、100%リセット時には倍率だけでなくスクロール・移動位置も初期化するよう明確化した。
- 既存のMermaid表示、コピー、SourceMap、SVG装飾、および既存のズーム・パン操作は維持する。
- 外側viewportと内側シーケンス図を分離し、ズーム時に表示領域自体が縮小しないよう責務を明確化した。
- UI上の100%と内部描画倍率を分離し、初期表示だけを調整可能な固定係数で少し縮小できるようにした。
