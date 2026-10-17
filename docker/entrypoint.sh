#!/bin/sh
# CiteLadder container entrypoint.
#
#   server  apply migrations, ensure the local workspace, then serve the API and app
#   runner  drain background work (crawls, audits, syncs) in a loop
#   *       run the given command
set -eu

data_dir="${CITELADDER_DATA_DIR:-/data}"
secrets="$data_dir/secrets.env"

# Generate the instance secrets once and keep them on the data volume, so a
# fresh install needs no hand-made keys. Values set in the environment win.
if [ ! -f "$secrets" ]; then
  umask 077
  node -e '
    const { randomBytes } = require("node:crypto");
    const key = () => randomBytes(48).toString("base64url");
    for (const name of ["ENCRYPTION_KEY", "API_KEY_PEPPER", "REFERRAL_HASH_SALT"])
      console.log(`${name}=${key()}`);
  ' > "$secrets.tmp"
  mv "$secrets.tmp" "$secrets"
fi
while IFS='=' read -r name value; do
  case "$name" in '' | \#*) continue ;; esac
  eval "current=\${$name:-}"
  [ -n "$current" ] || export "$name=$value"
done < "$secrets"

case "${1:-server}" in
  server)
    node src/cli/migrate.ts --wait-seconds 60
    node src/cli/bootstrap-account.ts
    exec node src/server.ts
    ;;
  runner)
    # A failing tick ends the loop so the container restarts and surfaces it.
    while true; do
      node src/tick.ts
      # Heartbeat for the container healthcheck: the last tick that succeeded.
      touch /tmp/runner-heartbeat
      sleep "${RUNNER_INTERVAL_SECONDS:-10}"
    done
    ;;
  *)
    exec "$@"
    ;;
esac
