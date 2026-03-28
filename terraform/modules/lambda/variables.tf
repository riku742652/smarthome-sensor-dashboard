variable "project_name" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "function_name" {
  description = "Lambda function name"
  type        = string
}

variable "handler" {
  description = "Lambda handler"
  type        = string
  default     = "lambda_function.lambda_handler"
}

variable "runtime" {
  description = "Lambda runtime"
  type        = string
  default     = "python3.11"
}

variable "timeout" {
  description = "Function timeout in seconds"
  type        = number
  default     = 30
}

variable "memory_size" {
  description = "Function memory in MB"
  type        = number
  default     = 128
}

variable "source_dir" {
  description = "Source directory containing Lambda code"
  type        = string
  default     = ""
}

variable "environment_variables" {
  description = "Environment variables for Lambda function"
  type        = map(string)
  default     = {}
}

variable "dynamodb_table_arn" {
  description = "DynamoDB table ARN for IAM policy"
  type        = string
  default     = ""
}

variable "schedule_expression" {
  description = "EventBridge schedule expression (e.g., rate(1 minute))"
  type        = string
  default     = ""
}
