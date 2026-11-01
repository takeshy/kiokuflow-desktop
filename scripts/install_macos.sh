#!/bin/sh
# Install the macOS app from GitHub Releases without sudo/build tools.
set -eu
repo=https://github.com/takeshy/kiokuflow-desktop
api=https://api.github.com/repos/takeshy/kiokuflow-desktop
version=${1:-latest}
if [ "$#" -gt 1 ]; then
  echo 'Usage: sh install_macos.sh [latest|vVERSION]' >&2
  exit 1
fi
if [ "$(uname -s)" != Darwin ]; then
  echo 'This installer is for macOS.' >&2
  exit 1
fi
case $(uname -m) in
arm64) asset=kiokuflow-desktop-darwin-arm64.app.zip ;;
*)
  echo 'Only Apple Silicon macOS releases are currently available.' >&2
  exit 1
  ;;
esac
legacy_asset=gemihub-desktop-darwin-arm64.app.zip
case "$version" in
latest) endpoint=$api/releases/latest ;;
'' | *[!A-Za-z0-9._-]* | .*)
  echo 'Invalid release version.' >&2
  exit 1
  ;;
v[0-9]*) endpoint=$api/releases/tags/$version ;;
*)
  echo 'Specify latest or a release tag such as v0.10.3.' >&2
  exit 1
  ;;
esac
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/kiokuflow-desktop-install.XXXXXX")
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM
curl -fsSL --proto '=https' --proto-redir '=https' "$endpoint" -o "$work_dir/release.json"
version=$(plutil -extract tag_name raw -o - "$work_dir/release.json")
case "$version" in
'' | *[!A-Za-z0-9._-]* | .*)
  echo 'Invalid release tag returned by GitHub.' >&2
  exit 1
  ;;
v[0-9]*) ;;
*)
  echo 'Invalid release tag returned by GitHub.' >&2
  exit 1
  ;;
esac
# macOS's built-in JSON parser avoids a dependency on jq or Python.
digest=
for candidate in "$asset" "$legacy_asset"; do
  index=0
  while name=$(plutil -extract "assets.$index.name" raw -o - "$work_dir/release.json" 2>/dev/null); do
    if [ "$name" = "$candidate" ]; then
      asset=$candidate
      digest=$(plutil -extract "assets.$index.digest" raw -o - "$work_dir/release.json")
      break
    fi
    index=$((index + 1))
  done
  if [ -n "$digest" ]; then break; fi
done
case "$digest" in
sha256:*) expected=${digest#sha256:} ;;
*)
  echo 'This release has no macOS app archive with a SHA-256 digest.' >&2
  exit 1
  ;;
esac
if [ "${#expected}" != 64 ]; then
  echo 'Invalid SHA-256 digest.' >&2
  exit 1
fi
case "$expected" in
*[!0-9a-f]*)
  echo 'Invalid SHA-256 digest.' >&2
  exit 1
  ;;
esac
echo "Downloading kiokuflow-desktop $version (Apple Silicon)..."
curl -fsSL --proto '=https' --proto-redir '=https' "$repo/releases/download/$version/$asset" -o "$work_dir/app.zip"
actual=$(shasum -a 256 "$work_dir/app.zip" | awk '{print $1}')
if [ "$actual" != "$expected" ]; then
  echo 'Checksum mismatch; nothing was installed.' >&2
  exit 1
fi
ditto -x -k "$work_dir/app.zip" "$work_dir/unpacked"
app="kiokuflow-desktop.app"
source_app="$work_dir/unpacked/$app"
if [ ! -d "$source_app" ] && [ -d "$work_dir/unpacked/GemiHub Desktop.app" ]; then
  source_app="$work_dir/unpacked/GemiHub Desktop.app"
fi
if [ ! -x "$source_app/Contents/MacOS/kiokuflow-desktop" ] && [ ! -x "$source_app/Contents/MacOS/gemihub-desktop" ]; then
  echo 'The release archive does not contain the expected app.' >&2
  exit 1
fi
codesign --verify --deep --strict "$source_app"
install_dir=${KIOKUFLOW_INSTALL_DIR:-${GEMIHUB_INSTALL_DIR:-"$HOME/Applications"}}
mkdir -p "$install_dir"
existing_app=$app
if [ ! -e "$install_dir/$existing_app" ] && [ ! -L "$install_dir/$existing_app" ]; then
  existing_app="GemiHub Desktop.app"
fi
if [ -e "$install_dir/$existing_app" ] || [ -L "$install_dir/$existing_app" ]; then
  backup=$(mktemp -d "$install_dir/kiokuflow-desktop.backup.XXXXXX")
  mv "$install_dir/$existing_app" "$backup/$existing_app"
  echo "Previous app saved at $backup/$existing_app"
fi
if ! mv "$source_app" "$install_dir/$app"; then
  if [ -n "${backup:-}" ]; then
    mv "$backup/$existing_app" "$install_dir/$existing_app"
  fi
  exit 1
fi
echo "Installed $version at $install_dir/$app"
echo "Open kiokuflow-desktop from Finder in $install_dir."
echo 'Quit and restart an older running version to use this update.'
