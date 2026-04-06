# S3 Bucket for Frontend
resource "aws_s3_bucket" "frontend" {
  bucket = "${var.project_name}-${var.environment}-frontend"

  tags = {
    Name        = "${var.project_name}-${var.environment}-frontend"
    Project     = var.project_name
    Environment = var.environment
  }
}

# S3 Bucket Public Access Block
resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# /api/* → /* パスプレフィックスを除去する CloudFront Function
resource "aws_cloudfront_function" "api_rewrite" {
  count   = var.lambda_function_url != "" ? 1 : 0
  name    = "${var.project_name}-${var.environment}-api-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "/api プレフィックスを除去して Lambda に転送する"
  publish = true

  code = <<-EOT
    function handler(event) {
      var request = event.request;
      // /api/* → /* に書き換え（例: /api/data → /data、/api/health → /health）
      request.uri = request.uri.replace(/^\/api/, '');
      if (request.uri === '' || request.uri === undefined) {
        request.uri = '/';
      }
      return request;
    }
  EOT
}

# Lambda 用 Origin Access Control（IAM SigV4 署名を CloudFront が代理実行）
resource "aws_cloudfront_origin_access_control" "lambda_api" {
  count                             = var.lambda_function_url != "" ? 1 : 0
  name                              = "${var.project_name}-${var.environment}-lambda-oac"
  description                       = "OAC for Lambda API origin"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront Origin Access Control
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project_name}-${var.environment}-oac"
  description                       = "OAC for ${var.project_name} frontend"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = var.price_class
  comment             = "${var.project_name} ${var.environment} frontend"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "S3-${aws_s3_bucket.frontend.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # Lambda IAM Function URL オリジン（lambda_function_url が設定されている場合のみ）
  dynamic "origin" {
    for_each = var.lambda_function_url != "" ? [1] : []
    content {
      # https:// および末尾スラッシュを除去してドメイン名のみ取得
      domain_name              = trimsuffix(replace(var.lambda_function_url, "https://", ""), "/")
      origin_id                = "Lambda-API"
      origin_access_control_id = aws_cloudfront_origin_access_control.lambda_api[0].id

      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${aws_s3_bucket.frontend.id}"

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = var.default_cache_ttl
    max_ttl                = var.max_cache_ttl
    compress               = true
  }

  # /api/* を Lambda にルーティング（キャッシュなし）
  dynamic "ordered_cache_behavior" {
    for_each = var.lambda_function_url != "" ? [1] : []
    content {
      path_pattern           = "/api/*"
      allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods         = ["GET", "HEAD"]
      target_origin_id       = "Lambda-API"
      compress               = true
      viewer_protocol_policy = "redirect-to-https"

      # API はキャッシュしない（AWS マネージドポリシー: CachingDisabled）
      cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
      # クエリ文字列・ヘッダー（Host 除く）・Cookie をオリジンに転送（AWS マネージドポリシー: AllViewerExceptHostHeader）
      origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"

      # CloudFront Function でパスプレフィックスを除去
      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.api_rewrite[0].arn
      }
    }
  }

  # SPA用カスタムエラーレスポンス（404を index.htmlにリダイレクト）
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-distribution"
    Project     = var.project_name
    Environment = var.environment
  }
}

# S3 Bucket Policy to allow CloudFront access
resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontServicePrincipal"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.frontend.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
          }
        }
      }
    ]
  })
}
