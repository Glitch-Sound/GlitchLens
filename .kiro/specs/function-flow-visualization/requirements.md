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
4. When 可視化結果に `loop`、`alt`、`opt`、`critical`、`option` が含まれる, the GlitchLens extension shall WebView 上で種類別のアクセント色を枠線とラベルへ適用し、枠線を実線かつ `1.8px` の太さ、ラベル文字を `14px` のサイズで表示する
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
23. When Mermaidシーケンス図のメッセージが表示される, the GlitchLens extension shall メッセージ間の間隔を維持したまま、メッセージラベルのみを現在位置より少し下げ、対応する線との距離を近づけて表示する

#### Requirements Change Notes

- 初期表示倍率を「自然サイズに左右されない固定倍率」から明示的な100%へ変更した。100%を図内要素の基準サイズとして扱うためである。
- `useMaxWidth: true` や SVG の `width:100%` による自動縮小を100%表示へ適用しない要件を追加した。大規模な図はスクロールで閲覧する。
- Fitを100%とは分離し、表示領域に収めるための自動縮小操作として定義した。
- 拡大・縮小はFit後を含めて現在倍率を基準に行い、100%リセット時には倍率だけでなくスクロール・移動位置も初期化するよう明確化した。
- 既存のMermaid表示、コピー、SourceMap、SVG装飾、および既存のズーム・パン操作は維持する。
- 外側viewportと内側シーケンス図を分離し、ズーム時に表示領域自体が縮小しないよう責務を明確化した。
- UI上の100%と内部描画倍率を分離し、初期表示だけを調整可能な固定係数で少し縮小できるようにした。
- メッセージ間の間隔は維持したまま、メッセージラベルのみを少し下げて対応する線に近づけ、ラベルの読みやすさを改善する要件を追加した。

### Requirement 10: 可視化コントロールの表示

**Objective:** As a シーケンス図を読む開発者, I want 操作コントロールを簡潔かつ視認しやすく確認したい, so that 図の表示操作を迷わず実行できる

#### Acceptance Criteria

1. When 可視化結果が表示される, the GlitchLens extension shall 関数名の直下に `success`、`partial`、`failure` などの内部状態名を表示しない
2. When 解析警告、未解決要素、部分解析、失敗理由などの user-visible notice が存在する, the GlitchLens extension shall 内部状態名の非表示に関係なく既存の notice を表示する
3. The GlitchLens extension shall `VisualizationViewModel.state` などの内部状態管理、解析判定、通知契約を UI表示削除のためだけに変更しない
4. When 可視化結果が表示される, the GlitchLens extension shall `Copy Mermaid`、`100%`、`Fit`、`-`、現在倍率、`+` の順で同じ1行に左寄せで配置する
5. The GlitchLens extension shall 現在倍率を示す表示を操作可能なボタンにせず、既存のズーム、Fit、100%リセット、Copy Mermaid の動作とメッセージ通信を維持する
6. When WebView の表示幅が通常または狭い場合, the GlitchLens extension shall 基本的にコントロールを1行に保ち、指定された左から右の順序を維持する
7. When ズーム操作ボタンが表示される, the GlitchLens extension shall VS Code のテーマ変数を優先したテーマに近い背景色と、Dark / Light テーマで十分なコントラストを持つ文字色を適用する
8. When ズーム操作ボタンまたは Copy Mermaid に hover、focus、disabled 状態が発生する, the GlitchLens extension shall 各状態で背景色、文字色、フォーカス表示の視認性を維持する
9. When `Copy Mermaid` が表示される, the GlitchLens extension shall 青系の背景色と十分なコントラストを持つ文字色を適用し、コピー処理、Workspace Trust 制約、成功・失敗通知を変更しない
10. The GlitchLens extension shall Requirement 10 の UI変更によって Mermaid text、Common Flow Model、Renderer contract、SourceMap contract、SVG装飾、fallback 表示の契約を変更しない

#### Requirements Change Notes

- 内部状態名は内部契約として保持し、ユーザー向けの関数名直下の表示だけを削除する。
- user-visible notice は内部状態名とは別の情報であるため、警告・未解決要素・部分解析・失敗理由の表示を維持する。
- ズーム操作と Copy Mermaid を1行の左寄せツールバーへ統合し、Copy Mermaid を先頭に配置する。
- WebView標準のVS Codeテーマ変数を利用して、ズームボタンはテーマ近似色、Copy Mermaid は目立ちすぎないテーマ寄りの青系配色とする。

### Requirement 11: 条件ラベルの視認性

**Objective:** As a シーケンス図を読む開発者, I want `loop`、`alt`、`opt`、`critical`、`option` の条件ラベルを枠線と対応づけて読みやすく確認したい, so that 制御ブロックの条件を素早く理解できる

#### Acceptance Criteria

1. When `loop`、`alt`、`opt`、`critical`、または `option` の条件ラベルが表示される, the GlitchLens extension shall 条件ラベルの文字色を対応する枠線の色と一致させる
2. When `loop`、`alt`、`opt`、`critical`、または `option` の条件ラベルが表示される, the GlitchLens extension shall 条件ラベルを現在の位置より上方へ配置し、対応する枠の上部に近づけて表示する
3. When 条件ラベルの文字色または位置が変更される, the GlitchLens extension shall 条件の文言、制御ブロックの範囲、メッセージ間の間隔、および Mermaid テキストの内容を変更しない
4. When Mermaidシーケンス図に任意のフラグメント種別とその遷移条件が含まれる, the GlitchLens extension shall フラグメント内条件ラベルの文字色を、対応するフラグメント種別ラベルの文字色および枠線色と一致させる
5. When フラグメント内条件ラベルが表示される, the GlitchLens extension shall DOM上の表示順や画面上の距離に依存せず、対応するフラグメント種別との意味的な対応に基づいて文字色を決定する

#### Requirements Change Notes

- `loop`、`alt`、`opt`、`critical`、`option` の条件ラベルについて、文字色を対応する枠線色に合わせる要件を追加した。
- 条件ラベルを上方へ移動し、枠の上部に近づけることで、制御ブロックとの対応関係を読み取りやすくする要件を追加した。
- 条件ラベルの色対応を一般化し、具体的な条件文言や関数固有のフラグメント構成に依存せず、対応するフラグメント種別ラベルおよび枠線と同色にすることを明文化した。
- フラグメント内条件ラベルについて、DOM順や画面上の距離による推測ではなく、フラグメント種別との意味的な対応に基づいて色を決定することを明文化した。

### Requirement 12: 処理ブロックの密度とテーマ識別性

**Objective:** As a シーケンス図を読む開発者, I want `continue`、`break`、式評価などの処理ブロックをコンパクトで背景から識別できる見た目で確認したい, so that 処理フローを追う際に不要な空白に妨げられず、処理ブロックを素早く見分けられる

#### Acceptance Criteria

1. When 制御移動、式評価、または同等の処理ノードに由来する Mermaid Note が表示される, the GlitchLens extension shall ブロック内の文字周囲に過剰な余白を設けず、内容量に見合うコンパクトな内側余白で表示する
2. When 処理ノードに由来する Mermaid Note が表示される, the GlitchLens extension shall 図のキャンバス背景色と視覚的に区別できるテーマ対応の背景色を適用する
3. When Dark テーマまたは Light テーマで処理ノードに由来する Mermaid Note が表示される, the GlitchLens extension shall 背景色、枠線色、および文字色の十分なコントラストを維持する
4. The GlitchLens extension shall 処理ブロックの表示を特定の文言（`continue`、`break`、`retry++` など）に依存させず、処理ノードに由来する Note という意味的な種別に基づいて適用する
5. When 処理ブロックの内側余白または背景色を変更する, the GlitchLens extension shall Requirement 9.18 で定めたメッセージ、participant、activation、および制御ブロック間の視覚的余白を縮小しない
6. When 処理ブロックの見た目を変更する, the GlitchLens extension shall Mermaid テキスト、処理ノードの意味、表示順、SourceMap、コピー機能、コードジャンプ機能、および Mermaid 描画失敗時の fallback 表示を変更しない

#### Requirements Change Notes

- `continue`、`break`、式評価などの処理を表す Mermaid Note を、条件文言ではなく処理ノード由来という意味的な単位で対象化した。
- 図全体の縦方向余白を縮める要求ではなく、処理ブロック内の余白だけをコンパクトにする要件として定義し、Requirement 9.18 と両立させた。
- 背景色は特定テーマ向けの固定色ではなく、Dark / Light テーマのキャンバス背景から区別でき、十分なコントラストを保つテーマ対応の配色を求めるよう明文化した。
