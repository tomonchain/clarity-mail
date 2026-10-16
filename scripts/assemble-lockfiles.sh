#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
cat lockparts/desktop-package-lock.part* > desktop/package-lock.json
cat lockparts/package-lock.part* > package-lock.json
d=$(git hash-object desktop/package-lock.json)
p=$(git hash-object package-lock.json)
test "$d" = "1d5cb370e9cefb17eff00975186bec59c80fe038"
test "$p" = "204bc3eb4d273df91b277df4c84a46650ed43662"
echo "lockfiles restored"
