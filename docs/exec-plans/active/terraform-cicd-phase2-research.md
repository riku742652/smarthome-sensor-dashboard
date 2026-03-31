# Terraform/Terragrunt CI/CD Phase 2 - Research

**Date**: 2026-03-29
**Status**: Research Complete
**Purpose**: Investigate current state to prepare for Phase 2 implementation (AWS OIDC, terraform plan, security scanning)

## Executive Summary

Phase 1 (Format & Validation) has been successfully implemented with a complete GitHub Actions workflow. Phase 2 will add AWS authentication via OIDC, terraform plan execution, plan commenting on PRs, and Trivy security scanning. The infrastructure is ready for these additions, with Terragrunt already configured for S3 backend access.

## Current State Analysis

### Phase 1 Completion Status

**Completed in Phase 1:**
- ✅ `.github/workflows/terraform-ci.yml` - Full format, validate, and summary jobs
- ✅ Terraform format check (`terraform fmt -check`)
- ✅ Terragrunt HCL format check (`terragrunt hcl fmt --check`)
- ✅ Terraform validate for all modules
- ✅ `.gitignore` updated with Terraform/Terragrunt patterns

**Workflow Details (Current):**
- Location: `.github/workflows/terraform-ci.yml`
- Triggers: PR changes to `terraform/**/*.tf|*.hcl`, main branch pushes
- Permissions: `contents: read`, `pull-requests: write`
- Jobs: terraform-format, terraform-validate (matrix of 4 modules), terragrunt-format, summary
- Execution time: ~2-3 minutes

**Module Matrix (from terraform-validate job):**
```
- terraform/modules/dynamodb
- terraform/modules/lambda
- terraform/modules/lambda-container
- terraform/modules/cloudfront
```

### AWS Infrastructure Setup

#### Terragrunt Root Configuration

**File**: `terraform/terragrunt.hcl`

Key configuration:
```hcl
remote_state {
  backend = "s3"
  config = {
    bucket         = "smarthome-terraform-state-${get_aws_account_id()}"
    key            = "${path_relative_to_include()}/terraform.tfstate"
    region         = "ap-northeast-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"
  }
}
```

**Implications for Phase 2:**
- S3 bucket naming includes AWS account ID (dynamic via `get_aws_account_id()`)
- State locking enabled via DynamoDB table
- Region: ap-northeast-1 (Tokyo)
- Encryption: enabled

#### Environment Structure

```
terraform/
├── environments/prod/
│   ├── dynamodb/terragrunt.hcl
│   ├── lambda-api/terragrunt.hcl
│   ├── lambda-poller/terragrunt.hcl
│   └── cloudfront/terragrunt.hcl
└── modules/ (4 modules)
```

**Environment Dependencies** (from lambda-api/terragrunt.hcl):
```hcl
dependency "dynamodb" {
  config_path = "../dynamodb"
}
```

This shows inter-environment dependencies that must be respected during `terraform plan`.

### Terraform Modules Analysis

#### Module Variables

**Common variables across all modules:**
- `project_name` (string, required)
- `environment` (string, required)
- Module-specific variables (function_name, timeout, memory_size, etc.)

**Example - Lambda module variables** (`terraform/modules/lambda/variables.tf`):
```hcl
variable "handler" { default = "lambda_function.lambda_handler" }
variable "runtime" { default = "python3.11" }
variable "timeout" { default = 30 }
variable "memory_size" { default = 128 }
variable "environment_variables" { type = map(string) }
variable "dynamodb_table_arn" { type = string }
variable "schedule_expression" { type = string }
```

**Lambda Container module** - Uses `image_uri` instead of source_dir:
```hcl
image_uri = "${get_env("AWS_ACCOUNT_ID", "123456789012")}.dkr.ecr.ap-northeast-1.amazonaws.com/smarthome-sensor-api:latest"
```

**Note**: Environment variables and AWS account ID can be sourced from `.env` or GitHub Actions secrets.

### GitHub Actions Infrastructure

**Current Permissions** (from terraform-ci.yml):
```yaml
permissions:
  contents: read
  pull-requests: write  # For commenting on PRs (future)
```

**Available for Phase 2:**
- ✅ `pull-requests: write` already enabled for PR comments
- ❌ No AWS credentials configuration yet
- ❌ No OIDC provider setup

### Security Configuration (from docs/)

**docs/SECURITY.md** defines:
1. **Minimum privilege principle** - Use only necessary AWS scopes
2. **Environment variables for secrets** - GitHub Secrets pattern
3. **Input validation** - All external data must be validated

**Phase 2 Implications:**
- AWS OIDC role must have minimal permissions (ReadOnly or limited scope)
- GitHub Actions secrets can be used for AWS_ACCOUNT_ID and other constants
- All terraform plan output should be validated before displaying

### .gitignore Coverage

**Terraform patterns already in .gitignore:**
```
**/.terraform/*
*.tfstate
*.tfstate.*
*.tfvars
*.tfvars.json
.terraformrc
terraform.rc
**/.terragrunt-cache/*
```

**Status**: ✅ Complete, no changes needed

## Phase 2 Implementation Requirements

### Requirement 1: AWS OIDC Authentication

**Purpose**: Enable GitHub Actions to authenticate to AWS without managing long-lived credentials

**Current State**: Not configured
- No OIDC provider exists in AWS
- No GitHub Actions AWS credentials in repository secrets
- No IAM role for OIDC-authenticated workflows

**What Needs to Happen:**

1. **AWS Setup (Manual - out of scope)**
   - Create OIDC provider in AWS with GitHub thumbprint
   - Create IAM role with trust policy for GitHub Actions
   - Attach policies for: `terraform plan`, S3 state access, DynamoDB lock access, and Trivy scanning

2. **GitHub Configuration (Implementation scope)**
   - Add OIDC step in workflow using `aws-actions/configure-aws-credentials@v4`
   - Configure role ARN and session name
   - Store AWS_ACCOUNT_ID and ROLE_ARN as repository secrets

**Type**: Manual prerequisite + workflow configuration

**Estimated complexity**: Medium (requires AWS IAM knowledge)

### Requirement 2: Terraform Plan Execution

**Purpose**: Execute `terraform plan` in CI to show planned changes

**Current Challenges:**
1. Dependency management: lambda-api depends on dynamodb output
2. Multi-environment setup: Must run plan for each environment separately
3. State access: Requires S3 bucket and DynamoDB lock table
4. Plan formatting: Output needs to be readable in PR comments

**Implementation Points:**

1. **Plan execution approach**:
   - Sequential: Plan dynamodb first, then lambda-api, lambda-poller
   - Alternative: Use `dependency` blocks in Terragrunt to auto-resolve
   - Recommended: Use `terragrunt run-all plan` for all environments at once

2. **Output handling**:
   - Capture plan output as JSON or plaintext
   - Parse to detect changes/adds/deletes
   - Truncate if > 65KB (GitHub comment limit)
   - Format with markdown code blocks

3. **Plan artifact storage**:
   - Store plan files in `plan/` directory per environment
   - Use as input for apply (future Phase 3)

**Type**: Primary feature

**Estimated complexity**: High (state management, formatting)

### Requirement 3: PR Comment with Plan Results

**Purpose**: Display terraform plan results directly in PR for easy review

**Current State**:
- Permissions already added (`pull-requests: write`)
- Comment posting mechanism not implemented

**Implementation Requirements:**

1. **Comment format**:
   - Summary: "Plan: 3 to add, 2 to change, 0 to destroy"
   - Details: Colored diff output (using markdown)
   - Link to full plan artifact (if > 65KB)

2. **Conditional posting**:
   - Always post comment on terraform changes
   - Update/replace same comment on subsequent commits
   - Post error summary if plan fails

3. **GitHub API usage**:
   - GitHub Actions provides automatic context: PR number, commit SHA
   - Use GitHub REST API or `github-script` action
   - Alternative: Use `terraform-plan-action` (external action)

**Type**: Secondary feature (depends on plan execution)

**Estimated complexity**: Medium

### Requirement 4: Trivy Security Scanning

**Purpose**: Scan Terraform/CloudFormation code for security vulnerabilities

**Current State**: Not configured

**What Trivy Does:**
- Scans IaC (Terraform, CloudFormation, Helm, Dockerfile, etc.)
- Checks for: misconfiguration, missing encryption, exposed ports, IAM issues
- Provides: severity levels, CVE references, remediation

**Implementation Approach:**

1. **Trivy in GitHub Actions**:
   - Official action: `aquasecurity/trivy-action@master`
   - Alternative: Install Trivy binary and run command
   - Recommended: Official action (maintained, reliable)

2. **Scan scope**:
   - Scan entire `terraform/` directory
   - Severity filtering: Fail on HIGH/CRITICAL
   - Output format: JSON for parsing, SARIF for GitHub security tab

3. **Failure strategy**:
   - Fail CI if HIGH or CRITICAL issues found
   - Allow MEDIUM for discussion
   - Generate security report in PR

**Example configuration**:
```yaml
- uses: aquasecurity/trivy-action@master
  with:
    scan-type: 'config'
    scan-ref: 'terraform/'
    format: 'sarif'
    output: 'trivy-results.sarif'
    severity: 'CRITICAL,HIGH'
```

**Type**: Primary feature

**Estimated complexity**: Low (straightforward integration)

## Technical Context

### Dependencies and Tools

**External Actions:**
- `hashicorp/setup-terraform@v3` - Already in use
- `aws-actions/configure-aws-credentials@v4` - New for OIDC
- `aquasecurity/trivy-action@master` - New for security scanning
- `github-script@v7` or similar - For PR commenting

**AWS Resources Required:**
- S3 bucket: `smarthome-terraform-state-{account-id}`
- DynamoDB table: `terraform-locks`
- IAM OIDC provider: `token.actions.githubusercontent.com`
- IAM role: For GitHub Actions (name TBD)

**Terraform Features Used:**
- `get_aws_account_id()` - Terragrunt function for dynamic bucket naming
- `get_env()` - Terragrunt function for environment variables
- `dependency` blocks - Inter-environment dependencies
- `terraform fmt` - Already using
- `terraform validate` - Already using

### Environment Variables Needed

From existing terragrunt.hcl and environment configs:

**Required for terraform plan:**
- `AWS_ACCOUNT_ID` - For S3 bucket and ECR URI generation
- `SWITCHBOT_DEVICE_ID` - From lambda-api/terragrunt.hcl
- `TF_TOKEN_app_terraform_io` - If using Terraform Cloud (unlikely)

**Optional:**
- `AWS_REGION` - Defaulted to ap-northeast-1 in root terragrunt.hcl
- `TF_LOG` - Debug logging (not recommended for prod)

### Type Definitions and Validation

**Current approach** (from code review):
- No explicit schema validation in Terraform modules
- Lambda module has basic type constraints (number, string)
- Terragrunt uses HCL (loosely typed at parse time)

**Phase 2 consideration:**
- Plan output is in HCL/JSON (auto-validated by Terraform)
- Trivy validates configuration against security rules
- No additional type definitions needed

## Constraints and Considerations

### Performance Constraints

**CI Execution Time Targets:**
- Phase 1 (current): ~2-3 minutes
- Phase 2 additions:
  - OIDC setup: +30 seconds (credential exchange)
  - terraform plan per environment: ~1-2 minutes (depends on state size)
  - Trivy scan: +30 seconds
  - PR comment posting: +10 seconds
  - **Estimated total: 4-6 minutes**

**Optimization opportunities:**
- Use Terraform cache (setup-terraform handles this)
- Parallelize environments if no dependencies (not applicable here)
- Parallel Trivy scan (fast anyway)

### Security Considerations

**From docs/SECURITY.md:**
1. **Minimum privilege** - OIDC role should have:
   - S3 read/write for state bucket
   - DynamoDB read/write for locks
   - CloudFront, Lambda, DynamoDB, ECR permissions (ReadOnly for plan)
   - SecurityHub (for Trivy results integration - optional)

2. **Secret management**:
   - No AWS credentials stored as secrets (use OIDC)
   - AWS_ACCOUNT_ID can be stored as secret (not sensitive, just organizational info)
   - Any sensitive values stay in Terragrunt/environment files

3. **Output safety**:
   - Plan output may contain resource IDs, ARNs (not sensitive)
   - Sanitize error messages (don't expose stack traces in PR)
   - Trivy results may include CVE details (acceptable, informative)

### Reliability Considerations

**State lock implications:**
- DynamoDB table required for concurrent plan operations
- Must not run multiple terraform commands simultaneously
- Add lock timeout and retry logic

**Plan failure scenarios:**
1. AWS auth fails → Clear error message, workflow fails
2. State lock acquisition fails → Retry logic, eventual failure
3. Plan shows errors → Comment shows errors, workflow fails
4. Plan partial success (some environments ok, some fail) → All-or-nothing approach recommended

### Testing Strategy

**What needs testing in Phase 2:**

1. **AWS OIDC**:
   - Test that credentials are obtained correctly
   - Verify scoped permissions work
   - Confirm no credential leakage in logs

2. **terraform plan**:
   - Test on actual changes (create/modify/destroy scenarios)
   - Verify plan output is captured correctly
   - Test large plan output (>65KB truncation)
   - Test with inter-environment dependencies

3. **PR comments**:
   - Verify comment is posted on plan changes
   - Verify comment is updated on subsequent commits
   - Test with large plans (truncation display)

4. **Trivy scanning**:
   - Verify scan completes without errors
   - Test detection of known issues (mock a bad config)
   - Verify severity filtering works
   - Test with SARIF output format

## Key Files and Patterns

### Existing Workflow Files

1. **`.github/workflows/terraform-ci.yml`** (Phase 1)
   - 130 lines, well-structured
   - Uses matrix strategy for module validation
   - Has summary job for aggregation
   - **Modification point**: Add plan, Trivy, and comment jobs

2. **`terraform/terragrunt.hcl`** (Root config)
   - Remote state configuration complete
   - Provider generation enabled
   - Common inputs defined
   - **No changes needed**: Works as-is with OIDC

3. **`terraform/environments/prod/*/terragrunt.hcl`** (Environment configs)
   - Show dependency management pattern
   - Use `get_env()` for dynamic values
   - Example: lambda-api depends on dynamodb
   - **Pattern to follow**: Run sequential plan per environment

### Modules to Test Plan Against

```
terraform/modules/
├── dynamodb (3 files)
├── lambda (3 files)
├── lambda-container (3 files)
└── cloudfront (3 files)
```

All have:
- Variable definitions (project_name, environment, others)
- Resource definitions (AWS resources)
- Output definitions (table_arn, function_arn, etc.)

## Potential Challenges

### Challenge 1: State Bucket Access During Plan

**Issue**: Terragrunt requires S3 bucket access to read current state
**Problem**: Bucket name includes AWS account ID (dynamic via `get_aws_account_id()`)
**Solution**:
- GitHub Actions needs AWS credentials to call `get_aws_account_id()`
- OIDC credentials must have S3:GetBucketVersioning or similar scopes
- Test: Verify plan can read existing state

### Challenge 2: DynamoDB Lock Table in CI

**Issue**: State locks prevent concurrent terraform operations
**Problem**: Long-running plans might block other workflows
**Solution**:
- Add explicit `-lock-timeout=5m` to terraform plan
- Add retry logic in workflow
- Document state locking behavior

### Challenge 3: Inter-Environment Dependencies

**Issue**: lambda-api depends on dynamodb outputs
**Problem**: Must plan dynamodb before lambda-api to validate
**Solution**:
- Option A: Sequential `terragrunt plan` per environment (simplest)
- Option B: Use `terragrunt run-all plan` (handles dependencies automatically)
- Recommended: Option B with error handling

### Challenge 4: Plan Output Size and Formatting

**Issue**: GitHub comments have 65,536 character limit
**Problem**: Large infrastructure plans may exceed limit
**Solution**:
- Stream plan to file artifact
- Post summary comment with artifact link
- Keep summary under limit, full plan in artifact

### Challenge 5: Security Scanning Results Integration

**Issue**: Trivy finds issues, need clear remediation path
**Problem**: Dev workflow needs to understand findings
**Solution**:
- Include remediation links in comments (Trivy provides these)
- Fail on CRITICAL/HIGH, warn on MEDIUM
- Post results as PR comment AND GitHub security tab

## Recommendations

### Recommended Approach for Phase 2

**1. AWS OIDC Setup (Manual prerequisite)**
- Create OIDC provider in AWS (external to implementation scope)
- Create IAM role with least-privilege policy
- Store AWS_ACCOUNT_ID and ROLE_ARN as repository secrets
- Test OIDC authentication before proceeding

**2. Terraform Plan Job**
- Add `terraform-plan` job after Phase 1 validation passes
- Use sequential environment planning (dynamodb → lambda-api → lambda-poller → cloudfront)
- Capture plan output as artifact
- Parse and summarize for PR comment

**3. PR Comment Job**
- Create separate job for PR comment posting
- Depend on plan job completion
- Use GitHub API (via `github-script@v7` or direct API call)
- Include summary + link to full plan artifact

**4. Trivy Scanning Job**
- Parallel job (independent of terraform plan)
- Use `aquasecurity/trivy-action@master`
- Output SARIF format for GitHub security tab
- Fail on CRITICAL/HIGH, report MEDIUM
- Include results in PR comment

**5. Workflow Structure**
```
Phase 1 jobs (already exist):
  - terraform-format
  - terraform-validate
  - terragrunt-format
  - summary (aggregates Phase 1)

Phase 2 additions:
  + aws-auth (configure OIDC credentials)
  + terraform-plan (runs plan per environment)
  + security-scan (Trivy)
  + pr-comment (posts results)
  + summary-phase2 (aggregates all)
```

### Why This Approach is Recommended

1. **Modular**: Each job has clear responsibility
2. **Fault-tolerant**: Trivy can fail independently of plan
3. **Performance**: Parallel jobs where possible (Trivy, format checks)
4. **Maintainable**: Easy to update individual components
5. **User-friendly**: Clear PR feedback on changes and security issues

## References

### Phase 1 Documentation

- [terraform-cicd-research.md](./terraform-cicd-research.md) - Phase 1 analysis
- [terraform-cicd-plan.md](./terraform-cicd-plan.md) - Phase 1 implementation plan

### External Documentation

- [AWS OIDC Provider Setup](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials)
- [Terragrunt Dependencies](https://terragrunt.gruntwork.io/docs/features/dependency/)
- [Trivy GitHub Action](https://github.com/aquasecurity/trivy-action)
- [terraform-plan-action](https://github.com/dflook/terraform-github-actions)

### Project References

- [Architecture](../../ARCHITECTURE.md) - System design
- [Security Guidelines](../../docs/SECURITY.md) - Security requirements
- [.gitignore](../../.gitignore) - Already configured for Terraform

## Outstanding Questions for Planning Phase

1. **AWS Account Setup**: Has OIDC provider been created in AWS? If not, who handles this?
2. **Plan Artifact Storage**: Should we keep plan artifacts (tfplan files) in artifact storage, or discard after commenting?
3. **Environment Execution Strategy**: Use `terragrunt run-all plan` or sequential environment planning?
4. **Failure Strategy**: Should single environment failure block PR, or just flag it?
5. **PR Comment Updates**: Replace previous comment or post new comment on each push?
6. **Trivy Severity Thresholds**: Are MEDIUM findings acceptable, or should they also block?
7. **Integration with Branch Protection**: Should plan-passing be a required check for merging?

---

**Researcher**: Claude Code
**Completion Date**: 2026-03-29
**Next Step**: Planning phase (harness-planner) to create detailed implementation plan
