data "archive_file" "lambda_zip" {
  count       = var.source_dir != "" ? 1 : 0
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/function.zip"
}

resource "aws_lambda_function" "this" {
  filename         = var.source_dir != "" ? data.archive_file.lambda_zip[0].output_path : null
  function_name    = "${var.project_name}-${var.environment}-${var.function_name}"
  role             = aws_iam_role.lambda_role.arn
  handler          = var.handler
  source_code_hash = var.source_dir != "" ? data.archive_file.lambda_zip[0].output_base64sha256 : null
  runtime          = var.runtime
  timeout          = var.timeout
  memory_size      = var.memory_size

  environment {
    variables = var.environment_variables
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-${var.function_name}"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_iam_role" "lambda_role" {
  name = "${var.project_name}-${var.environment}-${var.function_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_dynamodb" {
  count = var.dynamodb_table_arn != "" ? 1 : 0
  role  = aws_iam_role.lambda_role.id
  name  = "dynamodb-access"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ]
      Resource = var.dynamodb_table_arn
    }]
  })
}

# EventBridge (CloudWatch Events) schedule
resource "aws_cloudwatch_event_rule" "schedule" {
  count               = var.schedule_expression != "" ? 1 : 0
  name                = "${var.project_name}-${var.environment}-${var.function_name}-schedule"
  schedule_expression = var.schedule_expression
  description         = "Trigger ${var.function_name} Lambda function"
}

resource "aws_cloudwatch_event_target" "lambda" {
  count = var.schedule_expression != "" ? 1 : 0
  rule  = aws_cloudwatch_event_rule.schedule[0].name
  arn   = aws_lambda_function.this.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  count         = var.schedule_expression != "" ? 1 : 0
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.schedule[0].arn
}
