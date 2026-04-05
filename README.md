# Smarthome Sensor Dashboard

Switchbot温湿度CO2センサーから値を定期的に取得し、WebUI上でグラフ化するWebアプリケーション。

## プロジェクト概要

このプロジェクトは**ハーネスエンジニアリング**の原則に基づいて開発されています。

- **手書きコード禁止**: すべてのコードはエージェント（Claude Code）によって生成
- **計画と実行の分離**: コード実装前に計画を作成し、レビュー・承認を経る
- **エージェントファースト**: エージェントの認識可能性を最優先

詳細: [HARNESS_WORKFLOW.md](./HARNESS_WORKFLOW.md)

## ドキュメント

### 開発者向け

- **[AGENTS.md](./AGENTS.md)** - エージェント向けナビゲーションマップ
- **[HARNESS_WORKFLOW.md](./HARNESS_WORKFLOW.md)** - ワークフローガイド
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - システムアーキテクチャ

### 技術ドキュメント

- **[docs/FRONTEND.md](./docs/FRONTEND.md)** - フロントエンド開発ガイドライン
- **[docs/QUALITY_SCORE.md](./docs/QUALITY_SCORE.md)** - 品質基準
- **[docs/RELIABILITY.md](./docs/RELIABILITY.md)** - 信頼性とパフォーマンス
- **[docs/SECURITY.md](./docs/SECURITY.md)** - セキュリティガイドライン

### 製品・設計

- **[docs/PRODUCT_SENSE.md](./docs/PRODUCT_SENSE.md)** - 製品ビジョンと優先順位
- **[docs/design-docs/](./docs/design-docs/)** - 設計ドキュメント
- **[docs/product-specs/](./docs/product-specs/)** - 製品仕様

## セットアップ

### 前提条件

- Node.js 18以上
- npm 9以上
- Switchbot アカウントとAPIトークン

### インストール

```bash
# 1. リポジトリをクローン
git clone <repository-url>
cd smarthome

# 2. 依存関係をインストール
npm install

# 3. 環境変数を設定
cp .env.example .env
# .envファイルを編集し、SwitchbotのAPIトークンとシークレットを設定

# 4. 開発サーバーを起動
npm run dev
```

### Switchbot API トークンの取得

1. [Switchbot アプリ](https://www.switchbot.jp/)を開く
2. プロフィール > 設定
3. アプリバージョンを10回タップして開発者モードを有効化
4. トークンとシークレットを取得

詳細: https://support.switch-bot.com/hc/en-us/articles/12822710195351

## フロントエンド開発

### セットアップ

```bash
# 1. 依存関係のインストール
npm install

# 2. 環境変数の設定
cp .env.example .env
# .envファイルを編集してAPI URLを設定
# Lambda Function URLがデプロイされていない場合は、モックデータを使用:
# VITE_USE_MOCK_DATA=true

# 3. 開発サーバーの起動
npm run dev
# ブラウザで http://localhost:3000 を開く
```

### 開発モード（モックデータ使用）

APIがまだデプロイされていない場合は、モックデータで開発できます:

```bash
# .envファイルに追加
VITE_USE_MOCK_DATA=true
```

モックデータを有効にすると、実際のLambda APIを呼び出さずに、ランダムに生成されたセンサーデータが表示されます。

### ビルド

```bash
# 本番ビルド
npm run build

# ビルド結果は dist/ フォルダに出力されます
# S3にデプロイする場合は、dist/ の内容をアップロードしてください
```

### 品質チェック

```bash
# リント実行
npm run lint
npm run lint:fix  # 自動修正

# 型チェック
npm run type-check

# テスト実行
npm run test
npm run test:coverage

# すべての品質チェックを一括実行
npm run quality-check
```

### トラブルシューティング

**問題: ビルドが失敗する**

```bash
# node_modulesを削除して再インストール
rm -rf node_modules package-lock.json
npm install
```

**問題: 型エラーが出る**

```bash
# TypeScriptの型チェックを実行
npm run type-check
```

**問題: APIに接続できない**

1. `.env`ファイルで`VITE_API_BASE_URL`が正しく設定されているか確認
2. Lambda Function URLがデプロイされているか確認
3. モックデータモードで開発する: `VITE_USE_MOCK_DATA=true`

## 開発

### 利用可能なコマンド

```bash
# 開発サーバー起動
npm run dev

# 本番ビルド
npm run build

# ビルド結果のプレビュー
npm run preview

# リント実行
npm run lint

# リント自動修正
npm run lint:fix

# 型チェック
npm run type-check

# テスト実行
npm run test

# テストカバレッジ
npm run test:coverage

# フォーマット
npm run format

# 品質チェック（リント + 型チェック + テスト）
npm run quality-check
```

### ワークフロー

新機能開発や変更を行う際は、ハーネスエンジニアリングのワークフローに従います：

1. **リサーチ** - 関連コードを調査し、`docs/exec-plans/active/[task-name]-research.md` に記録
2. **計画** - 実装計画を `docs/exec-plans/active/[task-name]-plan.md` に作成
3. **レビュー** - 計画にインラインコメントでフィードバック
4. **実装** - 計画承認後、Claude Codeに実装を指示

詳細: [HARNESS_WORKFLOW.md](./HARNESS_WORKFLOW.md)

## アーキテクチャ

```
src/
├── domains/           # ビジネスドメイン
│   ├── sensor/       # センサードメイン
│   └── dashboard/    # ダッシュボードドメイン
├── shared/           # 共有コード
│   ├── components/  # 共有UIコンポーネント
│   ├── hooks/       # カスタムHooks
│   ├── utils/       # ユーティリティ
│   └── providers/   # 横断的関心事
└── app/             # アプリケーション起動
```

詳細: [ARCHITECTURE.md](./ARCHITECTURE.md)

## 技術スタック

### フロントエンド

- **React** 18 + TypeScript
- **Vite** - 高速ビルドツール
- **TailwindCSS** - ユーティリティファーストCSS
- **Recharts** - データ可視化

### 開発ツール

- **ESLint** - 静的解析
- **Prettier** - コードフォーマット
- **Vitest** - テストフレームワーク
- **TypeScript** - 型安全性

## 実装状況

### Phase 1: フロントエンド React UI ✅

- ✅ React + Vite + TypeScript プロジェクトセットアップ
- ✅ TailwindCSS スタイリング設定
- ✅ 階層化ドメインアーキテクチャ実装
- ✅ センサーダッシュボード（最新値表示）
- ✅ 時系列グラフ（Recharts）
- ✅ 時間範囲選択（1h, 6h, 12h, 24h, 7d）
- ✅ 自動更新（1分間隔）
- ✅ モックデータサポート（開発用）
- ✅ エラーハンドリングとローディング表示

### 今後の計画

- [x] Lambda API のデプロイ
- [x] S3 + CloudFront へのフロントエンドデプロイ
- [x] Terraform/Terragrunt によるインフラ構築
- [ ] テストの追加（カバレッジ80%以上）
- [x] CI/CD パイプライン構築

## 品質基準

- テストカバレッジ: 80%以上
- TypeScript strict mode
- ゼロリントエラー
- Time to Interactive: < 3秒
- バンドルサイズ: < 500KB

詳細: [docs/QUALITY_SCORE.md](./docs/QUALITY_SCORE.md)

## ライセンス

MIT

## 貢献

このプロジェクトはハーネスエンジニアリングの実験プロジェクトです。
すべてのコードはエージェント（Claude Code）によって生成されます。

## 変更履歴

- 2026-03-28: フロントエンド React UI 実装完了（Phase 1）
  - React + Vite + TypeScript + TailwindCSS セットアップ
  - センサーダッシュボードと時系列グラフ実装
  - モックデータサポート追加
  - ビルド成功確認
- 2026-03-28: プロジェクト初期化
