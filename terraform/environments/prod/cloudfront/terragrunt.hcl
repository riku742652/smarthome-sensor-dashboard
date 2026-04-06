include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "../../../modules/cloudfront"
}

# lambda-api の outputs を参照するための依存関係
dependency "lambda_api" {
  config_path = "../lambda-api"

  mock_outputs = {
    iam_function_url = "https://mock.lambda-url.ap-northeast-1.on.aws/"
  }
  mock_outputs_allowed_terraform_commands = ["plan", "validate"]
}

inputs = {
  price_class         = "PriceClass_200" # US, Europe, Asia, Middle East, Africa
  default_cache_ttl   = 3600             # 1 hour
  max_cache_ttl       = 86400            # 24 hours
  lambda_function_url = dependency.lambda_api.outputs.iam_function_url
}
