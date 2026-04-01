variable "project_name" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Environment name (e.g., prod, dev)"
  type        = string
}

variable "enable_ttl" {
  description = "Enable TTL for automatic data expiration"
  type        = bool
  default     = true
}

variable "ttl_days" {
  description = "Number of days before data expires"
  type        = number
  default     = 30
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-1"
}
