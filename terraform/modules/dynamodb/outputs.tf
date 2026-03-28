output "table_name" {
  description = "DynamoDB table name"
  value       = aws_dynamodb_table.sensor_data.name
}

output "table_arn" {
  description = "DynamoDB table ARN"
  value       = aws_dynamodb_table.sensor_data.arn
}

output "table_id" {
  description = "DynamoDB table ID"
  value       = aws_dynamodb_table.sensor_data.id
}
