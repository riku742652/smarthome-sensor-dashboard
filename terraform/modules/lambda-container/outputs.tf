output "function_name" {
  description = "Lambda 関数名"
  value       = aws_lambda_function.this.function_name
}

output "function_arn" {
  description = "Lambda 関数 ARN"
  value       = aws_lambda_function.this.arn
}

output "function_url" {
  description = "Lambda 関数 URL（create_function_url = false の場合は null）"
  value       = var.create_function_url ? aws_lambda_function_url.this[0].function_url : null
}

output "role_arn" {
  description = "Lambda IAM ロール ARN"
  value       = aws_iam_role.lambda_role.arn
}

output "ecr_repository_url" {
  description = "ECR リポジトリ URL（Docker push に使用）"
  value       = var.create_ecr_repository ? aws_ecr_repository.this[0].repository_url : null
}

output "ecr_repository_arn" {
  description = "ECR リポジトリ ARN"
  value       = var.create_ecr_repository ? aws_ecr_repository.this[0].arn : null
}

output "ecr_registry_id" {
  description = "ECR レジストリ ID（AWS アカウント ID）"
  value       = var.create_ecr_repository ? aws_ecr_repository.this[0].registry_id : null
}
