## How this was originally created

```
npx create-expo-app@latest
```

## Refreshing your dependencies

For example after pulling new main and getting an error like "Cannot find native module"

```
npx expo install
```

## Install new deps

```
npx expo install X 
```

## Run ios on simulator

```
npm run ios
```

or 

```
npx expo run:ios
```


## Reload app on simulator

Hit Command-D in simulator, then reload

## Delete stored data from simulator

```
xcrun simctl list devices booted
xcrun simctl uninstall <udid> com.aprid89.longeviq
```

## Run on ios device via cable

```
npx expo run:ios --device
```


## Run on ios device via ad hoc distribution

### Step 1 Register new device via eas device:create

Run `eas device:create` and follow instructions

![QR code for user to add UDID](https://github.com/user-attachments/assets/6546d07e-314c-47e5-98db-0e8c48d30722)

Or go directly to [https://expo.dev/register-device/abeae2fc-a5f7-4d97-ad8d-9478454bda2c](https://expo.dev/register-device/abeae2fc-a5f7-4d97-ad8d-9478454bda2c)

### Step 2 scan QR code on phone

And follow instructions.  Must go to settings and install provisioning profile.

### Step 3 configure eas build

```
npx eas build:configure
```

### Step 4 run eas build

```
eas build --platform ios --profile dev_self_contained
```

### Install full app

NOTE: this must be rebuilt for every new UDID added from installing provisioning profile from step above.

<img width="1090" alt="Image" src="https://github.com/user-attachments/assets/f0d1aafe-c681-42b5-9c32-eb37b99e620e" />

## Production Self-Contained Deployment

### One-time setup

First, make sure you have EAS CLI installed and configured:

```bash
npm install -g @expo/eas-cli
eas login
eas build:configure
```

Create the prod_self_contained branch and channel:

```bash
eas branch:create prod_self_contained
eas channel:create prod_self_contained
```

### Deploy to prod_self_contained

#### Step 1: Build for production self-contained

```bash
eas build --platform ios --profile prod_self_contained
```

#### Step 2: Publish update to prod_self_contained channel

```bash
eas update --branch prod_self_contained --message "Production update: [describe changes]"
```

#### Step 3: Install on device

Download and install the build from the EAS dashboard or the provided URL after build completion.

### Deploy to dev_self_contained (for testing)

#### Step 1: Build for dev self-contained

```bash
eas build --platform ios --profile dev_self_contained
```

#### Step 2: Publish update to dev_self_contained channel

```bash
eas update --branch dev_self_contained --message "Dev update: [describe changes]"
```

## Environment Separation

- **dev_self_contained**: For testing new features and changes on actual devices
- **prod_self_contained**: For stable releases that won't break production users

Both environments use the same internal distribution but separate channels, allowing you to:
- Test safely on dev_self_contained without affecting prod users
- Deploy to prod_self_contained only when changes are verified
- Maintain separate update channels for each environment

## Setup for expo go deployment 

### Eas update:configure

```
eas update:configure
```

### Eas create branch

```
eas branch:create dev_self_contained
```

### Eas update

```
eas update --branch dev_self_contained --message "Update for self-contained app"
```

### Eas bind branch to channel

Not needed if branch and channel name match


### Run expo in tunnel/go mode

Locally or on ec2

```
npx expo start --tunnel --go
```

## Clean build

When getting weird errors about pods, run this to rebuild pods from scratch:

```
npx expo prebuild --clean --platform ios
npx expo install
npm install
npx expo run:ios
```

## Send expo test notifications

1. Get the expo push token in supabase

2. Send notification from here:

https://expo.dev/notifications

Also within app its possible...


Database tables and columns:
SELECT 
    t.table_name,
    c.column_name,
    c.data_type,
    c.is_nullable
FROM information_schema.tables t
JOIN information_schema.columns c ON t.table_name = c.table_name
WHERE t.table_schema = 'public' 
AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name, c.ordinal_position;


Policies:
SELECT
  nspname AS schemaname,
  relname AS tablename,
  pol.polname AS policyname,
  pol.polpermissive,
  pg_get_userbyid(pol.polroles[1]) AS policyrole,
  pol.polcmd,
  pg_get_expr(pol.polqual, pol.polrelid) AS policyqual,
  pg_get_expr(pol.polwithcheck, pol.polrelid) AS policywithcheck
FROM pg_policy pol
JOIN pg_class cls ON pol.polrelid = cls.oid
JOIN pg_namespace nsp ON cls.relnamespace = nsp.oid
WHERE nsp.nspname = 'public';


### For emulator
## 1. export again
source ~/.zshrc

## 2. start emulator
npx expo run:android