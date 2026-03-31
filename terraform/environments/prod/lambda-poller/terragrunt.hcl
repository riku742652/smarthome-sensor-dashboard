include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "../../../modules/lambda"
}

dependency "dynamodb" {
  config_path = "../dynamodb"
}

inputs = {
  function_name = "poller"
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  source_dir    = "${get_repo_root()}/lambda/poller"
  timeout       = 30
  memory_size   = 128

  schedule_expression = "rate(2 minutes)"

  dynamodb_table_arn = dependency.dynamodb.outputs.table_arn

  environment_variables = {
    TABLE_NAME       = dependency.dynamodb.outputs.table_name
    DEVICE_ID        = get_env("SWITCHBOT_DEVICE_ID", "")
    SWITCHBOT_TOKEN  = get_env("SWITCHBOT_TOKEN", "")
    SWITCHBOT_SECRET = get_env("SWITCHBOT_SECRET", "")
  }
}
