
## Requirements

* Implement mockups


## Design Sketch

Expo ios app that uses Supabase as source of record, and connects to OpenAI directly for interaction.  

### Onboard interview v2 proposal

1. Ask user what area they want to improve, or "other"
2. Question 

## Prototyping process

1. [x] Create a Hello World Expo app with a dev build
2. [x] Add a stub "choose coach screen"
3. [x] Add "what's your name and email" screen
4. [x] Add rest of general onboarding
5. [x] Add "choose modules" screen
6. [x] Add parameterized module onboarding, for single module
7. [x] Choose LLM library (instructor, etc)
8. [x] Invoke LLM to generate follow-up questions
9. [x] Invoke LLM to generate an action plan
10. [x] Allow user to give feedback on plan and regenerate
11. [x] Get new onboarding questions working as expected
	1. [x] multi select
12. [x] Get "other" working correctly
13. [x] Fix confusing "end of general onboarding" screen
14. [x] Save onboarding data to local json file so it can survive app restarts (later save to supabase if needed)
	1. [x] Make sure it includes updated plan after final revisions
15. [x] Reactive: Add a chat interface so user can chat with coach
	1. [x] Add stub chat UI
	2. [x] Connect to LLM somehow - is a backend needed?
16. [x] Deploy to actual iphone
17. [x] Get Alonso setup on simulator and hopefully phone too
18. [x] Add in "what to expect" screen after generating plan
19. [x] Redo flow per new wireframes
20. [x] Remove dead code
21. [x] Update plan to have specific days that user should to plan
22. [x] Re-add canned options
23. [x] Show plan in UI
24. [x] Is it losing the chat history on app restart?  try on ios
25. [x] Admin UI hidden behind keyboard
26. [x] Add push notifications 
	1. [x] Start with  Expo Background Tasks
27. [x] Verify push notifications actually work
28. [x] Shorten to 3 questions
29. [x] Get correct behavior and timing for background notifications
	1. [x] Test with button dev mode
	2. [x] Open plan json
	3. [x] Decide if time to fire
	4. [x] Invoke LLM to get catchy text with emoji
	5. [x] Show notifications
30. [x] After user opens app from a notification
	1. [x] Generate a new LLM message based on the notification text and their current plan
31. [x] How will it deal with multiple notifications on the same day?  pick a random one?
32. [x] Add app icon
33. [ ] Fix code bugs to make o1 work
34. [ ] Do matrix with o1
35. [ ] Converge on prompt
36. [ ] Add instructions or video for ad hoc
	1. [ ] Have Fred test it
37. [ ] Setup Test Flight 


## Minor enhancements

1. [x] "complete" is confusing for end of general onboarding
2. [x] Handle the "other" in onboarding
3. [x] Red color too harsh in plan
4. [x] Revise plan should only be 3 items
5. [x] For the plan, it should show the "why" somewhere.  see mockups.  maybe (i) buttons


## Major UX enhancements wireframe skew

1. [ ] Move "plan" details to separate screen to show structured info
2. [ ] Separate "coach details" screen with "select if" and persona background
3. [ ] When generating the plan, it needs to say the "why" and have a separate screen with more details



## Design Decisions

### DD: Native vs WhatsApp

See google doc

### DD: Expo vs iOS Swift

See google doc

### DD: Supabase vs Firebase

#### Option 1: Supabase (rec'd)

#### Option 2: Firebase

### DD: How to auth users

#### Option 1: No auth yet (rec'd)

They just put in their email during onboarding
It finds or creates a user profile
It trusts user for now, add auth later

#### Option 2: Supabase auth 

Possibly magic link / supertokens to speed up

#### Option 3: Google SSO

#### Option 4: Clerk Auth

#### Decision

Start with no auth, then add magic link or password auth later

### DD: App connects to openai directly, or via backend?

#### Option 1: Directly (rec'd)

##### Risks

* Can't use pydantic AI 
	* [Instructor TS](https://github.com/567-labs/instructor-js) might be best equivalent

#### Option 2: Via 1st party backend



#### Option 3: Via 3rd party backend


### DD: Where is openai key stored?

#### Option 1: In user plist 

#### Option 2: Half plist, half returned from API  (rec'd)


### DD: How often will coach check in with user?

#### Option 1: Daily

#### Option 2: Weekly

#### Option 3: Every few days (random)

#### Option 4: Let LLM decide, give guidance (rec'd)

Every day:

1. Look at user's plan and recent checkins
2. Ask LLM if it should check in again
3. If yes, send push notification
4. Generate text: "how was last week's sleep?"



### DD: How will coach juggle multiple modules without overwhelming user?

#### Option 1: Prioritize, handle in serial

Day 1: How is sleep?
Day 4: How is nutrition?

#### Option 2: Randomly choose module for each check-in

Day 1: How is social?
Day 4: How is nutrition?

#### Option 3: Only allow single module for now (rec'd)


### DD: Where should user onboarding data be stored?

#### Option 1: Supabase DB table with JSON field

##### Strengths

* Much much simpler
* To develop product, we probably need to see user data
* No schema skew to worry about

##### Risks

* Privacy risk

#### Option 2: Local JSON file

How this could work:

1. Silent push notifications daily that trigger code to call LLM
2. Periodic normal push notifications that are generic like "Coach Joe has an idea for you!" - then in the chat when user opens app, it generates a new message with actual content

##### Risks

* Notifications get a bit more complex
	* If it doesn't have data, it could keep it super vague - "Just checking in on sleep", but then users will be annoyed
	* Not sure if local timer loop will wake up app?


### DD: How to avoid recommending contra-indicating supplements?


### DD: How to handle users with chronic diseases?


### DD: Which Expo Chat Library to use?


#### Option: Vibe Code it

##### Risks

* What about things like streaming?
	* Can add later
	* Vibe code it too


#### Option: GetStream with LLM support (rec'd)

##### Strengths

* Will support every feature we need
* Maintained
* Probably least amount of work
* Useful for other projects
* Easily drop in human coaches or founders to chat

https://getstream.io/blog/react-native-assistant/?utm_source=chatgpt.com

Example python backend code to proxy with openai:

```
# server.py
from fastapi import FastAPI, Request
from starlette.responses import StreamingResponse
from getstream import Stream
import openai, os, json

app = FastAPI()
openai.api_key = os.getenv("OPENAI_API_KEY")
stream_client = Stream(api_key=os.getenv("STREAM_API_KEY"),
                       api_secret=os.getenv("STREAM_API_SECRET"))

@app.post("/stream_ai")
async def stream_ai(request: Request):
    data = await request.json()
    user_id = data["user_id"]
    user_msg = data["message"]
    channel = stream_client.chat.channel("messaging", "global")
    channel.send_message({"user_id": user_id, "text": user_msg})

    def event_stream():
        resp = openai.ChatCompletion.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": user_msg}],
            stream=True
        )
        collected = ""
        for chunk in resp:
            delta = chunk.choices[0].delta.get("content") or ""
            collected += delta
            yield f"data: {json.dumps({'token': delta})}\n\n"
        channel.send_message({"user_id": "ai_bot", "text": collected})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

#### Option: ChatGptCloneReactNative

https://github.com/Galaxies-dev/chatgpt-clone-react-native

##### Strengths

* Clean code
* best practices

##### Risks

* Need to disentangle

#### Option: Gifted Chat

https://github.com/FaridSafi/react-native-gifted-chat?tab=readme-ov-file

##### Risks

* No longer mainttained

#### Option: LinkUp chat (8 stars)

https://github.com/TaichKarna/LinkUp?tab=readme-ov-file


#### Option: gommezz/react-native-chatgpt

[rgommezz](https://github.com/rgommezz)/[react-native-chatgpt](https://github.com/rgommezz/react-native-chatgpt)



### DD: How to send notifications?

#### Option 1: Local Scheduled Notifications

##### Strengths

##### Risks

* Messages are canned

#### Option: Expo Background Tasks (expo-background-fetch / expo-background-task)

##### Strengths

- Runs **periodically in the background**, even when the app isn’t open, enabling scheduled checks.
    
- No backend or external services needed—fully local. 
    
- You can combine this with expo-notifications to trigger in-app alerts (e.g., notify if no progress logged recently).

##### Risks

- iOS schedules tasks **unpredictably**—intervals may be longer than expected (every 15–20 minutes minimum, often hours apart) based on system optimizations, battery, usage, etc. 
    
- Facts from developers:
    
    > “[Background fetch] events can occur less often than your configured minimumFetchInterval. … If the user doesn’t open your iOS app for long periods, iOS will stop firing events.” 
    
- Tasks **won’t run at all if the app is fully terminated** (iOS limitation).
    
- Difficult to guarantee timely notifications (especially for exact 2–3‑day intervals).

#### Option: TODO

##### Strengths

##### Risks


### DD: How to remind users?

#### Example 1: sleep plan step

Plan: start wind down every day at 9pm

Notification sent at 8pm, daily

Notification msg: "Hey its time for wind down.  Tap for details or to chat"

Full chat msg: 

* Remind the goal - "to get you feeling better"
* Recap the step
* Hints and tips to execute
* Need any help?  Provide user an example of how can help

#### Example 2: nutrition plan step

Plan: start wind down every day at 9pm


### DD: Do we have separate prompts for separate problem/goal category?  (weight loss vs build muscle vs sleep)

#### Option 1: Separate prompts for each problem / goal category

#### Option 2: Same prompt for each problem / goal category

#### Option 3: Hybrid - fallback to default

### DD: Is each question generated from the same prompt, or per-question prompts?

#### Option 1: Same prompt (current)
#### Option 2: Per question

### DD: Do we show separate screen for diagnosis / root cause analysis before plan?

#### Option 1: Yes, always

##### Risks

* What about Fred use case?
#### Option 2: No, never (current)

#### Option 3: Let LLM decide (prompt chaining)


### DD: Should we tell it how many total questions?  


### DD: How to frame prompt?


pack it with hardcoded evidence backed info:

Overweight

common causes related to eating
* mindless eating

common causes related to sleep
- eat late at night

choose best question.   you have 10 questions total

questions and answers so far: ..

output:

- first question
- current hypothesis

pipe that back into next question


### DD: Should we plug in example questionnaires?

