# Implementation Plan

## Execution Order

この計画は、共通契約を先に実装し、その上へ Python 固有の解析と VS Code 統合を積み上げる。各タスクは完了条件を満たすテストを同時に追加または更新する。実装時に Common Flow Model、Mermaid 表現、共通 UI、または公開 contract の変更が追加で必要になった場合は、実装を進める前に共通仕様の再レビューを行う。

- [x] 1. 共通言語・実行順・ループ制御 contract を実装する

  - **変更対象**: `src/flow-model/sourceLocation.ts`、`metadata.ts`、`flowEdge.ts`、`flow-model` export、`src/test/flowModel*.test.ts`、`src/test/flowModelContract.test.ts`
  - Flow Model の language ID を既存4言語の union に固定せず、登録済み Analyzer の `languageId` を保持できる型へ開放する。
  - `break-exit` と `continue-loop` を FlowEdge kind として追加し、Break node からループ後の最初の到達可能 node、Continue node から loop node への意味論を contract として検証する。
  - `FlowNode.order` と `FlowEdge.executionOrder` が source traversal order ではなく、静的に推定できる実行順を表す不変条件を追加する。
  - **完了条件**: `python` languageId を含む plain-data FlowModel、両 edge kind、実行順の不変条件を unit test で検証できる。
  - **検証**: `npm run check-types`、`npm run lint`、`npm run test:unit`
  - _Requirements: 共通 15.1-15.4、Python 3.1-3.5、Python 5.5_
  - _Design: 共通「Cross-language Execution Order and Loop Control」、Python「Flow Model language ID」_

- [x] 2. 共通 Renderer と既存 TypeScript / JavaScript Analyzer を実行順 contract へ追従させる

  - **変更対象**: `src/analyzers/typescript/typescriptAnalyzer.ts`、`src/renderer/mermaidRenderer.ts`、`src/test/typescriptFlowExtractor.test.ts`、`src/test/mermaidRenderer.test.ts`、必要に応じて `src/flow-model/diagnostics.ts`
  - TypeScript / JavaScript の nested Call を子式から親式へ評価順で抽出し、`outer(inner())` が `inner`、`outer` の順になるよう更新する。
  - Break / Continue の `break-exit` / `continue-loop` を生成し、Renderer は通常の `next` edge として扱わず、loop 内の制御移動として処理する。
  - `continue-loop` は次の反復として Mermaid に表現する。Mermaid の構造化表現で完全に表現できない edge 組合せは、render 可能な順序を保ち、`order-uncertain` diagnostic または renderer warning で不確実性を明示する。
  - `break-exit` は Break node からループ後の最初の到達可能な処理へ接続し、Flow Model と Mermaid 出力の双方で到達経路を検証する。
  - Analyzer version を更新して既存キャッシュを再利用しないようにする。
  - **完了条件**: TypeScript / JavaScript の `outer(inner())` が `inner → outer` の順で、break / continue の Flow Edge と Mermaid 表示が共通 contract に一致する。`continue-loop` が通常の逐次 edge として表示されず、表現不能な場合に diagnostic または warning が返る。Analyzer version の更新により既存 cache entry が hit しないこと、および非関連 fixture が回帰しないことを確認できる。
  - **検証**: nested call の実行順、`break-exit` の loop 後到達、`continue-loop` の表示または不確実性通知、analyzer version 差分による cache miss を含む unit test と、`npm run check-types`、`npm run lint`、`npm run test:unit`
  - _Depends: 1_
  - _Requirements: 共通 2.2-2.4、6.1-6.5、15.1-15.5、Python 5.5_
  - _Design: 共通「LanguageAnalyzer Interface」「Cross-language Execution Order and Loop Control」_

- [x] 3. 言語非依存の Function Locator contract と registry を導入する

  - **変更対象**: `src/analyzers/functionLocator.ts`、`src/analyzers/functionLocatorRegistry.ts`、`src/analyzers/typescript/functionLocator.ts`、`src/analyzers/index.ts`、`src/integration/functionRanges.ts`、関連 unit tests
  - FunctionCandidate、offset を含む FunctionRange、FunctionLocator、FunctionLocatorRegistry の公開 contract を作成する。
  - 既存 TypeScript / JavaScript / TSX / JSX locator を新 contract へ移行し、候補形状、最内関数選択、CodeLens range の既存振る舞いを保持する。
  - registry は languageId から locator を解決し、未登録言語を安全に拒否する。CodeLens 候補列挙が Analyzer を起動しないことを維持する。
  - **完了条件**: TypeScript 系既存 fixture と新 registry fixture が通り、言語固有 parser 型を Integration 層へ渡さない。
  - **検証**: `npm run check-types`、`npm run lint`、`npm run test:unit`
  - _Depends: 1_
  - _Requirements: 共通 1.1-1.3、Python 1.1-1.5、Python 5.5_
  - _Design: 共通「Function Locator」、Python「Language-independent function locator」_

- [x] 4. Python parser dependency と parser adapter の安全な境界を追加する

  - **変更対象**: `package.json`、`package-lock.json`、`src/analyzers/python/pythonParser.ts`、`src/analyzers/index.ts`、parser adapter tests、安全境界 tests
  - `@lezer/python` を production dependency として `npm install` で追加し、lockfile を手編集しない。
  - parser adapter 内だけで Lezer の parser、Tree、TreeCursor を利用し、型を `analyzers/python/` の外へ公開しない。
  - LineMap と構文エラー検出を実装し、不完全な編集状態で解析可能な範囲を返せるようにする。parser 内部のエラー文字列を user-visible notice に露出しない。
  - esbuild production bundle で追加の WASM、native addon、外部 URL、Python インタープリタが不要であることを確認する。
  - **完了条件**: Python source を in-process で parse でき、adapter fixture が代表構文と構文エラーを扱え、安全境界 test が依存境界を検証する。
  - **検証**: `npm run check-types`、`npm run lint`、`npm run test:unit`、`npm run package`
  - _Depends: 1_
  - _Requirements: Python 3.2、4.3-4.5、5.1-5.3_
  - _Design: Python「Parser Decision」「Python parser adapter」_

- [x] 5. PythonFunctionLocator と CodeLens の言語別選択を実装する

  - **変更対象**: `src/analyzers/python/pythonFunctionLocator.ts`、`src/integration/codeLensCommands.ts`、`src/integration/codeLensProvider.ts`、`src/integration/extensionEntry.ts`、`src/integration/vscodeAdapters.ts`、`src/test/pythonFunctionLocator.test.ts`、CodeLens tests
  - top-level、class 内、nested の `def` / `async def` を CodeLens 候補として抽出し、lambda は候補にしない。
  - cursor が複数の関数範囲に入る場合は最内関数を選ぶ。decorator、名前、full range、body range の契約を fixture で固定する。
  - CodeLens provider と command factory へ FunctionLocatorRegistry を注入し、`python` を含む対応言語 selector で軽量な候補列挙を行う。
  - **完了条件**: Python の CodeLens と cursor 起点の対象関数が正しく一致し、編集途中・未対応言語・未信頼 workspace でも既存の安全な振る舞いを保つ。
  - **検証**: `npm run check-types`、`npm run lint`、`npm run test:unit`、`npm run test:integration`
  - _Depends: 3, 4_
  - _Requirements: Python 1.1-1.5、4.4、5.6_
  - _Design: Python「PythonFunctionLocator」「CodeLens flow」_

- [x] 6. PythonAnalyzer の基本フロー抽出を実装する

  - **変更対象**: `src/analyzers/python/pythonAnalyzer.ts`、`src/analyzers/index.ts`、`src/integration/vscodeAdapters.ts`、`src/test/pythonAnalyzer.test.ts`、analyzer contract tests
  - `LanguageAnalyzer` として `python` を登録し、対象関数の body だけを解析して Common Flow Model を返す。
  - Call、nested Call、Await、`AssignStatement`、型注釈付き代入、`UpdateStatement` の右辺 Call / Await、`if` / `elif` / `else`、`for` / `while`、`try` / `except` / `finally`、`return`、`raise` を静的な実行順でモデル化する。`AssignOp` / `UpdateOp` より後の右辺だけを抽出し、`retry += 1` のように呼び出しを含まない代入・更新は diagnostic なしで通過する。
  - 複数の context expression を含む `with` を左から右に抽出し、暗黙の `__enter__` / `__exit__` を推測しない。
  - Break / Continue を共通 edge contract へ接続し、nested function、lambda、comprehension の callable body へ再帰しない。
  - **完了条件**: Python fixture の node order、edge order、分岐・ループ・例外経路、`outer(inner())`、複数 `with`、代入、拡張代入、try / except / finally が期待どおりの FlowModel になる。拡張代入右辺の nested call / await を抽出し、Loop / Branch の表示ラベルは body を含まず、loop-exit は loop node 起点である。
  - **検証**: `UpdateStatement` の無診断通過、右辺 call / await、`while retry < 3` と `if saved` の表示ラベル、nested loop / break / continue / try / except の edge source を含む unit test と、`npm run check-types`、`npm run lint`、`npm run test:unit`
  - _Depends: 1, 4, 5_
  - _Requirements: Python 2.1-2.9、3.1、3.3-3.5_
  - _Design: Python「PythonAnalyzer」「Python to Flow Model Mapping」「Control-flow Construction」_

- [x] 7. Python の partial analysis、未知呼び出し、キャンセルを実装する

  - **変更対象**: `src/analyzers/python/pythonAnalyzer.ts`、`src/test/pythonAnalyzer.test.ts`、`src/test/analyzerContract.test.ts`、`src/test/safetyBoundary.test.ts`
  - 属性・添字・動的 callable の規則に従い `unknown` / `unresolved` と diagnostic を生成する。
  - 拡張代入の右辺に含まれる動的 callable には同じ `unknown` / `unresolved` と partial analysis 規則を適用し、演算子や代入先だけを diagnostic の理由にしない。
  - 構文エラー、`match` / `case`、generator、loop / try の `else` など初期スコープ外の構文では、解析済み範囲を保持して partial result を返す。
  - 解析開始前、parse 完了直後、走査中の cancellation を扱い、cancelled / fatal result を cache しない。
  - 対象コード、コールバック、式を実行せず、Python インタープリタ、外部プロセス、実行時トレース、外部送信を使わないことを検証する。
  - **完了条件**: partial / failed / cancelled の AnalyzerResult、拡張代入右辺の unknown / unresolved と diagnostic location、no-execution safety が fixture と boundary test で確認できる。
  - **検証**: `npm run check-types`、`npm run lint`、`npm run test:unit`
  - _Depends: 6_
  - _Requirements: Python 4.1-4.5、5.1-5.4_
  - _Design: Python「Error, Diagnostic, and Cache Policy」「Control-flow Construction」_

- [x] 8. Python を Application・manifest・Workspace Trust・キャッシュへ接続する

  - **変更対象**: `package.json`、`src/integration/documentSelector.ts`、`src/integration/vscodeAdapters.ts`、`src/application/cache.ts`、`src/test/foundation.test.ts`、`src/test/visualizeFunctionFlowUseCase.test.ts`、統合 tests
  - `onLanguage:python` と対応言語 configuration を追加し、AnalyzerRegistry に PythonAnalyzer を登録する。
  - cache key に存在する analyzer id / version を利用し、Python の parser・変換規則変更時は analyzer version を更新する。Python と既存言語の cache を混同しない。
  - Python の command、CodeLens、可視化、Clipboard に既存 Workspace Trust guard を同じように適用する。
  - **完了条件**: Python の supported / unsupported 判定、拡張代入の解析意味論変更に伴う analyzer version 差分での cache miss、Restricted Mode、既存言語の manifest・runtime selector 整合がテストで確認できる。
  - **検証**: `npm run check-types`、`npm run lint`、`npm run test:unit`、`npm run test:integration`
  - _Depends: 5, 6, 7_
  - _Requirements: Python 1.1-1.5、3.4-3.5、5.4-5.6_
  - _Design: Python「Integration and Data Flows」「Error, Diagnostic, and Cache Policy」_

- [x] 9. Python 対応と共通契約変更の回帰・配布検証を完了する

  - **変更対象**: `src/test/` 配下の Python / Flow Model / Renderer / CodeLens / safety / integration tests、必要に応じて analyzer version assertions
  - Python の正常系、partial result、unknown / unresolved、syntax error、cancellation、Workspace Trust、CodeLens、cursor 起点、Mermaid 表示を統合検証する。
  - `process_orders` fixture により、`validate_order`、`charge`、`notify`、`save`、`append`、`error` の Call / Await、`catchBinding: error`、`break-exit`、`continue-loop`、loop node 起点の loop-exit、warning のない Mermaid を検証する。
  - TypeScript / JavaScript / TSX / JSX の function locator、Analyzer、実行順、Renderer、CodeLens、キャッシュが回帰しないことを確認する。
  - Python の Flow Model を既存の共通 Renderer / WebView へ渡しても、Python 固有の UI 実装を追加せずに共通契約を維持できることを確認する。共通仕様 Requirement 9〜14 のズーム、Fit、パン、スクロール、Mermaid text と Clipboard の一致、SourceMap、処理 Note 装飾、メッセージラベル要約、コレクションメソッドの resolved 判定を回帰検証する。
  - bundle に WASM・native binary・外部 egress・実行 API が含まれず、ローカル静的解析境界を維持することを検証する。
  - **完了条件**: Python と既存 TypeScript / JavaScript / TSX / JSX の非退行に加え、`process_orders` の nested control-flow / UpdateStatement が共通 Renderer に warning なく渡され、Requirement 9〜14 の共通 UI・Renderer・Clipboard 契約が Python 対応後も維持される。Common Flow Model、Renderer、WebView、公開 contract の変更が不要であることを既存 FlowModel / Renderer / WebView contract test で確認する。全品質ゲートが成功し、失敗があれば該当タスクと requirement / design traceability へ戻して解消できる。
  - **検証**: Python Flow Model を入力にした Renderer / WebView 回帰、共通 UI・Clipboard・SourceMap・Note 装飾・ラベル要約・コレクションメソッド判定の既存 test、`npm run check-types`、`npm run lint`、`npm run test:unit`、`npm run compile`、`npm run test:integration`、`npm run package`
  - _Depends: 2, 8_
  - _Requirements: Python 1.1-5.6、共通 15.1-15.5_
  - _Design: Python「Test Strategy」「Revalidation Triggers」、共通「Cross-language Execution Order and Loop Control」_

- [x] 10. Python の共通描画契約を実装する

- [x] 10.1 Python Call の主体と操作名を共通契約へ変換する
  - 単一識別子 receiver を TypeScript と同じ class / instance participant とし、操作名を主体名と分離する。
  - direct、chain、computed、dynamic call はモジュール名等で補完せず、Unknown / Unresolved と対応する diagnostic を生成する。direct call は操作名を保持しつつ Unknown participant とする。
  - **完了条件**: `results.append()` と `logger.error()` が別ライフラインになり、`foo()` は操作名 `foo` の Unknown、動的呼び出しは対応 diagnostic 付きで Python Flow Model と Mermaid に確認できる。
  - _Boundary: PythonAnalyzer_
  - _Requirements: 2.2, 3.1, 3.2, 3.3, 4.1, 4.2, 6.1, 6.2, 6.3, 6.4, 6.6_

- [x] 10.2 Python の Await と終端表示を共通 edge 意味論へ合わせる
  - Await node から Call へ進む実行順と、Return / Throw node がキーワードを除く式を保持する規則を実装する。
  - Await → Call と式中 Call → Return / Throw の順序を Flow Model と Mermaid fixture の両方で検証する。
  - **完了条件**: `await service.save()` が `await save` と表示され、`return build()` と `raise create_error()` がキーワード重複なしで描画され、各 Call が終端メッセージに先行する。
  - _Boundary: PythonAnalyzer_
  - _Depends: 10.1_
  - _Requirements: 2.3, 2.8, 3.1, 3.3, 5.5_

- [x] 11. Python と既存言語の描画契約を回帰検証する
  - participant 集約、Unknown / Unresolved、Await、Return / Throw、Mermaid text、Clipboard、SourceMap、Analyzer version による cache miss を Python と既存言語で検証する。
  - CodeLens、Workspace Trust、部分結果、ローカル静的解析境界を含む既存の統合経路が Python の変換変更後も維持されることを確認する。
  - **完了条件**: Python と TypeScript / JavaScript の unit・integration 品質ゲートが成功し、Python 専用 Renderer / WebView 分岐を追加せずに図とコピー結果が一致する。
  - _Boundary: PythonAnalyzer tests, MermaidRenderer tests, Integration validation_
  - _Depends: 10.1, 10.2_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 12. Python の共通 `self` root 契約を回帰検証する
  - Python Flow Model を共通 Renderer へ渡し、最左の `self`、主体ライフライン、操作名、Unknown / Unresolved を既存言語と同じ規則で表示する。
  - 表示 Mermaid と Clipboard 内容の一致を確認し、Python 専用の Renderer または WebView 分岐を追加しない。
  - **完了条件**: Python fixture で `participant root as self`、主体と操作名の分離、Unknown / Unresolved、表示と Clipboard の完全一致、内部 ID `root` による WebView 装飾の継続、および Python 専用描画分岐がないことを確認できる。
  - _Depends: 共通仕様 Task 24.2_
  - _Boundary: PythonAnalyzer tests, MermaidRenderer tests, Integration validation_
  - _Requirements: 6.5, 6.6_

## Review Gates

- Task 1 完了後: Flow Edge の追加と Renderer の共通意味論を確認する。
- Task 3 完了後: locator registry が TypeScript 系の CodeLens 契約を維持することを確認する。
- Task 6 完了後: Python の構文変換が Renderer に Python 固有分岐を要求していないことを確認する。
- Task 9 完了後: package、統合 test、ローカル静的解析境界の結果を確認して実装完了を判定する。
- Task 10.1 完了後: participant と operation name が分離され、識別不能な主体をモジュール名等で補完していないことを確認する。
- Task 10.2 完了後: Await → Call と Call → Return / Throw の edge が既存 Renderer の表示契約に一致することを確認する。
- Task 11 完了後: Mermaid text、コピー、SourceMap、CodeLens、Workspace Trust、cache を含む言語横断契約を確認する。
- Task 12 完了後: Python Flow Model が共通の `self` root 契約を利用し、Python 専用の Renderer / WebView 分岐を必要としないことを確認する。
- 共通 design の「Cross-language Execution Order and Loop Control」に残る、TypeScript / JavaScript の入れ子 call が将来追従するという記述は、Task 2 が実装済みであることを前提に、共通仕様レビューで実装済み状態へ更新する。この注記自体は共通 requirements.md / design.md を変更しない。

## 活性化契約の追加タスク

- [x] 13. Python の共通 Mermaid 活性化契約を回帰検証する

- [x] 13.1 Python Flow Model の活性化出力を検証する
  - `results.append()`、`await service.save()`、入れ子 Call、`return results`、`raise error` を含む Python fixture を共通 Renderer へ渡し、静的な処理順と活性化期間を検証する。
  - `self`、静的に識別可能な participant、Unknown / Unresolved、partial result で、Python 固有の活性化データや描画分岐を追加しない。
  - Observable completion: Python fixture の正規 Mermaid テキストに活性化命令が含まれ、Call / Await / Return / Throw の順序、participant、SourceMap、process note の行番号が共通契約に一致する。
  - _Depends: function-flow-visualization:25.1_
  - _Boundary: Python flow regression, MermaidRenderer tests_
  - _Requirements: 2.13, 2.14, 3.6, 6.7_

- [x] 13.2 Python の表示・コピー完全一致を統合検証する
  - Python の WebView 描画入力、詳細表示、Clipboard、fallback が、活性化命令を含む同一の正規 Mermaid テキストを利用することを検証する。
  - TypeScript / JavaScript の既存経路と比較し、Python 専用の Renderer / WebView / Clipboard 分岐、Workspace Trust・SourceMap・unknown / unresolved・partial result の回帰がないことを確認する。
  - `npm run check-types`、`npm run lint`、`npm run test:unit`、`npm run compile`、`npm run test:integration`、`npm run package` を実行する。
  - Observable completion: Python の表示 Mermaid と Clipboard 内容が byte-for-byte で一致し、共通活性化契約を含む全品質ゲートが成功する。
  - _Depends: function-flow-visualization:25.2, 13.1_
  - _Boundary: Python flow regression, VisualizationView, ClipboardAdapter, Integration validation_
  - _Requirements: 3.6, 5.5, 5.7, 6.5, 6.6, 6.7_

## 活性化契約のレビューゲート

- Task 13.1 完了後: Python Flow Model が共通 Renderer へ活性化専用の言語別データを渡さず、Call / Await / Return / Throw の順序だけで共通契約を満たすことを確認する。
- Task 13.2 完了後: 共通 Task 25 の正規 Mermaid 出力が Python の WebView、Clipboard、fallback、SourceMap、process note に同一に伝播することを確認する。

## caller を含む Python return 回帰の追加タスク

- [ ] 14. Python の return を共通 caller 契約へ追従させる

- [x] 14.1 Python Flow Model の caller return 回帰を追加する
  - PythonAnalyzer に caller の推測や Python 専用 participant を追加せず、既存の Return node の式と edge 順序を共通 Renderer へ渡す。
  - `results.append(); return results`、`await service.save(); return result`、nested Call、Unknown / Unresolved、partial result の fixture で、return が `root-->>caller` となり Python call participant から root への return を出力しないことを検証する。
  - Python call participant の activation 終了、return の SourceMap、既存の await / throw / diagnostic を共通 Renderer 契約どおりに維持することを検証する。
  - Observable completion: Python fixture が固定 caller、正しい return 方向、callee return の不在、activation、SourceMap の期待値とともに成功する。
  - _Depends: function-flow-visualization:26.1, function-flow-visualization:26.2_
  - _Boundary: Python flow regression / MermaidRenderer tests_
  - _Requirements: 2.13, 3.3, 3.6, 6.5, 6.6, 6.8_

- [x] 14.2 Python の caller 表示・コピーと言語横断回帰を検証する
  - Python の caller を含む正規 Mermaid text が、WebView 描画入力、詳細表示、fallback、Clipboard で同一となり、Python 専用 Renderer / WebView / Clipboard 分岐がないことを確認する。
  - TypeScript / JavaScript と Python の return / await / partial fixture を比較し、caller 名を Python の関数名、class 名、module 名、file 名から推測しないことを確認する。
  - `npm run check-types`、`npm run lint`、`npm run test:unit`、`npm run compile`、`npm run test:integration`、`npm run package` を実行する。
  - Observable completion: Python と既存言語の表示・コピー・SourceMap・activation の return 契約が共通品質ゲートで成功する。
  - _Depends: function-flow-visualization:26.3, 14.1_
  - _Boundary: Python flow regression / VisualizationView / ClipboardAdapter / Integration validation_
  - _Requirements: 5.7, 6.5, 6.6, 6.8_

## caller を含む Python return 契約のレビューゲート

- Task 14.1 完了後: PythonAnalyzer が caller の名前解決を担わず、共通 Renderer の `root-->>caller` 契約だけを利用していることを確認する。
- Task 14.2 完了後: Python の WebView、fallback、Clipboard、SourceMap、activation が caller を含む共通 Mermaid text を利用し、全品質ゲートが成功することを確認する。

## caller から self への Python 開始呼び出し回帰の追加タスク

- [ ] 15. Python を共通 caller entry 契約へ追従させる

- [x] 15.1 Python Flow Model の caller entry 回帰を追加する
  - PythonAnalyzer に caller、synthetic node、entry edge、または Python 専用 participant を追加せず、既存の Common Flow Model を共通 Renderer へ渡す。
  - `results.append(); return results`、`await service.save(); return result`、nested Call、Unknown / Unresolved、partial result の fixture で、`caller->>root: invoke` が Python 関数本体より前に一度だけ出力され、return が `root-->>caller` のままであることを検証する。
  - Python の関数名、class 名、module 名、file 名を caller の実在名として推測せず、entry が SourceMap のコードジャンプ対象にならないこと、activation、await、throw、diagnostic を共通 Renderer 契約どおりに維持することを検証する。
  - Observable completion: Python fixture が固定 caller、entry の一意性と順序、return 方向、callee return の不在、SourceMap 非対象、activation の期待値とともに成功する。
  - _Depends: function-flow-visualization:27.1, function-flow-visualization:27.2, 14.1_
  - _Boundary: Python flow regression / MermaidRenderer tests_
  - _Requirements: 2.13, 3.3, 3.6, 6.5, 6.6, 6.8, 6.9_

- [x] 15.2 Python caller entry の表示・コピーと言語横断回帰を検証する
  - Python の entry を含む正規 Mermaid text が、WebView 描画入力、詳細表示、fallback、Clipboard で同一となり、Python 専用 Renderer / WebView / Clipboard 分岐がないことを確認する。
  - TypeScript / JavaScript と Python の return / await / partial fixture を比較し、entry の一意性、caller 名の非推測、SourceMap 非対象、activation と return の共通契約を検証する。
  - `npm run check-types`、`npm run lint`、`npm run test:unit`、`npm run compile`、`npm run test:integration`、`npm run package` を実行する。
  - Observable completion: Python と既存言語の表示・コピー・SourceMap・activation が entry を含む同一の共通 Mermaid 契約を利用し、品質ゲートで成功する。
  - _Depends: function-flow-visualization:27.3, 15.1_
  - _Boundary: Python flow regression / VisualizationView / ClipboardAdapter / Integration validation_
  - _Requirements: 5.7, 6.5, 6.6, 6.9_

## caller entry を含む Python 契約のレビューゲート

- Task 15.1 完了後: PythonAnalyzer が caller の名前解決、synthetic Flow Model、Python 専用 entry 表示を担わず、共通 Renderer の `caller->>root: invoke` 契約だけを利用することを確認する。
- Task 15.2 完了後: Python の WebView、fallback、Clipboard、SourceMap、activation が entry を含む共通 Mermaid text を利用し、synthetic entry がコードジャンプ対象にならないことと全品質ゲートの成功を確認する。
