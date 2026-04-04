locals {
  # ECR リポジトリ名: 明示指定がなければ {project_name}-{function_name} を使用
  ecr_repository_name = var.ecr_repository_name != null ? var.ecr_repository_name : "${var.project_name}-${var.function_name}"

  # image_uri: 明示指定があれば優先、なければ ECR リポジトリ URL から生成
  image_uri = var.image_uri != "" ? var.image_uri : "${aws_ecr_repository.this[0].repository_url}:${var.image_tag}"
}

# ECR リポジトリ
resource "aws_ecr_repository" "this" {
  count = var.create_ecr_repository ? 1 : 0

  name                 = local.ecr_repository_name
  image_tag_mutability = var.image_tag_mutability
  force_delete         = var.force_delete

  image_scanning_configuration {
    scan_on_push = var.scan_on_push
  }

  tags = {
    Name        = local.ecr_repository_name
    Project     = var.project_name
    Environment = var.environment
  }
}

# ECR ライフサイクルポリシー（最新 10 件を保持）
resource "aws_ecr_lifecycle_policy" "this" {
  count = var.create_ecr_repository ? 1 : 0

  repository = aws_ecr_repository.this[0].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "最新 10 件のイメージを保持し、古いものを削除する"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_lambda_function" "this" {
  function_name = "${var.project_name}-${var.environment}-${var.function_name}"
  role          = aws_iam_role.lambda_role.arn
  package_type  = "Image"
  image_uri     = local.image_uri
  timeout       = var.timeout
  memory_size   = var.memory_size

  environment {
    variables = var.environment_variables
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-${var.function_name}"
    Project     = var.project_name
    Environment = var.environment
  }

  depends_on = [aws_ecr_repository.this]
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

# ECR pull 権限（コンテナイメージ Lambda に必須）
resource "aws_iam_role_policy" "lambda_ecr" {
  count = var.create_ecr_repository ? 1 : 0

  role = aws_iam_role.lambda_role.id
  name = "ecr-pull"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability"
        ]
        Resource = aws_ecr_repository.this[0].arn
      },
      {
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      }
    ]
  })
}

# aws_lambda_function_url に count を追加したことによるアドレス変更を Terraform に通知
moved {
  from = aws_lambda_function_url.this
  to   = aws_lambda_function_url.this[0]
}

# Lambda Function URL（HTTP トリガーが必要な Lambda 向け。Poller には不要）
resource "aws_lambda_function_url" "this" {
  count              = var.create_function_url ? 1 : 0
  function_name      = aws_lambda_function.this.function_name
  authorization_type = "NONE" # パブリックアクセス

  cors {
    allow_credentials = false
    allow_origins     = ["*"]
    allow_methods     = ["*"]
    allow_headers     = ["*"]
    max_age           = 86400
  }
}

# IAM 認証 Lambda Function URL（Raspberry Pi 専用 POST エンドポイント）
resource "aws_lambda_function_url" "iam" {
  count              = var.create_iam_function_url ? 1 : 0
  function_name      = aws_lambda_function.this.function_name
  authorization_type = "AWS_IAM"

  # Lambda は Function URL を 1 つしか持てないため、
  # NONE URL（this）が存在する場合は削除してから作成する必要がある
  depends_on = [aws_lambda_function_url.this]

  cors {
    allow_credentials = false
    allow_origins     = ["*"]
    allow_methods     = ["POST"]
    allow_headers     = ["*"]
    max_age           = 86400
  }
}

# Raspberry Pi 用 IAM User（create_iam_function_url = true のときのみ作成）
resource "aws_iam_user" "raspberry_pi" {
  count = var.create_iam_function_url ? 1 : 0
  name  = "${var.project_name}-${var.environment}-raspberry-pi"

  tags = {
    Name        = "${var.project_name}-${var.environment}-raspberry-pi"
    Project     = var.project_name
    Environment = var.environment
  }
}

# Raspberry Pi 用 IAM ポリシー（lambda:InvokeFunctionUrl のみ許可）
resource "aws_iam_user_policy" "raspberry_pi" {
  count = var.create_iam_function_url ? 1 : 0
  name  = "invoke-lambda-function-url"
  user  = aws_iam_user.raspberry_pi[0].name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunctionUrl"
        Resource = "${aws_lambda_function.this.arn}"
        Condition = {
          StringEquals = {
            "lambda:FunctionUrlAuthType" = "AWS_IAM"
          }
        }
      }
    ]
  })
}

# Raspberry Pi 用 IAM アクセスキー（sensitive 出力）
resource "aws_iam_access_key" "raspberry_pi" {
  count = var.create_iam_function_url ? 1 : 0
  user  = aws_iam_user.raspberry_pi[0].name
}

# EventBridge (CloudWatch Events) スケジュール
# schedule_expression が設定されている場合のみリソースを作成する
resource "aws_cloudwatch_event_rule" "schedule" {
  count               = var.schedule_expression != "" ? 1 : 0
  name                = "${var.project_name}-${var.environment}-${var.function_name}-schedule"
  schedule_expression = var.schedule_expression
  description         = "${var.function_name} Lambda 関数を定期実行するスケジュールルール"
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
