# Infrastructure IaC Research

**日付**: 2026-03-28
**ステータス**: Research in Progress

## 目的

SwitchbotセンサーダッシュボードのインフラをIaC（Infrastructure as Code）化する。
サーバーレスアーキテクチャを採用し、スケーラブルで運用コスト低いシステムを構築する。

## ユーザー提案のアーキテクチャ

```
┌──────────────────────────────────────────────────────────┐
│                    ユーザー                               │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ↓
         ┌───────────────────────┐
         │  CloudFront (CDN)     │
         └───────────┬───────────┘
                     │
                     ↓
         ┌───────────────────────┐
         │   S3 (Static Web)     │
         │  (React SPA)          │
         └───────────┬───────────┘
                     │
                     ↓
         ┌───────────────────────┐
         │Lambda (API)           │
         │+ Function URL         │
         │データ取得             │
         └────────┬──────────────┘
                  │
         ┌────────┴───────────┐
         │                    │
         ↓                    ↓
┌────────────────┐   ┌────────────────┐
│Lambda (Poller) │   │   DynamoDB     │
│EventBridge     │   │ (Data Store)   │
│定期実行(1分)   │→→→│                │
│Switchbot API   │   │                │
│呼び出し        │   │                │
└────────────────┘   └────────────────┘
```

**変更点**:
- ❌ API Gateway削除 → ✅ Lambda Function URL使用
- シンプル化、コスト削減

<!-- ANSWER: 素晴らしい指摘です！改善案を提示します。

**1. API Gateway vs Lambda Function URL**

完全に同意です。個人利用であれば Lambda Function URL で十分です。

- ✅ Lambda Function URL の利点:
  - シンプル（API Gateway不要）
  - 安い（無料）
  - HTTPS自動付与
  - CORS設定可能

- API Gatewayが必要になるのは:
  - カスタムドメイン必須
  - 詳細な認証/認可
  - 複雑なレート制限
  - リクエスト変換

→ **採用**: Lambda Function URL を使用

**2. 1つのLambda vs 2つのLambda**

これは設計判断です。2つの選択肢を提示します：

**オプションA: 2つのLambda（責任分離）**
- Lambda (Poller): EventBridge定期実行専用
- Lambda (API): HTTP処理専用
- 利点: 単一責任原則、デプロイ独立
- 欠点: リソース数が多い

**オプションB: 1つのLambda（統合）**
- 1つのLambdaで両方を処理
- イベントソースで分岐（EventBridge vs Function URL）
- 利点: シンプル、リソース数削減
- 欠点: コード複雑化、責任混在

→ **決定**: オプションA（2つのLambda）承認

→ **追加要件**: FastAPI + Lambda Web Adapter

**Lambda Web Adapterの利点**:
1. ✅ 既存Webフレームワーク（FastAPI）がそのまま動く
2. ✅ ローカル開発が容易（uvicorn等で実行）
3. ✅ Lambdaへのデプロイも可能（Web Adapter経由）
4. ✅ コードの移植性が高い（Lambdaから他環境への移行が容易）
5. ✅ FastAPIの機能がフル活用できる（自動ドキュメント、型ヒント等）

**実装方針**:
- Lambda (Poller): シンプルなPython関数（boto3でDynamoDB操作）
- Lambda (API): FastAPI + Lambda Web Adapter
  - Dockerfile でビルド
  - Lambda Web Adapter レイヤー追加
  - FastAPIアプリケーション実装
  - 自動ドキュメント生成（/docs エンドポイント）

**参考**: https://aws.amazon.com/jp/builders-flash/202301/lambda-web-adapter/

→ **承認**: この方針で実装計画を更新します
 -->

### コンポーネント（改善版）

1. **Lambda (Poller)**
   - EventBridge (旧 CloudWatch Events) で1分間隔で実行
   - Switchbot APIを呼び出し
   - DynamoDBにデータを保存

2. **DynamoDB**
   - センサーデータの永続化
   - パーティションキー: デバイスID
   - ソートキー: タイムスタンプ
   - TTL設定で古いデータ自動削除（オプション）

3. **Lambda (API) + Function URL** 🆕
   - ~~API Gateway~~ → Lambda Function URL使用
   - DynamoDBからデータ取得
   - フロントエンドにJSON返却
   - CORS設定あり

4. **S3 + CloudFront**
   - Reactアプリの静的ホスティング
   - CloudFrontでHTTPS、キャッシング、グローバル配信

## 利点

### スケーラビリティ
- サーバーレス: 自動スケーリング
- DynamoDB: 読み書きキャパシティ自動調整
- CloudFront: グローバルCDN

### コスト効率
- Lambda無料枠: 100万リクエスト/月
- DynamoDB無料枠: 25GB, 25ユニット
- S3無料枠: 5GB（12ヶ月）
- **個人利用なら無料枠内で収まる可能性高い**

### 運用負荷
- サーバー管理不要
- パッチ適用不要
- 自動バックアップ（DynamoDB）

### 信頼性
- AWS managed services
- マルチAZ構成（自動）
- 99.9%以上のSLA

## 課題・トレードオフ

### 複雑性の増加
- ❌ システムコンポーネント数が増加
- ❌ デバッグが難しい（分散システム）
- ❌ ローカル開発環境の構築が複雑

### コールドスタート
- ❌ Lambda初回実行が遅い（~1-3秒）
- ✅ 対策: Provisioned Concurrency（コスト増）
- ✅ 対策: 定期実行なので影響小

### ベンダーロックイン
- ❌ AWS固有サービス使用
- ✅ IaCで他クラウドへの移行は可能（要リライト）

### 開発スピード
- ❌ 初期セットアップに時間がかかる
- ❌ ローカルテストが難しい
- ✅ 一度構築すれば変更は容易

## 代替案の検討

### 代替案1: クライアントサイドのみ（現状維持）

**構成**: React SPA + LocalStorage

**利点**:
- ✅ 最もシンプル
- ✅ インフラコストゼロ
- ✅ 開発スピード最速

**欠点**:
- ❌ データ永続化なし
- ❌ 複数デバイスで共有不可
- ❌ 履歴データ蓄積に限界

**結論**: MVPとしては十分だが、長期運用には不向き

### 代替案2: 従来型サーバー（VPS/Container）

**構成**: Node.js + PostgreSQL + Nginx on EC2/Fargate

**利点**:
- ✅ シンプルなアーキテクチャ
- ✅ デバッグしやすい
- ✅ ローカル開発環境と同じ

**欠点**:
- ❌ サーバー管理必要
- ❌ スケーリング手動
- ❌ 月額コスト高い（~$10-20）

**結論**: 小規模プロジェクトには過剰

### 代替案3: Vercel/Netlify + Firebase

**構成**: Vercel (Frontend) + Firebase (Backend/DB)

**利点**:
- ✅ 簡単デプロイ
- ✅ サーバーレス
- ✅ 無料枠あり

**欠点**:
- ❌ ベンダーロックイン（Firebase）
- ❌ IaCサポート限定的
- ❌ コスト予測が難しい

**結論**: 個人プロジェクトには良いが、IaC化が目的なら不向き

### 代替案4: ユーザー提案（Lambda + DynamoDB + S3/CloudFront）

**結論**: ✅ **最適解** - スケーラブル、コスト効率、IaC化しやすい

## IaCツールの選択

### オプション1: AWS CDK (TypeScript)

**利点**:
- ✅ TypeScriptで記述（既存スキルセット活用）
- ✅ 型安全
- ✅ 高レベル抽象化
- ✅ エージェントがコード生成しやすい

**欠点**:
- ❌ AWS固有

**推奨度**: ⭐⭐⭐⭐⭐

### オプション2: Terraform

**利点**:
- ✅ マルチクラウド対応
- ✅ 成熟したエコシステム
- ✅ 宣言的

**欠点**:
- ❌ HCL（新しい言語）
- ❌ エージェントの学習コスト

**推奨度**: ⭐⭐⭐⭐

### オプション3: AWS SAM

**利点**:
- ✅ Lambdaに特化
- ✅ ローカル実行環境

**欠点**:
- ❌ YAML（可読性低い）
- ❌ 機能限定的

**推奨度**: ⭐⭐⭐

### オプション4: Serverless Framework

**利点**:
- ✅ マルチクラウド
- ✅ プラグインエコシステム

**欠点**:
- ❌ 複雑な設定
- ❌ CDKより柔軟性低い

**推奨度**: ⭐⭐⭐

## 選択: Terraform + Terragrunt

**ユーザー指定により、Terraform/Terragruntを使用**

**Terraformの利点**:
1. マルチクラウド対応 → AWS以外にも移行可能
2. 宣言的 → インフラの状態を明確に定義
3. 成熟したエコシステム → 豊富なプロバイダー、モジュール
4. State管理 → インフラ状態の追跡
5. 業界標準 → 多くのプロジェクトで採用

**Terragruntの利点**:
1. DRY原則 → Terraformコードの重複排除
2. 環境管理 → dev/staging/prodの分離が容易
3. State管理の簡素化 → S3バックエンド自動設定
4. 依存関係管理 → モジュール間の依存を明示的に定義
5. リモートState → チーム開発に適している

## コスト見積もり

### 前提
- ポーリング: 1分間隔（1,440回/日）
- データ保存: 30日分
- API呼び出し: 100回/日（想定）
- ユーザー: 1名

### 月額コスト

| サービス | 使用量 | 無料枠 | コスト |
|---------|--------|--------|--------|
| Lambda (Poller) | 43,200実行/月 | 100万 | $0 |
| Lambda (API) + Function URL | 3,000実行/月 | 100万 | $0 |
| DynamoDB (Write) | 43,200回/月 | 100万 | $0 |
| DynamoDB (Read) | 3,000回/月 | 100万 | $0 |
| DynamoDB (Storage) | ~100MB | 25GB | $0 |
| S3 (Storage) | ~10MB | 5GB | $0 |
| CloudFront | ~10GB転送 | 50GB | $0 |

**合計**: **$0/月**（無料枠内）

**削減**: API Gateway不要（月額$0.35-1.00削減）

※ 無料枠超過時も月額$1以下と予想

## セキュリティ考慮事項

### 認証・認可
- **Phase 1**: APIは公開（個人利用のみ）
- **Phase 2**: AWS Cognito導入
- **Phase 3**: IAM Role ベース認証

### データ保護
- DynamoDB暗号化（デフォルト有効）
- S3暗号化
- HTTPS強制（CloudFront）

### APIキー管理
- Secrets Manager または Systems Manager Parameter Store
- Lambda環境変数経由で取得
- 絶対にコードにハードコードしない

## パフォーマンス

### レイテンシ
- CloudFront: ~50-100ms（エッジから）
- API Gateway + Lambda: ~100-500ms
- DynamoDB: ~10-50ms

**合計**: p95 < 500ms（十分高速）

### データ保持
- DynamoDB TTL設定: 30日後自動削除
- または無期限保持（コストは微増）

## 開発・運用フロー

### ローカル開発
```bash
# CDK
cdk synth          # テンプレート生成
cdk diff           # 差分確認
cdk deploy         # デプロイ

# Lambda local
sam local invoke   # ローカル実行
```

### CI/CD
```
GitHub Actions
 ↓
 CDK Synth
 ↓
 Test (optional)
 ↓
 CDK Deploy
```

## リスクと緩和策

### リスク1: AWS障害
- **影響**: サービス全停止
- **確率**: 低
- **緩和**: マルチリージョン（Phase 3）

### リスク2: コスト超過
- **影響**: 予期しない請求
- **確率**: 低（個人利用）
- **緩和**: CloudWatch Billing Alert設定

### リスク3: Lambda制限
- **影響**: 実行タイムアウト、メモリ不足
- **確率**: 低
- **緩和**: 適切なメモリ・タイムアウト設定

### リスク4: DynamoDB容量不足
- **影響**: 書き込み失敗
- **確率**: 低（無料枠25GB）
- **緩和**: TTL設定、オンデマンド課金

## 結論

### 推奨アーキテクチャ

**Lambda (Poller) + DynamoDB + Lambda (API) + S3/CloudFront**

### 選択されたIaCツール

**Terraform + Terragrunt**

### 理由

1. ✅ スケーラブル
2. ✅ コスト効率（無料枠内）
3. ✅ 運用負荷ゼロ
4. ✅ ハーネスエンジニアリング原則に適合
5. ✅ エージェントがコード生成しやすい

### 次のステップ

1. 実装計画の作成
2. 計画のレビューと承認
3. CDKプロジェクトのセットアップ
4. インフラコード生成
5. デプロイとテスト

## 未解決の質問

1. DynamoDBのTTL設定（30日? 無期限?）
2. 複数センサー対応の優先度
3. モニタリング・アラート設定の要否
4. バックアップ戦略

## 参考資料

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)

---

**次**: 実装計画の作成 → `infrastructure-iac-plan.md`
