include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "../../../modules/lambda-container"
}

dependency "dynamodb" {
  config_path = "../dynamodb"

  mock_outputs = {
    table_arn  = "arn:aws:dynamodb:ap-northeast-1:123456789012:table/mock-table"
    table_name = "mock-table"
  }
  mock_outputs_allowed_terraform_commands = ["plan", "validate"]
}

inputs = {
  function_name = "api"
  timeout       = 30
  memory_size   = 512

  # ECR リポジトリ設定
  create_ecr_repository = true
  ecr_repository_name   = "smarthome-sensor-api"
  image_tag             = "latest"
  image_tag_mutability  = "MUTABLE"
  scan_on_push          = true

  # Lambda Function URL 設定
  # IAM 認証 URL のみ使用（Raspberry Pi は SigV4 で認証）
  # フロントエンドの GET リクエストは CloudFront OAC 経由でルーティング
  create_function_url     = false
  create_iam_function_url = true

  # CloudFront OAC から Lambda IAM URL を呼び出すためのリソースポリシー
  # 注意: cloudfront と lambda-api の間に循環依存が生じるため、
  # cloudfront apply 後に CloudFront Distribution ARN を取得して手動設定する必要がある。
  # 初回 apply 時は空文字のまま（aws_lambda_permission.allow_cloudfront は作成されない）。
  # cloudfront_distribution_arn = "<cloudfront-apply-後に設定>"
  cloudfront_distribution_arn = get_env("CLOUDFRONT_DISTRIBUTION_ARN", "")

  dynamodb_table_arn = dependency.dynamodb.outputs.table_arn

  environment_variables = {
    TABLE_NAME = dependency.dynamodb.outputs.table_name
    DEVICE_ID  = get_env("SWITCHBOT_DEVICE_ID", "")
    # パブリック URL 経由の POST /data を保護する二重防御として維持
    API_KEY = get_env("API_KEY", "")
  }
}
