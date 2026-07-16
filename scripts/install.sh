#!/bin/sh
set -eu

REPOSITORY_URL="https://github.com/tunapro1234/outpost.git"
INSTALL_DIRECTORY="${INSTALL_DIRECTORY:-outpost}"

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git is required." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js 22 or newer is required." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Error: Node.js 22 or newer is required (found $(node --version))." >&2
  exit 1
fi

if [ -e "$INSTALL_DIRECTORY" ]; then
  echo "Error: install destination already exists: $INSTALL_DIRECTORY" >&2
  exit 1
fi

git clone "$REPOSITORY_URL" "$INSTALL_DIRECTORY"
cd "$INSTALL_DIRECTORY"
npm install

echo
echo "Outpost is installed in $INSTALL_DIRECTORY."
echo "Start it with:"
echo "  cd $INSTALL_DIRECTORY"
echo "  npm start"
echo "Then open http://localhost:3002"
