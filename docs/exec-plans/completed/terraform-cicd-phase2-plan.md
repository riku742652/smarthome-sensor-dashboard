# Terraform CI/CD Phase 2 - Implementation Plan

**Date**: 2026-03-29
**Status**: Plan - Approved (Q1/Q2/Q8 answered 2026-03-29)
**Prerequisite**: [terraform-cicd-phase2-research.md](./terraform-cicd-phase2-research.md) research complete
**Builds on**: [Phase 1 plan](../completed/terraform-cicd-plan.md) (already merged as `.github/workflows/terraform-ci.yml`)

---

## Goal and Success Criteria

**Goal**: Extend the existing Terraform CI workflow to add AWS authentication via OIDC, terraform plan execution per environment, PR comment display of plan results, and Trivy security scanning.

**Success Criteria**:
- [ ] GitHub Actions can authenticate to AWS using OIDC (no long-lived credentials in secrets)
- [ ] `terraform plan` runs for all 4 environments in the correct dependency order on each PR
- [ ] Plan results (summary + collapsible diff) are posted as a PR comment and updated on each new commit
- [ ] PR comment stays within the 65 KB GitHub limit (truncation with artifact link for large plans)
- [ ] Trivy scans `terraform/` on every PR and fails the workflow on CRITICAL or HIGH findings
- [ ] All Phase 2 jobs complete within 10 minutes (Phase 1 was 2-3 minutes; Phase 2 target: 8-10 minutes total)
- [ ] Phase 1 jobs (`terraform-format`, `terraform-validate`, `terragrunt-format`) remain unchanged and still pass

---

## Outstanding Questions (Decision Required Before / During Implementation)

The following decisions affect implementation details. They are called out inline within the relevant steps and summarized here.

<!-- ANSWERED: Q1 - Not yet created. Must be created as part of Manual Step A. -->
**Q1 - OIDC Provider**: ❌ 未作成。Manual Step A で作成する。

<!-- ANSWERED: Q2 - Not yet created. Must be created as part of Manual Step B. IAM role name will be decided during creation. -->
**Q2 - IAM Role ARN**: ❌ 未作成。Manual Step B で作成する。作成後に GitHub Secret `AWS_ROLE_ARN` に設定する。

<!-- QUESTION: Q3 - Sequential plan per environment or terragrunt run-all? -->
**Q3 - Plan strategy**: Use sequential `terragrunt plan` per environment (dynamodb → lambda-api → lambda-poller → cloudfront) or `terragrunt run-all plan --terragrunt-include-dir terraform/environments/prod`? Sequential is simpler to debug; run-all auto-resolves dependencies. Research recommends `run-all` but sequential is safer for first iteration. **This plan defaults to sequential** unless overridden.

<!-- QUESTION: Q4 - PR comment behavior: replace or append? -->
**Q4 - PR comment update**: On a second push to the same PR, should the workflow (a) find and replace the existing plan comment, or (b) post a new comment? Replacing is cleaner but requires storing the comment ID. **This plan defaults to replace**.

<!-- QUESTION: Q5 - Trivy MEDIUM severity: warn or fail? -->
**Q5 - Trivy MEDIUM**: Should MEDIUM severity findings block the PR (fail CI) or produce a warning comment only? **This plan defaults to CRITICAL+HIGH fail, MEDIUM warn**.

<!-- QUESTION: Q6 - Plan artifact retention: how many days? -->
**Q6 - Artifact retention**: How long should plan artifact files be retained in GitHub Actions? Default GitHub is 90 days. **This plan defaults to 7 days** (sufficient for PR review, minimizes storage).

<!-- QUESTION: Q7 - Should terraform plan job run on push to main as well, or only on PRs? -->
**Q7 - Trigger scope**: Phase 1 runs on both PR and push-to-main. Should Phase 2 jobs (plan, security scan, PR comment) also run on push-to-main? PR comment is meaningless on main. **This plan defaults to: plan and security scan run on PR only; push-to-main triggers format/validate only (no change to existing behaviour)**.

---

## Architectural Changes

### Modified Files

- `.github/workflows/terraform-ci.yml` - Add 4 new jobs: `aws-auth` (reusable credential step via environment), `terraform-plan`, `security-scan`, `pr-comment`. Modify `summary` job to aggregate Phase 2 results.

### New GitHub Secrets Required (manual, pre-implementation)

| Secret name | Description | Sensitivity |
|---|---|---|
| `AWS_ROLE_ARN` | ARN of the IAM role to assume via OIDC | Low (organizational info, not a credential) |
| `AWS_ACCOUNT_ID` | 12-digit AWS account number | Low |
| `SWITCHBOT_DEVICE_ID` | SwitchBot device ID for lambda env vars | Medium |

> Note: `SWITCHBOT_TOKEN` and `SWITCHBOT_SECRET` are used at runtime by the Lambda, not by `terraform plan`, so they do not need to be GitHub secrets. Terragrunt's `get_env("SWITCHBOT_TOKEN", "")` will produce an empty string during plan and that is acceptable (plan does not execute Lambda code).

### No New Files

All changes are confined to `.github/workflows/terraform-ci.yml`. No new Terraform or Terragrunt files are needed.

### Dependencies (GitHub Actions)

| Action | Version | Purpose |
|---|---|---|
| `aws-actions/configure-aws-credentials` | `v4` | OIDC token exchange → AWS session |
| `aquasecurity/trivy-action` | `0.29.0` (pinned) | IaC security scanning |
| `actions/github-script` | `v7` | PR comment creation/update via GitHub API |
| `actions/upload-artifact` | `v4` | Store plan output files |

> Pinning `trivy-action` to a specific release (rather than `@master`) is recommended to avoid breaking changes. At time of writing `0.29.0` is the latest stable release; update to the newest at implementation time.

---

## Pre-Implementation: Manual Prerequisites

**These steps must be completed by a human with AWS console/CLI access before any workflow changes are implemented.**

### MANUAL STEP A: Create AWS OIDC Identity Provider

> This is a one-time AWS account setup. It cannot be automated in this workflow.

In the AWS console (IAM > Identity providers > Add provider):

- Provider type: OpenID Connect
- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

Using AWS CLI:
```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

**Verify**: `aws iam list-open-id-connect-providers` should show `token.actions.githubusercontent.com`.

### MANUAL STEP B: Create IAM Role for GitHub Actions

Create an IAM role `github-actions-smarthome-plan` (name is a suggestion) with the following trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<GITHUB_ORG>/<REPO_NAME>:*"
        }
      }
    }
  ]
}
```

Replace `<ACCOUNT_ID>`, `<GITHUB_ORG>`, and `<REPO_NAME>` with actual values.

Attach the following inline policy (minimum permissions for `terraform plan` + state access):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TerraformStateS3",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GetBucketVersioning"
      ],
      "Resource": [
        "arn:aws:s3:::smarthome-terraform-state-<ACCOUNT_ID>",
        "arn:aws:s3:::smarthome-terraform-state-<ACCOUNT_ID>/*"
      ]
    },
    {
      "Sid": "TerraformStateDynamoDB",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:DeleteItem",
        "dynamodb:DescribeTable"
      ],
      "Resource": "arn:aws:dynamodb:ap-northeast-1:<ACCOUNT_ID>:table/terraform-locks"
    },
    {
      "Sid": "TerraformPlanReadOnly",
      "Effect": "Allow",
      "Action": [
        "dynamodb:Describe*",
        "dynamodb:List*",
        "lambda:Get*",
        "lambda:List*",
        "cloudfront:Get*",
        "cloudfront:List*",
        "ecr:Describe*",
        "ecr:List*",
        "iam:Get*",
        "iam:List*",
        "logs:Describe*",
        "events:Describe*",
        "events:List*"
      ],
      "Resource": "*"
    }
  ]
}
```

> Note: The `TerraformPlanReadOnly` section covers the AWS resources managed by the four Terraform modules. Review and expand if new modules are added. The `iam:Get*` and `iam:List*` permissions are needed because Lambda execution roles are created by the Lambda module.

**Record the created role ARN for the next step.**

### MANUAL STEP C: Add GitHub Repository Secrets

In the GitHub repository settings (Settings > Secrets and variables > Actions > New repository secret):

| Secret name | Value |
|---|---|
| `AWS_ROLE_ARN` | ARN from Manual Step B (e.g., `arn:aws:iam::<ACCOUNT_ID>:role/github-actions-smarthome-plan`) |
| `AWS_ACCOUNT_ID` | 12-digit AWS account ID |
| `SWITCHBOT_DEVICE_ID` | SwitchBot device ID (needed so `get_env("SWITCHBOT_DEVICE_ID", "")` in lambda-api/terragrunt.hcl resolves; empty string also acceptable for plan) |

**Rollback for Manual Steps**: If the role is misconfigured, delete it and re-create. OIDC provider can be deleted and re-created (`aws iam delete-open-id-connect-provider`). GitHub secrets can be updated in place.

---

## Implementation Steps

### Step 1: Add `id-token: write` Permission to Workflow

**Purpose**: The workflow's top-level `permissions` block must include `id-token: write` to allow the OIDC token exchange with AWS.

**Actions**:

1. Open `.github/workflows/terraform-ci.yml`
2. Update the `permissions` block (currently at line 19-21):

```yaml
# BEFORE
permissions:
  contents: read
  pull-requests: write  # For commenting on PRs (future)
```

```yaml
# AFTER
permissions:
  contents: read
  pull-requests: write
  id-token: write   # Required for AWS OIDC authentication
```

**Completion Criteria**:
- [ ] `id-token: write` added to global permissions block
- [ ] No other changes to Phase 1 jobs

**Files Affected**:
- `.github/workflows/terraform-ci.yml` (modified, 1 line addition)

**Rollback**: Revert the single line addition. Phase 1 jobs are unaffected.

---

### Step 2: Add `terraform-plan` Job

**Purpose**: Run `terragrunt plan` sequentially for each of the 4 environments in dependency order, capture output, and upload as workflow artifacts.

**Dependency order** (from terragrunt.hcl dependency blocks):
1. `dynamodb` (no dependencies, base resource)
2. `lambda-api` (depends on dynamodb outputs)
3. `lambda-poller` (depends on dynamodb outputs)
4. `cloudfront` (no terraform dependencies on others)

> `lambda-api` and `lambda-poller` both depend on `dynamodb` but not on each other; however sequential execution is simpler and avoids race conditions on the DynamoDB lock table. Order: dynamodb → lambda-api → lambda-poller → cloudfront.

**Actions**:

Add the following job after `terragrunt-format` in the YAML file. This job has `needs: [terraform-format, terraform-validate, terragrunt-format]` so it only runs if Phase 1 passes.

```yaml
  terraform-plan:
    name: Terraform Plan
    runs-on: ubuntu-latest
    needs: [terraform-format, terraform-validate, terragrunt-format]
    if: github.event_name == 'pull_request'
    env:
      AWS_ACCOUNT_ID: ${{ secrets.AWS_ACCOUNT_ID }}
      SWITCHBOT_DEVICE_ID: ${{ secrets.SWITCHBOT_DEVICE_ID }}
      # SWITCHBOT_TOKEN and SWITCHBOT_SECRET intentionally omitted:
      # get_env() returns empty string, which is acceptable during plan.
    outputs:
      plan_exitcode: ${{ steps.plan_summary.outputs.exitcode }}
      plan_summary: ${{ steps.plan_summary.outputs.summary }}
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          role-session-name: github-actions-terraform-plan
          aws-region: ap-northeast-1

      - name: Verify AWS credentials
        run: aws sts get-caller-identity

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.14.8
          terraform_wrapper: false  # Required: wrapper interferes with output capture

      - name: Setup Terragrunt
        run: |
          TERRAGRUNT_VERSION=0.96.1
          wget -q https://github.com/gruntwork-io/terragrunt/releases/download/v${TERRAGRUNT_VERSION}/terragrunt_linux_amd64
          chmod +x terragrunt_linux_amd64
          sudo mv terragrunt_linux_amd64 /usr/local/bin/terragrunt
          terragrunt --version

      - name: Create plan output directory
        run: mkdir -p /tmp/tfplan

      - name: Plan - dynamodb
        id: plan_dynamodb
        run: |
          set +e
          terragrunt plan \
            -lock-timeout=5m \
            -no-color \
            -out=/tmp/tfplan/dynamodb.tfplan \
            2>&1 | tee /tmp/tfplan/dynamodb.txt
          EXIT_CODE=${PIPESTATUS[0]}
          echo "exit_code=$EXIT_CODE" >> $GITHUB_OUTPUT
          exit $EXIT_CODE
        working-directory: terraform/environments/prod/dynamodb

      - name: Plan - lambda-api
        id: plan_lambda_api
        run: |
          set +e
          terragrunt plan \
            -lock-timeout=5m \
            -no-color \
            -out=/tmp/tfplan/lambda-api.tfplan \
            2>&1 | tee /tmp/tfplan/lambda-api.txt
          EXIT_CODE=${PIPESTATUS[0]}
          echo "exit_code=$EXIT_CODE" >> $GITHUB_OUTPUT
          exit $EXIT_CODE
        working-directory: terraform/environments/prod/lambda-api

      - name: Plan - lambda-poller
        id: plan_lambda_poller
        run: |
          set +e
          terragrunt plan \
            -lock-timeout=5m \
            -no-color \
            -out=/tmp/tfplan/lambda-poller.tfplan \
            2>&1 | tee /tmp/tfplan/lambda-poller.txt
          EXIT_CODE=${PIPESTATUS[0]}
          echo "exit_code=$EXIT_CODE" >> $GITHUB_OUTPUT
          exit $EXIT_CODE
        working-directory: terraform/environments/prod/lambda-poller

      - name: Plan - cloudfront
        id: plan_cloudfront
        run: |
          set +e
          terragrunt plan \
            -lock-timeout=5m \
            -no-color \
            -out=/tmp/tfplan/cloudfront.tfplan \
            2>&1 | tee /tmp/tfplan/cloudfront.txt
          EXIT_CODE=${PIPESTATUS[0]}
          echo "exit_code=$EXIT_CODE" >> $GITHUB_OUTPUT
          exit $EXIT_CODE
        working-directory: terraform/environments/prod/cloudfront

      - name: Generate plan summary
        id: plan_summary
        if: always()
        run: |
          SUMMARY=""
          OVERALL_EXIT=0

          for ENV in dynamodb lambda-api lambda-poller cloudfront; do
            FILE="/tmp/tfplan/${ENV}.txt"
            if [ -f "$FILE" ]; then
              # Extract the final "Plan: X to add, Y to change, Z to destroy" line
              PLAN_LINE=$(grep -E "^Plan:|No changes\." "$FILE" | tail -1 || echo "Error reading plan")
              SUMMARY="${SUMMARY}\n- **${ENV}**: ${PLAN_LINE}"
            else
              SUMMARY="${SUMMARY}\n- **${ENV}**: Plan did not run"
              OVERALL_EXIT=1
            fi
          done

          # Check if any plan step failed
          if [ "${{ steps.plan_dynamodb.outputs.exit_code }}" != "0" ] || \
             [ "${{ steps.plan_lambda_api.outputs.exit_code }}" != "0" ] || \
             [ "${{ steps.plan_lambda_poller.outputs.exit_code }}" != "0" ] || \
             [ "${{ steps.plan_cloudfront.outputs.exit_code }}" != "0" ]; then
            OVERALL_EXIT=1
          fi

          # Write to output (multiline safe via EOF delimiter)
          {
            echo 'summary<<EOF'
            echo -e "$SUMMARY"
            echo 'EOF'
          } >> $GITHUB_OUTPUT

          echo "exitcode=$OVERALL_EXIT" >> $GITHUB_OUTPUT
          exit $OVERALL_EXIT

      - name: Upload plan artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: terraform-plan-${{ github.event.pull_request.number }}-${{ github.run_number }}
          path: /tmp/tfplan/*.txt
          retention-days: 7
          if-no-files-found: warn
```

**Important implementation notes**:

- `terraform_wrapper: false` is critical. The `hashicorp/setup-terraform@v3` wrapper wraps `terraform` binary output with annotations. This breaks output capture when using `tee`. Set to `false` explicitly.
- `set +e` combined with `${PIPESTATUS[0]}` captures the terraform exit code even when piped through `tee`. Without `set +e`, any failure in the pipe would stop the step immediately without saving output.
- `-lock-timeout=5m` prevents indefinite hanging if another process holds the DynamoDB lock.
- `-no-color` removes ANSI escape codes, which would corrupt the PR comment markdown.
- `.tfplan` binary files are NOT uploaded (only `.txt` text output). Binary plan files are not useful in GitHub artifact storage and may contain sensitive data. Future Phase 3 apply workflow should generate its own plan immediately before apply.

**Completion Criteria**:
- [ ] Job added with correct `needs` dependencies
- [ ] `if: github.event_name == 'pull_request'` condition present (does not run on push-to-main)
- [ ] All 4 environment plan steps defined in dependency order
- [ ] `terraform_wrapper: false` set
- [ ] Plan output captured to `/tmp/tfplan/*.txt`
- [ ] Artifacts uploaded with 7-day retention
- [ ] `plan_summary` output generated even on failure (`if: always()`)

**Files Affected**:
- `.github/workflows/terraform-ci.yml` (modified)

**Rollback**: Delete the `terraform-plan` job block. Phase 1 jobs are not affected.

---

### Step 3: Add `security-scan` Job (Trivy)

**Purpose**: Scan the `terraform/` directory for IaC misconfigurations using Trivy. This job runs in parallel with `terraform-plan` (both depend on Phase 1 passing, but not on each other).

**Actions**:

Add the following job after `terraform-plan` (or alongside it, since it is independent):

```yaml
  security-scan:
    name: Trivy Security Scan
    runs-on: ubuntu-latest
    needs: [terraform-format, terraform-validate, terragrunt-format]
    if: github.event_name == 'pull_request'
    permissions:
      contents: read
      security-events: write  # Required for SARIF upload to GitHub security tab
    outputs:
      scan_result: ${{ steps.trivy_summary.outputs.result }}
      critical_high_count: ${{ steps.trivy_summary.outputs.critical_high_count }}
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Run Trivy IaC scan (SARIF output for security tab)
        uses: aquasecurity/trivy-action@0.29.0
        with:
          scan-type: config
          scan-ref: terraform/
          format: sarif
          output: trivy-results.sarif
          severity: CRITICAL,HIGH,MEDIUM
          exit-code: '0'  # Do not fail here; we control failure in next step

      - name: Upload SARIF to GitHub Security tab
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: trivy-results.sarif
        continue-on-error: true  # Security tab upload is best-effort

      - name: Run Trivy IaC scan (table output for PR comment)
        id: trivy_table
        uses: aquasecurity/trivy-action@0.29.0
        with:
          scan-type: config
          scan-ref: terraform/
          format: table
          output: trivy-table.txt
          severity: CRITICAL,HIGH,MEDIUM
          exit-code: '0'

      - name: Evaluate Trivy results
        id: trivy_summary
        if: always()
        run: |
          if [ ! -f trivy-table.txt ]; then
            echo "result=error" >> $GITHUB_OUTPUT
            echo "critical_high_count=unknown" >> $GITHUB_OUTPUT
            exit 1
          fi

          # Count CRITICAL and HIGH findings
          CRITICAL_COUNT=$(grep -c "CRITICAL" trivy-table.txt || echo 0)
          HIGH_COUNT=$(grep -c "HIGH" trivy-table.txt || echo 0)
          MEDIUM_COUNT=$(grep -c "MEDIUM" trivy-table.txt || echo 0)
          TOTAL_CRITICAL_HIGH=$((CRITICAL_COUNT + HIGH_COUNT))

          echo "critical_high_count=$TOTAL_CRITICAL_HIGH" >> $GITHUB_OUTPUT

          if [ "$TOTAL_CRITICAL_HIGH" -gt 0 ]; then
            echo "result=failed" >> $GITHUB_OUTPUT
            echo "Found $TOTAL_CRITICAL_HIGH CRITICAL/HIGH findings. Failing."
            exit 1
          else
            echo "result=passed" >> $GITHUB_OUTPUT
            echo "No CRITICAL or HIGH findings. MEDIUM count: $MEDIUM_COUNT"
            exit 0
          fi

      - name: Upload Trivy table artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: trivy-results-${{ github.event.pull_request.number }}-${{ github.run_number }}
          path: |
            trivy-results.sarif
            trivy-table.txt
          retention-days: 7
```

**Important implementation notes**:

- Trivy is run twice: once for SARIF output (GitHub security tab integration) and once for table output (human-readable for PR comment). This is intentional.
- The `security-events: write` permission is needed for SARIF upload. It is scoped only to the `security-scan` job via job-level permissions (overrides the global block for this job only).
- `continue-on-error: true` on SARIF upload prevents scan results from being lost if the security tab upload fails (e.g., if the GitHub Advanced Security feature is not enabled on the repository).
- `exit-code: '0'` on both Trivy steps prevents Trivy itself from failing the step; the `evaluate` step controls CI failure based on severity counts. This gives us control to warn on MEDIUM without failing.

**Completion Criteria**:
- [ ] `security-scan` job runs in parallel with `terraform-plan` (both `needs` Phase 1 jobs only)
- [ ] `if: github.event_name == 'pull_request'` condition present
- [ ] SARIF output uploaded to GitHub security tab
- [ ] Table output saved as artifact
- [ ] CI fails on CRITICAL/HIGH, passes with MEDIUM warning
- [ ] `scan_result` and `critical_high_count` outputs propagated for PR comment

**Files Affected**:
- `.github/workflows/terraform-ci.yml` (modified)

**Rollback**: Delete the `security-scan` job block.

---

### Step 4: Add `pr-comment` Job

**Purpose**: Aggregate plan results and Trivy scan results and post (or update) a single comment on the PR. This job runs after both `terraform-plan` and `security-scan` complete.

**Comment behavior**: The job finds any existing comment from `github-actions[bot]` that contains the marker string `<!-- terraform-plan-comment -->` and replaces it. If no existing comment is found, a new comment is created. This prevents comment spam on PRs with multiple pushes.

**Actions**:

Add the following job:

```yaml
  pr-comment:
    name: Post Plan Comment
    runs-on: ubuntu-latest
    needs: [terraform-plan, security-scan]
    if: |
      always() &&
      github.event_name == 'pull_request' &&
      (needs.terraform-plan.result == 'success' ||
       needs.terraform-plan.result == 'failure') &&
      (needs.security-scan.result == 'success' ||
       needs.security-scan.result == 'failure')
    steps:
      - name: Download plan artifacts
        uses: actions/download-artifact@v4
        with:
          name: terraform-plan-${{ github.event.pull_request.number }}-${{ github.run_number }}
          path: /tmp/tfplan
        continue-on-error: true  # Artifact may not exist if plan job was skipped

      - name: Download Trivy artifacts
        uses: actions/download-artifact@v4
        with:
          name: trivy-results-${{ github.event.pull_request.number }}-${{ github.run_number }}
          path: /tmp/trivy
        continue-on-error: true

      - name: Build comment body
        id: build_comment
        run: |
          PLAN_STATUS="${{ needs.terraform-plan.result }}"
          SCAN_STATUS="${{ needs.security-scan.result }}"
          PLAN_SUMMARY="${{ needs.terraform-plan.outputs.plan_summary }}"
          CRITICAL_HIGH="${{ needs.security-scan.outputs.critical_high_count }}"
          SCAN_RESULT="${{ needs.security-scan.outputs.scan_result }}"

          # Plan status icon
          if [ "$PLAN_STATUS" = "success" ]; then
            PLAN_ICON="✅"
          else
            PLAN_ICON="❌"
          fi

          # Security icon
          if [ "$SCAN_RESULT" = "passed" ]; then
            SCAN_ICON="✅"
          elif [ "$SCAN_RESULT" = "failed" ]; then
            SCAN_ICON="❌"
          else
            SCAN_ICON="⚠️"
          fi

          # Build comment sections
          COMMENT="<!-- terraform-plan-comment -->
          ## Terraform Plan Results

          **Commit**: \`${{ github.event.pull_request.head.sha }}\`
          **Workflow run**: [${{ github.run_number }}](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }})

          ### ${PLAN_ICON} Plan Summary

          ${PLAN_SUMMARY}

          ### ${SCAN_ICON} Security Scan (Trivy)

          "

          # Append Trivy detail (truncated to keep within 65KB limit)
          if [ -f /tmp/trivy/trivy-table.txt ]; then
            TRIVY_CONTENT=$(cat /tmp/trivy/trivy-table.txt)
            TRIVY_LINES=$(echo "$TRIVY_CONTENT" | wc -l)
            if [ "$TRIVY_LINES" -gt 100 ]; then
              TRIVY_CONTENT=$(echo "$TRIVY_CONTENT" | head -100)
              TRIVY_CONTENT="${TRIVY_CONTENT}

          ... (truncated, see full results in workflow artifacts)"
            fi
            COMMENT="${COMMENT}
          <details>
          <summary>Trivy findings (CRITICAL: ${CRITICAL_HIGH} CRITICAL+HIGH)</summary>

          \`\`\`
          ${TRIVY_CONTENT}
          \`\`\`

          </details>"
          else
            COMMENT="${COMMENT}
          Trivy scan results not available. See workflow artifacts."
          fi

          # Append plan details per environment (truncated if too large)
          COMMENT="${COMMENT}

          ### Plan Details by Environment
          "

          TOTAL_CHARS=${#COMMENT}
          CHAR_LIMIT=60000  # Leave 5KB buffer below GitHub's 65536 limit

          for ENV in dynamodb lambda-api lambda-poller cloudfront; do
            if [ -f "/tmp/tfplan/${ENV}.txt" ]; then
              ENV_PLAN=$(cat "/tmp/tfplan/${ENV}.txt")
              ENV_CHARS=${#ENV_PLAN}
              if [ $((TOTAL_CHARS + ENV_CHARS + 200)) -lt $CHAR_LIMIT ]; then
                COMMENT="${COMMENT}
          <details>
          <summary>${ENV}</summary>

          \`\`\`hcl
          ${ENV_PLAN}
          \`\`\`

          </details>
          "
                TOTAL_CHARS=$((TOTAL_CHARS + ENV_CHARS + 200))
              else
                COMMENT="${COMMENT}
          - **${ENV}**: Plan output too large to display inline. See [workflow artifacts](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}).
          "
              fi
            fi
          done

          # Write full comment to file to avoid shell escaping issues
          echo "$COMMENT" > /tmp/comment.md

      - name: Post or update PR comment
        uses: actions/github-script@v7
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          script: |
            const fs = require('fs');
            const commentBody = fs.readFileSync('/tmp/comment.md', 'utf8');
            const marker = '<!-- terraform-plan-comment -->';
            const prNumber = context.payload.pull_request.number;

            // Find existing comment with our marker
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: prNumber,
            });

            const existingComment = comments.find(
              c => c.user.login === 'github-actions[bot]' && c.body.includes(marker)
            );

            if (existingComment) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existingComment.id,
                body: commentBody,
              });
              console.log(`Updated existing comment ${existingComment.id}`);
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: prNumber,
                body: commentBody,
              });
              console.log('Created new comment');
            }
```

**Important implementation notes**:

- The `<!-- terraform-plan-comment -->` HTML comment marker is the key for finding and replacing the existing comment. It is invisible in the rendered GitHub UI.
- Comment is written to a file (`/tmp/comment.md`) first rather than passed directly through environment variables. This avoids shell quoting and newline escaping issues with complex multiline strings.
- The `CHAR_LIMIT=60000` (not 65536) provides a 5 KB buffer for the GitHub API overhead and JSON encoding.
- The `if: always()` combined with explicit result checks ensures the comment is posted even when either upstream job fails, which is critical for communicating failure reasons to the PR author.
- `actions/github-script@v7` uses the automatically provided `GITHUB_TOKEN` - no additional secrets needed.

**Completion Criteria**:
- [ ] `pr-comment` job added with `needs: [terraform-plan, security-scan]`
- [ ] `if: always()` with upstream result checks (runs on failure too)
- [ ] Comment marker `<!-- terraform-plan-comment -->` present for idempotent updates
- [ ] 60 KB truncation logic implemented for plan details
- [ ] Comment posted on first push, updated on subsequent pushes to same PR
- [ ] Trivy results included in comment with collapsible `<details>` section
- [ ] Plan details per environment included with collapsible `<details>` sections

**Files Affected**:
- `.github/workflows/terraform-ci.yml` (modified)

**Rollback**: Delete the `pr-comment` job block.

---

### Step 5: Update `summary` Job

**Purpose**: Extend the existing Phase 1 `summary` job to also aggregate Phase 2 job results. The summary job is what branch protection rules check, so it must accurately reflect all job results.

**Actions**:

Update the existing `summary` job:

```yaml
# BEFORE
  summary:
    name: CI Summary
    runs-on: ubuntu-latest
    needs: [terraform-format, terraform-validate, terragrunt-format]
    if: always()
    steps:
      - name: Check CI Status
        run: |
          if [ "${{ needs.terraform-format.result }}" != "success" ] || \
             [ "${{ needs.terraform-validate.result }}" != "success" ] || \
             [ "${{ needs.terragrunt-format.result }}" != "success" ]; then
            echo "❌ Terraform CI failed"
            echo ""
            echo "terraform-format: ${{ needs.terraform-format.result }}"
            echo "terraform-validate: ${{ needs.terraform-validate.result }}"
            echo "terragrunt-format: ${{ needs.terragrunt-format.result }}"
            exit 1
          else
            echo "✅ All Terraform CI checks passed!"
            exit 0
          fi
```

```yaml
# AFTER
  summary:
    name: CI Summary
    runs-on: ubuntu-latest
    needs: [terraform-format, terraform-validate, terragrunt-format, terraform-plan, security-scan]
    if: always()
    steps:
      - name: Check CI Status
        run: |
          FAILED=0

          echo "=== Phase 1: Format & Validate ==="
          echo "terraform-format:   ${{ needs.terraform-format.result }}"
          echo "terraform-validate: ${{ needs.terraform-validate.result }}"
          echo "terragrunt-format:  ${{ needs.terragrunt-format.result }}"

          echo ""
          echo "=== Phase 2: Plan & Security (PR only) ==="
          echo "terraform-plan:     ${{ needs.terraform-plan.result }}"
          echo "security-scan:      ${{ needs.security-scan.result }}"

          # Phase 1 failures always block
          if [ "${{ needs.terraform-format.result }}" != "success" ] || \
             [ "${{ needs.terraform-validate.result }}" != "success" ] || \
             [ "${{ needs.terragrunt-format.result }}" != "success" ]; then
            FAILED=1
          fi

          # Phase 2 failures block only on PR (skipped = ok on push-to-main)
          if [ "${{ needs.terraform-plan.result }}" = "failure" ] || \
             [ "${{ needs.security-scan.result }}" = "failure" ]; then
            FAILED=1
          fi

          if [ "$FAILED" = "1" ]; then
            echo ""
            echo "❌ Terraform CI failed. See individual job logs for details."
            exit 1
          else
            echo ""
            echo "✅ All applicable Terraform CI checks passed!"
            exit 0
          fi
```

**Important note**: The summary job uses `result == 'failure'` rather than `!= 'success'` for Phase 2 jobs. This is because when the workflow runs on push-to-main, Phase 2 jobs have `if: github.event_name == 'pull_request'` and will be in state `skipped`. `skipped != success` would cause false failures. `skipped != failure` correctly passes through.

**Completion Criteria**:
- [ ] `summary` job `needs` array includes `terraform-plan` and `security-scan`
- [ ] Phase 1 failure logic unchanged
- [ ] Phase 2 failure uses `== 'failure'` not `!= 'success'` to handle skipped state
- [ ] Summary output clearly labels Phase 1 and Phase 2 results

**Files Affected**:
- `.github/workflows/terraform-ci.yml` (modified)

**Rollback**: Revert `needs` array and failure logic to Phase 1 version.

---

### Step 6: Add `security-events: write` Global Permission (or Verify Job-Level Scope)

**Purpose**: The `security-scan` job needs `security-events: write` for SARIF upload. This can be granted at job level (overrides global) or added to the global `permissions` block.

**Decision**: Job-level permission is preferred (principle of least privilege - only the Trivy scan job needs security-events write access).

**Actions**:

Verify the `security-scan` job has the job-level permissions block:

```yaml
  security-scan:
    name: Trivy Security Scan
    runs-on: ubuntu-latest
    needs: [terraform-format, terraform-validate, terragrunt-format]
    if: github.event_name == 'pull_request'
    permissions:                      # Job-level override
      contents: read
      security-events: write          # For SARIF upload
    ...
```

> The global `permissions` block at the workflow level does NOT need to include `security-events: write`. Job-level permissions override (not merge with) the global block for that specific job, so `contents: read` must be re-stated in the job-level block.

**Completion Criteria**:
- [ ] `security-scan` job has explicit job-level `permissions` block
- [ ] `security-events: write` present at job level only (not global)
- [ ] `contents: read` re-stated in job-level permissions block

**Files Affected**:
- `.github/workflows/terraform-ci.yml` (modified, no new lines, already included in Step 3 YAML)

---

### Step 7: Local Validation and Dry-Run

**Purpose**: Validate the YAML syntax and logic before pushing. This step is a developer activity.

**Actions**:

1. Validate YAML syntax locally:
   ```bash
   # Install yamllint if not available
   pip install yamllint
   yamllint .github/workflows/terraform-ci.yml
   ```

2. Check GitHub Actions workflow syntax using the GitHub CLI:
   ```bash
   gh workflow view terraform-ci.yml
   ```

3. Verify the completed workflow file structure matches the expected job graph:
   ```
   terraform-format ─────────────────────────────────────────── summary
   terraform-validate (x4) ──────────────────────────────────── summary
   terragrunt-format ──────┬──── terraform-plan ─────────────── summary
                           │                    \
                           │                     ── pr-comment
                           └──── security-scan ─/
   ```

4. Count total lines in the updated workflow to ensure no accidental truncation.

**Completion Criteria**:
- [ ] YAML is valid (no syntax errors)
- [ ] Job dependency graph matches expected structure
- [ ] File saved without truncation

---

### Step 8: Integration Testing on a Feature Branch

**Purpose**: Verify the complete workflow end-to-end with real AWS authentication before merging.

**Actions**:

1. Create a feature branch:
   ```bash
   git checkout -b feature/terraform-cicd-phase2
   ```

2. Commit the workflow changes:
   ```bash
   git add .github/workflows/terraform-ci.yml
   git commit -m "ci: Add AWS OIDC auth, terraform plan, Trivy scan, PR comments (Phase 2)"
   git push origin feature/terraform-cicd-phase2
   ```

3. Open a PR and observe the Actions run. Verify:
   - [ ] Phase 1 jobs still pass
   - [ ] `terraform-plan` job appears and authenticates to AWS successfully (`Verify AWS credentials` step shows account info)
   - [ ] All 4 environment plan steps complete
   - [ ] Plan output artifacts uploaded (check Actions > Artifacts)
   - [ ] `security-scan` job completes
   - [ ] Trivy SARIF uploaded to Security tab (GitHub > Security > Code scanning)
   - [ ] `pr-comment` job posts a comment on the PR
   - [ ] Comment contains plan summary and Trivy results
   - [ ] `summary` job reports success

4. Push a second commit to the same PR branch and verify:
   - [ ] The plan comment is **updated** (not a new comment added)
   - [ ] New commit SHA appears in the comment

5. Test failure scenario: Introduce a deliberate Terraform misconfiguration (e.g., add a security group with port 0.0.0.0/0 open) to a test file, push, and verify Trivy fails CI and the comment reflects the failure. Revert before merging.

**Completion Criteria**:
- [ ] All jobs pass on clean PR
- [ ] Comment posted and updated correctly
- [ ] Failure case shows correct error in comment and CI fails
- [ ] No credential leakage visible in logs

**Rollback**: Close the PR and delete the feature branch without merging.

---

## Test Strategy

### Integration Tests (GitHub Actions)

These are the primary tests - the workflow is tested by running it.

**Test Case 1 - Clean plan, no Trivy findings**:
- Trigger: Open PR with minor Terraform comment change
- Expected: All jobs green, comment shows "No changes" for all environments

**Test Case 2 - Plan with changes**:
- Trigger: Open PR with a legitimate Terraform change (e.g., update a tag value)
- Expected: Plan shows changes, comment shows diff summary

**Test Case 3 - Trivy finding (MEDIUM)**:
- Trigger: Introduce a MEDIUM severity misconfiguration
- Expected: CI passes, comment shows Trivy warning with finding details

**Test Case 4 - Trivy finding (HIGH/CRITICAL)**:
- Trigger: Introduce a HIGH severity misconfiguration (e.g., unencrypted S3 bucket)
- Expected: CI fails, comment shows failure and finding details

**Test Case 5 - Comment update on second push**:
- Trigger: Two commits on same PR
- Expected: Only one PR comment exists, updated with second run's results

**Test Case 6 - Push to main (no Phase 2 jobs)**:
- Trigger: Merge PR to main with terraform changes
- Expected: Only Phase 1 jobs run; `summary` passes (skipped Phase 2 jobs not counted as failure)

**Test Case 7 - AWS auth failure (negative test)**:
- Trigger: Temporarily set `AWS_ROLE_ARN` secret to invalid value
- Expected: `terraform-plan` fails at credential step, PR comment shows failure
- Note: Restore correct value immediately after test

### Manual Verification Checklist

- [ ] PR comment renders correctly in GitHub UI (no broken markdown)
- [ ] `<details>` sections expand correctly
- [ ] Artifact links in comment are valid and accessible
- [ ] GitHub Security tab shows Trivy SARIF results
- [ ] No AWS credentials appear anywhere in workflow logs (sensitive=false for account ID is acceptable)

---

## Known Risks and Constraints

### Risk 1: State Lock During CI

- **Description**: If a developer runs `terraform apply` locally at the same time as CI runs `terraform plan`, the DynamoDB lock table will cause one operation to wait.
- **Impact**: Medium - CI job may hang for up to 5 minutes then fail
- **Mitigation**: `-lock-timeout=5m` is set. CI plan is read-only so it does not hold the lock long. Document this behavior. Future Phase 3 should handle lock conflicts explicitly.

### Risk 2: S3 State Bucket Does Not Exist Yet

- **Description**: The S3 bucket `smarthome-terraform-state-<ACCOUNT_ID>` and DynamoDB table `terraform-locks` must exist before `terragrunt plan` can run. If the infrastructure has never been applied, these do not exist.
- **Impact**: High - `terraform-plan` job will fail at init step
- **Mitigation**: Confirm S3 bucket and DynamoDB table exist before running Phase 2. If they do not, either: (a) create them manually, or (b) add a workflow step that creates them with `aws s3 mb` and `aws dynamodb create-table` if they do not exist.

<!-- ANSWERED: Q8 - S3 state bucket already exists. No action needed. -->

### Risk 3: Terragrunt Dependency Resolution During Plan

- **Description**: When planning `lambda-api`, Terragrunt reads the `dependency "dynamodb"` block and tries to fetch the DynamoDB `outputs`. If DynamoDB has never been applied, there are no outputs in state.
- **Impact**: High - `terraform-plan` for lambda-api may fail with "output not found" error
- **Mitigation**: Add `mock_outputs` to the dependency blocks in `lambda-api/terragrunt.hcl` and `lambda-poller/terragrunt.hcl` for CI purposes.

The terragrunt.hcl files for `lambda-api` and `lambda-poller` should be updated to include mock outputs:

```hcl
# terraform/environments/prod/lambda-api/terragrunt.hcl
dependency "dynamodb" {
  config_path = "../dynamodb"
  mock_outputs = {
    table_arn  = "arn:aws:dynamodb:ap-northeast-1:123456789012:table/mock-table"
    table_name = "mock-table"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
}
```

```hcl
# terraform/environments/prod/lambda-poller/terragrunt.hcl
dependency "dynamodb" {
  config_path = "../dynamodb"
  mock_outputs = {
    table_arn  = "arn:aws:dynamodb:ap-northeast-1:123456789012:table/mock-table"
    table_name = "mock-table"
  }
  mock_outputs_allowed_terraform_commands = ["validate", "plan"]
}
```

> This means Step 2 also requires modifying two terragrunt.hcl files. Add this to the files affected list.

**Completion Criteria for Risk 3 mitigation**:
- [ ] `mock_outputs` added to `lambda-api/terragrunt.hcl`
- [ ] `mock_outputs` added to `lambda-poller/terragrunt.hcl`
- [ ] `mock_outputs_allowed_terraform_commands = ["validate", "plan"]` set (not "apply")

### Risk 4: GitHub Comment 65 KB Limit

- **Description**: If a plan changes many resources simultaneously, the combined plan output could exceed 65,536 characters.
- **Impact**: Medium - GitHub API returns 422 error, comment not posted
- **Mitigation**: `CHAR_LIMIT=60000` check in Step 4 truncates per-environment plan details. Plan summary line is always included. Full output available in workflow artifacts.

### Risk 5: Trivy Action Version Drift

- **Description**: Using `@master` for `trivy-action` risks breaking changes when Trivy releases new versions.
- **Impact**: Medium - workflow may break unexpectedly
- **Mitigation**: Pin to specific version (e.g., `@0.29.0`). Update the version number at implementation time to the latest stable release. Add a note to review quarterly.

### Risk 6: OIDC Role Permissions Too Broad or Too Narrow

- **Description**: The IAM policy in Manual Step B may be missing permissions (causing plan failures) or may be overly broad (security risk).
- **Impact**: High if permissions are wrong
- **Mitigation**: Start with the policy in Manual Step B. If `terraform plan` fails with `AccessDenied`, check CloudTrail for the denied API call and add the minimum required permission. Do not use `*` actions.

---

## Alternative Approaches Considered

### Approach A: `terragrunt run-all plan` (Not Selected)

- **Pros**: Single command handles all environments and resolves dependencies automatically. Simpler workflow YAML.
- **Cons**: Output from all environments is interleaved, making it harder to parse per-environment results. Error attribution is less clear. Less control over lock timeout per environment.
- **Decision**: Not chosen for Phase 2. Sequential per-environment approach is easier to debug and attribute failures. Can be revisited in Phase 3.

### Approach B: Sequential `terragrunt plan` per environment (Selected)

- **Pros**: Clear output per environment. Easy to see which environment failed. Straightforward lock timeout per step.
- **Cons**: More YAML boilerplate. Does not automatically handle dependency resolution (mitigated by mock_outputs).
- **Decision**: Selected for Phase 2 as the simpler, more debuggable approach.

### Approach C: Use `dflook/terraform-github-actions` (Not Selected)

- **Pros**: Turnkey solution for plan-and-comment workflow. Handles 65KB limit, comment updates, etc.
- **Cons**: External action dependency. Less transparent about what it does. Does not support Terragrunt natively. Black-box behaviour harder to debug.
- **Decision**: Not chosen. The custom implementation gives full control and visibility.

### Approach D: SARIF-only for Trivy (Not Selected for comments)

- **Pros**: GitHub security tab integration is the "official" way.
- **Cons**: Security tab requires GitHub Advanced Security (paid feature for private repos). Not all team members may check the security tab.
- **Decision**: Use both SARIF (for security tab when available) AND table output (for PR comment, always visible). `continue-on-error: true` on SARIF upload handles cases where Advanced Security is not enabled.

---

## Post-Implementation Tasks

- [ ] Update `terraform/README.md` to document Phase 2 CI capabilities (plan on PR, Trivy, PR comments)
- [ ] Update `docs/SECURITY.md` to document the OIDC role and its permissions
- [ ] Update `ARCHITECTURE.md` if it documents CI/CD
- [ ] Move this plan to `docs/exec-plans/completed/`
- [ ] Create retrospective document noting any issues encountered
- [ ] Consider adding the `summary` job as a required status check in branch protection rules (GitHub Settings > Branches > main > Required status checks > "CI Summary")
- [ ] Schedule a quarterly review of pinned Trivy action version

---

## Workflow File Final Structure (Reference)

After all steps are complete, `.github/workflows/terraform-ci.yml` will have this job structure:

```yaml
name: Terraform CI

on:
  pull_request:        # Phase 1 + Phase 2 jobs
    paths: [...]
  push:
    branches: [main]
    paths: [...]       # Phase 1 jobs only (Phase 2 has if: pull_request condition)

permissions:           # Global (minimum)
  contents: read
  pull-requests: write
  id-token: write      # NEW for OIDC

jobs:
  terraform-format:    # Phase 1 (unchanged)
  terraform-validate:  # Phase 1 (unchanged, matrix x4)
  terragrunt-format:   # Phase 1 (unchanged)

  terraform-plan:      # Phase 2 NEW - needs Phase 1, PR only
  security-scan:       # Phase 2 NEW - needs Phase 1, PR only, job-level security-events:write
  pr-comment:          # Phase 2 NEW - needs terraform-plan + security-scan, always(), PR only

  summary:             # UPDATED - now needs all 6 upstream jobs
```

**Estimated total workflow execution time on PR**:
- Phase 1 jobs (parallel): ~2-3 minutes
- `terraform-plan` (sequential): ~5-6 minutes (1-1.5 min per environment)
- `security-scan` (parallel with plan): ~1 minute
- `pr-comment` (after plan + scan): ~30 seconds
- **Total wall-clock time: ~8-10 minutes**

---

## References

- [Research Document](./terraform-cicd-phase2-research.md)
- [Phase 1 Plan](../completed/terraform-cicd-plan.md)
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [docs/SECURITY.md](../../docs/SECURITY.md)
- [GitHub OIDC Documentation](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
- [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials)
- [Terragrunt mock_outputs](https://terragrunt.gruntwork.io/docs/reference/config-blocks-and-attributes/#dependency)
- [aquasecurity/trivy-action](https://github.com/aquasecurity/trivy-action)
- [actions/github-script](https://github.com/actions/github-script)

---

**Planner**: Claude Code (harness-planner)
**Planning Date**: 2026-03-29
**Next Step**: Human review and annotation, then harness-executor to implement
