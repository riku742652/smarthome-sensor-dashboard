# Infrastructure as Code - Terraform + Terragrunt

This directory contains Terraform modules and Terragrunt configurations for deploying the Smarthome Sensor Dashboard infrastructure to AWS.

## Architecture

```
User
  ↓
CloudFront (CDN)
  ↓
S3 (React SPA)
  ↓
Lambda (API) + Function URL
  FastAPI + Lambda Web Adapter
  Docker Container (ECR)
  ↓
DynamoDB
  ↑
Raspberry Pi (BLE scan)
  SwitchBot CO2 Sensor via BLE
```

## Components

- **DynamoDB**: Stores sensor data with 30-day TTL
- **Lambda (API)**: FastAPI application with Lambda Web Adapter. Receives BLE sensor data from Raspberry Pi
- **Lambda Function URL**: HTTPS endpoint for API (IAM auth for POST, no API Gateway needed)
- **S3 + CloudFront**: Frontend hosting (future)

## Prerequisites

### Tools

- [Terraform](https://www.terraform.io/downloads) >= 1.5
- [Terragrunt](https://terragrunt.gruntwork.io/docs/getting-started/install/) >= 0.50
- [AWS CLI](https://aws.amazon.com/cli/) v2
- [Docker](https://www.docker.com/) (for building API Lambda)
- AWS Account with appropriate permissions

### AWS Setup

1. Configure AWS credentials:

```bash
aws configure
# Or use AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables
```

2. Create S3 bucket for Terraform state:

```bash
aws s3 mb s3://smarthome-terraform-state-$(aws sts get-caller-identity --query Account --output text) --region ap-northeast-1
aws s3api put-bucket-versioning --bucket smarthome-terraform-state-$(aws sts get-caller-identity --query Account --output text) --versioning-configuration Status=Enabled
```

3. Create DynamoDB table for state locking:

```bash
aws dynamodb create-table \
  --table-name terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-northeast-1
```

## Environment Variables

Set the following environment variables:

```bash
# Required for deployment
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export SWITCHBOT_DEVICE_ID="your_device_id"
export SWITCHBOT_TOKEN="your_token"
export SWITCHBOT_SECRET="your_secret"
```

## Deployment

### Step 1: Build and Push Lambda API Docker Image

```bash
# Create ECR repository
aws ecr create-repository --repository-name smarthome-sensor-api --region ap-northeast-1

# Build Docker image
cd ../lambda/api
docker build --platform linux/amd64 -t smarthome-sensor-api:latest .

# Push to ECR
aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com

docker tag smarthome-sensor-api:latest ${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest
docker push ${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest
```

### Step 2: Deploy Infrastructure

Deploy in order (due to dependencies):

```bash
cd terraform/environments/prod

# 1. DynamoDB
cd dynamodb
terragrunt init
terragrunt plan
terragrunt apply

# 2. Lambda API
cd ../lambda-api
terragrunt init
terragrunt apply
```

### Step 3: Verify Deployment

```bash
# Get API Function URL
FUNCTION_URL=$(aws lambda get-function-url-config --function-name smarthome-sensor-prod-api --query 'FunctionUrl' --output text)
echo "API URL: ${FUNCTION_URL}"

# Test API endpoints
curl "${FUNCTION_URL}"
curl "${FUNCTION_URL}/health"
curl "${FUNCTION_URL}/data?hours=24"
curl "${FUNCTION_URL}/latest"
curl "${FUNCTION_URL}/docs"  # FastAPI automatic documentation
```

## Local Development

### Lambda API (FastAPI)

Run FastAPI locally for development:

```bash
cd lambda/api

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export TABLE_NAME="smarthome-sensor-prod-sensor-data"
export DEVICE_ID="your_device_id"

# Run with uvicorn
python main.py
# Or: uvicorn main:app --reload

# Open browser
open http://localhost:8000/docs
```

## CI/CD

### GitHub Actions

All Terraform and Terragrunt code is automatically checked on pull requests:

- **Format Check**: `terraform fmt -check -recursive`
- **HCL Format Check**: `terragrunt hcl fmt --check`
- **Validate**: `terraform validate` for all modules

### Local Development

Before committing, run:

```bash
# Format all Terraform files
terraform fmt -recursive terraform/

# Format all Terragrunt HCL files
terragrunt hcl fmt --working-dir terraform

# Validate all modules
for module in terraform/modules/*; do
  cd "$module"
  terraform init -backend=false
  terraform validate
  cd -
done
```

### CI Workflow

`.github/workflows/terraform-ci.yml` runs on:
- Pull requests that modify `terraform/**` or `lambda/**`
- Pushes to `main` branch

Jobs:
1. **terraform-format**: Check Terraform formatting
2. **terraform-validate**: Validate all modules
3. **terragrunt-format**: Check Terragrunt HCL formatting
4. **summary**: Aggregate results

## Updating

### Update Lambda API

```bash
# Rebuild and push Docker image
cd lambda/api
docker build --platform linux/amd64 -t smarthome-sensor-api:latest .
docker tag smarthome-sensor-api:latest ${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest
docker push ${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest

# Update Lambda function
aws lambda update-function-code \
  --function-name smarthome-sensor-prod-api \
  --image-uri ${AWS_ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest
```

## Cleanup

To destroy all infrastructure:

```bash
cd terraform/environments/prod

# Destroy in reverse order
cd lambda-api
terragrunt destroy

cd ../dynamodb
terragrunt destroy
```

## Cost Estimation

All components should stay within AWS Free Tier for personal use:

- Lambda: 1M requests/month free
- DynamoDB: 25GB storage free
- ECR: 500MB storage free
- **Estimated monthly cost: $0** (within free tier)

## Troubleshooting

### Lambda API errors

View logs:

```bash
aws logs tail /aws/lambda/smarthome-sensor-prod-api --follow
```

### DynamoDB access issues

Check IAM role permissions:

```bash
aws iam get-role --role-name smarthome-sensor-prod-api-role
aws iam list-attached-role-policies --role-name smarthome-sensor-prod-api-role
```

## Directory Structure

```
terraform/
├── terragrunt.hcl              # Root configuration
├── modules/                    # Reusable Terraform modules
│   ├── dynamodb/              # DynamoDB table module
│   ├── lambda/                # Lambda function module (zip)
│   └── lambda-container/      # Lambda function module (container)
└── environments/
    └── prod/                  # Production environment
        ├── dynamodb/
        ├── lambda-api/
        └── cloudfront/
```

## References

- [Terraform Documentation](https://www.terraform.io/docs)
- [Terragrunt Documentation](https://terragrunt.gruntwork.io/)
- [AWS Lambda Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
