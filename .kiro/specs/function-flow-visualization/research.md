# Research & Design Decisions

## Summary

- **Feature**: `function-flow-visualization`

## UI改善要件の設計調査

### 主な発見

1. 内部状態名は `renderHtml` の `<p>` 要素で直接表示されている。状態値自体は解析判定に使われるため、表示要素だけを削除するのが最小変更となる。
2. ズーム操作はDOM ID、Copy Mermaidは `copyMermaid` メッセージと `viewId` に依存する。配置変更時もこれらの契約を維持すれば機能影響はない。
3. 配色はVS Code WebView CSS変数で完結でき、追加依存や外部ネットワークは不要である。`--vscode-button-*` と `--vscode-button-secondary*` を優先し、フォールバック色と `:focus-visible` を定義する。

### 設計判断

- Requirement 10 を既存の表示倍率・Copy・通知要件と分離して追加する。
- user-visible notice は内部状態名と異なるため維持する。
- ツールバーは `VisualizationView` に閉じ込め、Common Flow Model、Renderer、SourceMap、Clipboard adapterの契約は変更しない。
- 生成HTMLの要素順序・既存ID・CSS変数をテストし、Dark / Lightと狭い幅は目視確認で補完する。

### リスクと対策

- 狭いWebView幅で右寄せ配置が圧迫される可能性があるため、flex設定とボタン余白を実機相当表示で確認する。
- VS Codeテーマごとのコントラスト差をDark / Light双方で確認する。
- **Discovery Scope**: Extension / Integration-focused discovery
- **Key Findings**:
  - 既存コードは VS Code 拡張テンプレートに近く、`src/extension.ts` と `package.json` の command contribution が主な統合点である。
  - Steering は `VS Code Integration -> Application -> Language Analyzer -> Common Flow Model -> Renderer` の依存方向を要求しているため、設計はこの境界を最優先する。
  - VS Code API は CodeLens、Command、Webview、Clipboard、CancellationToken、Workspace Trust を提供するが、これらは Integration 層へ閉じ込める。

## Research Log

### 処理 Note の密度とテーマ識別性
- **Context**: Requirement 12 は、制御移動・式評価に由来する処理ブロックを、固定の表示文言に依存せずコンパクトかつキャンバス背景から区別できる見た目にすることを求める。
- **Sources Consulted**: `src/renderer/mermaidRenderer.ts`, `src/application/visualizeFunctionFlow.ts`, `src/integration/visualizationView.ts`, `src/integration/webviewMermaid.js`, `node_modules/mermaid/dist/chunks/mermaid.esm/sequenceDiagram-DXCB7GA4.mjs`。
- **Findings**:
  - `throw`、`break`、`continue`、`expression` は Renderer の共通 `renderNote` 経路から `Note over root` として出力される。一方、unknown / unresolved call、order uncertainty、diagnostic も Note を生成するため、描画済み SVG の文字列だけでは処理 Note を安全に区別できない。
  - Mermaid sequence renderer は `noteMargin` を Note text の周囲の余白と Note の幅・高さ計算に使用する。`noteMargin: 20` は全 Note に対する内側余白を大きくしている。
  - Mermaid の theme variable には `noteBkgColor`、`noteBorderColor`、`noteTextColor` があり、現実装は VS Code の `textBlockQuote` 系テーマ変数から解決している。キャンバスとの差をより明確にするには `editorWidget` 系の背景・枠線を優先できる。
- **Implications**:
  - Renderer は Mermaid text・SourceMap を変えず、処理 Note を出力した行番号と FlowNode kind だけの表示専用メタデータを返す。
  - Application と VisualizationView はこのメタデータを別 payload として Webview へ渡し、Webview は固定文言や画面上の距離ではなくそのメタデータで対象 Note を選ぶ。
  - `noteMargin` は `12` に縮める。これは Mermaid sequence の全 Note に作用するレイアウト設定だが、メッセージ、participant、activation、control block の余白設定は維持する。処理 Note 固有の色装飾はメタデータに基づいて適用する。

### メッセージラベル位置調整
- **Context**: Requirement 9.23 の追加に伴い、メッセージ間隔を変えずにラベルと線の距離だけを縮める方法を確認した。
- **Sources Consulted**: `src/integration/webviewMermaid.js`, `src/integration/visualizationView.ts`、既存の Mermaid sequence 設定および SVG 装飾処理。
- **Findings**:
  - Mermaid の `messageMargin` はメッセージ間の縦方向の間隔を制御するため、ラベルと線の局所的な距離調整には使用しない。
  - 既存の Webview は Mermaid 描画後に SVG text へ装飾を適用しており、同じ層でメッセージラベルだけを調整できる。
  - Mermaid の `x`、`y`、`textLength`、`lengthAdjust` を書き換えるとレイアウト計算や長いラベルに影響するため、表示用 `transform` に限定する。
- **Implications**:
  - `webviewMermaid.js` のメッセージ装飾処理に、ラベル text の `translateY`（初期値 20px）を追加する。
  - Mermaid text、SourceMap、線、activation、participant、メッセージ間隔は変更しない。

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

### Decision: 入辺のない先頭 Call を Renderer の entry として描画する
- **Context**: Requirement 16.7 は、関数先頭の Call が先行する処理を持たない場合でも図とコピーから省略されないことを求める。現行 Renderer は FlowEdge を起点に traversal するため、入辺がない最初の Call を描画できない。
- **Sources Consulted**: `src/analyzers/typescript/typescriptAnalyzer.ts`, `src/renderer/mermaidRenderer.ts`, `src/test/extension.test.ts`, `src/test/mermaidRenderer.test.ts`。
- **Alternatives Considered**:
  1. Analyzer が人工的な root edge を Common Flow Model に追加する。
  2. Common Flow Model に renderer 専用 root node を追加する。
  3. Renderer が入辺のない先頭 Call を entry として選択する。
- **Selected Approach**: Renderer が全 FlowEdge の target にならない Call のうち最小 order を entry-call として root から描画する。モデルを変更せず、通常の edge traversal と同じ描画済み node の重複排除を利用する。
- **Rationale**: root は表示専用の概念であり、Analyzer の静的解析結果へ人工的な制御移動を混在させない。既存の Common Flow Model を言語非依存かつ表示方式非依存に保てる。
- **Trade-offs**: entry-call の SourceMap には対応する実在 edge がないため edgeId を付与しない。entry-call 選択規則の変更時は Renderer と統合テストを再検証する。
- **Follow-up**: edge を持たない最初の Call、後続 Call、Unknown / Unresolved、cursor、CodeLens、Clipboard の回帰テストを追加する。

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

### Decision: 入力方式は共通の表示状態契約へ集約する
- **Context**: Requirement 9 はボタンに加えてマウスホイールとトラックパッド／タッチデバイスのピンチズームを求める。既存実装はボタンによる倍率変更と Pointer Events によるパンを持つ。
- **Alternatives Considered**:
  1. ボタン、ホイール、ピンチごとに別々の倍率状態を持つ。
  2. 各入力を同じ `scale` 更新契約へ変換し、パン状態と一元管理する。
  3. Mermaidを入力ごとに再描画して倍率を反映する。
- **Selected Approach**: WebView表示層がホイール量とピンチ距離の変化を共通の表示状態更新へ変換する。SVG内部のレイアウトは変更せず、既存の表示ラッパーのtransformを更新する。
- **Rationale**: ボタン、ホイール、ピンチで倍率境界やリセットの挙動を統一でき、Mermaidテキスト、SourceMap、装飾への影響を避けられる。
- **Trade-offs**: Pointer Eventsの複数ポインター状態と、通常の縦スクロールとの入力調停が必要になる。OSやWebViewがトラックパッドのピンチを異なるイベントへ変換する可能性もあるため、入力経路ごとの検証が必要である。
- **Follow-up**: WebView実機検証ではマウス、macOSトラックパッド、タッチ入力を確認し、ピンチ終了後にパンとスクロールが復帰することを確認する。

### Design Synthesis
- **Generalization**: ボタン、ホイール、ピンチはすべて表示倍率を変更する入力であり、個別のUI状態ではなく共通の表示状態更新へ一般化する。
- **Build vs. Adopt**: 新規ライブラリは導入せず、WebView標準の Wheel Events と Pointer Events を利用する。既存のMermaid描画や外部ズームライブラリを拡張しない。
- **Simplification**: 現要件ではズーム中心を完全にポインター位置へ固定する追加状態を導入せず、既存の `translate` / `scale` 契約を維持する。必要になった場合は別要件として再検討する。

### Display Scale Design Update
- **Context**: 大規模な関数ではMermaidの自動幅調整により、初期100%でも文字・枠・線が小さく表示される。
- **Sources Consulted**: `src/integration/webviewMermaid.js`, `src/integration/visualizationView.ts`, `src/test/visualizationView.test.ts`, Mermaid公式Config Schema
- **Findings**: 現行実装は`sequence.useMaxWidth: true`、SVGの`width:100%`、`transform: scale(1)`を併用している。Mermaid公式仕様では`useMaxWidth: true`は利用可能領域に合わせて図を拡大縮小し、`false`は必要な絶対サイズを使用する。
- **Implications**: 100%では`useMaxWidth: false`と自然サイズのSVGを使用し、図が大きい場合はスクロールさせる。FitはSVG実寸と表示領域から別途倍率を計算し、100%と混同しない。
- **Synthesis**: 新しいライブラリは導入せず、SVGの自然サイズ、WebViewのスクロール、既存CSS transform、ブラウザ標準の寸法取得を採用する。Renderer、Common Flow Model、Application contractは変更しない。

### Viewport and Canvas Design Update
- **Context**: 現行実装ではズーム用`transform`を外側の`#diagram-viewer`へ適用しているため、縮小時にスクロール領域・描画領域自体も縮小される。
- **Sources Consulted**: `src/integration/visualizationView.ts`, `src/test/visualizationView.test.ts`, 既存のWebView表示状態契約
- **Findings**: 外側viewportと内側canvasを同一要素で兼ねている。CSS transformは適用要素の視覚的な大きさも変更するため、viewportの固定と内容のズームを同時に満たせない。
- **Implications**: `#diagram-viewer`を固定viewport、内側ラッパーをcanvasとして分離し、transformはcanvasだけへ適用する。Fitはviewport寸法を基準にcanvas倍率を計算する。
- **Decision**: UI上の倍率と実効描画倍率を分離する。UI 100%は`uiScale=1`とし、初期見た目の微調整は`INITIAL_RENDER_SCALE`固定係数で管理する。Mermaid text、SourceMap、SVG装飾、Copy Mermaid、コードジャンプは表示状態から独立させる。

### 追加UI変更の設計更新

- コントロール順序を `Copy Mermaid`、`100%`、`Fit`、`-`、`x%`、`+` の左寄せ1行へ変更した。
- Copy Mermaid はプライマリボタン色を避け、`--vscode-button-secondaryBackground` と `--vscode-textLink-foreground` を利用し、濃い青系フォールバックを設定する。
- 右端配置用の自動マージンは使用せず、既存のDOM ID、ズームイベント、Copy Mermaidメッセージ契約は維持する。

### 条件ラベル視認性の設計更新

- **Context**: Requirement 11 は `loop`、`alt`、`opt`、`critical`、`option` の条件ラベルと枠線の対応を読み取りやすくする。
- **Finding**: 既存の `decorateSequenceControls` が制御ブロックのキーワード、枠線色、ラベル要素を同じ処理で識別しているため、既存の装飾境界で色と表示位置を一貫して変更できる。
- **Decision**: 条件ラベルの `fill` は対応する `CONTROL_COLOR_BY_KEYWORD` と同じ値を使用する。位置はラベル要素の表示用 `transform` のみを変更し、Mermaid の `x`、`y`、`textLength`、`lengthAdjust`、枠範囲、メッセージ間隔は変更しない。
- **Build vs. Adopt**: 新規ライブラリやMermaid設定の追加は不要で、既存のSVG後処理とCSS/SVG標準の表示変換を利用する。
- **Risk**: MermaidのバージョンやSVGグループ構造により対象要素の親子関係が変わる可能性があるため、5種類の条件を含むfixtureでラベル要素と対応枠の両方を検証する。

### Decision: 処理 Note は表示専用メタデータで識別する
- **Context**: 処理 Note の装飾を `continue`、`break`、`retry++` のような固定文言や、SVG上の相対位置で判定すると、任意の式・ネスト・診断 Note が混在する図で誤装飾する。
- **Alternatives Considered**:
  1. Note の文字列を正規表現で判定する。
  2. すべての Mermaid Note を処理 Note として装飾する。
  3. Renderer が FlowNode kind と Mermaid 出力行を表示専用メタデータとして返す。
- **Selected Approach**: `throw`、`break`、`continue`、`expression` の Note 出力時に `ProcessNoteDecoration` を記録し、Application と VisualizationView を経由して Webview へ渡す。Webview は元の Mermaid text の Note 出現行と SVG Note group を決定的に対応付け、メタデータにあるものだけを装飾する。対応が検証できない場合は装飾を省略する。
- **Rationale**: Common Flow Model の kind を唯一の判定根拠にでき、Mermaid text、SourceMap、コピー内容を保ったまま任意の処理文言へ対応できる。
- **Trade-offs**: Renderer result と Webview payload に小さな表示専用配列が増える。Mermaid の SVG Note group 構造が変化した場合は対応付けを再検証する必要がある。
- **Follow-up**: 実 Mermaid 描画 SVG fixture で、処理 Note・diagnostic Note・ネストした制御構造を混在させ、対象だけが装飾されることを確認する。

### 処理 Note 背景のコントラスト強化
- **Context**: `--vscode-editorWidget-background` はテーマによってキャンバス背景と近い値になり、処理 Note の背景差が視認できない場合がある。
- **Decision**: 処理 Note の背景はキャンバス背景と VS Code のリンク色を `color-mix` で合成し、テーマ性を維持しながら青系の差分を常に持たせる。未対応ブラウザー向けの fallback 色も CSS に含める。
- **Implications**: Note 自体の Mermaid text、Note 以外の背景、SourceMap、コピー対象は変更しない。Dark / Light テーマの実 SVG fixture でキャンバス背景との差を確認する。

### Design Synthesis: 処理 Note の表示改善
- **Generalization**: `continue`、`break`、任意の式評価はすべて FlowNode kind から出力される処理 Note として扱い、表示文字列では区別しない。
- **Build vs. Adopt**: Mermaid が提供する `noteMargin` と theme variables、既存の Webview SVG 後処理を利用し、新規ライブラリや独自 SVG renderer は導入しない。
- **Simplification**: FlowModel へ表示色や余白を追加せず、Renderer result の最小限の行番号・kind メタデータと Webview の CSS class だけで完結する。SourceMap を表示装飾用に転用しない。

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

---

## Requirement 16: 指定関数を起点とするライフラインとメッセージの設計調査

### Summary

- 現在の Renderer は固定 ID `root` を空 label で出力している。左端を `self` にするには、root の表示名だけを変更し、内部 ID は維持する必要がある。
- TypeScript Analyzer は receiver を取得できるため、クラス名またはインスタンス名だけを plain-data `FlowParticipant` として Flow Model に渡せる。
- module URI、ファイル名、役割名を代替タイトルにすると今回の要件を逸脱するため、識別できない場合は `Unknown`／`Unresolved` の固定 participant へ集約する必要がある。

### Research Log

#### Existing model and renderer boundary

- **Sources Consulted**: `src/flow-model/flowModel.ts`、`src/flow-model/flowNode.ts`、`src/analyzers/typescript/typescriptAnalyzer.ts`、`src/analyzers/python/pythonAnalyzer.ts`、`src/renderer/mermaidRenderer.ts`、関連 unit tests
- **Findings**:
  - root は固定 ID `root` を participant ID として使用し、空 label で出力している。固定の `self` root 表示へ変更する必要がある。
  - PropertyAccessExpression の receiver は analyzer に存在するため、Identifier receiver をクラスまたはインスタンスとして Flow Model へ渡せる。
  - existing participant key を利用すれば、`Unknown` と `Unresolved` を各一つへ集約できる。
- **Implications**:
  - Call participant の key と label を model contract に追加し、renderer は key で重複排除する。
  - root は model 名や source URI を title に使用せず、Renderer 固定 ID `root` と label `self` で最初に出力する。
  - `calleeName` は引数を含まない要求 message として残す。

### Design Decisions

#### Decision: `self` root とクラス／インスタンス限定の FlowParticipant を導入する

- **Alternatives Considered**:
  1. Renderer が `calleeName`、source URI、または関数名からライフライン名を推測する。
  2. TypeScript TypeChecker と言語別の型解析を導入し、実体を完全解決する。
  3. Renderer が `self` root を固定出力し、Analyzer が構文から確定できるクラス／インスタンスだけを Call participant として渡す。
- **Selected Approach**: 3 を採用する。
- **Rationale**: 静的解析のみ・Language Analyzer boundary・Common Flow Model first を守り、ユーザーが指定したタイトルの範囲を超えない。
- **Trade-offs**: 型を完全解決しないため、候補がない呼び出しは module fallback ではなく Unknown / Unresolved になる。
- **Follow-up**: Analyzer version を更新し、participant contract 追加前の cache result を再利用しないことを検証する。

#### Design Synthesis

- **Generalization**: 言語固有の receiver 抽出を、クラス／インスタンス・unknown・unresolved だけを持つ共通 `FlowParticipant` へ一般化する。root は participant resolution の対象外とする。
- **Build vs. Adopt**: Mermaid の標準 participant syntax と既存 Renderer を利用する。TypeChecker、外部パッケージ解決、追加ライブラリは導入しない。
- **Simplification**: participant resolver を公開サービスにせず、各 Analyzer 内部の小さな変換と共通 Flow Model value object に限定する。モジュール・ファイル名の正規化は不要にする。

### Risks & Mitigations

- 同じ label を異なる主体が共有するリスク — `FlowParticipant.key` を participant の同一性に使い、label では集約しない。
- `Unknown` が多数表示されるリスク — kind ごとの固定 key を使用して一つに集約する。
- `self` root が Mermaid 構文または表示テーマで意図せず表示されないリスク — 実 Mermaid 描画を含む renderer fixture で `self` の表示名と最左位置を検証する。
- collection method の receiver が実体不明なリスク — Requirement 14 の対象だけを `Array` クラスとして表し、その他は推測せず fallback する。

---

## Requirement 13: メッセージラベル簡潔化の設計調査

### Summary

- 現在の `MermaidRenderer.renderReturn` は `return ${node.expression}` をそのまま Mermaid message にしているため、オブジェクトリテラルを含む return 式が長大なラベルになる。
- `renderCall` は callee 名中心のラベルを既に生成しているため、主な改善対象は return / throw の式要約である。
- `RenderResult.mermaidText` は WebView 表示と Clipboard コピーの双方で利用されるため、Rendererで一度だけ要約すれば両者の内容を一致させられる。
- `sourceMap` は Mermaid 行番号と node / edge を保持しており、ラベル文字列だけを変更してもコード対応を維持できる。

### Research Log

#### Existing Renderer and Integration Contract

- **Sources Consulted**: `src/renderer/mermaidRenderer.ts`, `src/renderer/index.ts`, `src/application/visualizeFunctionFlow.ts`, `src/integration/visualizationView.ts`, `src/test/mermaidRenderer.test.ts`, `src/test/visualizationView.test.ts`
- **Findings**:
  - Return node は `node.expression` を直接文字列化して Mermaid の return message に渡している。
  - Call node は `calleeName`、`await`、resolution suffix を使っており、引数の詳細を含めていない。
  - `mermaidText` は `VisualizationSuccessResult`、`VisualizationViewModel`、`currentMermaidText` を経由して表示・コピーされる。
  - SourceMap はラベル内容ではなく Mermaid 行番号、nodeId、edgeId、sourceLocation でコード対応を表現する。
- **Implications**:
  - WebView後処理ではなく Rendererのメッセージ生成時に要約する。
  - Common Flow Model、SourceMap、Clipboard adapter の契約変更は不要である。

#### Design Decision: Renderer-local Formatter

- **Alternatives Considered**:
  1. WebView SVGの文字列を描画後に切り詰める。
  2. Analyzerが解析時に短い表示ラベルをFlowNodeへ格納する。
  3. Renderer内部の純粋なFormatterでMermaid messageを生成する。
- **Selected Approach**: 3を採用する。
- **Rationale**: 表示とコピーの一致、Analyzerと表示責務の分離、SourceMap行の安定性を同時に満たせる。WebViewやAnalyzerに表示固有の責務を追加しない。
- **Trade-offs**: Rendererは文字列ベースの安全な要約に限定され、全てのTypeScript構文を意味解析する責務は持たない。

#### Design Synthesis

- **Generalization**: 長大なラベル対策は `return` 固有ではなく、Call / Return / Throw に共通する `MessageLabelFormatter` と表示上限ポリシーへ一般化する。ただし現在の実装範囲ではこの3種類だけを対象とする。
- **Build vs. Adopt**: 新規ライブラリやMermaid拡張は導入せず、標準TypeScriptの文字列処理と既存Rendererを拡張する。
- **Simplification**: participant名、FlowModel、SourceMap、WebView表示状態を変更せず、Renderer内部の一つの整形境界だけを追加する。

### Risks and Mitigations

- 式の構文を誤って意味要約するリスク — 呼び出し先の安全な抽出に失敗した場合は空白正規化と長さ制限へフォールバックし、意味の推測を行わない。
- 同一ラベルの呼び出しを識別しづらくなるリスク — 連番をラベルへ埋め込まず、Mermaid行順、participant、SourceMapのnodeId / edgeIdを維持する。
- 表示とコピーの内容が乖離するリスク — `mermaidText`生成後のWebView側変換を行わず、Renderer出力を両経路で共有する。

---

## Requirement 14: コレクションメソッドの静的呼び出し判定

### Summary

- `FlowBuilder.callInfo` は PropertyAccessExpression の receiver が CallExpression である場合、メソッド名に関係なく dynamic receiver として unresolved にしていた。
- `findFunctionCandidates(source).map(...)` の `map` は、表示上は既知の標準コレクション操作として識別できるため、動的オブジェクトメソッドとは異なる扱いが必要である。
- `factory.getService(name).run()` と `serviceMap[type].execute()` は receiver の実体を静的に確定できないため、unresolved を維持する。
- Analyzer version は CacheKey に含まれているため、判定規則を変更した場合に version を更新すれば旧結果を再利用しない契約を満たせる。

### Research Log

#### Existing Classification Logic

- **Sources Consulted**: `src/analyzers/typescript/typescriptAnalyzer.ts`, `src/test/typescriptFlowExtractor.test.ts`, `src/application/cache.ts`, `src/application/visualizeFunctionFlow.ts`, `src/renderer/mermaidRenderer.ts`
- **Findings**:
  - `callInfo` は PropertyAccessExpression の receiver が CallExpression、NewExpression、ElementAccessExpression、optional access の場合に unresolved を返す。
  - ElementAccessExpression の callable target は unknown として扱われる。
  - `FlowCallNode.resolution` は Renderer の participant、message、unresolved Note、diagnostic の分岐に使われる。
  - CacheKey は analyzer id と analyzer version を含み、version が異なると cache miss になる。
- **Implications**:
  - 判定変更は Analyzer 層の `callInfo` に閉じ込め、FlowModel と Renderer の契約を変更しない。
  - collection method だけを例外的に resolved とし、動的 receiver の一般的な完全解決へ拡張しない。

#### Design Decision: Syntax-based Collection Method Policy

- **Alternatives Considered**:
  1. すべての CallExpression receiver の method call を resolved とする。
  2. TypeScript Program / TypeChecker を導入して receiver の実行時型を解決する。
  3. 標準コレクションメソッド名を構文上の表示ポリシーとして扱い、それ以外は従来の unresolved 判定を維持する。
- **Selected Approach**: 3を採用する。
- **Rationale**: 新しいProgram構築や外部モジュール解決を導入せず、`map` などの一般的な操作を正確に表示できる。動的オブジェクトメソッドの不確実性も保持できる。
- **Trade-offs**: 同名のカスタムメソッドを完全には識別できないため、対象集合を拡張するときは動的オブジェクトメソッドの回帰テストを必須とする。

#### Design Synthesis

- **Generalization**: 問題は `map` 固有ではなく、CallExpression receiver 上の標準コレクション操作という判定カテゴリに一般化する。ただし実装は必要なメソッド集合に限定する。
- **Build vs. Adopt**: TypeScript TypeChecker の導入は採用せず、既存の Compiler API AST と既存 CacheKey 契約を利用する。
- **Simplification**: 新しい Analyzer interface や FlowModel field は追加せず、既存 `CallResolution` の分類だけを修正する。

### Risks and Mitigations

- カスタムオブジェクトの `map` を誤って resolved にするリスク — collection method 集合を限定し、動的 `run` や計算プロパティの unresolved / unknown 回帰を維持する。
- 判定変更後に旧キャッシュが残るリスク — Analyzer version を更新し、既存 CacheKey の version 差分による cache miss を利用する。
- resolved と完全な型解決を混同するリスク — 設計と診断文言で、resolved は表示上の操作識別を意味し receiver の実行時型保証ではないことを明記する。

---

## Requirement 15: 実行順と Break / Continue 契約の設計調査

### Summary

- Common Flow Model の設計は `break-exit` と `continue-loop` を定義していた一方、FlowNode union に対応する node を含めておらず、設計内で矛盾していた。
- 実装と contract test には既に `FlowBreakNode`、`FlowContinueNode`、対応 edge kind が存在するため、既存 node への曖昧な埋め込みではなく、明示的な node として設計へ採用する。
- 静的解析の不確実性と Mermaid の表現不能は異なる責務であり、前者は FlowDiagnostic、後者は RendererWarning として Application で別々の notice に変換する。

### Research Log

#### Existing model, analyzer, and renderer boundary

- **Sources Consulted**: `src/flow-model/flowNode.ts`、`src/flow-model/flowEdge.ts`、`src/analyzers/typescript/typescriptAnalyzer.ts`、`src/renderer/mermaidRenderer.ts`、`src/application/visualizeFunctionFlow.ts`、関連 contract / renderer tests。
- **Findings**:
  - FlowNode は Break / Continue を独立した discriminated union として持ち、各 node は statement の sourceLocation と静的実行順の order を持つ。
  - Analyzer は loop context を使い、break を loop 後の最初に到達可能な node へ `break-exit` として接続する。後続がなければ edge を作らず、break は terminal になる。continue は最も内側の loop node へ `continue-loop` として接続する。
  - Renderer は Break / Continue を処理 Note として表し、continue-loop を Mermaid の循環メッセージとして重複出力しない。不正または表現できない node / edge 組合せは RendererWarning として返す。
  - FlowDiagnostic と RendererWarning は Application でそれぞれ VisualizationNotice に変換され、Analyzer は Mermaid の表現可否を判断しない。
- **Implications**:
  - FlowNode / FlowEdge の設計契約と TypeScriptAnalyzer、MermaidRenderer、Application、VisualizationView の責務を一致させる。
  - Analyzer の実行順規則または Common Flow Model 変換を変更する場合は analyzer version を更新し、既存の CacheKey によって古い結果を再利用しない。

### Design Decisions

#### Decision: Break / Continue は専用 FlowNode として表現する

- **Alternatives Considered**:
  1. Break / Continue を expression node の文字列として扱う。
  2. Break / Continue を edge だけで表し、起点 node を作らない。
  3. `FlowBreakNode` と `FlowContinueNode` を Common Flow Model の discriminated union として定義する。
- **Selected Approach**: 3 を採用する。
- **Rationale**: sourceLocation、order、処理 Note、SourceMap、制御 edge の起点を一つの型安全な契約で保持でき、Renderer が文字列推測を行わずに済む。
- **Trade-offs**: FlowNode union を利用する Analyzer、Renderer、test fixture の網羅性が必要になる。これは既存の実装契約と一致するため、新しい依存は増えない。
- **Follow-up**: 入れ子 Call、複数 loop、後続のない break、continue、uncertain edge を含む fixture で制御移動と notice 経路を回帰確認する。

#### Design Synthesis

- **Generalization**: 制御移動は statement text ではなく、sourceLocation と order を持つ FlowNode、および意味を表す FlowEdge の組合せとして表現する。
- **Build vs. Adopt**: TypeScript Compiler API、既存 Common Flow Model、MermaidRenderer を拡張して利用し、新規 parser、型解析器、Mermaid 拡張は導入しない。
- **Simplification**: 静的順序不確実性は Analyzer の FlowDiagnostic に限定し、Mermaid 変換の問題は RendererWarning に限定する。両者を相互変換しない。

### Risks & Mitigations

- loop の出口を誤って loop 内へ接続するリスク — `break-exit` の target が loop body 内でないことを Analyzer と Renderer の fixture で検証する。
- continue を通常の逐次処理として描画するリスク — `continue-loop` は次反復の制御 edge とし、Renderer は循環メッセージを追加しない。
- 不確実性の表示経路が混在するリスク — FlowDiagnostic と RendererWarning を Application の別変換で検証する。

---

## Mermaid 活性化とコピー一致の設計調査

### Summary

- WebView は `buildMermaidRenderText()` で `activate` / `deactivate` を描画時だけに補完しているため、Clipboard の `mermaidText` と図の構造が分岐している。
- `MermaidRenderer` は正規 Mermaid の行、SourceMap、process note の行番号を管理する唯一の境界であり、活性化命令の生成責務を置ける。
- 新規ライブラリ、Flow Model の活性化専用フィールド、Analyzer の言語別活性化ロジックは不要である。

### Research Log

#### Renderer と WebView の文字列経路

- **Sources Consulted**: `src/renderer/mermaidRenderer.ts`、`src/application/visualizeFunctionFlow.ts`、`src/integration/visualizationView.ts`、`src/integration/webviewMermaid.js`、`src/test/mermaidRenderer.test.ts`、`src/test/visualizationView.test.ts`。
- **Findings**:
  - `MermaidRenderer` の `RenderContext` は Mermaid の行、SourceMap、処理 Note の行番号を一元的に管理している。
  - `VisualizationView` は Renderer から受けた `mermaidText` を保持して Clipboard へ渡すが、WebView はその文字列を `buildMermaidRenderText()` で別の描画入力へ変換する。
  - WebView の変換は root と呼び出し先 participant の活性化を補完するが、その変換後の文字列は表示・コピーの公開契約に存在しない。
- **Implications**:
  - Renderer が活性化命令を含む正規 Mermaid を出力し、行番号を正規出力に対して確定する。
  - WebView は正規 Mermaid を変更せずに描画し、SVG 装飾だけを担当する。

### Design Decisions

#### Decision: Renderer を活性化命令の唯一の生成元にする

- **Alternatives Considered**:
  1. WebView の変換済み文字列を Clipboard に返す。
  2. 各 Language Analyzer が活性化専用の Flow Model データを追加する。
  3. `MermaidRenderer` が既存の Call / Await / Return / Throw と FlowEdge の順序から活性化命令を正規 Mermaid テキストへ出力する。
- **Selected Approach**: 3 を採用する。
- **Rationale**: Renderer が Mermaid 構文の唯一の責務を持つ既存境界、Common Flow Model first、Mermaid-first、および表示とコピーの完全一致を維持できる。
- **Trade-offs**: 活性化命令の追加により Mermaid 行番号が増えるため、SourceMap と process note の行番号を Renderer 出力基準で検証する必要がある。
- **Follow-up**: Call、Await、Return、Throw、入れ子 Call、partial result を含む Renderer / WebView fixture を追加し、活性化命令を含む文字列の完全一致を確認する。

#### Design Synthesis

- **Generalization**: 表示専用の文字列変換ではなく、再利用可能な Mermaid 構造を Renderer の正規出力へ集約する。
- **Build vs. Adopt**: Mermaid の sequence diagram 標準 `activate` / `deactivate` 構文と既存 Renderer を使用し、新規依存や独自の図表形式は追加しない。
- **Simplification**: Flow Model、Analyzer、Application、Clipboard API の型を変更せず、Renderer 内部の活性化出力状態と WebView の不要な構造変換だけを変更する。

### Risks & Mitigations

- 活性化命令の行追加で SourceMap または process note 行番号がずれるリスク — Renderer の `addLine()` 経路で命令を出力し、行番号の回帰テストを追加する。
- Call の後に対応する終端がない場合に活性化が閉じないリスク — 既存の静的 FlowEdge と terminal node から閉じる規則を定義し、表現不能な状態を実行時情報で補完しない。
- WebView の旧後処理が残り二重活性化するリスク — Mermaid 構造の書き換え関数を削除し、WebView が受け取った文字列を直接描画することをテストする。

---

## Requirement 17: caller を含む return 表現の設計調査

### Summary

- 現行 Renderer は Return edge の source Call participant を送信元として `participant-->>root: return` を出力するため、対象関数の return と Call participant の応答を混同する。
- 呼び出し元は静的 Flow Model に存在しない。caller を Renderer 固定 participant とすれば、Analyzer と Flow Model の責務を拡張せずに `root-->>caller` を正規 Mermaid として出力できる。
- Call participant の deactivate は return message の送信元とは独立して維持でき、SourceMap、WebView、Clipboard は既存の Renderer 出力経路を再利用できる。

### Research Log

#### Existing return rendering and text propagation

- **Sources Consulted**: `src/renderer/mermaidRenderer.ts`、`src/flow-model/flowModel.ts`、`src/flow-model/flowNode.ts`、`src/flow-model/flowParticipant.ts`、`src/integration/visualizationView.ts`、`src/test/mermaidRenderer.test.ts`、`src/test/pythonFunctionFlow.test.ts`、`src/test/visualizationView.test.ts`。
- **Findings**:
  - `renderReturn()` は edge source の call participant を選び、`participant-->>root` を出力する。caller は Renderer、FlowModel、FlowParticipant のいずれにも存在しない。
  - `RenderContext` は participant 登録順で Mermaid 宣言を出力するため、caller を root より先に登録すれば caller を図の最左に固定できる。
  - return の Mermaid 行は既に Return node / edge の SourceMap を作成する。正規出力を変えても同じ行生成経路を使えばコード対応は維持できる。
  - VisualizationView は Renderer の `mermaidText` を WebView payload と Clipboard に同一文字列として渡す。
- **Implications**:
  - caller は Renderer 内部の synthetic participant とし、Flow Model 公開契約や Language Analyzer の入力・出力を変更しない。
  - return message の出力と call participant の deactivate を別操作として扱う必要がある。

### Design Decisions

#### Decision: caller を Renderer 固定 participant とする

- **Alternatives Considered**:
  1. Return edge の source Call participant を return message の送信元として使い続ける。
  2. caller を FlowModel / FlowParticipant に追加して各 Analyzer が供給する。
  3. `MermaidRenderer` が未特定の外部 caller を固定 participant として追加し、Return node を root から caller へ出力する。
- **Selected Approach**: 3 を採用する。
- **Rationale**: caller は関数内の静的フローではなく図の外部文脈であり、Renderer 固定 root と同じ層に置くことで Common Flow Model first と Language Analyzer の独立性を維持できる。
- **Trade-offs**: 図に participant が一つ増え、既存 SourceMap 行番号を参照する fixture は更新を要する。caller の実在名は表示できないが、静的推測を行わない要件に合致する。
- **Follow-up**: 通常 Call、await、入れ子 Call、Unknown / Unresolved、partial result の後にある return と、表示・コピーの同一文字列を回帰検証する。

#### Design Synthesis

- **Generalization**: 問題は Python の return ではなく、対象関数の終端と関数内 Call の終端を区別する言語横断 Renderer 契約である。
- **Build vs. Adopt**: Mermaid sequence diagram の既存 response message 構文と既存 Renderer を使用し、新規ライブラリ、外部サービス、Flow Model の caller 型は追加しない。
- **Simplification**: synthetic caller は一つの固定 participant に限定し、呼び出し元の名称解決、entry call の推測、throw の表現変更は実施しない。

### Risks & Mitigations

- participant 宣言の追加で SourceMap / process note の行番号がずれるリスク — 全行を `RenderContext.addLine()` から出力し、return の SourceMap 行と process note 行を回帰確認する。
- return と callee deactivate が再結合するリスク — return sender を常に root、deactivate target を edge source Call participant として別々に検証する。
- WebView または Clipboard が旧 Mermaid text を使用するリスク — VisualizationView の payload と Clipboard の byte-for-byte 回帰 test を追加する。

---

## Requirement 16: caller から self への開始呼び出しの設計調査

### Summary

- 固定 `caller` と `self` の間に synthetic entry message を置くことで、関数本体と return を含む呼び出し全体を読み取れる。
- entry は関数内の静的 FlowNode / FlowEdge ではないため、FlowModel、Analyzer、SourceMap のコードジャンプ契約を拡張しない。
- Renderer の正規 Mermaid text に一度だけ出力すれば、WebView と Clipboard は既存の共有経路で一致する。

### Design Decisions

#### Decision: caller から self への入口を Renderer 固定 message とする

- **Alternatives Considered**:
  1. 呼び出し元の実在する関数名やモジュール名を解析して entry message に使用する。
  2. FlowModel に synthetic caller node / edge を追加する。
  3. `MermaidRenderer` が固定 `caller->>root: invoke` を一度だけ出力する。
- **Selected Approach**: 3 を採用する。
- **Rationale**: `caller → self → caller` を可視化しつつ、function-first の静的解析境界、FlowModel の関数内フロー責務、caller 名非推測契約を維持できる。
- **Trade-offs**: entry message は元コードの FlowNode / FlowEdge ではないため、SourceMap のコードジャンプ対象にはならない。
- **Follow-up**: entry が本体前に一度だけ出力され、WebView と Clipboard が同じ正規 Mermaid text を共有することを回帰検証する。

#### Design Synthesis

- **Generalization**: caller は静的な呼び出し解決の結果ではなく、対象関数の外部文脈を示す Renderer 固定の participant と message である。
- **Build vs. Adopt**: Mermaid sequence diagram の既存 request message 構文と既存 Renderer を利用し、新規ライブラリを導入しない。
- **Simplification**: caller 名の解決、synthetic FlowModel node、entry 用 SourceMap、言語別 Renderer 分岐を追加しない。

---

## Requirement 18: 自己呼び出し表示の設計調査

### Summary

- `self.method()` と `this.method()` は対象関数自身への呼び出しとして識別できるが、既存の FlowParticipant には root / self を表す種類がない。
- participant の label から自己呼び出しを推測すると、表示名と主体の同一性を混同するため、Call に明示的な表示宛先を追加する。
- renderer が root のネスト activation と Note を正規 Mermaid text に出力すれば、WebView と Clipboard の既存共有経路を維持できる。

### Design Decisions

#### Decision: Call の表示宛先を明示する

- **Alternatives Considered**:
  1. `self` / `this` を通常の instance participant として描画する。
  2. participant の label が `self` かどうかを Renderer で判定する。
  3. `FlowCallNode.invocationTarget` で participant と self を明示する。
- **Selected Approach**: 3 を採用する。
- **Rationale**: Analyzer が言語構文を解釈し、Renderer は言語非依存の Flow Model を描画する既存境界を維持できる。
- **Trade-offs**: Common Flow Model の公開 contract を一つ拡張するため、TypeScript / JavaScript / Python の analyzer と renderer の回帰を同時に行う必要がある。
- **Follow-up**: Note 行の SourceMap、activation の対称性、direct / dynamic call の非誤分類を fixture で確認する。

#### Design Synthesis

- **Generalization**: 自己呼び出しは Python 固有の participant 名問題ではなく、言語横断の Call 表示宛先の問題である。
- **Build vs. Adopt**: 既存 Common Flow Model と Mermaid の Note / activation 構文を使用し、新規依存を導入しない。
- **Simplification**: caller のような synthetic node や自己呼び出し専用 Renderer / WebView 分岐を追加しない。

### Risks & Mitigations

- direct call を自己呼び出しへ誤分類するリスク — receiver が `this` / `self` と構文上明示された場合だけ target を設定する。
- nested activation が不均衡になるリスク — Renderer の既存 stack に root を一段だけ push / pop し、終了数の一致をテストする。
- Note の SourceMap が操作行を指さないリスク — Note の追加行を Call node と Await→Call edge の source map として登録する。
