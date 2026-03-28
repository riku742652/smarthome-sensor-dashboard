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

## MVP機能（Phase 1）

- [ ] Switchbot APIからセンサーデータを取得
- [ ] 現在の温度、湿度、CO2濃度を表示
- [ ] 過去24時間のグラフ表示
- [ ] 1分ごとの自動更新
- [ ] ローカルストレージでのデータキャッシング

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

- 2026-03-28: プロジェクト初期化
