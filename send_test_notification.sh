#!/bin/bash

# Get the first booted simulator UDID
DEVICE_ID=$(xcrun simctl list devices booted | grep "Booted" | head -1 | sed -E 's/.*\(([A-Z0-9-]+)\).*/\1/')

echo "Found booted device UDID: $DEVICE_ID"

# Check if we found a device
if [ -z "$DEVICE_ID" ]; then
    echo "No booted simulator found. Please start a simulator first."
    exit 1
fi

# Send the notification
xcrun simctl push $DEVICE_ID com.aprid89.longeviq notification.apns
