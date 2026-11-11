#!/bin/sh
# 未显式配置的密钥在数据目录内生成并持久化，避免每次重启后 DevToken 变化、JWT 会话全部失效。
set -eu

DATA_DIR="${HC_DATA_DIR:-/data}"
SECRETS_FILE="$DATA_DIR/.secrets.env"
mkdir -p "$DATA_DIR"

gen() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

if [ -f "$SECRETS_FILE" ]; then
  # shellcheck disable=SC1090
  . "$SECRETS_FILE"
fi

changed=0
if [ -z "${HC_DEV_TOKEN:-}" ]; then
  if [ -z "${SAVED_DEV_TOKEN:-}" ]; then SAVED_DEV_TOKEN="$(gen 40)"; changed=1; fi
  HC_DEV_TOKEN="$SAVED_DEV_TOKEN"
  echo "[hypercraft] 使用自动生成的 DevToken（保存在 $SECRETS_FILE）: $HC_DEV_TOKEN"
fi
if [ -z "${HC_JWT_SECRET:-}" ]; then
  if [ -z "${SAVED_JWT_SECRET:-}" ]; then SAVED_JWT_SECRET="$(gen 64)"; changed=1; fi
  HC_JWT_SECRET="$SAVED_JWT_SECRET"
fi

if [ "$changed" = 1 ]; then
  umask 077
  {
    echo "SAVED_DEV_TOKEN=${SAVED_DEV_TOKEN:-}"
    echo "SAVED_JWT_SECRET=${SAVED_JWT_SECRET:-}"
  } > "$SECRETS_FILE"
fi

export HC_DEV_TOKEN HC_JWT_SECRET
exec "$@"
