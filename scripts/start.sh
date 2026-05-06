#!/bin/bash
# EC2 インスタンスを起動する (コスト管理用)
# デモ前に実行。起動後、Ollama / VOICEVOX / Nginx が自動起動する。
#
# 使い方:
#   bash scripts/start.sh

set -euo pipefail

STACK_NAME=${STACK_NAME:-seaman-demo}
AWS_REGION=${AWS_REGION:-ap-northeast-1}

log() { echo "[start] $*"; }

# スタックから InstanceId を取得
INSTANCE_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" \
  --output text)

if [ -z "$INSTANCE_ID" ]; then
  echo "ERROR: スタック ${STACK_NAME} から InstanceId を取得できませんでした" >&2
  exit 1
fi

log "インスタンス起動: $INSTANCE_ID"
aws ec2 start-instances \
  --instance-ids "$INSTANCE_ID" \
  --region "$AWS_REGION" \
  --output table

log "起動待機中..."
aws ec2 wait instance-running \
  --instance-ids "$INSTANCE_ID" \
  --region "$AWS_REGION"

# SSM エージェントが応答するまで待機
log "SSM エージェント待機中 (最大 2 分)..."
for i in $(seq 1 24); do
  STATUS=$(aws ssm describe-instance-information \
    --filters "Key=InstanceIds,Values=${INSTANCE_ID}" \
    --region "$AWS_REGION" \
    --query "InstanceInformationList[0].PingStatus" \
    --output text 2>/dev/null || echo "")
  if [ "$STATUS" = "Online" ]; then
    log "SSM 接続可能 ✓"
    break
  fi
  sleep 5
done

# 現在の EIP を表示
EIP=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='PublicIP'].OutputValue" \
  --output text)

WEB_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='WebUrl'].OutputValue" \
  --output text)

log "起動完了"
echo ""
echo "  Public IP : $EIP"
echo "  Web URL   : $WEB_URL"
echo "  SSM 接続  : aws ssm start-session --target ${INSTANCE_ID} --region ${AWS_REGION}"
echo ""
echo "  ※ サービス起動まで 1〜2 分かかることがあります"
