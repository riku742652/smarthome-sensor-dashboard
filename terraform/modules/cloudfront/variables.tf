variable "project_name" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Environment (e.g., prod, dev)"
  type        = string
}

variable "price_class" {
  description = "CloudFront price class"
  type        = string
  default     = "PriceClass_200"
}

variable "default_cache_ttl" {
  description = "Default cache TTL in seconds"
  type        = number
  default     = 3600 # 1 hour
}

variable "max_cache_ttl" {
  description = "Maximum cache TTL in seconds"
  type        = number
  default     = 86400 # 24 hours
}
