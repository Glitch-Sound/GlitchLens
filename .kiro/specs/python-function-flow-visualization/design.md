# Design Document

## Overview

Python Function Flow Visualization は、既存の GlitchLens の静的処理フロー可視化を VS Code の `python` languageId に拡張する差分機能である。Python のソースをローカルで構文解析し、カーソルまたは CodeLens で選択した `def`、`async def`、クラスメソッドを Common Flow Model へ変換する。既存の Mermaid Renderer、WebView、コピー、キャッシュ、Workspace Trust は Flow Model を介して再利用する。

### Goals

- Python の関数候補を CodeLens とカーソル位置から特定する。
- Python の構文を Call、Await、Branch、Loop、Try-Catch、Return、Throw、Break、Continue と既存 Flow Model へ変換する。
- 既存 TypeScript / JavaScript Analyzer と独立した Python Analyzer を追加する。
- 実行、Python インタープリタ起動、外部プロセス、外部通信、実行時トレースを行わない。
- 不完全な編集状態または静的に確定できない呼び出しでは、diagnostic 付きの部分結果を優先する。

### Non-Goals

- Python の型推論、import 解決、動的ディスパッチ、`getattr`、`__call__` の完全な解決。
- `match` / `case`、`yield` / `yield from`、ジェネレータ意味論のフロー表現。
- 呼び出し先関数本体への再帰解析。
- 既存 Renderer、WebView、Mermaid 表現、コピー、ズーム UI の Python 専用変更。

## Boundary Commitments

### This Spec Owns

- Python の Call に、既存の `FlowParticipant` と `calleeName` の共通契約を供給し、TypeScript と同じライフライン名・操作名・集約規則を成立させる。
- Python の Await、Return、Throw を既存 Renderer が同じ Mermaid 表示へ変換できる node と edge の順序で出力する。
- 上記の Python 固有変換と、Python / TypeScript の共通 Renderer 回帰テストを更新する。

### Out of Boundary

- `FlowParticipant`、MermaidRenderer、WebView、Clipboard、SourceMap の公開契約または Python 専用表示分岐の変更。
- Python の型推論、import 解決、実行時 receiver・descriptor・`__call__` の同定。
- モジュール名、パッケージ名、ファイル名、enclosing class 名を不明な主体の代替ライフラインとして推測すること。

### Allowed Dependencies

- `src/analyzers/python/pythonParser.ts` が公開する Python 構文走査境界。
- `FlowParticipant`、`FlowCallNode`、FlowEdge、MermaidRenderer、および既存の TypeScript Analyzer の静的分類規則。
- 既存の unit / integration test と AnalysisCache の analyzer version 契約。

### Revalidation Triggers

- FlowParticipant の key・label・kind、Call participant の任意性、または Renderer の participant 集約規則を変更する場合。
- Await の判定 edge、Return / Throw の表示規則、SourceMap、または message formatter を変更する場合。
- Python parser の MemberExpression / CallExpression の形状、または TypeScript の静的 receiver 分類規則を変更する場合。

## Architecture

### Dependency Direction

```mermaid
graph LR
    VSCode[VS Code Integration] --> Application
    Application --> AnalyzerRegistry
    Application --> Renderer
    AnalyzerRegistry --> PythonAnalyzer
    AnalyzerRegistry --> TypeScriptAnalyzer
    PythonAnalyzer --> LezerPython
    PythonAnalyzer --> FlowModel[Common Flow Model]
    TypeScriptAnalyzer --> FlowModel
    Renderer --> FlowModel
    VSCode --> FunctionLocatorRegistry
    FunctionLocatorRegistry --> PythonLocator
    FunctionLocatorRegistry --> TypeScriptLocator
```

- VS Code API は `src/integration/` に閉じ込める。
- `PythonAnalyzer` と `PythonFunctionLocator` は Flow Model contract と `@lezer/python` だけへ依存し、`vscode`、Renderer、WebView、Clipboard へ依存しない。
- Renderer と Application は `FlowModel` のみを入力とし、Python の構文木・パーサー型を扱わない。
- TypeScript Compiler API は従来どおり `analyzers/typescript/` のみに閉じ込める。

### Parser Decision

`@lezer/python` を production dependency として採用する。Lezer は JavaScript の構文木パーサーであり、生成済みの Python grammar package には TypeScript 宣言が含まれる。構文木は `TreeCursor` で走査する。パーサーは文字列から必ず Tree を返すため、編集途中の入力に対しても候補抽出と部分解析を継続できる。

Tree-sitter WASM は高速で堅牢な候補だが、VSIX への grammar WASM 同梱、esbuild でのアセットコピー、実行時のファイル位置解決、ABI 互換性を別途管理する必要がある。また公式資料は Node.js での WASM 実行が native binding より遅いと説明している。本仕様では単一言語の初期対応であり、純粋 JavaScript dependency として bundle できる Lezer の方が配布と保守の境界が小さいため採用する。

- 採用依存: `@lezer/python`（MIT）
- 追加しない依存: Python インタープリタ、`child_process`、native addon、WASM grammar、ネットワーククライアント
- `@lezer/python` の公開 Tree / TreeCursor API のみを利用し、生成済み parser table や内部実装へ依存しない。
- grammar package 更新時にノード名・エラー回復が変化し得るため、Python parser adapter の fixture test を compatibility gate とする。

参考: [Lezer System Guide](https://lezer.codemirror.net/docs/guide/)、[@lezer/python](https://www.npmjs.com/package/@lezer/python)、[Tree-sitter JavaScript/Wasm overview](https://tree-sitter-tree-sitter.mintlify.app/api/javascript/overview)

## Components and Interfaces

### Language-independent function locator

現在の `src/integration/functionRanges.ts` は TypeScript 専用 locator を直接 import している。これを言語非依存の contract と registry に置き換える。

```typescript
export interface FunctionCandidate {
  readonly name: string;
  readonly kind: string;
  readonly range: FunctionRange;
  readonly fullRange: FunctionRange;
  readonly bodyRange?: FunctionRange;
}

export interface FunctionRange extends SourceRange {
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface FunctionLocator {
  readonly id: string;
  readonly version: string;
  readonly languageIds: readonly string[];
  findFunctionCandidates(source: SourceFileInput): readonly FunctionCandidate[];
  findFunctionContainingOffset(source: SourceFileInput, offset: number): FunctionLocatorResult;
  findFunctionByRange(source: SourceFileInput, range: SourceRange): FunctionLocatorResult;
}
```

- `FunctionLocatorRegistry` は `languageId` から locator を選び、未登録時は `unsupported-language` を返す。
- `TypeScriptFunctionLocator` は既存 `analyzers/typescript/functionLocator.ts` の公開実装をこの contract へ移管する。検出対象と range の意味は変更しない。
- `PythonFunctionLocator` は `def`、`async def`、クラス内の同構文を候補として返す。`range` は関数名、`fullRange` は decorator を除く `def` / `async def` から本体末尾、`bodyRange` はインデントされた本体の範囲とする。
- 同じ offset を含む候補が複数あるときは、`fullRange` が最小の候補を返す。これによりネストした関数では内側の関数を選ぶ。
- CodeLens の候補列挙は locator registry を利用し、Analyzer を実行しない。Analyzer は command 実行時に改めて対象を確認する。

### Python parser adapter

`src/analyzers/python/pythonParser.ts` を Lezer の薄い adapter とする。

- adapter 内だけが `@lezer/python` の `parser`、Tree、TreeCursor を import する。
- Lezer の Tree / TreeCursor 型、およびそれらを模倣した公開 node interface は `analyzers/python/` の外へ公開しない。adapter と PythonFunctionLocator / PythonFlowBuilder は同じ言語境界の内部で cursor を直接走査し、構文木全体を独自の immutable node view へ複製しない。
- `LineMap` utility が offset を `SourcePosition` へ変換する。行開始 offset を一度構築し、各 node の `from` / `to` から `SourceLocation` を作成する。
- エラー node を検出した場合は、解析可能な兄弟 node を継続しつつ `unsupported-syntax` または `partial-analysis` diagnostic を追加する。parser の内部エラー文字列はユーザー通知へ露出しない。

### PythonFunctionLocator

`src/analyzers/python/pythonFunctionLocator.ts` は parser adapter を利用して関数候補だけを抽出する。

- decorator は関数候補の名前・本体の解析対象に含めない。
- `async def` は独立の候補として認識し、Analyzer は同じ Flow Model 表現を使う。
- クラス本体を走査して見つかった関数も通常の関数候補と同じように扱う。クラス名や `self` を Flow Model の必須フィールドに追加しない。
- トップレベル、クラス内、nested を問わず `def` と `async def` を CodeLens 候補にする。cursor 位置が複数候補に含まれる場合は、最小の `fullRange` を持つ最内関数を選ぶ。lambda は初期スコープ外であり候補にしない。
- 解析エラーで完全な関数 node を得られない場合は、確定できた候補だけを返す。候補を得られないときは既存の target-not-found フローへ委譲する。

### PythonAnalyzer

`src/analyzers/python/pythonAnalyzer.ts` は `LanguageAnalyzer` を実装する。

```typescript
export class PythonAnalyzer implements LanguageAnalyzer {
  readonly id = 'python';
  readonly version = '1.0.0';
  readonly languageIds = ['python'] as const;
  analyze(input: AnalyzerInput): Promise<AnalyzerResult>;
}
```

処理順序は以下とする。

1. cancellation を確認する。
2. `languageId === 'python'` を検証する。
3. `PythonFunctionLocator` で対象関数を解決する。解決不能なら `invalid-input` を返す。
4. parser adapter の Tree から対象関数 node を取得する。
5. `PythonFlowBuilder` が対象関数の body だけを走査し、FlowModel を生成する。
6. `complete` または `partial` と diagnostic を `AnalyzerResult` として返す。

`PythonFlowBuilder` は TypeScript の `FlowBuilder` と同じ node / edge 不変条件を満たすが、TypeScript AST を共有しない。AST の走査規則と Python の制御構造が異なるため、既存 TypeScript Analyzer の大規模な共通化は行わない。共通化の対象は Flow Model contract とテスト fixture の期待結果に限定する。

### Flow Model language ID

`SupportedLanguageId` は Flow Model の公開 contract として既存4言語の union に固定されている。これを任意の VS Code language ID を保持できる `string` 型へ広げる。型名を保つ場合は `export type SupportedLanguageId = string` とし、Flow Model が Integration の対応言語リストを所有しないようにする。

- `FlowModel.metadata.languageId` と `FlowSource.languageId` は `python` をそのまま保持する。
- 対応可否は Flow Model ではなく `AnalyzerRegistry` と `FunctionLocatorRegistry` が決定する。
- `documentSelector` の `supportedLanguageIds` は runtime の UI 選択子として `python` を加える。

## Python to Flow Model Mapping

| Python construct | Flow Model | Extraction and edges |
|---|---|---|
| `def` / `async def` | `rootFunction` | name と function range を記録する。`async` 自体の node は作らない。 |
| `call()` | `call` | `calleeName` は操作名を保持し、participant は `Unknown` とする。入れ子の call は、子の評価を親の call より先に、静的に推定できる実行順で抽出する。 |
| `object.method()` | `call` | receiver が単一の識別子の場合だけ、method 名を `calleeName`、receiver を既存 TS と同じ class / instance participant とする。 |
| `factory().run()` | `call` | `run` は動的 receiver のため `unresolved`、diagnostic を付与する。内側の `factory` call は別 node とする。 |
| `items[index]()` / `getattr(...)()` / 不明な callable | `call` | `calleeName: '<unknown>'`、`unknown` または `unresolved` と diagnostic を付与する。 |
| `await expression` | `await` | Await node を式中の call より先に作り、Await から Call への edge を持たせる。これにより既存 Renderer はメッセージを `await <操作名>` と一度だけ表示する。 |
| assignment / annotated assignment | right-hand expression only | Lezer の `AssignStatement` を対象とする。代入先は FlowNode に変換せず、`AssignOp` より後の右辺にある Call / Await を評価順で抽出する。呼び出しがない代入は diagnostic なしで通過する。 |
| augmented assignment | right-hand expression only | Lezer の `UpdateStatement` を対象とする。`UpdateOp` より後の右辺にある Call / Await だけを評価順で抽出し、`retry += 1` のように呼び出しがない更新は diagnostic なしで通過する。右辺の動的 callable は既存の `unknown` / `unresolved` と partial analysis 規則を適用する。 |
| `if` / `elif` / `else` | `branch` | `if` を branch、then を `true`、else / elif を `false` edge とする。`elif` は false 側の入れ子 branch として表現する。表示ラベルには body を含めず条件式だけを保持する。 |
| `for` / `while` | `loop` | loop body を `loop-body`、後続を loop node 起点の `loop-exit` edge で結ぶ。条件・iterable 内の call を body より前に抽出し、表示ラベルには body を含めないヘッダだけを保持する。 |
| `try` / `except` / `finally` | `try-catch` | try / catch / finally edge を使う。`except ... as error` の binding を `catchBinding` に記録する。 |
| `with expr as name` | expression + body | 複数の context expression を左から右の評価順で抽出し、その後に body を処理する。`__enter__` / `__exit__` の暗黙呼び出しは推測しない。 |
| `return expr` | `return` | expr 内の call を return node より前に抽出し、node にはキーワードを除く式だけを保持して terminal とする。 |
| `raise expr` | `throw` | expr 内の call を throw node より前に抽出し、node にはキーワードを除く式だけを保持して terminal とする。 |
| `break` / `continue` | `break` / `continue` | `break` から loop 後の最初の到達可能 node へ `break-exit` edge を、`continue` から loop node へ `continue-loop` edge を作る。通常の `next` edge は作らない。 |

`for ... else`、`while ... else`、`try ... else` は初期スコープで誤った到達可能性を描かないため、該当節を `unsupported-syntax` diagnostic として扱い、前後で解析可能な statement を保持する。`match`、`yield`、`yield from` も同じ partial-analysis 方針とする。

### Assignment and UpdateStatement Extraction

`PythonFlowBuilder` は `AssignStatement` と `UpdateStatement` を control-flow node としては扱わない。各 statement の直接 child から `AssignOp` または `UpdateOp` を識別し、その演算子より後の child だけを `extractCalls` へ渡す。これにより、代入先、型注釈、更新演算子を Call と誤認せず、右辺の `await`、入れ子 call、unknown / unresolved call は既存の式抽出規則で一貫して扱える。

Call / Await を含まない代入・更新は node、edge、diagnostic を追加しない。右辺に call があれば、子式から親式の順で node を追加し、通常 statement と同じ `pendingEdges` / terminal 規則で前後の処理へ接続する。拡張代入そのものは loop、branch、try-catch の edge kind を変更しない。

Loop / Branch の表示ラベルは、対応する `Body` の開始位置より前の header から抽出する。`while retry < 3:` は `retry < 3`、`if saved:` は `saved` とし、本体の statement、改行、インデントはラベルへ含めない。

## Control-flow Construction

`PythonFlowBuilder` は既存の Flow Model 不変条件を維持する。

- `FlowNode.order` は静的に推定できる実行順で 0 から単調増加する。
- `FlowEdge.executionOrder` は追加順に 0 から単調増加する。
- 分岐の mutually exclusive な body 同士を `next` edge で接続しない。
- non-terminal な分岐・try 経路は後続 statement に合流する。
- return / throw / break / continue の後に、同じ到達経路上の `next` edge を追加しない。
- loop は body への `loop-body` と、loop node から通常のループ終了後の後続 statement へ向かう `loop-exit` を持つ。loop body 内の branch、try、catch、finally、または通常 statement を `loop-exit` の source にしない。Break node は `break-exit` で同じ後続へ接続し、Continue node は `continue-loop` で loop node へ接続する。ループの実行回数は Mermaid の sequence diagram で表現しない。
- nested function、lambda、comprehension の callable body は走査しない。ただし対象関数の通常式に含まれる最上位の call は抽出する。

各 statement または一定数の構文 node ごとに cancellation を確認し、50 work item ごとを目安に event loop へ制御を返す。同期的な parser 呼び出しの途中での中断は要求しないが、解析開始前・parse 完了直後・走査中にキャンセルされた場合は `analysis-cancelled` を返し、結果を cache しない。

## Integration and Data Flows

### Command and cursor flow

```mermaid
sequenceDiagram
    participant User
    participant CommandController
    participant UseCase
    participant Registry as AnalyzerRegistry
    participant Python as PythonAnalyzer
    participant Renderer
    participant View

    User->>CommandController: Python 関数内で可視化を実行
    CommandController->>UseCase: Plain VisualizationRequest(languageId=python)
    UseCase->>Registry: resolve(python)
    Registry->>Python: analyze(request)
    Python->>Python: parse and build FlowModel
    Python-->>UseCase: success or partial result
    UseCase->>Renderer: render(FlowModel)
    Renderer-->>UseCase: Mermaid text and notices
    UseCase-->>CommandController: VisualizationResult
    CommandController->>View: 表示
```

### CodeLens flow

1. `registerGlitchLensCodeLensProvider` は `supportedLanguageIds` から `python` を含む selector を生成する。
2. Provider は Workspace Trust、cancellation、CodeLens 設定を確認する。
3. `createFunctionCodeLensCommands` は FunctionLocatorRegistry から Python locator を解決し、候補ごとに既存形式の command argument を返す。
4. command 実行後、`CommandController` は既存と同じ plain source request を Application へ渡す。

`vscodeAdapters.ts` の composition root は以下を生成する。

```typescript
const functionLocators = new FunctionLocatorRegistry([
  new TypeScriptFunctionLocator(),
  new PythonFunctionLocator(),
]);

const analyzers = new AnalyzerRegistry([
  new TypeScriptAnalyzer(),
  new PythonAnalyzer(),
]);
```

Provider と command factory には `functionLocators` を dependency injection する。Analyzer registry と locator registry を単一の巨大な registry に統合しない。関数候補列挙は UI の軽量処理、フロー解析は Application の重い処理であり、責務・呼び出し頻度・失敗の扱いが異なるためである。

## Error, Diagnostic, and Cache Policy

| Condition | Analyzer result | User-visible outcome | Cache |
|---|---|---|---|
| Python locator が対象を発見できない | failed / `invalid-input` | target-not-found | 保存しない |
| parser が対象関数内に error node を含むが解析可能 | partial | partial と diagnostic | 保存する |
| 未知・動的な call | partial | unknown / unresolved notice | 保存する |
| 初期スコープ外構文 | partial | unsupported-syntax / partial-analysis notice | 保存する |
| cancellation | failed / `analysis-cancelled` | cancelled | 保存しない |
| parser adapter の予期しない例外 | failed / `analysis-failed` | failed | 保存しない |

既存 `AnalysisCache` は `analyzerId` と `analyzerVersion` を key に含むため、PythonAnalyzer の version を解析規則・parser adapter の意味論が変わるたびに更新する。Python と TypeScript の結果は analyzer ID が異なるため同一 document URI でも混同しない。

## File Structure Plan

```text
src/
├── analyzers/
│   ├── functionLocator.ts                  # language-independent contract
│   ├── functionLocatorRegistry.ts          # languageId → locator
│   ├── typescript/
│   │   └── functionLocator.ts              # contract を実装する既存 locator
│   └── python/
│       ├── pythonParser.ts                 # @lezer/python boundary
│       ├── pythonFunctionLocator.ts        # def / async def candidate discovery
│       └── pythonAnalyzer.ts               # Python AST → FlowModel
├── flow-model/
│   └── sourceLocation.ts                   # language ID union を開放
├── integration/
│   ├── documentSelector.ts                 # python を selector に追加
│   ├── functionRanges.ts                   # locator registry に委譲
│   ├── codeLensCommands.ts                 # locator registry を注入
│   ├── codeLensProvider.ts                 # registry を注入
│   ├── extensionEntry.ts                   # locator-aware provider を登録
│   └── vscodeAdapters.ts                   # Python analyzer / locator の composition
└── test/
    ├── pythonFunctionLocator.test.ts
    ├── pythonAnalyzer.test.ts
    ├── functionLocatorRegistry.test.ts
    ├── codeLensProvider.test.ts
    ├── analyzerContract.test.ts
    └── foundation.test.ts
```

変更対象の manifest と build:

- `package.json`: `@lezer/python` を dependency に追加し、`onLanguage:python` と `glitchlens.supportedLanguages` の `python` を追加する。
- `package-lock.json`: `npm install` によって package metadata を更新する。手編集しない。
- `esbuild.js`: 純粋 JavaScript dependency のため asset copy plugin、native module external、WASM loader を追加しない。`dist/extension.js` への bundle を build test で確認する。

## Test Strategy

### Unit tests

- `PythonFunctionLocator`
  - top-level `def`、`async def`、クラスメソッド、nested `def` の CodeLens 候補、およびカーソルから最内関数の選択
  - name / full / body range、decorator の除外、編集途中の部分候補、対象外 lambda
- `PythonAnalyzer`
  - call の静的な実行順、`outer(inner())` の `inner` → `outer`、await
  - `AssignStatement`、型注釈付き代入、`UpdateStatement` の右辺 Call / Await 抽出、呼び出しを含まない `retry += 1` の無診断通過
  - if / elif / else、for / while、try / except / finally、複数 context expression を持つ with
  - return / raise、break の `break-exit`、continue の `continue-loop`、loop node だけを source とする `loop-exit`
  - `process_orders` fixture: nested for / while、try / except、await、複数分岐、`if saved: break`、`retry += 1` に対し、`validate_order`、`charge`、`notify`、`save`、`append`、`error` の抽出、`catchBinding: error`、warning のない Mermaid を検証する
  - Loop / Branch label が `for order in orders`、`retry < 3`、`saved` のように body を含まないことを検証する
  - unknown / unresolved call、構文エラー、スコープ外構文、partial result
  - cancellation の開始前・走査中、および FlowModel の plain-data 性
- `FunctionLocatorRegistry` と `AnalyzerRegistry`
  - `python` を正しい実装へ解決し、未登録言語を拒否する。
- parser compatibility fixture
  - Python source fixture ごとに adapter が必要な関数・制御構造を認識することを検証する。Lezer node 名を Analyzer 全体へ散在させない。

### Regression tests

- 現行 TypeScript / JavaScript / TSX / JSX の locator、CodeLens、Analyzer、Renderer の全既存 test を保持する。
- 共通契約の追従作業では、TypeScript / JavaScript の入れ子 call を実行順へ更新する test を追加し、既存の構文走査順を期待する test を置き換える。この仕様段階では実装・test 変更は行わない。
- `foundation.test.ts` は manifest activation events と `supportedLanguageIds` に `python` が揃うことを検証し、Python が未対応である前提の assertion を削除・置換する。
- `codeLensProvider.test.ts` は Python selector と Python function range を追加し、既存言語の期待候補が変わらないことを確認する。
- analyzer boundary test は `@lezer/python` import が `analyzers/python/` だけに限定されること、`child_process`、`vm`、`fetch`、trace API が production source に入らないことを検証する。

### Validation commands

```bash
npm run check-types
npm run lint
npm run test:unit
npm run compile
npm run test:integration
npm run package
```

`npm run package` の成功は、Lezer dependency が esbuild の production bundle に含まれ、VSIX 側で追加の runtime asset を必要としないことの確認に用いる。実装時は `dist/extension.js` に native binary、WASM asset、外部 URL が含まれないことも安全性テストで確認する。

## Requirements Traceability

| Requirement | Design response |
|---|---|
| 1: Python 関数の対象特定 | `PythonFunctionLocator` と `FunctionLocatorRegistry` を導入し、nested `def` を含む CodeLens と cursor の両方を同一候補 contract で扱う。 |
| 2: 静的処理フロー抽出 | `PythonAnalyzer` / `PythonFlowBuilder` が Python 構文を共通の実行順・loop control edge contract へ変換する。`AssignStatement` / `UpdateStatement` は右辺の Call / Await のみを抽出する。 |
| 3: Common Flow Model 境界 | parser adapter を `analyzers/python/` に閉じ、Flow Model language ID と Renderer / FlowEdge の共通契約変更は共通仕様で定義する。 |
| 4: 未解決呼び出しと部分結果 | call resolution 規則、error node の diagnostic、partial result と既存 notification path を定義する。 |
| 5: 安全性・応答性・互換性 | Lezer の in-process parse、cancellation cooperation、cache version、native/WASM/外部プロセスを排除した配布、非退行テストで保証する。 |

## Revalidation Triggers

- Python の `match`、generator、comprehension、import / type 解決をスコープへ加える場合。
- Flow Model に context manager 専用または Python 専用 node kind を追加する場合。
- `@lezer/python` の major update、ノード構造の変更、または parser adapter fixture が失敗する場合。
- Python 以外の追加言語が locator registry と parser dependency の選択へ影響する場合。
- package / esbuild が JavaScript bundle 以外の asset または native binary を要求する場合。

## Python と TypeScript の描画契約更新

### Architecture Decision

`PythonFlowBuilder` は Call ごとに、操作名と主体を別々に生成する。単一識別子 receiver の `service.save()` は `instance:service`、`ClassName.build()` は `class:ClassName` を participant とし、`calleeName` はそれぞれ `save`、`build` とする。直接呼び出し `foo()`、chain call `factory().run()`、添字・動的属性アクセスは、モジュール名等で補完せず、既存の resolution に対応する `Unknown` または `Unresolved` participant を用いる。

Await は Await node を先に置き、Await から式中の Call への edge を構築する。Return / Throw node はキーワードを除いた式だけを保持する。これらは既存 MermaidRenderer の message formatter と awaited-call 判定をそのまま利用して、`await save`、`return value`、`throw error` を一度だけ出力するための契約である。

```mermaid
flowchart LR
    PythonSyntax[Python Call / Await / Return / Raise] --> PythonAnalyzer
    PythonAnalyzer --> FlowCall[FlowCallNode: participant + calleeName]
    PythonAnalyzer --> FlowControl[Await / Return / Throw nodes and edges]
    FlowCall --> MermaidRenderer
    FlowControl --> MermaidRenderer
    MermaidRenderer --> MermaidText[Diagram and copied Mermaid text]
```

### Python Participant Extraction Contract

| Python source form | participant | operation message | resolution / diagnostic |
|---|---|---|---|
| `service.save()` | `instance:service` | `save` | resolved |
| `ClassName.build()` | `class:ClassName` | `build` | resolved |
| `foo()` | `unknown` | `foo` | resolved、主体は推測しない |
| `factory().run()` | `unresolved` | `run` | unresolved diagnostic |
| `items[index]()` / `getattr(...)()` | `unknown` または `unresolved` | 安全に得られる操作名、または `<unknown>` | 対応する diagnostic |

participant key は既存の共通 Renderer が重複排除する。同一 key の操作は一つのライフラインに集約され、異なる key の同名操作は分離される。Python は participant の表示名を renderer で推測させず、Python 専用の Renderer / WebView 分岐も追加しない。

### File Structure Impact

- `src/analyzers/python/pythonAnalyzer.ts` — Python Call から participant と `calleeName` を分離し、Await / Return / Throw の node と edge の順序を共通 Renderer 契約へ合わせる。
- `src/test/pythonFunctionFlow.test.ts` — participant key / label、同一主体の集約、異なる主体の分離、Unknown / Unresolved、await / return / throw の Mermaid 出力を検証する。
- `src/test/mermaidRenderer.test.ts` — Python Flow Model で既存 participant 集約、SourceMap、コピー対象 Mermaid の契約を回帰検証する。
- `src/test/typescriptFlowExtractor.test.ts` — Python の変更が参照する TypeScript 静的 receiver 分類・await表示の基準を回帰検証する。

### Requirements Traceability Amendment

| Requirement | Design response |
|---|---|
| 2.2 | Python の nested Call は既存の静的実行順で生成する。 |
| 2.3 | Await node を Call の前に置き、Await → Call edge により `await <操作名>` を既存 Renderer へ伝える。 |
| 2.8 | Return / Throw node はキーワードを除く式を保持し、終端前に式中 Call を接続する。 |
| 4.1–4.2 | 動的 receiver は既存の Unknown / Unresolved participant と diagnostic へフォールバックする。 |
| 5.5 | Python 固有の描画分岐を追加せず、TypeScript / JavaScript の Renderer 回帰を実行する。 |
| 6.1 | 単一識別子 receiver を、先頭大文字は class、それ以外は instance の participant とする。 |
| 6.2 | participant key による既存 Renderer 集約を利用する。 |
| 6.3 | `calleeName` は引数・receiver・モジュール名を含まない操作名とする。 |
| 6.4 | 主体を識別できない呼び出しは推測せず Unknown / Unresolved へ集約する。 |
| 6.5–6.6 | `self` root、Mermaid 表示・コピー、および Python 固有表示規則を追加しない共通 Renderer 契約を維持する。 |

### Testing Strategy Amendment

- `pythonFunctionFlow.test.ts` で `results.append()` と `logger.error()` が別 participant、同一 receiver の複数操作が一つの participant、異なる receiver の同名 `save()` が別 participant となることを検証する。
- `await service.save()` と入れ子 call を含む await で、実行順、`await save` message、SourceMap を検証する。
- `return build()` と `raise create_error()` が、キーワードを二重に出力せず、Call が終端メッセージに先行することを検証する。
- direct / chain / computed / dynamic call の Unknown / Unresolved 表示、diagnostic、Mermaid text と Clipboard の一致を検証する。

### 完全な要件トレーサビリティ

| Requirement | Components / validation |
|---|---|
| 1.1, 1.2, 1.3, 1.4, 1.5 | PythonFunctionLocator、FunctionLocatorRegistry、CodeLens integration と locator unit test |
| 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12 | PythonAnalyzer、PythonFlowBuilder、FlowModel mapping、control-flow / Mermaid unit test |
| 3.1, 3.2, 3.3, 3.4, 3.5 | Python parser adapter、LanguageAnalyzer contract、FlowModel language ID、共通 Renderer regression |
| 4.1, 4.2, 4.3, 4.4, 4.5 | call resolution policy、partial result / diagnostic policy、Visualization integration test |
| 5.1, 5.2, 5.3, 5.4, 5.5, 5.6 | safety boundary、cancellation、AnalysisCache、Workspace Trust、cross-language regression |
| 6.1, 6.2, 6.3, 6.4, 6.5, 6.6 | Python participant extraction contract、MermaidRenderer、pythonFunctionFlow / Renderer regression test |

## Mermaid 活性化の共通契約追従

### Boundary Commitments Amendment

この仕様は、Python の Flow Model が共通 Mermaid 活性化契約を利用できること、および Python の表示・コピーが同一の正規 Mermaid テキストを利用することを所有する。活性化命令を生成する共通 Renderer の実装と、WebView の文字列後処理の削除は `function-flow-visualization` 仕様が所有する。

- **This Spec Owns**: Python の Call / Await / Return / Throw を含む Flow Model fixture、固定 `caller`、`self`、静的に識別可能な participant の表示と活性化期間、表示入力と Clipboard の完全一致に関する Python 回帰検証。
- **Out of Boundary**: Python 専用の活性化情報、Python 専用 Mermaid 構文、Python 専用 WebView / Clipboard 分岐、共通 Renderer または WebView の活性化実装そのもの。
- **Allowed Dependencies**: `function-flow-visualization` が定める正規 Mermaid テキスト、共通 `MermaidRenderer`、`VisualizationView`、Clipboard、SourceMap、process note decoration の契約。
- **Revalidation Triggers**: 共通 Renderer の活性化開始・終了規則、正規 Mermaid テキストの行順、WebView の描画入力、Clipboard payload、SourceMap、または process note の行番号が変更される場合。

### Common Integration Contract

共通仕様は、`MermaidRenderer` が participant 宣言、メッセージ、活性化開始、活性化終了を含む正規 Mermaid テキストを出力することを定める。`RenderContext` はメッセージを出力する同じ行生成経路で活性化命令を出力し、SourceMap と process note の行番号を正規テキストに対して記録する。WebView はこの文字列を変更せずに描画し、Clipboard は同一の文字列を保存する。

```mermaid
sequenceDiagram
    participant PythonAnalyzer
    participant FlowModel
    participant MermaidRenderer
    participant VisualizationView
    participant Clipboard
    PythonAnalyzer->>FlowModel: Python の Call / Await / Return / Throw
    FlowModel->>MermaidRenderer: 共通 Flow Model
    MermaidRenderer->>MermaidRenderer: 正規 Mermaid と活性化命令を生成
    MermaidRenderer->>VisualizationView: mermaidText
    VisualizationView->>VisualizationView: 同じ mermaidText を描画
    VisualizationView->>Clipboard: 同じ mermaidText を保存
```

固定 `caller` は最左に宣言され、`self` はその右で participant 宣言の後から図の終端まで活性化する。呼び出し先 participant は共通 Renderer が Call、Return、Throw の Flow Model 順序から導出する活性化開始・終了規則に従う。`await` と入れ子 Call は既存の静的実行順を変更せず、動的 receiver、unknown、unresolved、または部分解析では確定できない実行時状態を追加推測しない。

### File Structure Plan Amendment

- `src/renderer/mermaidRenderer.ts` — **共通仕様所有**。正規 Mermaid テキストに活性化命令を含め、SourceMap と process note の行番号をその正規テキストに対応させる。
- `src/integration/webviewMermaid.js` — **共通仕様所有**。Mermaid 構造を書き換えず、受け取った正規 Mermaid テキストをそのまま描画する。
- `src/test/mermaidRenderer.test.ts` — **共通仕様所有**。Call、Await、Return、Throw、入れ子 Call の活性化命令、SourceMap、process note 行番号を検証する。
- `src/test/visualizationView.test.ts` — **共通仕様所有**。WebView 描画入力と Clipboard が活性化命令を含む同一文字列であることを検証する。
- `src/test/pythonFunctionFlow.test.ts` — **本仕様所有**。Python Flow Model の Call / Await / Return / Throw が共通活性化契約を満たし、Python 専用の描画分岐なしで表示・コピーされることを検証する。

### Requirements Traceability Amendment

| Requirement | Design response |
|---|---|
| 2.13 | Python の Call と終端処理を含む fixture を共通 Renderer へ渡し、静的実行順に対応する活性化期間を検証する。 |
| 2.14 | await と入れ子 Call の fixture で、各 participant の活性化期間と既存の実行順を検証する。 |
| 3.6 | Python は共通 `mermaidText` を利用し、Python 専用の活性化表現またはコピー形式を追加しない。 |
| 5.7 | VisualizationView / Clipboard 回帰で、活性化命令を含む表示入力とコピー内容の完全一致を検証する。 |
| 6.7 | `caller`、`self`、静的に識別可能な Python participant を含む fixture で、共通活性化表現を検証する。 |

### Testing Strategy Amendment

- `pythonFunctionFlow.test.ts` で `results.append()`、`await service.save()`、入れ子 Call、`return results`、`raise error` を含む Python fixture の正規 Mermaid テキストに活性化命令が含まれることを検証する。
- `mermaidRenderer.test.ts` で root と呼び出し先の活性化開始・終了が Call / Return / Throw の正規行順に現れ、SourceMap と process note の行番号がずれないことを検証する。
- `visualizationView.test.ts` で WebView の Mermaid 描画入力、詳細表示の Mermaid テキスト、Clipboard の内容が byte-for-byte で一致することを検証する。
- Python と TypeScript / JavaScript の同一 Flow Model 形状を比較し、Python 専用の Renderer / WebView / Clipboard 分岐が存在しないことを検証する。

### Implementation Prerequisite

Python 側の活性化回帰テストと完了判定は、`function-flow-visualization` 仕様で共通 Renderer の正規 Mermaid テキスト化と WebView 後処理の除去が完了してから実施する。この前提が未完了の間、Python 固有の活性化実装で代替してはならない。

## caller を含む共通 entry / return 契約への追従

### Boundary Commitments Amendment

**This Spec Owns**

- Python の Return node と既存の FlowEdge 順序を変更せず、共通 Renderer が `self` から固定 `caller` へ戻り値を描画できる Python fixture を提供すること。
- PythonAnalyzer に caller の名前解決を追加せず、共通 Renderer が関数本体より前に固定 `caller` から `self` への開始呼び出しを一度だけ描画できる Python fixture を提供すること。
- Python の通常 Call、await、入れ子 Call、Unknown / Unresolved、partial result の直後でも、Python call participant を対象関数の戻り値送信元として描画しない回帰検証。

**Out of Boundary**

- caller participant、synthetic entry / return message の送信元・送信先、activation stack、SourceMap、WebView、Clipboard の共通実装変更。
- Python から呼び出し元を解析・推測すること、または Python 専用の participant / Mermaid 表示規則を追加すること。

**Allowed Dependencies**

- `function-flow-visualization` の Requirement 17 と caller / self の正規 Mermaid 契約、既存 `PythonAnalyzer`、Common Flow Model、`MermaidRenderer`、Python Renderer regression test。

**Revalidation Triggers**

- Python Return node の式保存形式、Return edge の順序、Python analyzer version、または共通 return message の送信元・送信先を変更する場合。
- 共通 Renderer が caller を FlowModel / FlowParticipant から取得する設計へ変わる場合。

### Integration Decision

PythonAnalyzer は caller を生成せず、既存どおり Return node のキーワードを除く式と静的な FlowEdge を出力する。共通 MermaidRenderer が固定 caller を宣言し、関数本体より前に `caller->>root: invoke` を一度だけ出力してから、Return node を `root-->>caller` として出力する。synthetic entry は Python の FlowNode / FlowEdge と SourceMap を持たず、Python の関数名、class 名、module 名、file 名から caller を推測しない。Python の Call participant は call の操作名、活性化、および diagnostic を表すだけであり、対象関数の return message の送信元にはならない。

```mermaid
sequenceDiagram
    participant PythonAnalyzer
    participant FlowModel
    participant MermaidRenderer
    PythonAnalyzer->>FlowModel: Return node and edge
    FlowModel->>MermaidRenderer: Common flow model
    MermaidRenderer->>MermaidRenderer: self return caller
```

### File Structure Plan Amendment

- `src/test/pythonFunctionFlow.test.ts` — `results.append()`、`await service.save()`、入れ子 Call、Unknown / Unresolved を含む Python fixture で、`caller->>root: invoke` が本体より前に一度だけ出力され、return が `root-->>caller` となり Python call participant から root への return を出力しないことを検証する。
- `src/analyzers/python/pythonAnalyzer.ts` — caller を追加せず、既存 Return node の式・edge 順序を維持する。解析器の変更は不要であることを回帰 test で確認する。
- `src/renderer/mermaidRenderer.ts` — **function-flow-visualization 仕様所有**。固定 caller、共通 synthetic entry message、共通 return message を実装する。

### Requirements Traceability Amendment

| Requirement | Design response |
|---|---|
| 2.13 | Python Call participant の活性化終了と対象関数の `self` から `caller` への return を別の表現として回帰検証する。 |
| 3.3, 3.6 | Python 固有の Renderer 分岐なしで、共通 caller / entry / return Mermaid text を利用する。 |
| 5.7 | caller と entry を含む正規 Mermaid text が表示と Clipboard で完全に一致する共通回帰を利用する。 |
| 6.5, 6.6, 6.9 | Python は共通の caller / self 順と caller から self への一意な entry message を維持し、Python 専用命名規則を追加しない。 |
| 6.8 | Python の return は常に `self` から固定 `caller` へ描画され、直前の Python call participant を送信元にしない。 |

### Testing Strategy Amendment

- `pythonFunctionFlow.test.ts` は `results.append(); return results` と `await service.save(); return result` の Mermaid 出力が `root-->>caller` を含み、`results-->>root` / `service-->>root` を含まないことを検証する。
- 同テストは `caller->>root: invoke` が関数本体より前に一度だけ出力され、Python の関数名・class 名・module 名・file 名を caller の実在名として推測しないことを検証する。
- 同テストは nested Call、Unknown / Unresolved、partial result でも、caller 名を Python の関数名・class 名・module 名から推測せず、共通 Renderer の activation と SourceMap を維持することを検証する。
- TypeScript / JavaScript と Python の同形 Flow Model を同じ共通 Renderer へ渡す回帰により、Python 専用の描画分岐がないことを検証する。
