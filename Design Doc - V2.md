
## Requirements




## Design Sketch

![https://github-production-user-asset-6210df.s3.amazonaws.com/296876/470359646-39df5525-d752-4536-ae57-4fd2ac273755.png](https://github.com/user-attachments/assets/39df5525-d752-4536-ae57-4fd2ac273755)

or https://excalidraw.com/#json=rci4CVZXtezzmqwYYc_Bj,91URoewbfe49pIeLeB4hoA


### Data storage 

Local

1. The user_id of the logged in user

Supabase

1. Everything else, keyed on user id

New install sequence

1. No local user_id
2. Create a new uuid to be used as the user id (in memory)
3. Save an 
4. Go through onboarding
5. Save onboarding profile to supabase, keyed by user_id

Existing app sequence

1. Find local user_id
2. Pull profile from supabase based on user_id, or throw error and reset to new install sequence

## Rollout plan

1. [4 hours] Shadow all writes to supabase
2. [4 hours] Get expo push notifications working with app.  Add dev only tool to trigger a manual notification
3. [2 hours] Get LLM calls working from Modal
4. [2 hours] Have Modal poll supabase, call LLM, and send notifications
5. [0 hours] Once cloud notifications are working, remove local notifications
6. [2 hours] Convert all read ops to use supabase rather than sqlite
7. [2 hours] Add scheme to be able to snapshot a plan for historical data collection
8. [2 hour] When coach edits plan make sure it reflects in the app
9. [1 hour] Figure out a way for coach to message users via supabase or otherwise

## Rework UI plan

[6 hours total]

1. Update choose your coach screen
2. Add landing screen
3. Show web view with home page
4. Redo the "how it works" screen according to mockups
5. Update primary goal screen based on a config json
6. Add secondary goal screen based on a config json
7. Add the "get motivated" screen
8. Add the "choose AI or Hybrid" screen
9. 

## Design Decisions

### DD: Who generates notifications?  Supabase cloud functions vs Modal.com


#### Option 1: Supabase cloud functions

##### Risk

1. **Only 2s runtime**, not enough for an LLM call.  Not going to cut it

#### Option 2: Modal.com (rec'd)


### DD: Which gateway to APNS?

#### Option 1: Expo Push (rec'd)


### DD: How will coach trigger messages to user?


#### Option 1: Directly via supabase for now - (rec'd)


#### Option 2: Special menu in developer section of app

This could stack on option 1

#### Option 3: Switch messaging to getstream platform

Too much work, do this if we hit a wall


### DD: How will coach modify plan?


#### Option 1: Directly via supabase for now - (rec'd)
