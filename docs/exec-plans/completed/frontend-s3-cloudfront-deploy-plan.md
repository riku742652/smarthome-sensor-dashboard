# Frontend S3+CloudFront Deploy Plan

## 目的
S3 + CloudFront へのフロントエンドデプロイを CI/CD で自動化し、手動配信作業をなくす。

## 成功基準
- [x] フロント専用デプロイワークフローが存在する
- [x] `dist/` が S3 バケットへ同期される
- [x] CloudFront invalidation が実行される
- [x] 配信先（バケット/Distribution/URL）がサマリーに出力される
- [x] README の計画ステータスが実態に追従する

## 変更対象
1. `.github/workflows/frontend-deploy.yml`
2. `README.md`
3. `docs/exec-plans/completed/frontend-s3-cloudfront-deploy-research.md`
4. `docs/exec-plans/completed/frontend-s3-cloudfront-deploy-plan.md`

## 実装ステップ
1. [x] 既存 Terraform/Terragrunt 出力値を確認
2. [x] フロントデプロイ用 GitHub Actions を追加
3. [x] キャッシュ戦略を分離（`index.html` と静的アセット）
4. [x] CloudFront invalidation を追加
5. [x] README の計画チェックを更新
6. [x] エディタ上のエラー確認

## テスト戦略
1. ワークフロー定義の静的確認（YAML 構文・参照値）。
2. 本番検証は Actions 実行履歴で以下を確認。
   - `Build frontend` 成功
   - `Upload static assets` 成功
   - `Invalidate CloudFront cache` 成功

## リスクと対策
1. リスク: Terragrunt output 取得失敗で配信先解決できない。
   対策: `terraform/environments/prod/cloudfront` の state/権限を事前確認。
2. リスク: invalidation 完了前に旧キャッシュが返る。
   対策: サマリーに invalidation ID を出し、必要に応じて AWS Console で追跡。
3. リスク: `AWS_ROLE_ARN` 未設定で認証失敗。
   対策: リポジトリ Secrets を事前に確認。

## 完了判定
- [x] 実装完了
- [x] ドキュメント記録完了
- [ ] PR 作成
- [ ] AI レビュー対応
- [ ] CI Green 確認
- [ ] マージ
