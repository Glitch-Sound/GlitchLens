# Implementation Plan

- [x] 1. Foundation: 拡張の起動基盤とローカル実行境界を整える
- [x] 1.1 VS Code 側の起動口と設定を GlitchLens の可視化機能へ置き換える
  - hello world の起動口を、関数フロー可視化 command、CodeLens 起動、Workspace Trust 前提の manifest 設定へ置き換える。
  - TypeScript / JavaScript だけが初期対象になるよう、対応言語と非対応言語の判定が明確になる。
  - VS Code の command palette から可視化 command が見え、未実装の外部連携や LLM 連携の起動口が存在しない状態になる。
  - _Requirements: 1.1, 1.2, 1.4, 7.3_
- [x] 1.2 Core logic と VS Code Integration の境界を実装時に守れる土台を作る
  - VS Code API を Integration 境界へ閉じ込めるための module 境界と import 方針を実装に反映する。
  - core 側の単体テストと VS Code 統合テストを分けて実行できる状態にする。
  - `strict` TypeScript、lint、test scripts が新しい構成でも通る状態になる。
  - _Requirements: 7.1, 7.2, 8.3_

- [x] 2. Common Flow Model: 静的処理フローの安定契約を実装する
- [x] 2.1 FlowNode、FlowEdge、metadata、source location、diagnostic のモデルを定義する
  - Call、Branch、Loop、Await、Return、Throw、Try/Catch、unknown / unresolved を表せるモデルにする。
  - FlowEdge は接続元、接続先、edge kind、execution order、任意の label、condition、source location を保持する。
  - metadata は analyzer id、analyzer version、language id、generated at、source document version、completeness、configuration digest を保持する。
  - AST、Symbol、VS Code object を含まない plain data として扱える状態になる。
  - _Requirements: 2.2, 2.3, 2.4, 3.1, 3.3, 3.4, 6.1, 6.2, 7.2_
- [x] 2.2 FlowModel の順序、部分結果、未解決要素を検証する単体テストを追加する
  - node order と edge execution order が元コード順を保持できることを fixture で確認する。
  - unknown / unresolved、partial completeness、diagnostic が同じモデル内で表現できることを確認する。
  - FlowEdge と metadata が言語固有 object を保持しないことを型とテストで確認できる。
  - _Requirements: 2.2, 3.1, 3.3, 3.4, 6.1, 6.3, 6.4, 7.2_

- [x] 3. Analyzer: TypeScript / JavaScript の対象関数と静的処理フローを抽出する
- [x] 3.1 Language Analyzer 契約と analyzer selection を実装する
  - Analyzer は source file、cursor position、configuration、cancellation を受け取り、Common Flow Model と diagnostics を返す。
  - TypeScript / JavaScript の analyzer が選択され、非対応言語では解析開始前に扱える error が返る。
  - Analyzer から Mermaid、WebView、Clipboard、VS Code API へ依存しない状態になる。
  - _Requirements: 1.4, 2.1, 2.4, 6.3, 7.1, 7.2_
- [x] 3.2 TypeScript / JavaScript の関数特定を実装する
  - CodeLens 用の関数候補 range と、カーソル位置を含む最も近い関数を解決できる。
  - 対象関数が見つからない場合は解析を開始せずに扱える結果を返す。
  - TypeScript と JavaScript の代表的な関数宣言、関数式、arrow function で対象関数が特定できる。
  - _Requirements: 1.1, 1.2, 1.3_
- [x] 3.3 対象関数内の Call と制御構造を source order で抽出する
  - 関数 body の処理順序に沿って Call、Branch、Loop、Await、Return、Throw、Try/Catch を識別する。
  - Branch、Loop、Try/Catch の接続関係を FlowEdge として保持する。
  - 呼び出し先関数内部へ再帰的に入らず、対象関数内の静的処理フローだけがモデル化される。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 7.4_
- [x] 3.4 未解決呼び出し、部分結果、キャンセルを Analyzer で扱う
  - 静的に解決できない呼び出しは unknown または unresolved としてモデルと diagnostic に残る。
  - 一部の statement が解析できなくても、解析済み範囲と未解析箇所を区別できる部分結果が返る。
  - cancellation が要求された場合に古い解析を中断でき、対象コードの実行や実行時トレースを行わない状態が保たれる。
  - _Requirements: 6.1, 6.3, 6.5, 7.1, 7.4, 8.3, 8.4_
- [x] 3.5 Analyzer の単体テストを代表構文と失敗ケースで揃える
  - TypeScript / JavaScript の関数特定、呼び出し順、分岐、ループ、await、return、throw、try/catch を検証する。
  - unresolved、partial result、target not found、unsupported language の振る舞いがテストで確認できる。
  - 深度解析しないことと対象コードを実行しないことを fixture で確認できる。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 6.1, 6.3, 6.5, 7.4_

- [x] 4. Renderer: Common Flow Model から Mermaid sequenceDiagram を生成する
- [x] 4.1 Mermaid text、source map、renderer warning を生成する
  - FlowNode と FlowEdge の順序を使って sequenceDiagram text を生成する。
  - unknown / unresolved と順序不確定箇所が Mermaid 上で認識できる形になる。
  - Mermaid 要素と source location の対応を source map として返し、Renderer は UI 固有表示文言や VS Code API に依存しない。
  - _Depends: 2.1_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.3, 5.2, 6.1, 6.2, 7.2_
- [x] 4.2 Mermaid Renderer の単体テストを追加する
  - nodes と edges だけから Mermaid text が生成されることを確認する。
  - branch、loop、try/catch、return、throw、unknown / unresolved、partial result の出力が安定する。
  - source map と renderer warning が UI 非依存で返ることを確認できる。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.3, 5.2, 6.1, 6.2_

- [x] 5. Application: 解析、描画、キャッシュ、ユーザー向け結果を調停する
- [x] 5.1 Visualize use case で Analyzer と Renderer を接続する
  - request から analyzer を選び、解析結果を Mermaid Renderer に渡して表示用結果へまとめる。
  - FlowDiagnostic と RendererWarning はユーザー向け notice に変換され、Renderer contract へ UI 固有型が混ざらない。
  - 完全解析失敗でも Mermaid として表現できる部分結果があれば表示用結果として返る。
  - _Depends: 3.1, 4.1_
  - _Requirements: 2.1, 4.1, 4.5, 6.2, 6.3, 6.4, 8.4, 8.5_
- [x] 5.2 Analysis cache と無効化を実装する
  - cache key は document URI、document version、function range、configuration digest、analyzer id、analyzer version を含む。
  - document change、configuration change、analyzer version change で古い結果を再利用しない。
  - cancelled result は cache せず、source version が一致する partial result だけ再利用できる。
  - _Depends: 2.1, 3.1_
  - _Requirements: 8.1, 8.3, 8.4_
- [x] 5.3 Application の単体テストで orchestration と cache を検証する
  - supported / unsupported language、target not found、partial success、render failure、cancelled の結果が区別される。
  - analyzer version を変えると cache miss になることを確認する。
  - diagnostics と renderer warnings が user-visible notices に変換されることを確認できる。
  - _Requirements: 1.3, 1.4, 4.5, 6.2, 6.3, 6.4, 8.1, 8.4, 8.5_

- [x] 6. VS Code Integration: command、CodeLens、表示、Clipboard を接続する
- [x] 6.1 CommandController でカーソル起点と CodeLens 起点の実行を扱う
  - VS Code document、position、cancellation を plain request に変換して Application を呼び出す。
  - 解析中 state、対象関数なし、非対応言語、解析失敗が VS Code 上でユーザーに分かる。
  - command 実行中も VS Code の通常編集操作を妨げない。
  - _Depends: 5.1_
  - _Requirements: 1.2, 1.3, 1.4, 4.2, 8.2, 8.3, 8.5_
- [x] 6.2 CodeLens provider で軽量な関数起動 UI を提供する
  - 対応言語の関数に CodeLens が表示され、実行時に対象関数 range が command へ渡る。
  - CodeLens 計算では詳細解析を行わず、cancellation により古い計算を破棄できる。
  - CodeLens から起動した関数が解析対象として特定されることを確認できる。
  - _Depends: 3.2_
  - _Requirements: 1.1, 8.3_
- [x] 6.3 VisualizationView と Webview adapter で可視化結果を表示する
  - Application から受け取った表示用結果だけを使い、Analyzer 固有データや Renderer warning を直接扱わない。
  - VS Code 上で Mermaid 図、未解決要素、解析できた範囲とできなかった箇所が表示される。
  - Webview adapter には CSP、nonce、local resource 制限が設定される。
  - _Depends: 5.1_
  - _Requirements: 3.1, 3.2, 3.4, 4.2, 4.3, 4.4, 6.2, 6.4, 7.2_
- [x] 6.4 Clipboard 操作で現在の Mermaid text をコピーできるようにする
  - 表示中の図に対応する Mermaid text をユーザー操作で clipboard へ保存できる。
  - コピー対象がない場合は理由が通知される。
  - Clipboard 利用は Integration 境界に留まり、解析結果の外部送信を行わない。
  - _Depends: 6.3_
  - _Requirements: 5.1, 5.2, 5.3, 7.2_
- [x] 6.5 Workspace Trust とローカル処理の runtime guard を組み込む
  - Restricted Mode で許可する動作と制限する動作が manifest と runtime の両方で一致する。
  - ソースコード、FlowModel、Mermaid text、diagnostics を外部サービスへ送信する経路が存在しない。
  - LLM 連携や実行時トレースのコードパスがこの仕様の機能として登録されていない。
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 7. Integration validation: VS Code 上の主要体験を通す
- [x] 7.1 Extension entry で登録と lifecycle をまとめる
  - command、CodeLens、VisualizationView、Clipboard、Workspace Trust 関連の disposable が extension lifecycle に登録される。
  - extension entry は登録だけを担当し、解析や Mermaid 生成の business logic を持たない。
  - package contribution と実装内 command id が一致していることを確認できる。
  - _Depends: 6.1, 6.2, 6.3, 6.4, 6.5_
  - _Requirements: 1.1, 1.2, 5.1, 7.1, 7.2_
- [x] 7.2 VS Code 統合テストで command、CodeLens、表示、Clipboard を検証する
  - カーソル起点と CodeLens 起点の両方から可視化が開始される。
  - Mermaid 図が VS Code 上に表示され、unknown / unresolved と partial result がユーザーに見える。
  - 表示済み Mermaid text をコピーでき、コピー対象なしの理由も通知される。
  - _Requirements: 1.1, 1.2, 3.2, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 8.2_

- [x] 8. Responsiveness and safety validation: 応答性優先の振る舞いを確認する
- [x] 8.1 大きい関数や複雑な関数で部分結果とキャンセルを検証する
  - 完全解析より応答性を優先し、可能な範囲の部分結果が表示される。
  - 新しい編集や再実行で古い解析が破棄され、UI が長時間ブロックされない。
  - 解析できなかった箇所または失敗理由がユーザーに提示される。
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 6.3, 6.4_
- [x] 8.2 ローカル静的解析のみで完結することを検証する
  - 対象コードを実行しない fixture と、実行時トレースを使わない経路を検証する。
  - ソースコード、解析結果、Mermaid text が外部送信や永続化されないことを確認する。
  - Workspace Trust の制約下でも安全な範囲で動作または明示的に制限される。
  - _Requirements: 2.1, 7.1, 7.2, 7.3, 7.4_

- [x] 9. Final verification: 品質ゲートを通して実装完了にする
- [x] 9.1 TypeScript、lint、unit test、integration test を通す
  - `check-types`、lint、compile、unit tests、VS Code integration tests が成功する。
  - core logic の単体テストと VS Code 統合テストが分離されたまま実行できる。
  - 失敗があれば要件に紐づくタスクへ戻して修正できる状態になる。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 10. Spec完了後のUI改善: Marketplace公開向けにWebview表示を整える
- [x] 10.1 Mermaid sequence diagramの視認性を改善する
  - Mermaid公式RendererをWebview内のローカルbundleとして使用し、外部CDNや外部ネットワークへ依存しない。
  - Mermaid初期化では `currentColor` や未解決CSS変数を渡さず、解決済みの実色または安全なfallback色を使用する。
  - `loop`、`alt`、`opt`、`critical`、`option` を種類別のアクセントカラーで表示し、枠線、ラベル、必要な文字色へ適用する。
  - Control Block の枠線を `1.8px`、ラベル文字を `14px` として表示する。ラベル枠幅の追加調整用定義値は設けず、Mermaid の自然な幅計算を維持する。
  - Mermaid描画失敗時は Mermaid text を fallback 表示し、Copy Mermaid は従来どおり動作する。
  - Mermaid text、Common Flow Model、Renderer contract は変更しない。
  - _Requirements: 4.2, 4.3, 5.1, 5.2, 7.2_
- [x] 10.2 Source locations一覧を非表示にする
  - SourceMap は内部データとして維持する。
  - Webview下部の Source locations セクションは表示せず、空欄や余白も残さない。
  - Renderer の RenderResult と SourceMap contract は変更しない。
  - _Requirements: 3.2, 4.2, 7.2_
- [x] 10.3 UI-2: ライフライン・Activation の視認性改善
  - ライフラインと participant 境界線を明るいグレー系へ調整し、背景へ埋もれない表示にする。
  - Mermaid activation を Webview の描画入力で利用し、実行中の participant を表示する。
  - await 呼び出しと return を通常 call から視覚的に区別できる配色にする。
  - root participant を他 participant より少し強調する。
  - UI 配色とテーマ適用は Visualization / Webview 層に閉じ込め、Mermaid text、Common Flow Model、Renderer contract、Copy Mermaid、SourceMap contract は変更しない。
  - _Requirements: 3.1, 4.2, 4.3, 5.1, 5.2, 7.2_
- [x] 10.4 UI-3: ライフライン・Activation・レイアウト改善
  - root participant は関数開始から終了まで常時 activation 表示し、解析対象と処理全体の起点を明示する。
  - 他 participant は Call / Await の実行期間だけ activation 表示する。
  - ライフラインを白系へ調整し、ダークテーマでも activation と区別できる視認性を確保する。
  - `loop`、`alt`、`opt`、`critical`、`option` のアクセントカラーを枠線、ラベル、タブへ適用する方針へ戻す。
  - 長い participant 名、条件式、Call / Await ラベルが切れにくいよう Webview 側の Mermaid sequence 設定、SVG overflow、text layout を調整する。
  - Mermaid text、Common Flow Model、Renderer contract、Copy Mermaid、SourceMap contract は変更しない。
  - _Requirements: 3.1, 4.2, 4.3, 5.1, 5.2, 7.2_
- [x] 10.5 UI-3不具合修正: Mermaid拡大表示とparticipant名はみ出しを解消する
  - SVG は Webview 幅へ自然に収め、`max-width: none`、過剰な `min-width`、はみ出し回避目的の `overflow: visible` を使わない。
  - Mermaid sequence の `useMaxWidth` を有効にし、actor/message/box margin は過剰に広げない。
  - Mermaid が生成した `textLength`、`lengthAdjust`、SVG text の font-size を破壊的に上書きしない。
  - root participant の常時 activation、他 participant の Call / Await activation、白系ライフライン、Control Block アクセント、Source locations 非表示、Copy Mermaid を維持する。
  - _Requirements: 3.1, 4.2, 4.3, 5.1, 5.2, 7.2_

- [x] 10.6 UI-3不具合修正: participant名をactor box内で中央揃えし、長い名前のはみ出しを防止する
  - 上部・下部のactor boxに対応するtextへ水平・垂直中央揃え属性を付与し、Mermaidのx/y/textLength/lengthAdjustを維持する。
  - Mermaidの既定レイアウトを優先し、必要最小限のsequence余白だけを設定する。一律font-size強制やSVG text属性の削除は行わない。
  - _Requirements: 3.1, 4.2, 4.3, 5.1, 5.2, 7.2_

## Implementation Notes

- 9.1: README/CHANGELOG は VS Code テンプレート文面が残っていたため、MVP の実行方法、対応範囲、Workspace Trust、local-only 境界を反映した。
- 10.1, 10.2: Task 9 完了後の UI 改善として、Visualization / Webview 層だけで Mermaid 描画の視認性向上と Marketplace 公開版向けの Source locations 非表示を反映した。
- 10.3: UI-2 として、Visualization / Webview 層だけでライフライン、activation、await / return、root participant の視認性を改善した。
- 10.4: UI-3 として、Visualization / Webview 層だけで root participant の常時 activation、白系ライフライン、Control Block アクセントカラー、長いラベルや条件式のレイアウトを改善した。
- 10.5: UI-3 の不具合修正として、Mermaid のレイアウト計算を尊重し、SVG の過剰拡大と participant 名のはみ出しを解消した。
- 10.6: participant 名を actor box 内で水平・垂直中央揃えし、Mermaid の text layout 属性を保持したまま長い名前のはみ出しを防止した。
- 10.7: Mermaidの実SVGでactor textが直接`text.actor.actor-box`になる構造にも対応し、中央揃え指定を確実に適用した。
- 10.8: Control Block の配色はMermaid既定CSSとの競合を避けるため描画後SVGへ直接適用し、枠線を実線・1.8px、ラベル文字を14pxで表示する。制御ラベル枠の横幅はMermaidの自然な幅計算を維持し、追加調整用の定義値は設けない。重複するVisualizationView側のControl Block CSSは削除した。

- [x] 11. Mermaid表示操作: 初期倍率固定、ズーム、パン、余白改善を実装する
- [x] 11.1 WebViewの表示状態と操作UIを設計・実装する
  - 固定初期倍率、最小倍率、最大倍率、ズームステップ、パン位置、リセット操作をWebView表示層に定義する。
  - 拡大縮小とドラッグ移動をSVG外側のラッパーtransformで処理し、SVG内部のレイアウト属性を変更しない。
  - 拡大率表示、拡大・縮小、リセットの操作UIまたは同等のユーザー認識手段を提供する。
  - _Boundary: VisualizationView / Webview Mermaid_
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.8_
- [x] 11.2 ドラッグによるパン操作と入力競合対策を実装する
  - ポインター操作で図を移動でき、ドラッグ中のテキスト選択とページ全体の意図しないスクロールを抑止する。
  - 図の再描画、fallback、リセット時の状態遷移を定義し、異常な移動値を適用しない。
  - _Depends: 11.1_
  - _Boundary: Webview Mermaid interaction_
  - _Requirements: 9.5, 9.6, 9.7, 9.10_
- [x] 11.3 Mermaid sequenceレイアウトの縦方向余白を調整する
  - 通常規模、大規模、長いラベルを含むfixtureでmessage、diagram、box、note間隔を比較する。
  - `messageMargin: 70`、`diagramMarginY: 10`、`boxMargin: 22`、`boxTextMargin: 12`、`noteMargin: 20` を採用し、横方向の可読性と過度な図の巨大化を悪化させない状態に固定する。
  - _Depends: 11.1_
  - _Boundary: Webview Mermaid layout_
  - _Requirements: 9.9_
- [x] 11.4 WebView操作と既存表示機能のテストを追加する
  - 異なる関数規模で初期倍率が固定され、ズーム境界とリセットが機能することを検証する。
  - パン操作、縦方向余白、SVG装飾、SourceMap、Copy Mermaid、CSP、fallbackの回帰を検証する。
  - _Depends: 11.1, 11.2, 11.3_
  - _Boundary: VisualizationView tests / Webview Mermaid tests_
  - _Requirements: 9.1, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_
- [x] 11.5 品質ゲートと実機相当の表示確認を行う
  - `check-types`、lint、compile、unit test、VS Code integration testを実行する。
  - WebView上で通常規模・大規模の図を表示し、固定初期倍率、ズーム、パン、リセット、縦方向余白を目視確認する。
  - _Depends: 11.4_
  - _Boundary: Integration validation_
  - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6, 9.9, 9.10_

- [x] 11.6 WebViewにマウスホイールズームとピンチズームを追加する
  - マウスホイールの方向と量を共通の表示倍率更新へ変換し、図上の入力だけをズームとして扱う。
  - 2本のポインターの距離変化をピンチ操作として扱い、単一ポインターのドラッグパンと状態を分離する。
  - 既存の最小・最大倍率、有限値検証、`translate` / `scale` 更新契約をホイール・ピンチにも適用する。
  - ピンチ終了、pointer cancel、pointer capture 解除後に通常のパンと縦スクロールへ復帰できる状態にする。
  - Observable completion: マウスホイールとトラックパッド／タッチのピンチで表示倍率が変化し、倍率範囲外の値が適用されない。
  - _Depends: 11.1, 11.2_
  - _Boundary: VisualizationView / Webview Mermaid interaction_
  - _Requirements: 9.2, 9.3, 9.4, 9.6, 9.7, 9.11, 9.12, 9.13_

- [x] 11.7 WebViewのホイール・ピンチ操作テストを追加する
  - ホイールイベントの正負・量、ピンチの距離増減、最小・最大倍率のクランプを検証する。
  - 2本指操作中にパンが開始されず、ジェスチャー終了後に単一ポインターのパンと通常の縦スクロールが復帰することを検証する。
  - 既存のボタン操作、リセット、Copy Mermaid、SVG装飾、SourceMap、fallback、CSPの回帰を維持する。
  - Observable completion: `visualizationView.test.ts` で 9.11〜9.13 の入力契約と既存表示機能の非干渉が確認できる。
  - _Depends: 11.6_
  - _Boundary: VisualizationView tests / Webview Mermaid tests_
  - _Requirements: 9.4, 9.7, 9.8, 9.10, 9.11, 9.12, 9.13_

- [x] 11.8 ズーム入力の実機相当検証と品質ゲートを行う
  - マウスホイール、macOSトラックパッドのピンチ、タッチ入力相当のポインター列で倍率変更を確認する。
  - 通常の縦スクロール、ドラッグパン、リセット、図の再描画、fallback復帰が入力後も利用できることを確認する。
  - `check-types`、lint、compile、unit test、VS Code integration test を実行し、既存の表示操作回帰がないことを確認する。
  - Observable completion: Requirement 9.1〜9.13 に対応するテストと表示確認が成功し、既存の Mermaid テキスト、SourceMap、SVG装飾に変更がない。
  - _Depends: 11.7_
  - _Boundary: Integration validation_
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13_

- 11.6-11.8: マウスホイールと2本ポインターのピンチを既存の表示倍率状態へ統合し、通常のパン・縦スクロール・fallback・既存表示機能との回帰を統合テストで確認した。

- [x] 12. 表示倍率仕様変更: 100%固定表示、Fit、スクロールを実装する
- [x] 12.1 100%表示でMermaid SVGの自然サイズを維持する
  - Mermaid sequence設定の`useMaxWidth`とSVG表示CSSを、表示倍率100%で自動縮小しない構成へ変更する。
  - SVGの文字、participant枠、制御ブロック枠、線が関数規模によって縮小されず、図の自然サイズを基準に表示される状態にする。
  - WebView幅を超える図は横方向・縦方向にスクロールでき、既存のMermaid text、SourceMap、SVG装飾、Copy Mermaidへ影響しない。
  - Observable completion: 小規模と大規模のfixtureを100%で表示したとき、文字・枠・線のCSS上の基準サイズが同じで、大規模図だけがスクロール可能になる。
  - _Boundary: VisualizationView / Webview Mermaid_
  - _Requirements: 9.1, 9.2, 9.3, 9.7, 9.8, 9.9, 9.10, 9.13, 9.14_

- [x] 12.2 Fitと100%リセットを表示状態へ統合する
  - Fit操作でSVGの実寸と表示領域から図全体が収まる倍率を計算し、100%とは別の表示状態として適用する。
  - Fit後の拡大・縮小は現在倍率を基準に変更し、最小倍率・最大倍率を超えないようにする。
  - 100%リセットでは倍率を1へ戻し、translateとスクロール位置を初期位置へ戻す。
  - Observable completion: Fitで大規模図が表示領域へ収まり、手動ズーム後の100%リセットで倍率・パン・スクロールが初期状態へ戻る。
  - _Depends: 12.1_
  - _Boundary: Webview Mermaid interaction_
  - _Requirements: 9.4, 9.5, 9.6, 9.7, 9.8, 9.18_

- [x] 12.3 表示倍率変更の回帰テストを追加する
  - 小規模・大規模・長いラベルを含むfixtureで、100%の自然サイズ表示と大規模図のスクロールを検証する。
  - Fit倍率の計算、Fit後の現在倍率基準ズーム、100%リセット時のscrollLeft・scrollTop・translate初期化を検証する。
  - Copy Mermaid、SourceMap、SVG装飾、fallback、ホイール、ピンチ、通常縦スクロールが表示倍率変更によって壊れないことを検証する。
  - Observable completion: `visualizationView.test.ts`でRequirement 9.1〜9.18の表示倍率契約と既存表示機能の非干渉が確認できる。
  - _Depends: 12.2_
  - _Boundary: VisualizationView tests / Webview Mermaid tests_
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13, 9.14, 9.15, 9.16, 9.17, 9.18_

- [x] 12.4 表示倍率仕様の統合検証と品質ゲートを行う
  - WebView上で初期100%、大規模図のスクロール、Fit、手動ズーム、100%リセットを通常規模・大規模の図で確認する。
  - Mermaid text、Copy Mermaid、SourceMap、SVG装飾、fallback、既存のコードジャンプ連携に回帰がないことを確認する。
  - `npm run check-types`、`npm run lint`、`npm run compile`、`npm run test:unit`、`npm run test:integration`を実行する。
  - Observable completion: 全品質ゲートが成功し、Requirement 9.1〜9.18に対応する表示確認結果が得られる。
  - _Depends: 12.3_
  - _Boundary: Integration validation_
  - _Requirements: 4.2, 4.3, 5.1, 5.2, 7.2, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13, 9.14, 9.15, 9.16, 9.17, 9.18

## Implementation Notes

- 12.1-12.4: 既存の11.x表示操作タスクを前提に、`useMaxWidth: true`による自動縮小を100%表示から除外し、Fitを明示的な自動縮小操作として追加する。

- [x] 13. 表示viewportと内側canvasを分離し、UI倍率と描画倍率を統合する
- [x] 13.1 固定viewportと内側canvasの表示構造を実装する
  - 外側viewportを固定されたスクロールコンテナとして維持し、幅・高さ・スクロール領域を倍率変更やFitで変更しない。
  - 内側canvasを追加し、ズーム・パンの`transform`をcanvasだけへ適用する。外側viewportにはズームtransformを適用しない。
  - 100%表示ではMermaidの自然サイズを維持し、viewportを超える図をスクロール可能にする。
  - Observable completion: 縮小時もviewportの表示領域とスクロールコンテナが縮小せず、canvas内のシーケンス図だけが縮小される。
  - _Boundary: VisualizationView / Webview Mermaid_
  - _Requirements: 9.5, 9.6, 9.7, 9.10, 9.11, 9.16, 9.17, 9.22_

- [x] 13.2 UI倍率と初期描画倍率を分離し、Fitとリセットを更新する
  - UI上の100%を`uiScale=1`として管理し、初期描画には後から調整可能な固定`INITIAL_RENDER_SCALE`係数を適用する。
  - 実効canvas倍率を初期描画係数とUI倍率から算出し、ユーザーの拡大・縮小はUI倍率を基準に適用する。
  - Fitは固定viewportとSVG自然サイズからcanvasのUI倍率だけを計算し、100%リセットでは初期係数、倍率、パン、スクロールを初期化する。
  - Observable completion: UI上100%の初期表示が現在より少し小さく、Fit後の手動ズームと100%リセットが仕様どおり動作する。
  - _Depends: 13.1_
  - _Boundary: Webview Mermaid interaction_
  - _Requirements: 9.1, 9.3, 9.4, 9.8, 9.9, 9.12, 9.13, 9.14, 9.15_

- [x] 13.3 viewport・canvas分離と表示倍率の回帰テストを追加する
  - 小規模・大規模fixtureで、viewportの幅・高さ・スクロール領域が倍率変更前後で維持されることを検証する。
  - canvasだけのズーム、UI上100%と内部描画倍率の分離、Fit、現在倍率基準の拡大・縮小、リセット時の状態初期化を検証する。
  - Mermaid text、SourceMap、SVG装飾、Copy Mermaid、コードジャンプ、fallback、ホイール、ピンチ、通常スクロールの非干渉を検証する。
  - Observable completion: `visualizationView.test.ts`でRequirement 9.1〜9.22のviewport・canvas表示契約と既存機能の回帰が確認できる。
  - _Depends: 13.2_
  - _Boundary: VisualizationView tests / Webview Mermaid tests_
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13, 9.14, 9.15, 9.16, 9.17, 9.18, 9.19, 9.20, 9.21, 9.22_

- [x] 13.4 表示viewport分離の統合検証と品質ゲートを行う
  - WebView上で初期UI 100%、現在より少し小さい表示、固定viewport、大規模図のスクロール、canvasのみの縮小、Fit、リセットを確認する。
  - Mermaid text、Copy Mermaid、SourceMap、SVG装飾、コードジャンプ、fallbackに回帰がないことを確認する。
  - `npm run check-types`、`npm run lint`、`npm run compile`、`npm run test:unit`、`npm run test:integration`を実行する。
  - Observable completion: 全品質ゲートが成功し、Requirement 9.1〜9.22の表示確認結果が得られる。
  - _Depends: 13.3_
  - _Boundary: Integration validation_
  - _Requirements: 4.2, 4.3, 5.1, 5.2, 7.2, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13, 9.14, 9.15, 9.16, 9.17, 9.18, 9.19, 9.20, 9.21, 9.22_

- [x] 14. 可視化コントロールのUIを再構成する
- [x] 14.1 内部状態表示を削除し、既存noticeを維持する
  - 関数名直下の内部状態名表示だけを削除し、内部状態管理とnotice生成は変更しない。
  - Observable completion: success等はHTMLに出力されず、warning/error/unresolved/partial noticeは表示される。
  - _Requirements: 6.2, 6.4, 8.5, 10.1, 10.2, 10.3_
  - _Boundary: VisualizationView_

- [x] 14.2 ツールバーを1行へ再配置し、既存操作を維持する
  - `Copy Mermaid`、`100%`、`Fit`、`-`、`x%`、`+` の順で同一行の左側に配置する。
  - Observable completion: 既存のズーム・Fit・リセット・Copy MermaidイベントとView ID通信を維持したHTMLが生成される。
  - _Requirements: 5.1, 5.2, 9.1, 9.7, 9.8, 9.9, 10.4, 10.5, 10.6_
  - _Boundary: VisualizationView / Webview interaction_
  - _Depends: 14.1_

- [x] 14.3 テーマ対応のボタン配色と状態表示を実装する
  - ズームボタンをテーマ近似色、Copy Mermaidを目立ちすぎないテーマ寄りの青系背景とし、hover、focus-visible、disabledの視認性を定義する。
  - Observable completion: Dark / Lightテーマと通常幅・狭い幅で、文字と背景のコントラストおよびフォーカス表示を確認できる。
  - _Requirements: 10.7, 10.8, 10.9_
  - _Boundary: VisualizationView CSS_
  - _Depends: 14.2_

- [x] 14.4 UI改善の回帰検証と品質ゲートを行う
  - HTMLの状態名非表示、notice維持、コントロール順序、非操作倍率表示、テーマCSS、既存IDをテストする。
  - 既存のズーム、Fit、Copy Mermaid、fallback、SourceMap、SVG装飾、CSP、Workspace Trust通知を回帰確認する。
  - Observable completion: WebView目視確認と `npm run check-types`、`npm run lint`、`npm run compile`、`npm run test:unit`、`npm run test:integration` が成功する。
  - _Requirements: 4.2, 5.1, 5.2, 6.2, 6.4, 8.5, 9.1, 9.7, 9.8, 9.9, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10_
  - _Boundary: VisualizationView tests / Integration validation_
  - _Depends: 14.3_

- [x] 15. メッセージラベルと線の距離を調整する
- [x] 15.1 メッセージ間隔を維持したままラベル位置を下げる
  - Mermaid描画後のSVGでメッセージラベルの`text`要素だけを識別し、表示用の`translateY`（初期値8px）を適用する。
  - Mermaidの`messageMargin: 70`、線、矢印、activation、participant、control block、および`x`/`y`/`textLength`/`lengthAdjust`/font-sizeは変更しない。
  - Observable completion: メッセージ間の縦方向の間隔を維持したまま、ラベルが対応する線へ近づいて表示される。
  - _Requirements: 9.23_
  - _Boundary: webviewMermaid.js_

- [x] 15.2 メッセージラベル位置調整の回帰テストを追加する
  - 通常のCall、Await、Returnを含むシーケンス図で、ラベルだけに位置調整が適用されることを検証する。
  - メッセージ間隔、線・矢印、activation、participant、control block、Mermaid text、SourceMap、既存のSVG装飾が変更されないことを検証する。
  - Observable completion: Requirement 9.23 の位置調整と非干渉条件がテストまたは表示検証で確認できる。
  - _Requirements: 4.2, 4.3, 9.23_
  - _Boundary: VisualizationView tests / Webview Mermaid tests_
  - _Depends: 15.1_

- [x] 15.3 メッセージラベル位置調整の統合検証と品質ゲートを行う
  - Dark / Lightテーマ、長いラベル、複数メッセージ、Await / Returnを含む図でラベルの読みやすさを確認する。
  - `npm run check-types`、`npm run lint`、`npm run compile`、`npm run test:unit`、`npm run test:integration`を実行する。
  - Observable completion: Requirement 9.23 の表示確認と全品質ゲートが成功し、既存のMermaid表示機能に回帰がない。
  - _Requirements: 4.2, 5.1, 5.2, 9.23_
  - _Boundary: Integration validation_
  - _Depends: 15.2_

- [x] 16. 条件ラベルの視認性を改善する
- [x] 16.1 条件ラベルの色と位置を枠線に合わせて調整する
  - 任意のフラグメント種別と条件文言について、条件ラベルを対応するフラグメント種別ラベル・制御ブロック枠線と同じ色で表示する。
  - Mermaid描画後のSVG装飾でラベル要素だけを対象にし、枠線・枠範囲・条件文言・メッセージ間隔・Mermaid textを変更しない。
  - ラベルの表示用`transform`だけを調整し、対応する枠の上部に近づけて表示する。Mermaidの`x`、`y`、`textLength`、`lengthAdjust`、font-sizeは変更しない。
  - Observable completion: 複数のフラグメント種別と異なる条件文言で、条件ラベルが対応する枠線色で表示され、枠上部に近い位置へ移動していることを確認できる。
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - _Boundary: webviewMermaid.js_

- [x] 16.2 条件ラベル装飾の回帰テストを追加する
  - 複数のフラグメント種別と、関数ごとに異なる条件文言を含むfixtureで、条件ラベルの文字色が対応する種別ラベル・枠線の色と一致することを検証する。
  - ラベルの表示用変換が上方配置として適用され、枠範囲、条件文言、メッセージ間隔、Mermaid text、既存のSVG装飾へ影響しないことを検証する。
  - Observable completion: `visualizationView.test.ts` で Requirement 11.1〜11.5 の色対応、位置、非干渉契約が確認できる。
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - _Boundary: VisualizationView tests / Webview Mermaid tests_
  - _Depends: 16.1_

- [x] 16.3 条件ラベル改善の統合検証と品質ゲートを行う
  - Dark / Lightテーマ、関数ごとに異なる長い条件文、ネストした制御ブロックを含む図でラベルと枠線の対応および上部配置を確認する。
  - Mermaid text、Copy Mermaid、SourceMap、fallback、メッセージラベル位置調整に回帰がないことを確認する。
  - `npm run check-types`、`npm run lint`、`npm run compile`、`npm run test:unit`、`npm run test:integration`を実行する。
  - Observable completion: Requirement 11.1〜11.5 の表示確認と全品質ゲートが成功する。
  - _Requirements: 4.2, 4.3, 5.1, 5.2, 9.23, 11.1, 11.2, 11.3, 11.4, 11.5_
  - _Boundary: Integration validation_
  - _Depends: 16.2_

- [x] 17. 処理 Note の密度とテーマ識別性を改善する
- [x] 17.1 処理 Note の意味的な表示メタデータを Renderer から生成する
  - 制御移動・式評価の FlowNode kind から生成された Note だけを、Mermaid 出力行と kind を持つ表示専用メタデータとして記録する。
  - Mermaid text、既存の source map、renderer warning、処理順の意味を変更せず、unknown・unresolved・diagnostic に由来する Note を処理 Note として記録しない。
  - Observable completion: 異なる `throw`、`break`、`continue`、任意の式評価で、表示文言に依存せず該当 Note の Mermaid 出力行と kind が返る。
  - _Requirements: 12.4, 12.6_
  - _Boundary: MermaidRenderer_

- [x] 17.2 処理 Note メタデータを表示専用 payload として統合する
  - Renderer が返した処理 Note メタデータを Application、cache、VisualizationViewModel を通じて Webview へ渡す。
  - Mermaid text、SourceMap、notice、Copy Mermaid の payload と責務を混在させず、fallback 表示では空のメタデータを渡す。
  - Observable completion: 成功・部分結果・fallback の各表示モデルで、処理 Note メタデータの有無が明確になり、コピー対象と SourceMap の内容が変わらない。
  - _Depends: 17.1_
  - _Requirements: 12.4, 12.6_
  - _Boundary: VisualizeFunctionFlowUseCase, VisualizationView_

- [x] 17.3 処理 Note をコンパクトかつテーマ対応の配色で描画する
  - Mermaid Note の内側余白を `noteMargin: 12` へ更新し、メッセージ、participant、activation、control block の余白設定を維持する。
  - 描画済み Note は処理 Note メタデータと Mermaid 出力行の対応だけで選択し、固定文言、画面上の距離、ネスト構造の子孫検索に依存しない。
  - 処理 Note の背景・枠線・文字色には Dark / Light テーマでキャンバスと区別できるテーマ色と fallback 色を適用し、条件ラベル・フラグメント装飾を変更しない。
  - Observable completion: 任意の処理文言を持つ処理 Note だけが、コンパクトな余白とキャンバス背景から識別できる配色で表示される。
  - _Depends: 17.2_
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_
  - _Boundary: Webview Mermaid_

- [x] 17.4 処理 Note の意味的判定と実描画 SVG の回帰テストを追加する
  - Renderer の単体テストで、異なる処理文言と FlowNode kind の組み合わせが同じ意味的な処理 Note メタデータになることを検証する。
  - Mermaid を実描画した SVG fixture に、処理 Note、diagnostic・未解決 Note、ネストした制御ブロックを混在させ、処理 Note だけに背景・枠線・文字色が適用されることを検証する。
  - Dark / Light の具体色 fixture で背景とキャンバスが異なることを確認し、`noteMargin: 12`、message・participant・activation・control block の余白設定、Mermaid text、SourceMap、Copy Mermaid、fallback、条件ラベル装飾の非干渉を検証する。
  - Observable completion: 固定文字列だけを検索するテストを使わず、任意の処理文言と混在 Note を含む実 SVG で Requirement 12 の装飾・非干渉契約が確認できる。
  - _Depends: 17.3_
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_
  - _Boundary: MermaidRenderer tests, VisualizationView tests, Webview Mermaid tests_

- [x] 17.5 処理 Note 改善の品質ゲートと表示検証を行う
  - Dark / Light テーマで、`continue`、`break`、任意の式評価、長い処理文言、診断・未解決 Note を含む図の余白と配色を確認する。
  - Mermaid text、Copy Mermaid、SourceMap、コードジャンプ、fallback、既存の条件ラベルおよびフラグメント装飾に回帰がないことを確認する。
  - `npm run check-types`、`npm run lint`、`npm run compile`、`npm run test:unit`、`npm run test:integration`を実行する。
  - Observable completion: Requirement 12 の表示確認と品質ゲートが成功し、既存の可視化契約が維持される。
  - _Depends: 17.4_
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_
  - _Boundary: Integration validation_

- [x] 18. メッセージラベルの簡潔化を実装する
- [x] 18.1 メッセージラベルの要約ポリシーを実装する
  - Call、Return、Throw の表示ラベルを処理種別と主要な呼び出し先中心に整形し、引数・オブジェクトリテラル・配列・複合式の詳細を必要に応じて縮約する。
  - `await`、`unresolved`、`unknown call` などの識別情報を維持し、式を実行したり意味を推測して置換したりしない。
  - ラベル上限を80文字、超過時の省略記号を `...` として一箇所のポリシーから適用する。
  - Observable completion: 長い `return JSON.stringify({ ... })` が `return JSON.stringify(...)` の形式で出力され、上限を超えるラベルが80文字以内に収まる。
  - _Boundary: MessageLabelFormatter_
  - _Requirements: 13.1, 13.2, 13.3_
- [x] 18.2 Renderer のメッセージ生成へ要約ラベルを統合する
  - Call、Return、Throw の Mermaid message 生成が共通の要約ポリシーを利用し、表示用ラベルを `mermaidText` へ直接反映する。
  - メッセージの方向、FlowNode / FlowEdge の順序、participant 名、unknown / unresolved の既存表現を変更しない。
  - SourceMap の Mermaid 行番号、nodeId、edgeId、sourceLocation を従来どおり生成し、WebView側で追加のラベル変換を行わない。
  - Observable completion: Renderer が生成する Mermaid text に要約済みラベルが含まれ、既存の call、return、unknown、unresolved の出力契約が維持される。
  - _Depends: 18.1_
  - _Boundary: MermaidRenderer_
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_
- [x] 18.3 メッセージラベルの単体・Renderer回帰テストを追加する
  - 単純な呼び出し、長い引数、オブジェクトリテラル、配列、入れ子呼び出し、await、unknown、unresolved、80文字境界を検証する。
  - `return JSON.stringify({ documentUri: key.documentUri, ... })` が `return JSON.stringify(...)` へ要約されることを確認する。
  - 同一ラベルが複数回現れる場合も行順と SourceMap の nodeId / edgeId で識別でき、ラベルへ不要な連番を追加しないことを確認する。
  - Observable completion: ラベル要約、Mermaid text、SourceMap の期待値を含むテストが成功し、既存 Renderer テストが回帰しない。
  - _Depends: 18.2_
  - _Boundary: MessageLabelFormatter tests / MermaidRenderer tests_
  - _Requirements: 13.1, 13.2, 13.3, 13.4_
- [x] 18.4 Mermaid表示・コピーの統合と品質検証を行う
  - VisualizationView が Renderer の要約済み `mermaidText` をそのまま表示し、ClipboardAdapter へ同じ内容を渡すことを検証する。
  - participant、メッセージ方向、SourceMap、コードジャンプ、fallback、Copy Mermaid の既存機能が要約化によって変わらないことを確認する。
  - TypeScript、lint、unit test、integration test を実行し、長い return 式を含むfixtureでVS Code上の表示とコピー結果を確認する。
  - Observable completion: 表示中のMermaid textとコピーされるMermaid textが一致し、Requirement 13 の全受け入れ条件に対応するテストが成功する。
  - _Depends: 18.3_
  - _Boundary: VisualizationView / ClipboardAdapter / Integration validation_
  - _Requirements: 13.4, 13.5_

- [x] 19. コレクションメソッドの静的呼び出し判定を改善する
- [x] 19.1 動的 receiver 上のコレクションメソッド分類を実装する
  - 呼び出し式の戻り値に対する標準コレクションメソッドを resolved として扱い、`map` などのメソッド名を通常の participant / message 表示へ渡す。
  - コレクションメソッドと判断できない動的オブジェクトメソッドは unresolved、計算プロパティは unknown として既存契約を維持する。
  - receiver の実行時型評価、外部モジュール解析、呼び出し先内部への再帰的解析を追加しない。
  - Observable completion: `findFunctionCandidates(source).map(...)` で `map` に unresolved diagnostic / Note が生成されず、`factory.getService(name).run()` は unresolved のままになる。
  - _Boundary: TypeScriptAnalyzer_
  - _Requirements: 14.1, 14.2, 14.3_
- [x] 19.2 判定規則、SourceMap、キャッシュ無効化の回帰テストを追加する
  - コレクションメソッドの resolved 判定、動的オブジェクトメソッドの unresolved 判定、計算プロパティの unknown 判定を fixture で検証する。
  - Mermaid の participant / message、呼び出し順序、SourceMap、コードジャンプ、部分解析、unresolved Note が既存契約どおりであることを確認する。
  - Analyzer の判定規則を更新した場合に analyzer version の差分で旧解析結果が cache hit にならないことを検証する。
  - Observable completion: `typescriptFlowExtractor.test.ts` と既存の cache / Renderer テストで Requirement 14.1〜14.5 の期待結果が確認できる。
  - _Depends: 19.1_
  - _Boundary: TypeScriptAnalyzer tests / MermaidRenderer tests / AnalysisCache tests_
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_
- [x] 19.3 コレクションメソッド判定の統合検証と品質ゲートを行う
  - CodeLens から解析した関数で `map` が resolved 表示され、`unresolved call` の Note が表示されないことを確認する。
  - 動的オブジェクトメソッド、計算プロパティ、SourceMap、コードジャンプ、partial result、Mermaid コピーに回帰がないことを確認する。
  - Analyzer version 更新後に旧キャッシュが再利用されないことを確認し、`npm run check-types`、`npm run lint`、`npm run compile`、`npm run test:unit`、`npm run test:integration` を実行する。
  - Observable completion: Requirement 14 の全受け入れ条件を満たす統合テストと品質ゲートが成功する。
  - _Depends: 19.2_
  - _Boundary: VisualizationView / CommandController / Integration validation_
  - _Requirements: 14.2, 14.3, 14.4, 14.5_

- [x] 20. 言語横断の実行順とループ制御を実装する
- [x] 20.1 Break / Continue の共通制御フロー契約を実装する
  - Break と Continue を、source location と静的な実行順を持つ独立した処理要素として表現する。
  - `break-exit` と `continue-loop` を制御移動 edge の種類として表現できる共通契約を追加する。具体的な到達可能先と後続のない break の扱いは Analyzer task 20.2 で実装する。
  - Observable completion: Flow Model contract fixture で Break / Continue の kind、順序、source location、label、`break-exit`、`continue-loop` の edge shape を確認できる。
  - _Boundary: Common Flow Model_
  - _Requirements: 15.3, 15.4_

- [x] 20.2 TypeScript / JavaScript の評価順とループ制御を抽出する
  - 入れ子の呼び出しを inner から outer の実行順で抽出し、loop context から break と continue の制御移動を生成する。
  - break はループ後の最初の到達可能 node へ接続し、後続がない場合は `break-exit` edge を生成しない。continue は対応する loop node へ接続する。
  - 静的に順序を確定できない場合だけ不確実性の diagnostic を生成し、解析規則の変更時には analyzer version を更新する。
  - Observable completion: `outer(inner())`、break、continue、後続のない break、不確実な順序を含む fixture で、node / edge 順序、terminal edge 不在、diagnostic、analyzer version の差分による cache miss を確認できる。
  - _Depends: 20.1_
  - _Boundary: TypeScriptAnalyzer_
  - _Requirements: 14.5, 15.1, 15.2, 15.3, 15.4, 15.5_

- [x] 20.3 制御フローの描画警告と表示通知を統合する
  - Mermaid で完全に表現できない node / edge 組合せを RendererWarning として返し、Application が表示通知へ変換する。
  - Analyzer が返す順序不確実性 diagnostic と RendererWarning を別経路で扱い、Break / Continue の処理 Note、SourceMap、部分結果表示を維持する。
  - Observable completion: 表現不能な制御フローと順序不確実性を含む図で、両方の notice が区別して表示され、静的に推定できる処理順は Mermaid 図に残る。
  - _Depends: 20.1, 20.2_
  - _Boundary: MermaidRenderer, Application, VisualizationView_
  - _Requirements: 3.4, 6.2, 8.5, 15.5_

- [x] 21. 指定関数を起点とするライフラインとメッセージを実装する
- [x] 21.1 Call 専用のライフライン主体契約を追加する
  - Call がクラス、インスタンス、Unknown、Unresolved の主体情報を持てるようにし、Unknown と Unresolved は別々の固定 key へ集約する。
  - 指定関数の root は主体情報に含めず、Renderer が無題の固定ライフラインとして扱える状態にする。
  - Observable completion: Flow Model contract test で、Call の主体 kind、key、label、操作名と、root が主体として解決されないことを確認できる。
  - _Boundary: Common Flow Model_
  - _Requirements: 16.2, 16.4, 16.5_

- [x] 21.2 TypeScript / JavaScript のクラス・インスタンス主体を抽出する
  - 識別可能な receiver をクラスまたはインスタンスとして扱い、標準コレクション操作は `Array` への要求として扱う。
  - 直接呼び出し、chain call、computed call、optional call は主体名を推測せず、解決状態に対応する Unknown / Unresolved を維持する。
  - Observable completion: クラス、インスタンス、標準コレクション、各種未解決呼び出しの fixture が、要件どおりの主体と解決状態を返す。
  - _Depends: 21.1_
  - _Boundary: TypeScriptAnalyzer_
  - _Requirements: 14.1, 14.2, 14.3, 16.2, 16.5_

- [x] 21.3 無題 root、主体ライフライン、要求メッセージを Mermaid に出力する
  - 指定関数を最左・空タイトルの固定 root として出力し、同じ主体だけを同じライフラインへ統合する。
  - 操作名を要求メッセージとして出力し、Unknown と Unresolved は別々に一つずつ表示する。主体情報がない Call は関数名、モジュール名、ファイル名を代替タイトルにしない。
  - Observable completion: Mermaid fixture で無題 root、クラス／インスタンス名、同一主体の統合、異なる主体の分離、各一つの Unknown / Unresolved、引数なしの操作メッセージを確認できる。
  - _Depends: 21.1_
  - _Boundary: MermaidRenderer_
  - _Requirements: 14.2, 16.1, 16.3, 16.4, 16.5, 16.6_

- [x] 21.4 ライフラインの表示・コピー統合を回帰検証する
  - 表示中とコピーされた Mermaid text が一致し、SourceMap、コードジャンプ、部分解析、処理順、未解決通知を維持する。
  - 既存の await、return、diagnostic、UI 操作へ回帰がないことを確認する。
  - Observable completion: VisualizationView と ClipboardAdapter の統合テストで、ライフライン表示とコピーの一致、および既存の追跡・部分結果契約を確認できる。
  - _Depends: 21.2, 21.3_
  - _Boundary: VisualizationView, ClipboardAdapter, Integration validation_
  - _Requirements: 14.4, 16.6_

- [x] 22. 関数先頭の要求メッセージを省略せずに描画する
- [x] 22.1 Mermaid Renderer の entry-call 描画を実装する
  - 先行する FlowEdge を持たない Call のうち最初のものを、無題 root からの要求メッセージとして一度だけ出力する。
  - 表示専用の entry として扱い、Analyzer、Common Flow Model、diagnostic、キャッシュへ人工的な node、edge、warning を追加しない。
  - entry-call の SourceMap に nodeId と source location を保持し、実在しない edgeId を生成しない。
  - Observable completion: Call だけを含む Flow Model でも、無題 root から participant への操作メッセージが Mermaid text に含まれる。
  - _Boundary: MermaidRenderer_
  - _Requirements: 16.7_

- [x] 22.2 entry-call の Mermaid と SourceMap の回帰テストを追加する
  - edge を持たない先頭 Call、先頭 Call に続く Call、Unknown、Unresolved の fixture で、メッセージ、順序、participant、重複排除を検証する。
  - entry-call が一度だけ描画され、SourceMap が nodeId と source location を保持し、架空の edgeId や RendererWarning を生成しないことを検証する。
  - Observable completion: 先頭 Call を含む Renderer fixture が Mermaid text、SourceMap、warning の期待値とともに成功する。
  - _Depends: 22.1_
  - _Boundary: MermaidRenderer tests_
  - _Requirements: 16.7_

- [x] 22.3 先頭 Call の VS Code 表示・コピー統合を検証する
  - cursor 実行、CodeLens 実行、Copy Mermaid の各経路で、関数先頭の Call が表示中とコピー対象の Mermaid text に含まれることを検証する。
  - 既存の partial result、SourceMap、コードジャンプ、Unknown / Unresolved、無題 root の表示契約に回帰がないことを確認する。
  - Observable completion: `fetchUser`、`firstCall`、`makeDiagram` を含む VS Code integration fixture が期待する Mermaid text とコピー内容を返す。
  - _Depends: 22.1_
  - _Boundary: VS Code Integration validation_
  - _Requirements: 16.6, 16.7_

- [x] 23. 実行順とライフライン表示の最終統合検証を行う
- [x] 23.1 全品質ゲートと回帰検証を実施する
  - 実行順、Break / Continue、RendererWarning、ライフライン、entry-call、コピー、cache miss を横断 fixture で検証する。
  - `check-types`、`lint`、`compile`、unit test、integration test を実行する。
  - Observable completion: Requirement 15 と 16 の全受け入れ条件、およびコレクション判定・既存可視化契約が品質ゲート成功で確認できる。
  - _Depends: 20.3, 21.4, 22.2, 22.3_
  - _Boundary: Final integration validation_
  - _Requirements: 14.5, 15.1, 15.2, 15.3, 15.4, 15.5, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_

- [x] 24. 左端ライフラインの `self` 表示を適用する
- [x] 24.1 Mermaid の root participant を `self` として出力する
  - 内部 participant ID `root` を維持したまま、指定関数の最左ライフラインを `self` として出力する。
  - entry-call の一回だけの描画、主体ライフラインの集約、各一つの Unknown / Unresolved、操作名の表示を維持する。
  - **完了条件**: Mermaid fixture で `participant root as self`、最初の Call の一回だけの message、Unknown / Unresolved の各一つのライフライン、nodeId と sourceLocation を持ち架空の edgeId を持たない SourceMap を確認できる。
  - _Depends: 21.3, 22.1_
  - _Boundary: MermaidRenderer_
  - _Requirements: 16.1, 16.3, 16.4, 16.5, 16.7_

- [x] 24.2 `self` ライフラインの表示・コピー統合を回帰検証する
  - Renderer、表示、コピーの各経路で同じ `self` を含む Mermaid text を使用し、既存の SourceMap、コードジャンプ、partial result、未解決通知を維持する。
  - WebView の root participant 装飾が表示名ではなく内部 ID `root` を通じて継続して適用されることを検証する。
  - **完了条件**: VisualizationView と ClipboardAdapter の統合 fixture で、最左の `self`、表示 Mermaid と Clipboard 内容の完全一致、root participant 装飾、entry-call の一回だけの描画、および SourceMap の非退行を確認できる。
  - _Depends: 24.1_
  - _Boundary: MermaidRenderer tests, VisualizationView, ClipboardAdapter, Integration validation_
  - _Requirements: 16.1, 16.6, 16.7_

- [x] 25. Mermaid 活性化を正規 Mermaid 出力へ統合する

- [x] 25.1 Renderer が活性化を含む正規 Mermaid テキストを生成する
  - root の開始・終了、および Call / Await / Return / Throw の静的な順序に対応する participant の開始・終了を、Mermaid の正規テキストへ出力する。
  - 活性化命令を含む行順を SourceMap、process note の行番号、unknown / unresolved、partial result、既存 warning と同じ Renderer 出力として扱う。
  - Observable completion: Call、Await、Return、Throw、入れ子 Call を含む Renderer fixture が、`activate` / `deactivate` を含む Mermaid テキストと正しい SourceMap・process note 行番号を返す。
  - _Boundary: MermaidRenderer / RenderContext_
  - _Requirements: 4.1, 4.3, 4.5, 9.18_

- [x] 25.2 WebView と Clipboard を正規 Mermaid テキストへ統一する
  - WebView の Mermaid 構造後処理を除去し、Renderer 由来の Mermaid テキストを変更せずに描画する。
  - 詳細表示、fallback、Clipboard が活性化命令を含む同一文字列を利用し、既存の SVG テーマ・participant・await・return・control・process note 装飾を維持する。
  - Observable completion: WebView の描画入力、表示される Mermaid テキスト、Clipboard の内容が byte-for-byte で一致し、二重の活性化命令が発生しない。
  - _Depends: 25.1_
  - _Boundary: WebView Mermaid renderer, VisualizationView, ClipboardAdapter_
  - _Requirements: 4.2, 4.4, 5.1, 5.2, 5.3, 9.11, 9.18, 9.19_

- [x] 25.3 活性化の言語横断回帰と品質ゲートを実施する
  - TypeScript / JavaScript の Call、Await、Return、Throw、入れ子 Call、loop / branch / try-catch、unknown / unresolved、partial result で、活性化が処理順・participant・メッセージ・notice を変えないことを検証する。
  - Python Flow Model を共通 Renderer / WebView に渡し、Python 専用の活性化・描画・コピー分岐が不要であることを検証する。
  - `npm run check-types`、`npm run lint`、`npm run test:unit`、`npm run compile`、`npm run test:integration` を実行する。
  - Observable completion: 活性化を含む正規 Mermaid、表示、Clipboard、SourceMap、process note、fallback の契約が全対応言語の回帰テストと品質ゲートで確認できる。
  - _Depends: 25.1, 25.2_
  - _Boundary: Renderer tests, VisualizationView tests, Python flow regression, Integration validation_
  - _Requirements: 4.1, 4.2, 4.3, 4.5, 5.1, 5.2, 5.3, 9.11, 9.18, 9.19_

## caller を含む return 契約の追加タスク

- [ ] 26. 対象関数の return を caller へ正しく描画する

- [x] 26.1 固定 caller と return の共通 Renderer 契約を実装する
  - 未特定の外部呼び出し元を固定 `caller` として `self` より先に宣言し、Flow Model、FlowParticipant、Language Analyzer に caller を追加しない。
  - すべての Return node を `root` から `caller` への応答として描画し、直前の通常 Call、await、nested Call、Unknown、Unresolved を戻り値メッセージの送信元にしない。
  - call participant の deactivate は return message の送信元決定から分離し、既存の terminal edge 起点で return message 後に閉じる。throw の既存表示は変更しない。
  - Observable completion: `results.append(); return results` と `await service.save(); return result` が `root-->>caller` を出力し、`results-->>root` / `service-->>root` を出力しない。
  - _Boundary: MermaidRenderer / RenderContext_
  - _Requirements: 16.1, 17.1, 17.2, 17.3, 17.5, 17.6, 17.8_

- [x] 26.2 return の方向・活性化・SourceMap の Renderer 回帰を追加する
  - 通常 Call、await、nested Call、Unknown / Unresolved、partial result、throw、同一 Return node を複数 edge が指すケースで、return の方向、重複排除、既存の活性化終了を検証する。
  - caller が固定名 `caller` で一度だけ宣言され、対象関数名、class 名、module 名、file 名を推測して caller のタイトルに使用しないことを検証する。
  - 長いまたは入れ子の return 式でも、要約後の `return` と戻り値概要が一度だけ `root-->>caller` に出力されることを検証する。
  - return の SourceMap が Return node / edge と同じ正規 Mermaid 行を指し、caller の追加後も process note の行番号が維持されることを検証する。
  - Observable completion: caller / self / callee の順、return message、activation、SourceMap、warning の期待値を含む Renderer test が成功する。
  - _Depends: 26.1_
  - _Boundary: MermaidRenderer tests / MessageLabelFormatter tests_
  - _Requirements: 13.4, 16.1, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8_

- [x] 26.3 caller を含む表示・コピー契約を統合検証する
  - Renderer が出力した caller を含む正規 Mermaid text を、WebView の描画入力、詳細表示、fallback、Clipboard が構造変換なしで共有することを検証する。
  - TypeScript / JavaScript の return fixture で、SourceMap、コードジャンプ、unknown / unresolved、partial result、既存の return 装飾が回帰しないことを確認する。
  - `npm run check-types`、`npm run lint`、`npm run test:unit`、`npm run compile`、`npm run test:integration` を実行する。
  - Observable completion: caller を含む表示 Mermaid と Clipboard 内容が byte-for-byte で一致し、共通 return 契約の品質ゲートが成功する。
  - _Depends: 26.2_
  - _Boundary: VisualizationView / ClipboardAdapter / Integration validation_
  - _Requirements: 16.6, 17.7_

## caller を含む return 契約のレビューゲート

- Task 26.1 完了後: caller が Renderer 固定 participant に留まり、Flow Model、FlowParticipant、Language Analyzer、throw の既存契約を変更していないことを確認する。
- Task 26.2 完了後: callee の activation 終了と `root-->>caller` の return が分離され、caller 名の推測、return の重複、SourceMap 行ずれがないことを確認する。
- Task 26.3 完了後: WebView、fallback、Clipboard が caller を含む同一の正規 Mermaid text を利用し、全品質ゲートが成功することを確認する。
