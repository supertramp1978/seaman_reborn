#!/bin/bash
# CloudFormation スタック デプロイスクリプト
# aws cloudformation create-stack / update-stack で YAML を直接アップロードする。
# (aws cloudformation deploy は使わない)
#
# 使い方:
#   bash scripts/deploy.sh              # create または update を自動判定
#   bash scripts/deploy.sh delete       # スタック削除
#   bash scripts/deploy.sh outputs      # Outputs 表示のみ
#
# 必須環境変数 (または下記デフォルト値を編集):
#   STACK_NAME, ASSET_BUCKET, ALLOWED_CIDR, DOMAIN_NAME,
#   CERTBOT_EMAIL, GIT_REPO, AWS_REGION

set -euo pipefail

# ─── 設定 (環境変数で上書き可) ────────────────────────────────────────
STACK_NAME=${STACK_NAME:-seaman-demo}
TEMPLATE=cloudformation/seaman-stack.yaml
AWS_REGION=${AWS_REGION:-ap-northeast-1}
ASSET_BUCKET=${ASSET_BUCKET:-}
ALLOWED_CIDR=${ALLOWED_CIDR:-0.0.0.0/0}
DOMAIN_NAME=${DOMAIN_NAME:-}
CERTBOT_EMAIL=${CERTBOT_EMAIL:-admin@example.com}
GIT_REPO=${GIT_REPO:-}
INSTANCE_TYPE=${INSTANCE_TYPE:-g5.xlarge}
SSM_DEPLOY_KEY_PARAM=${SSM_DEPLOY_KEY_PARAM:-/seaman/deploy-key}
SSM_HTPASSWD_PARAM=${SSM_HTPASSWD_PARAM:-/seaman/htpasswd}

# ─── カラー出力 ─────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_info()  { echo -e "${GREEN}[deploy]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
log_error() { echo -e "${RED}[error]${NC} $*" >&2; }

# ─── 必須パラメータ確認 ───────────────────────────────────────────────
check_required() {
  local missing=false
  [ -z "$ASSET_BUCKET" ]  && { log_error "ASSET_BUCKET を設定してください"; missing=true; }
  [ -z "$DOMAIN_NAME" ]   && { log_error "DOMAIN_NAME を設定してください";  missing=true; }
  [ -z "$GIT_REPO" ]      && { log_error "GIT_REPO を設定してください";     missing=true; }
  [ "$missing" = true ]   && exit 1
}

# ─── S3 へスクリプト・設定ファイルをアップロード ─────────────────────
upload_assets() {
  log_info "S3 へアセットをアップロード: s3://${ASSET_BUCKET}/"

  aws s3 cp scripts/setup-instance.sh \
    "s3://${ASSET_BUCKET}/scripts/setup-instance.sh" \
    --region "$AWS_REGION"

  aws s3 cp nginx/seaman.conf \
    "s3://${ASSET_BUCKET}/nginx/seaman.conf" \
    --region "$AWS_REGION"

  log_info "アップロード完了"
}

# ─── パラメータ文字列を組み立てる ────────────────────────────────────
build_params() {
  echo "\
ParameterKey=InstanceType,ParameterValue=${INSTANCE_TYPE} \
ParameterKey=AllowedCIDR,ParameterValue=${ALLOWED_CIDR} \
ParameterKey=DomainName,ParameterValue=${DOMAIN_NAME} \
ParameterKey=CertbotEmail,ParameterValue=${CERTBOT_EMAIL} \
ParameterKey=GitRepoSSHUrl,ParameterValue=${GIT_REPO} \
ParameterKey=SSMDeployKeyParam,ParameterValue=${SSM_DEPLOY_KEY_PARAM} \
ParameterKey=SSMHtpasswdParam,ParameterValue=${SSM_HTPASSWD_PARAM} \
ParameterKey=AssetBucket,ParameterValue=${ASSET_BUCKET}"
}

# ─── スタックが存在するか確認 ────────────────────────────────────────
stack_exists() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" &>/dev/null
}

# ─── スタック作成 ────────────────────────────────────────────────────
create_stack() {
  log_info "スタック作成: $STACK_NAME"

  # YAML を直接アップロード (--template-body file://)
  aws cloudformation create-stack \
    --stack-name "$STACK_NAME" \
    --template-body "file://${TEMPLATE}" \
    --parameters $(build_params) \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "$AWS_REGION" \
    --tags \
      Key=Project,Value=seaman-demo \
      Key=CreatedBy,Value=deploy-sh

  log_info "作成待機中... (EC2 起動 + Phase 1 セットアップに数分かかります)"
  aws cloudformation wait stack-create-complete \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION"

  log_info "スタック作成完了 ✓"
}

# ─── スタック更新 (CloudFormation パラメータ変更時) ──────────────────
update_stack() {
  log_info "スタック更新: $STACK_NAME"

  aws cloudformation update-stack \
    --stack-name "$STACK_NAME" \
    --template-body "file://${TEMPLATE}" \
    --parameters $(build_params) \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "$AWS_REGION" || {
      log_warn "変更なし、または update-stack エラー"
      return 0
  }

  log_info "更新待機中..."
  aws cloudformation wait stack-update-complete \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION"

  log_info "スタック更新完了 ✓"
}

# ─── Outputs 表示 ────────────────────────────────────────────────────
show_outputs() {
  log_info "=== Stack Outputs ==="
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[*].[OutputKey,OutputValue]" \
    --output table
}

# ─── アプリ再デプロイ (コード変更時) ─────────────────────────────────
redeploy_code() {
  local instance_id
  instance_id=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" \
    --output text)

  log_info "インスタンス ${instance_id} に git pull + nginx reload を送信"

  aws ssm send-command \
    --instance-ids "$instance_id" \
    --document-name AWS-RunShellScript \
    --parameters 'commands=["cd /opt/seaman-modern && git pull && systemctl reload nginx"]' \
    --region "$AWS_REGION" \
    --output table
}

# ─── スタック削除 ────────────────────────────────────────────────────
delete_stack() {
  log_warn "スタック削除: $STACK_NAME (全リソースが削除されます)"
  read -r -p "本当に削除しますか? [y/N] " confirm
  [ "$confirm" != "y" ] && { log_info "キャンセル"; exit 0; }

  aws cloudformation delete-stack \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION"

  log_info "削除待機中..."
  aws cloudformation wait stack-delete-complete \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION"

  log_info "スタック削除完了 ✓"
}

# ─── エントリポイント ───────────────────────────────────────────────
COMMAND=${1:-deploy}

case "$COMMAND" in
  deploy)
    check_required
    upload_assets
    if stack_exists; then
      update_stack
    else
      create_stack
    fi
    show_outputs
    ;;
  redeploy)
    redeploy_code
    ;;
  outputs)
    show_outputs
    ;;
  delete)
    delete_stack
    ;;
  *)
    echo "使い方: $0 [deploy|redeploy|outputs|delete]"
    exit 1
    ;;
esac
