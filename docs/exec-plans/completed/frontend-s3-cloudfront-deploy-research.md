# Frontend S3+CloudFront Deploy Research

## タスク概要
フロントエンド成果物 (`dist/`) を AWS の S3 + CloudFront へ自動デプロイする。

## 調査日
2026-04-05

## 調査対象
- `.github/workflows/*.yml`
- `terraform/environments/prod/cloudfront/terragrunt.hcl`
- `terraform/modules/cloudfront/*`
- `README.md`

## 現状整理（着手前）
1. フロントエンドのビルドコマンドは `npm run build` で利用可能。
2. Terraform/Terragrunt 側で CloudFront モジュールは定義済み。
3. CloudFront モジュールの output として以下が利用可能。
   - `bucket_name`
   - `cloudfront_distribution_id`
   - `cloudfront_url`
4. GitHub Actions にはフロント配信専用ワークフローが未存在。
5. README の「今後の計画」に「S3 + CloudFront へのフロントエンドデプロイ」が未完了として残存。

## 制約・前提
1. AWS 認証は既存方針に合わせ OIDC (`secrets.AWS_ROLE_ARN`) を使用する。
2. Terraform/Terragrunt のバージョンは既存ワークフローと整合させる。
3. SPA のため `index.html` は短期キャッシュ、それ以外のアセットは長期キャッシュが望ましい。

## 採用方針
1. GitHub Actions に `frontend-deploy.yml` を追加。
2. 配信先は Terragrunt output から動的解決。
3. S3 反映後に CloudFront invalidation (`/*`) を実行。
4. 実行結果は `GITHUB_STEP_SUMMARY` へ出力。

## 実施結果
1. `.github/workflows/frontend-deploy.yml` を追加。
2. `README.md` の今後計画チェックを実態に合わせて更新。

## 検証結果
1. 追加・更新ファイルに Problems エラーなし。
2. ワークフロー構文エラーなし（エディタ診断ベース）。

## 残課題
1. GitHub Actions 実行結果（本番 AWS への反映確認）は、運用実行時の確認事項として残る。
