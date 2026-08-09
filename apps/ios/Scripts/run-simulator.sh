#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ios_root="$(cd "$script_dir/.." && pwd)"
device_name="${SHOP_OVERLAP_SIMULATOR_NAME:-ShopOverlap iPhone}"
device_type="${SHOP_OVERLAP_SIMULATOR_TYPE:-iPhone 17e}"
derived_data="$ios_root/DerivedData/Simulator"
bundle_id="jp.shopoverlap.app"
app_path="$derived_data/Build/Products/Debug-iphonesimulator/ShopOverlap.app"
secrets_file="$ios_root/Config/Secrets.xcconfig"

if [[ ! -s "$secrets_file" ]]; then
  echo "Missing $secrets_file. Copy Secrets.xcconfig.example and configure the iOS Maps key." >&2
  exit 1
fi
if ! grep -Eq '^GOOGLE_MAPS_IOS_API_KEY[[:space:]]*=[[:space:]]*[^[:space:]]+' "$secrets_file" ||
   grep -Eq '^GOOGLE_MAPS_IOS_API_KEY[[:space:]]*=[[:space:]]*replace-' "$secrets_file"; then
  echo "Configure GOOGLE_MAPS_IOS_API_KEY in $secrets_file before launching the app." >&2
  exit 1
fi

if [[ -n "${SHOP_OVERLAP_SIMULATOR_LOCATION+x}" ]]; then
  simulator_location="$SHOP_OVERLAP_SIMULATOR_LOCATION"
  if [[ ! "$simulator_location" =~ ^-?[0-9]+(\.[0-9]+)?,-?[0-9]+(\.[0-9]+)?$ ]]; then
    echo "SHOP_OVERLAP_SIMULATOR_LOCATION must be a latitude,longitude pair." >&2
    exit 1
  fi

  IFS=, read -r latitude longitude <<< "$simulator_location"
  if ! awk -v latitude="$latitude" -v longitude="$longitude" \
    'BEGIN { exit !(latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) }'; then
    echo "SHOP_OVERLAP_SIMULATOR_LOCATION is outside valid latitude/longitude ranges." >&2
    exit 1
  fi
fi

device_info() {
  xcrun simctl list devices available -j | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const name = process.argv[1];
      const devices = Object.values(JSON.parse(input).devices).flat();
      const device = devices.find((candidate) => candidate.name === name && candidate.isAvailable);
      if (device) process.stdout.write(`${device.udid}\t${device.state}`);
    });
  ' "$device_name"
}

IFS=$'\t' read -r device_id device_state <<< "$(device_info)"
if [[ -z "${device_id:-}" ]]; then
  echo "Creating $device_name ($device_type) on the latest compatible iOS runtime..."
  device_id="$(xcrun simctl create "$device_name" "$device_type")"
  device_state="Shutdown"
fi

case "$device_state" in
  Booted)
    ;;
  Booting)
    ;;
  Shutdown)
    xcrun simctl boot "$device_id"
    ;;
  *)
    xcrun simctl shutdown "$device_id" || true
    xcrun simctl boot "$device_id"
    ;;
esac
xcrun simctl bootstatus "$device_id" -b
if [[ -n "${SHOP_OVERLAP_SIMULATOR_LOCATION+x}" ]]; then
  xcrun simctl location "$device_id" set "$simulator_location"
fi

echo "Building ShopOverlap for $device_name..."
xcodebuild build -quiet \
  -project "$ios_root/ShopOverlap.xcodeproj" \
  -scheme ShopOverlap \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$device_id" \
  -derivedDataPath "$derived_data" \
  -skipPackagePluginValidation \
  CODE_SIGNING_ALLOWED=NO

open -a Simulator
xcrun simctl install "$device_id" "$app_path"
xcrun simctl terminate "$device_id" "$bundle_id" >/dev/null 2>&1 || true
xcrun simctl launch "$device_id" "$bundle_id"
echo "ShopOverlap launched on $device_name ($device_id)."
