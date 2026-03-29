# Next Development Steps

**最終更新**: 2026-03-29

## Phase 1 完了状況 ✅

Phase 1の主要開発項目がすべて完了しました：

### ✅ 完了済み

1. **Infrastructure as Code (IaC)** - PR #5
   - Terraform + Terragrunt インフラ構築
   - Lambda (Poller + API) デプロイ
   - DynamoDB セットアップ
   - Lambda Function URL 有効化

2. **Frontend Tests** - PR #6, #7
   - テスト基盤構築 (Vitest + React Testing Library)
   - 包括的なテストスイート実装
   - **99.83% カバレッジ達成**
   - CI/CD統合

3. **Terraform CI/CD** - PR #8
   - Terraform format チェック
   - Terragrunt HCL format チェック
   - Terraform validate (全モジュール)
   - GitHub Actions ワークフロー

## Phase 2 候補アイテム

次のフェーズで取り組むべき開発項目：

### 優先度: 高

#### 1. フロントエンドデプロイ（S3 + CloudFront）

**目的**: フロントエンドを本番環境にデプロイ

**タスク**:
- [ ] S3バケット作成（静的ウェブホスティング）
- [ ] CloudFront ディストリビューション設定
- [ ] Terraform モジュール作成 (`terraform/modules/cloudfront`)
- [ ] GitHub Actions デプロイワークフロー
- [ ] カスタムドメイン設定（オプション）

**見積もり**: 4-6時間

**完了条件**:
- CloudFront URLでフロントエンドにアクセス可能
- ビルド自動デプロイ（mainブランチへのマージ時）

---

#### 2. Lambda API 最適化

**目的**: APIのパフォーマンスとコスト最適化

**タスク**:
- [ ] Provisioned Concurrency 設定（コールドスタート対策）
- [ ] Lambda メモリサイズ最適化
- [ ] CloudWatch Logs Insights クエリ作成
- [ ] X-Ray トレーシング有効化
- [ ] コスト分析とアラート設定

**見積もり**: 3-4時間

**完了条件**:
- コールドスタートが < 500ms
- 平均レスポンスタイムが < 200ms

---

#### 3. モニタリング・アラート

**目的**: システムの健全性を監視

**タスク**:
- [ ] CloudWatch ダッシュボード作成
  - Lambda実行時間
  - DynamoDB読み込み/書き込みメトリクス
  - エラー率
- [ ] CloudWatch Alarms 設定
  - Lambda エラー率 > 5%
  - DynamoDB スロットリング
  - API レイテンシー > 1秒
- [ ] SNS トピック作成（アラート通知）
- [ ] Terraformモジュール化

**見積もり**: 4-5時間

**完了条件**:
- ダッシュボードで全メトリクスが可視化
- アラート通知が機能

---

### 優先度: 中

#### 4. セキュリティ強化

**目的**: セキュリティベストプラクティスの適用

**タスク**:
- [ ] Lambda Function URL 認証追加（IAM or Cognito）
- [ ] CORS設定の厳格化
- [ ] Secrets Manager でAPIキー管理
- [ ] WAF設定（CloudFront）
- [ ] セキュリティスキャン自動化（Trivy）

**見積もり**: 5-7時間

**完了条件**:
- 公開エンドポイントに認証
- すべてのシークレットがSecrets Manager管理

---

#### 5. データ分析機能

**目的**: センサーデータの高度な分析

**タスク**:
- [ ] 統計情報表示（平均、最小、最大、中央値）
- [ ] データエクスポート機能（CSV, JSON）
- [ ] 時間帯別の傾向分析
- [ ] 快適範囲との比較グラフ
- [ ] アラート閾値設定UI

**見積もり**: 8-10時間

**完了条件**:
- 統計情報が表示される
- CSVエクスポートが動作

---

#### 6. CI/CD 拡張

**目的**: 開発プロセスの自動化

**タスク**:
- [ ] Terraform Plan のPRコメント表示
- [ ] Terraform Security スキャン（Trivy）
- [ ] Lambda デプロイ自動化
- [ ] ロールバック戦略
- [ ] Staging 環境追加

**見積もり**: 6-8時間

**完了条件**:
- PRでTerraform Planが確認可能
- セキュリティスキャンが自動実行

---

### 優先度: 低

#### 7. 複数センサー対応

**目的**: 複数の部屋のセンサーをサポート

**タスク**:
- [ ] センサー選択UI
- [ ] 比較ビュー（複数センサー）
- [ ] DynamoDBスキーマ変更
- [ ] 環境変数で複数デバイスID管理

**見積もり**: 10-12時間

---

#### 8. WebSocket リアルタイム更新

**目的**: ポーリング不要なリアルタイム更新

**タスク**:
- [ ] API Gateway WebSocket API
- [ ] Lambda WebSocket ハンドラー
- [ ] フロントエンド WebSocket クライアント
- [ ] 接続管理（DynamoDB）

**見積もり**: 12-15時間

---

#### 9. E2Eテスト

**目的**: エンドツーエンドの動作確認

**タスク**:
- [ ] Playwright セットアップ
- [ ] 主要フローのE2Eテスト
- [ ] ビジュアルリグレッションテスト
- [ ] CI/CD統合

**見積もり**: 6-8時間

---

## 推奨：次の開発アイテム

Phase 2の最初に取り組むべき項目（優先度順）：

### 1位: フロントエンドデプロイ（S3 + CloudFront） ⭐⭐⭐

**理由**:
- 現在フロントエンドはローカルでしか動作しない
- ユーザーがアクセスできる本番環境が必要
- 比較的短時間で完了可能

**Next Step**: リサーチ開始 → プラン作成 → 実装

---

### 2位: モニタリング・アラート ⭐⭐

**理由**:
- 本番環境の健全性を確認する必要
- 問題の早期発見
- Phase 1で構築したインフラの監視

**Next Step**: リサーチ開始 → プラン作成 → 実装

---

### 3位: CI/CD 拡張 ⭐⭐

**理由**:
- Terraform Plan のPRコメント表示が便利
- セキュリティスキャンで脆弱性を防ぐ
- 開発効率の向上

**Next Step**: Terraform CI/CD Plan Phase 2 を参照

---

## アーキテクチャの現状

```
┌─────────────────────────────────────────────────────┐
│                   Phase 1 完了                        │
├─────────────────────────────────────────────────────┤
│                                                       │
│  User (Local)                                         │
│    ↓                                                  │
│  Frontend (Local npm run dev)                         │
│    ↓                                                  │
│  Lambda API (AWS) + Function URL                      │
│    FastAPI + Lambda Web Adapter                       │
│    Docker Container (ECR)                             │
│    ↓                                                  │
│  DynamoDB (AWS)                                       │
│    ↑                                                  │
│  Lambda Poller (AWS)                                  │
│    Python + boto3                                     │
│    EventBridge (1分間隔)                              │
│    ↓                                                  │
│  Switchbot API                                        │
│                                                       │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                  Phase 2 目標                         │
├─────────────────────────────────────────────────────┤
│                                                       │
│  User                                                 │
│    ↓                                                  │
│  CloudFront (CDN) ← 【NEW】                          │
│    ↓                                                  │
│  S3 (React SPA) ← 【NEW】                            │
│    ↓                                                  │
│  Lambda API + Function URL                            │
│    ↓                                                  │
│  DynamoDB                                             │
│                                                       │
│  Monitoring ← 【NEW】                                │
│  - CloudWatch Dashboard                               │
│  - CloudWatch Alarms                                  │
│  - SNS Notifications                                  │
│                                                       │
└─────────────────────────────────────────────────────┘
```

## 技術的負債

現時点では技術的負債はほとんどありません。Phase 1で品質の高いコードベースを構築できました：

- ✅ テストカバレッジ 99.83%
- ✅ TypeScript strict mode
- ✅ CI/CD自動テスト
- ✅ Terraform/Terragrunt IaC
- ✅ ドメイン駆動設計アーキテクチャ

## メトリクス

### コード品質

- **Frontend Line Coverage**: 99.83%
- **Frontend Branch Coverage**: 98.21%
- **Frontend Function Coverage**: 100%
- **TypeScript Errors**: 0
- **ESLint Errors**: 0

### インフラ

- **Terraform Modules**: 4 (DynamoDB, Lambda, Lambda Container, CloudFront)
- **Lambda Functions**: 2 (Poller, API)
- **DynamoDB Tables**: 1
- **Estimated Monthly Cost**: $0 (within AWS Free Tier)

## 参考リンク

- [Product Specifications](./product-specs/index.md)
- [Architecture](../ARCHITECTURE.md)
- [Frontend Guidelines](./FRONTEND.md)
- [Quality Standards](./QUALITY_SCORE.md)
- [Harness Workflow](../HARNESS_WORKFLOW.md)

---

**次のステップ**: Phase 2の開発アイテムから1つ選択し、リサーチを開始してください。
