#!/bin/bash
set -e

PLATFORM="${1:-android}"
PROFILE="${2:-preview}"

if [ -z "$EXPO_TOKEN" ]; then
  echo "Error: EXPO_TOKEN environment variable is not set"
  exit 1
fi

echo "Triggering EAS build..."
echo "  Platform: $PLATFORM"
echo "  Profile:  $PROFILE"
echo ""

cd "$(dirname "$0")/../artifacts/mobile"

EAS_NO_VCS=1 EXPO_TOKEN="$EXPO_TOKEN" pnpm exec eas build \
  --platform "$PLATFORM" \
  --profile "$PROFILE" \
  --non-interactive \
  --no-wait

echo ""
echo "Track all builds at: https://expo.dev/accounts/chabota_01/projects/mobile/builds"
