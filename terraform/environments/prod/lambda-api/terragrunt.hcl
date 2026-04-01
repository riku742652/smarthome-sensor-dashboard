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
  # NOTE: Update this with your AWS account ID and ECR image
  # Build and push:
  #   cd lambda/api
  #   docker build --platform linux/amd64 -t smarthome-sensor-api:latest .
  #   aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com
  #   docker tag smarthome-sensor-api:latest <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest
  #   docker push <ACCOUNT_ID>.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest
  image_uri   = "${get_env("AWS_ACCOUNT_ID", "123456789012")}.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest"
  timeout     = 30
  memory_size = 512

  dynamodb_table_arn = dependency.dynamodb.outputs.table_arn

  environment_variables = {
    TABLE_NAME = dependency.dynamodb.outputs.table_name
    DEVICE_ID  = get_env("SWITCHBOT_DEVICE_ID", "")
  }
}
