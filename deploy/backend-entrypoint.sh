#!/bin/sh
set -eu

NODE_BIN='/usr/local/bin/node'
REPLICA_URL="${LITESTREAM_REPLICA_URL:-}"

# Fail-open: run backend even when replication is not configured or malformed.
if [ -z "${REPLICA_URL}" ]; then
  echo "LITESTREAM_REPLICA_URL not set; starting backend without Litestream replication."
  exec "$NODE_BIN" dist/server.js
fi

case "${REPLICA_URL}" in
  *://*)
    exec /usr/local/bin/litestream replicate -config /etc/litestream.yml -exec "$NODE_BIN dist/server.js"
    ;;
  *)
    echo "LITESTREAM_REPLICA_URL is invalid (${REPLICA_URL}); starting backend without Litestream replication."
    exec "$NODE_BIN" dist/server.js
    ;;
esac
