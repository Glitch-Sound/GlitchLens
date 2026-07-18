# Requirements Document

## Introduction

Python Function Flow Visualization は、VS Code で Python を読む開発者が、現在カーソルを置いている関数の静的な処理フローと推定呼び出し順を Mermaid シーケンス図で短時間に把握するための機能である。

本機能は既存の TypeScript / JavaScript 対応と同じローカル静的解析の体験を Python に提供する。対象コードを実行せず、外部送信や実行時トレースも行わない。Python 固有の構文解析は Language Analyzer の責務とし、既存の Common Flow Model、Renderer、VS Code 表示機能の安定した契約を利用する。

## Boundary Context

- **In scope**: VS Code の `python` languageId、`def`、`async def`、クラスメソッド、CodeLens またはカーソル位置からの対象関数特定、関数内の Call / Await / Branch / Loop / Try-Catch / Return / Throw / Break / Continue の静的フロー抽出、`with` の処理フローへの反映、共通の `caller` / `self` と呼び出し先のライフライン、静的に推定できる participant の活性化期間、unknown / unresolved と diagnostic、部分結果、既存 Mermaid 表示とコピー。
- **Out of scope**: 対象関数または呼び出し先の実行、実行時トレース、外部サービスへのソースまたは解析結果の送信、LLM 連携、呼び出し先関数本体の再帰解析、lambda の関数候補化、Python の完全な型推論・動的ディスパッチの完全解決、`match` / `case`、`yield` / `yield from`、ジェネレータの実行意味論の可視化。
- **Compatibility**: TypeScript、JavaScript、TSX、JSX の既存の解析対象、可視化結果、Mermaid テキストとコピー内容の一致、CodeLens、診断、キャッシュ、および Workspace Trust の振る舞いを変更しない。

## Requirements

### Requirement 1: Python 関数の対象特定

**Objective:** As a VS Code 上で Python を読む開発者, I want CodeLens またはカーソル位置から Python 関数を選択したい, so that 現在読んでいる関数のフローをすぐに可視化できる

#### Acceptance Criteria

1. When ユーザーが languageId `python` のファイルで関数を開く, the GlitchLens extension shall トップレベル、クラス内、ネスト内を問わず `def` と `async def` を可視化対象の関数として認識する
2. When ユーザーが Python の `def` または `async def` に表示された CodeLens を実行する, the GlitchLens extension shall その関数を解析対象として特定する
3. When ユーザーが Python 関数内にカーソルを置いて可視化を開始する, the GlitchLens extension shall カーソル位置を含む最も近い対象関数を解析対象として特定する
4. If カーソル位置または CodeLens から Python の対象関数を特定できない, the GlitchLens extension shall 解析を開始せず、対象関数を選択できないことをユーザーに通知する
5. When Python の解析対象が登録される, the GlitchLens extension shall Python 用の対象特定を他言語用の関数特定実装から独立して扱う

### Requirement 2: Python の静的処理フロー抽出

**Objective:** As a Python 開発者, I want 関数内の静的な処理順序と推定呼び出し順を抽出したい, so that 対象コードを実行せずに関数の動きを理解できる

#### Acceptance Criteria

1. When Python の対象関数の解析が開始される, the GlitchLens extension shall 対象コードを実行せずに静的解析を行う
2. When 対象関数に関数呼び出しまたはメソッド呼び出しが含まれる, the GlitchLens extension shall 構文上の出現順ではなく静的に推定できる実行順として Call を抽出する
3. When 対象関数に呼び出しを含む `await` が含まれる, the GlitchLens extension shall Await をその呼び出しより先に処理フローへ表現し、Mermaid の操作メッセージに `await <操作名>` を一度だけ表示する
4. When 対象関数に `if`、`elif`、または `else` が含まれる, the GlitchLens extension shall 各分岐を Branch として抽出し、相互排他的な経路を逐次実行として接続しない
5. When 対象関数に `for` または `while` が含まれる, the GlitchLens extension shall ループ本体とループ後の処理を区別して Loop として抽出する
6. When 対象関数に `try`、`except`、または `finally` が含まれる, the GlitchLens extension shall 各経路を Try-Catch として抽出する
7. When 対象関数に `with` が含まれる, the GlitchLens extension shall 複数のコンテキスト式を左から右の評価順で抽出し、ブロック内の処理をその後に反映する
8. When 対象関数に `return` または `raise` が含まれる, the GlitchLens extension shall それぞれのキーワードと式を Mermaid に一度だけ表示し、式に含まれる呼び出しはその終端処理より前の実行順で表現する
9. When 対象関数に `break` または `continue` が含まれる, the GlitchLens extension shall それぞれ Break または Continue として抽出し、`break` はループ後の次の到達可能な処理へ、`continue` は次の反復へ進む到達可能性を表現する
10. The GlitchLens extension shall 呼び出し先関数の本体へ再帰的に入って解析しない
11. When 対象関数に通常代入、型注釈付き代入、または `+=` / `-=` 等の拡張代入が含まれる, the GlitchLens extension shall 代入先を新たな FlowNode として推測せず、右辺に含まれる Call / Await だけを静的な実行順で抽出し、呼び出しを含まない代入または拡張代入を unsupported-syntax diagnostic の対象にしない
12. When Python の `if` / `elif`、`for` / `while` が Mermaid 表示へ変換される, the GlitchLens extension shall 本体を含めず、条件式またはループヘッダだけを Branch / Loop の表示ラベルとして保持する
13. When Python の呼び出しが Mermaid シーケンス図へ表示される, the GlitchLens extension shall 静的に推定できる呼び出し開始から対応する呼び出しの終了までの participant の活性化期間を、対象関数から `caller` への return メッセージと区別し、処理順を維持して表現する
14. When Python の入れ子の呼び出しまたは `await` を伴う呼び出しが Mermaid シーケンス図へ表示される, the GlitchLens extension shall 静的に推定できる実行順に従い、それぞれの participant の活性化期間を区別して表現する

### Requirement 3: Python 解析結果の共通モデルへの変換

**Objective:** As a GlitchLens の保守開発者, I want Python 固有の構文解析結果を共通モデルへ変換したい, so that 既存の描画・表示機能を変更せずに Python を扱える

#### Acceptance Criteria

1. When Python の解析結果が生成される, the GlitchLens extension shall 既存の Common Flow Model を出力契約として使用する
2. The GlitchLens extension shall Python 固有の AST、パーサー、またはシンボル情報を Common Flow Model、Renderer、WebView、または VS Code Integration 層へ公開しない
3. When Python の解析結果が Mermaid 表示へ渡される, the GlitchLens extension shall 既存の Renderer を Python 固有の条件分岐なしで利用できる状態にする
4. The GlitchLens extension shall Python Analyzer を LanguageAnalyzer の公開契約に従う独立した Analyzer として実装可能な状態にする
5. The GlitchLens extension shall Flow Model の言語識別子を特定の既存対応言語だけに固定せず、登録済みの Analyzer が返す `python` を保持できるようにする
6. When Python の解析結果が Mermaid テキストとして提供される, the GlitchLens extension shall TypeScript と同じ共通 Mermaid 表現を使用し、Python 専用の活性化表現またはコピー形式を追加しない

### Requirement 4: 未解決呼び出しと部分結果

**Objective:** As a Python の動的なコードを読む開発者, I want 静的に確定できない箇所を明示した部分結果を確認したい, so that 図の確実性を理解しながら調査を進められる

#### Acceptance Criteria

1. If Python の呼び出し先を静的に特定または解決できない, the GlitchLens extension shall その呼び出しを `unknown` または `unresolved` として保持し、対応する diagnostic を生成する
2. If 計算された属性アクセス、添字アクセス、動的な呼び出し可能オブジェクト、または同等の動的構造により呼び出し先を確定できない, the GlitchLens extension shall 完全な解決を推測せず `unknown` または `unresolved` として扱う
3. If Python の対象関数の一部だけを解析できる, the GlitchLens extension shall 解析可能な範囲の Flow Model と diagnostic を返し、全体を失敗させない
4. If Python の構文が編集途中で不完全である、または初期スコープ外の構文に遭遇する, the GlitchLens extension shall 可能な範囲の関数候補または解析結果を提供し、提供できない場合は理由をユーザーへ通知する
5. When Python の部分結果が可視化可能である, the GlitchLens extension shall 既存の Mermaid 表示を用いてその結果と未解決・未解析の通知を表示する

### Requirement 5: 安全性、応答性、および既存言語との互換性

**Objective:** As a 機密性の高い Python コードを扱う開発者, I want 安全かつ既存言語対応を壊さない解析を利用したい, so that 安心して GlitchLens を継続利用できる

#### Acceptance Criteria

1. The GlitchLens extension shall Python の対象コード、呼び出し先、コールバック、または生成された式を実行しない
2. The GlitchLens extension shall Python の解析で実行時トレース、Python インタープリタの起動、外部プロセス、または外部サービスを利用しない
3. The GlitchLens extension shall Python のソースコード、Flow Model、diagnostic、または Mermaid テキストを外部へ送信しない
4. While Python の解析が進行中である, the GlitchLens extension shall キャンセル要求を受け付け、VS Code の通常の編集操作を不必要に妨げない
5. When Python Analyzer が追加される, the GlitchLens extension shall TypeScript、JavaScript、TSX、および JSX の既存の解析・表示・CodeLens の期待結果を維持する
6. When Workspace Trust により解析または可視化が制限されている, the GlitchLens extension shall Python に対しても既存言語と同じ制限を適用する
7. When ユーザーが Python の可視化で `Copy Mermaid` を実行する, the GlitchLens extension shall 画面の図を生成する Mermaid テキストと完全に一致し、participant の活性化表現を含むテキストをクリップボードへ保存する

### Requirement 6: Python 呼び出しのライフライン主体名

**Objective:** As a Python のシーケンス図を読む開発者, I want TypeScript と同じライフライン命名規則で Python の呼び出しを確認したい, so that 言語が異なっても同じ読み方で操作と主体を区別できる

#### Acceptance Criteria

1. When Python の `receiver.operation()` 形式の呼び出しで receiver が単一の識別子として静的に識別できる, the GlitchLens extension shall TypeScript と同じ静的命名規則に従い、先頭が大文字の receiver をクラス、それ以外の receiver をインスタンスとして、その receiver 名をライフラインのタイトルに表示する
2. When 同一の Python receiver に対する複数の呼び出しが表示される, the GlitchLens extension shall TypeScript と同じ主体として一つのライフラインへ集約し、異なる receiver に属する同名の操作を同じライフラインへ統合しない
3. When Python の呼び出しがライフラインへ表示される, the GlitchLens extension shall 関数名またはメソッド名だけを、引数、receiver、モジュール名、ファイル名を含まない操作名としてメッセージに表示する
4. If Python の直接関数呼び出し、チェーン途中の呼び出し、添字アクセス、動的属性アクセス、またはその他の動的な呼び出しでクラス名またはインスタンス名を静的に識別できない, the GlitchLens extension shall TypeScript と同じく `Unknown` または `Unresolved` の専用ライフラインへ集約し、推測したクラス名、インスタンス名、パッケージ名、モジュール名、またはファイル名をタイトルとして表示しない
5. When Python の可視化結果が Mermaid テキストとして表示またはコピーされる, the GlitchLens extension shall 共通 Requirement 16 および Requirement 17 と同じ最左の `caller`、その右の `self`、`caller` から `self` への開始呼び出し、主体ライフライン、操作メッセージ、戻り値メッセージ、unknown / unresolved 表示、および処理順序を保持する
6. The GlitchLens extension shall Python 固有の構文だけを理由に、共通 Requirement 16 と異なるライフライン命名またはメッセージ表示をしない
7. When Python の対象関数と静的に識別できる呼び出し先が Mermaid シーケンス図へ表示される, the GlitchLens extension shall `self` を含む各ライフラインの活性化期間を共通の活性化表現として保持する
8. When Python の対象関数に `return` が含まれる Mermaid シーケンス図が生成される, the GlitchLens extension shall 共通 Requirement 17 に従い、`self` から固定ライフライン `caller` への戻り値メッセージを表示し、直前の Python 呼び出し先をその送信元として表示しない
9. When Python の対象関数の Mermaid シーケンス図が生成される, the GlitchLens extension shall 共通 Requirement 16 に従い、関数本体の処理より前に `caller` から `self` への開始呼び出しを一度だけ表示し、Python の関数名、クラス名、モジュール名、またはファイル名を `caller` の実在名として推測しない

## Requirements Change Notes

- 本仕様は既存の Function Flow Visualization へ Python を追加する差分仕様であり、既存の Mermaid 表示、コピー、ズーム、SourceMap、および Workspace Trust の要件を置き換えない。
- 初期スコープ外の Python 構文は、完全な意味論を実装する対象ではない。解析可能な周辺部分を保持し、diagnostic と部分結果を優先する。
- Python の静的解析は Language Analyzer 境界で完結し、共通モデル以降の層へ Python 固有の依存を伝播させない。
- Python は共通の実行順・制御フロー契約を利用する。Common Flow Model、Mermaid 表現、共通 UI、または共通 contract の変更は Python spec だけで確定しない。
- 拡張代入は通常代入と同じく代入先の状態遷移を Flow Model へ推測せず、右辺に含まれる静的に抽出可能な Call / Await だけを保持する。これにより、ループのカウンタ更新などを partial analysis の理由にしない。
- ライフラインの主体名は共通 Requirement 16 に従う。Python 固有の役割は、Python の構文から主体名候補を抽出して共通のライフライン命名規則へ渡すことであり、Python 専用の Mermaid 表示規則を持たない。
- モジュール名、パッケージ名、ファイル名、および enclosing class 名は、主体を静的に識別できない Python 呼び出しの代替ライフライン名に用いない。識別不能な主体は共通の `Unknown` または `Unresolved` を用いる。
- Python の活性化期間は、静的に推定できる呼び出し順と終端処理を Mermaid テキストへ反映する共通契約である。Python 固有の表示規則やコピー形式を追加せず、画面の図を生成する Mermaid テキストとコピー内容を完全に一致させる。
- Python の `return` は、共通 Requirement 17 に従い `self` から固定 `caller` への戻り値メッセージとして表示する。Python の call participant、await、または動的 receiver を戻り値の送信元として扱わない。
- Python の開始呼び出しは、共通 Requirement 16 に従い固定 `caller` から `self` へ一度だけ表示する。Python 固有の entry 表示、caller 名の推測、または Renderer / WebView / Clipboard の分岐は追加しない。
- 動的な呼び出し先、未解決要素、または部分解析により活性化期間を確定できない場合は、実行時の状態を推測しない。表現可能な静的処理順、既存の `unknown` / `unresolved`、および diagnostic の契約を維持する。
