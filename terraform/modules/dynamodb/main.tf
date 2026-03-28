resource "aws_dynamodb_table" "sensor_data" {
  name         = "${var.project_name}-${var.environment}-sensor-data"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "deviceId"
  range_key    = "timestamp"

  attribute {
    name = "deviceId"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "N"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = var.enable_ttl
  }

  server_side_encryption {
    enabled = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-sensor-data"
    Project     = var.project_name
    Environment = var.environment
  }
}
