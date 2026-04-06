variable "project_name" {
  description = "プロジェクト名"
  type        = string
}

variable "environment" {
  description = "環境名"
  type        = string
}

variable "function_name" {
  description = "Lambda 関数名"
  type        = string
}

variable "image_uri" {
  description = "ECR イメージ URI。指定された場合は ECR リポジトリ自動生成より優先される"
  type        = string
  default     = ""
}

variable "timeout" {
  description = "関数タイムアウト秒数"
  type        = number
  default     = 30
}

variable "memory_size" {
  description = "関数メモリ MB"
  type        = number
  default     = 512
}

variable "environment_variables" {
  description = "Lambda 関数の環境変数"
  type        = map(string)
  default     = {}
}

variable "dynamodb_table_arn" {
  description = "IAM ポリシー用 DynamoDB テーブル ARN"
  type        = string
  default     = ""
}

variable "aws_region" {
  description = "AWS リージョン"
  type        = string
  default     = "ap-northeast-1"
}

# --- ECR リポジトリ管理 ---

variable "create_ecr_repository" {
  description = "ECR リポジトリを作成するかどうか"
  type        = bool
  default     = true
}

variable "ecr_repository_name" {
  description = "ECR リポジトリ名。未指定の場合は {project_name}-{function_name} が使用される"
  type        = string
  default     = null
}

variable "image_tag" {
  description = "コンテナイメージのタグ"
  type        = string
  default     = "latest"
}

variable "image_tag_mutability" {
  description = "イメージタグの変更可否 (MUTABLE または IMMUTABLE)"
  type        = string
  default     = "MUTABLE"

  validation {
    condition     = contains(["MUTABLE", "IMMUTABLE"], var.image_tag_mutability)
    error_message = "image_tag_mutability は MUTABLE または IMMUTABLE である必要があります。"
  }
}

variable "scan_on_push" {
  description = "プッシュ時にイメージスキャンを有効にするかどうか"
  type        = bool
  default     = true
}

variable "force_delete" {
  description = "イメージが残っていても ECR リポジトリを強制削除するかどうか"
  type        = bool
  default     = false
}

variable "schedule_expression" {
  description = "EventBridge スケジュール式（例：rate(2 minutes)）。空文字の場合は EventBridge リソースを作成しない"
  type        = string
  default     = ""
}

variable "create_function_url" {
  description = "Lambda Function URL を作成するかどうか。HTTP トリガー不要の Lambda は false に設定する"
  type        = bool
  default     = true
}

variable "create_iam_function_url" {
  description = "IAM 認証付き Lambda Function URL を作成するかどうか（Raspberry Pi 用 POST エンドポイント向け）"
  type        = bool
  default     = false
}

variable "cloudfront_distribution_arn" {
  description = "CloudFront Distribution ARN。設定された場合、CloudFront から Lambda IAM URL を呼び出すためのリソースポリシーを追加する"
  type        = string
  default     = ""
}
