# Project Structure

## Organization Philosophy

現状は小さな VS Code 拡張として、extension entry を中心にしたシンプルな構造です。機能が増える場合も、VS Code lifecycle と command registration は薄く保ち、解析・変換・表示などの domain logic は独立した TypeScript module に分離します。

GlitchLens はレイヤードアーキテクチャを採用し、各レイヤーの責務を明確に分離します。ディレクトリ構造そのものよりも責務分離を優先し、フォルダ構成は将来変更できるものとして扱います。ただし責務境界と依存方向は維持します。

```text
VS Code Integration
    ↓
Application
    ↓
Language Analyzer
    ↓
Common Flow Model
    ↓
Renderer
```

下位レイヤーは上位レイヤーへ依存してはなりません。新しい構成を足すときは、ファイル数そのものではなく「VS Code API 境界」「ユースケース orchestration」「Analyzer」「共通処理フローモデル」「Renderer」を分けることを優先します。

## Layer Responsibilities

### VS Code Integration

**Purpose**: VS Code Extension API とユーザー操作をつなぐ境界。  
**Responsibilities**: Extension Entry、Command Registration、CodeLens、WebView、Clipboard、Go To Definition、Configuration、VS Code API。  
**Rule**: ここにはビジネスロジックを書かない。VS Code API の型や lifecycle はこの層に閉じ込める。

### Application

**Purpose**: ユースケースを表現し、解析から表示までの流れを組み立てる。  
**Responsibilities**: 解析開始、各コンポーネントの orchestration、Analyzer 選択、Renderer 呼び出し。  
**Rule**: Mermaid の構文や AST 詳細を知らない。入力、Analyzer、共通処理フローモデル、Renderer の接続だけに集中する。

### Language Analyzer

**Purpose**: 言語固有のソースコードを解析し、共通処理フローモデルへ変換する。  
**Responsibilities**: AST 解析、Symbol 解決、Import 解決、Call / Branch / Loop / Await / Return / Throw 抽出。  
**Rule**: Analyzer は Mermaid 文字列を生成しない。各 Analyzer は Common Flow Model を返す。新しい言語対応は Analyzer 追加だけで実現できる構造を維持する。

### Language Analyzer Interface

すべての Language Analyzer は共通インターフェースに従います。目的は、Analyzer を追加しても Application や Renderer を変更せず、新しい言語へ拡張できるようにすることです。

**Input**:
- Source File
- Cursor Position
- Analyzer Configuration

**Output**:
- Common Flow Model
- Diagnostics

**Rules**:
- Analyzer は language 固有 AST だけを扱う。
- 共通処理フローモデルへの変換のみを責務とする。
- Mermaid や WebView 用データを直接生成しない。
- Renderer を参照しない。
- VS Code API に依存しない。
- 他言語 Analyzer に依存しない。
- Analyzer 間で実装を共有する場合も、公開契約は Common Flow Model のみとする。

新しい言語対応では、既存の Renderer、Application、WebView を変更せず、新しい Analyzer を追加するだけで対応できる構造を維持します。

### Common Flow Model

**Purpose**: GlitchLens 全体の唯一の共通データモデル。  
**Responsibilities**: Call、Branch、Loop、Await、Return、Throw、Try/Catch、Diagnostic、Source Location。  
**Rule**: Renderer や将来機能は、このモデルだけに依存する。

### Common Flow Model Principles

Common Flow Model は、GlitchLens における唯一のドメインモデル、つまり Single Source of Truth として扱います。Language Analyzer が生成した解析結果は、必ず Common Flow Model を経由して利用します。

以下の機能は Analyzer 固有データへ直接依存してはなりません。

- Mermaid Renderer
- WebView
- Sequence Diff
- Test Hints
- Layer Classification
- Architecture Rules
- 将来追加される解析・可視化機能

新しい Analyzer を追加する場合も、既存の下流機能は Common Flow Model を通じて動作できることを保証します。Common Flow Model は GlitchLens 全体の安定した契約であり、各言語固有の AST や Symbol 情報を外部へ公開しません。

### Renderer

**Purpose**: 共通処理フローモデルを表示・出力向けの表現へ変換する。  
**Responsibilities**: Mermaid 生成、WebView 表示用データ生成、将来の SVG / PNG 生成。  
**Rule**: Renderer は AST を扱わない。

### Future Capabilities

Sequence Diff、Test Hints、Architecture Rules、Layer Classification は Analyzer ではなく、Common Flow Model を入力として実装します。

## Directory Patterns

### Extension Entry

**Location**: `src/`  
**Purpose**: VS Code extension host から読み込まれる実装を置く。`activate` / `deactivate` と command registration はここから始まる。  
**Example**: `src/extension.ts` で command id と implementation を接続する。

### Layered Modules

**Location**: `src/` under responsibility-based modules  
**Purpose**: VS Code Integration、Application、Language Analyzer、Common Flow Model、Renderer を責務ごとに分ける。  
**Example**: フォルダ名は将来変更できるが、VS Code API に触れる module から core model へ依存し、core model から VS Code API へ戻らない。

### Tests

**Location**: `src/test/`  
**Purpose**: VS Code test runner で動かす extension test と、分離された domain logic の期待結果を検証する test を置く。  
**Example**: command activation は VS Code 統合テスト、Analyzer や Common Flow Model、Renderer は VS Code 非依存の単体テストで検証する。

### Build Artifacts

**Location**: `dist/`, `out/`  
**Purpose**: build と test compile の生成物を置く。手編集せず、npm scripts から再生成する。  
**Example**: `dist/extension.js` は esbuild の出力で、extension の `main` が参照する。

## Naming Conventions

- **Files**: 小さな module は camelCase または用途が明確な lower-case 名を使い、既存の TypeScript entry と整合させる。
- **Commands**: VS Code command id は extension namespace を prefix にする。例: `glitchlens.someAction`
- **Functions**: TypeScript の通常規約に従い camelCase を使う。
- **Types and Classes**: PascalCase を使う。

## Import Organization

```typescript
import * as vscode from 'vscode';
import { parseFlow } from './flowParser';
```

外部 API としての `vscode` は extension 境界で扱い、domain module ではできるだけ VS Code API 型に依存しない形を優先します。ローカル module は相対 import を使います。現時点で path alias は定義されていません。

## Code Organization Principles

- `activate` は command registration と subscription 管理を中心にし、重い処理を直接抱え込まない。
- 解析、共通処理フローモデル生成、Mermaid 文字列生成は分離可能な module として設計する。
- VS Code UI への表示や通知は adapter 的に扱い、core logic のテストを editor 環境に依存させすぎない。
- Application は Analyzer 選択と Renderer 呼び出しを調停し、Mermaid 構文や AST 詳細を持たない。
- Analyzer は Common Flow Model を返し、Renderer や WebView に依存しない。
- Renderer は Common Flow Model だけを入力にし、AST や言語固有 symbol へ依存しない。
- 将来機能は Analyzer へ押し込まず、Common Flow Model を入力にした別責務として追加する。
- `package.json` の `contributes` と実装内の command id は常に一致させる。
- 生成物や dependency metadata は手で編集せず、必要な npm command で更新する。

## Design Principles

- **Single Responsibility**: 各 module は 1 つの責務を持つ。
- **Dependency Inversion**: 上位のユースケースは具体的な Analyzer 実装へ密結合しない。
- **Common Flow Model First**: 下流機能の入力は共通処理フローモデルに揃える。
- **Language Plugin Architecture**: 新しい言語は Analyzer 追加で対応する。
- **VS Code API Isolation**: VS Code API は integration 層に閉じ込める。
- **Renderer Independence**: Renderer は AST や VS Code API に依存しない。

updated_at: 2026-07-11

---
_Document patterns, not file trees. New files following patterns shouldn't require updates_
