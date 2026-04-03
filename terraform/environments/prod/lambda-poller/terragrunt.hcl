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
  function_name = "poller"
  timeout       = 30
  memory_size   = 128

  # ECR リポジトリ設定
  create_ecr_repository = true
  ecr_repository_name   = "smarthome-sensor-poller"
  image_tag             = "latest"
  image_tag_mutability  = "MUTABLE"
  scan_on_push          = true

  # HTTP トリガー不要（EventBridge で起動）
  create_function_url = false

  # EventBridge スケジュール（2分間隔）
  schedule_expression = "rate(2 minutes)"

  dynamodb_table_arn = dependency.dynamodb.outputs.table_arn

  environment_variables = {
    TABLE_NAME       = dependency.dynamodb.outputs.table_name
    DEVICE_ID        = get_env("SWITCHBOT_DEVICE_ID", "")
    SWITCHBOT_TOKEN  = get_env("SWITCHBOT_TOKEN", "")
    SWITCHBOT_SECRET = get_env("SWITCHBOT_SECRET", "")
  }
}
