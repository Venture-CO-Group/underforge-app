#!/bin/bash

# Deploy cronjobs and notification functions to Modal

set -e  # Exit on any error

# Use python3 -m modal instead of modal CLI (works without global CLI installation)
python3 -m modal profile activate glow360

# Deploy send_notifications functions
python3 -m modal deploy -m send_notifications.send_notifications

echo "✅ All functions deployed successfully!"
