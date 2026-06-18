## Overview


1. User must install the provisioning profile that allows our developer account to install apps on their iOS device
2. We need to rebuild the adhoc distribution app
3. User installs the new adhoc distribution app from a QR code
4. User needs to turn on developer mode


## Step 1: User installs provisioning profile

![QR code for user to add UDID](https://github.com/user-attachments/assets/6546d07e-314c-47e5-98db-0e8c48d30722)

Or the user can go directly to [https://expo.dev/register-device/abeae2fc-a5f7-4d97-ad8d-9478454bda2c](https://expo.dev/register-device/abeae2fc-a5f7-4d97-ad8d-9478454bda2c) on their device

### Step 1B: Download profile

Click the blue Download Profile button.

<img src="https://github.com/user-attachments/assets/abd1efcc-17f9-4431-8a7c-f54a564223c4" alt="Image" width="500"/>

### Step 1C: Install profile

Follow these instructions to install the profile:

<img src="https://github.com/user-attachments/assets/a0bd300f-172a-4044-833d-efcdc195f87b" alt="Image" width="500"/>


## Step 2: We rebuild adhoc distribution app

NOTE: @Alonso not sure if this will work on your macbook yet.  Probably not.

```
eas build --platform ios --profile dev_self_contained
```

## Step 3: User installs adhoc distribution app via new QR code

The `eas build` command will spit out another QR code (different from the first one).  This must be shared with the user.

1. Take a screenshot of QR code generated from `eas build` command above
2. Send the screenshot to the user somehow (email / whatsapp fine)
3. The user opens the ios camera app to snap the screenshot

It should install the app and it should appear on their homescreen.

## Step 4: Turn on developer mode

1. On the iPhone, navigate to Settings → Privacy & Security → Developer Mode and toggle it on.

2. Restart the phone