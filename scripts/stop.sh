#!/bin/bash
# EC2 インスタンスを停止する (コスト管理用)
# デモ終了後に実行。EIP は保持されるため再起動時に IP は変わらない。
#
# 使い方:
#   bash scripts/stop.sh

set -euo pipefail

STACK_NAME=${STACK_NAME:-seaman-demo}
AWS_REGION=${AWS_REGION:-ap-northeast-1}

log() { echo "[stop] $*"; }

INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" \
  --output text)

if [ -z "$INSTANCE_ID" ]; then
  echo "ERROR: スタック ${STACK_NAME} から InstanceId を取得できませんでした" >&2
  exit 1
fi

# 現在の状態確認
STATE=$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --region "$AWS_REGION" \
  --query "Reservations[0].Instances[0].State.Name" \
  --output text)

if [ "$STATE" = "stopped" ]; then
  log "インスタンス ${INSTANCE_ID} は既に停止済みです"
  exit 0
fi

log "インスタンス停止: $INSTANCE_ID (現在の状態: $STATE)"
aws ec2 stop-instances \
  --instance-ids "$INSTANCE_ID" \
  --region "$AWS_REGION" \
  --output table

log "停止待機中..."
aws ec2 wait instance-stopped \
  --instance-ids "$INSTANCE_ID" \
  --region "$AWS_REGION"

log "停止完了 ✓"
echo ""
echo "  ※ EIP は保持されます。再起動: bash scripts/start.sh"
echo "  ※ 完全削除:  bash scripts/deploy.sh delete"
