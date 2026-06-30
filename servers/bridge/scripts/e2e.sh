#!/bin/bash
# Mobile Agent Bridge - E2E 验证脚本
# 前提：OpenCode serve 运行在 OPENCODE_URL（默认 localhost:4096）
# 用法：BRIDGE_PORT=8080 PASSWORD=test123 bash scripts/e2e.sh

BRIDGE_PORT=${BRIDGE_PORT:-8080}
PASSWORD=${PASSWORD:-"test123"}
BASE="ws://localhost:$BRIDGE_PORT/ws"

echo "=== Mobile Agent Bridge E2E 验证 ==="
echo "Bridge 端口: $BRIDGE_PORT"

# 1. 无 token 连接 → 应被拒绝
echo ""
echo "=== 1. 无 token 连接 → 应被拒绝 ==="
RESP=$(wscat -c "$BASE?token=bad" -x '{"type":"req","id":"1","method":"health.ping","params":{}}' 2>/dev/null)
echo "$RESP"
if echo "$RESP" | grep -q "unauthorized"; then
  echo "✅ 无 token 被正确拒绝"
else
  echo "❌ 预期 unauthorized"
fi

# 2. auth.login → 拿 token
echo ""
echo "=== 2. auth.login ==="
RESP=$(wscat -c "$BASE?token=ignored" -x '{"type":"req","id":"1","method":"auth.login","params":{"password":"'"$PASSWORD"'"}}' 2>/dev/null)
echo "$RESP"
TOKEN=$(echo "$RESP" | sed 's/.*"token":"\([^"]*\)".*/\1/')
if [ -n "$TOKEN" ]; then
  echo "✅ token 获取成功: ${TOKEN:0:20}..."
else
  echo "❌ 获取 token 失败"
  exit 1
fi

# 3. health.ping
echo ""
echo "=== 3. health.ping ==="
RESP=$(wscat -c "$BASE?token=$TOKEN" -x '{"type":"req","id":"2","method":"health.ping","params":{}}' 2>/dev/null)
echo "$RESP"
if echo "$RESP" | grep -q '"ok":true'; then
  echo "✅ health.ping 正常"
else
  echo "❌ health.ping 失败"
fi

# 4. 未知方法
echo ""
echo "=== 4. 未知方法 ==="
RESP=$(wscat -c "$BASE?token=$TOKEN" -x '{"type":"req","id":"3","method":"nonexistent","params":{}}' 2>/dev/null)
echo "$RESP"
if echo "$RESP" | grep -q "unknown method"; then
  echo "✅ 未知方法被正确拒绝"
else
  echo "❌ 预期 unknown method"
fi

# 5. 无效帧类型
echo ""
echo "=== 5. 无效帧类型 ==="
RESP=$(wscat -c "$BASE?token=$TOKEN" -x '{"type":"invalid","id":"4","method":"health.ping"}' 2>/dev/null)
echo "$RESP"
if echo "$RESP" | grep -q "invalid frame type"; then
  echo "✅ 无效帧类型被正确拒绝"
else
  echo "❌ 预期 invalid frame type"
fi

echo ""
echo "=== E2E 验证完成 ==="
