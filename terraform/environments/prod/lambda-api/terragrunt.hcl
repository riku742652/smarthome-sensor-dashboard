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
  create_function_url     = true   # パブリック URL（フロントエンド・GET 用）
  create_iam_function_url = true   # IAM 認証 URL（Raspberry Pi 専用 POST 用）

  dynamodb_table_arn = dependency.dynamodb.outputs.table_arn

  environment_variables = {
    TABLE_NAME = dependency.dynamodb.outputs.table_name
    DEVICE_ID  = get_env("SWITCHBOT_DEVICE_ID", "")
    # API_KEY は IAM 認証に移行したため不要
  }
}
