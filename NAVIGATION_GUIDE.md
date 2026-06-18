# 📱 UnderForge App Navigation Flow - Complete Guide

## Overview

Your app uses **state-based navigation** rather than a traditional navigation library like React Navigation. This means screen transitions are controlled by React state variables that determine which component to render.

---

## 🏗️ Architecture Hierarchy

```
app/index.tsx (AppContent)
    ├─ OnboardingModalV2 (if not completed)
    │   └─ Multiple onboarding screens (wizard flow)
    │       └─ PlanAccepted (final onboarding screen)
    │
    └─ MainAppContainer (after onboarding)
        ├─ CoachDashboard (home tab)
        ├─ ChatScreen (when coach ribbon clicked)
        ├─ ProgressScreen (progress tab)
        └─ GamesScreen (games tab)
```

---

## 📍 Level 1: App Entry Point (`app/index.tsx`)

### **Key State Variables**

```typescript
const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
const [onboardingData, setOnboardingData] = useState<Onboard | null>(null);
const [isLoading, setIsLoading] = useState(true);
const [showDashboard, setShowDashboard] = useState(false);
```

### **Navigation Logic (Lines 458-498)**

```typescript
// CONDITION 1: User has completed onboarding
if (hasCompletedOnboarding && onboardingData) {
  // Show the main app
  return (
    <MainAppContainer
      onboardingData={onboardingData}
      onLogout={handleLogout}
      pendingNotificationMessage={pendingNotificationMessage}
      onNotificationMessageProcessed={() => setPendingNotificationMessage(null)}
      shouldGenerateWelcome={shouldGenerateWelcome}
      onWelcomeGenerated={() => setShouldGenerateWelcome(false)}
    />
  );
}

// CONDITION 2: User hasn't completed onboarding
return (
  <>
    {shouldShowOnboarding && (
      <OnboardingModalV2
        visible={true}
        onComplete={handleOnboardingComplete}  // <-- Sets hasCompletedOnboarding to true
      />
    )}
    
    {isLoading && (
      <View style={styles.container}>
        <Text>Loading...</Text>
      </View>
    )}
  </>
);
```

### **How It Works:**

1. **App starts** → `isLoading = true` → Shows "Loading..."
2. **After DB initialization** → `isLoading = false`
3. **Check if user exists:**
   - ✅ **User exists & has onboarding data** → `hasCompletedOnboarding = true` → Show `MainAppContainer`
   - ❌ **No user or no onboarding data** → Show `OnboardingModalV2`

### **Debugging Tips:**

```typescript
// Add this to see which screen should render:
console.log('Navigation Decision:', {
  isLoading,
  hasCompletedOnboarding,
  hasOnboardingData: !!onboardingData,
  decision: hasCompletedOnboarding && onboardingData ? 'MainAppContainer' : 'OnboardingModalV2'
});
```

---

## 📍 Level 2: Onboarding Flow (`OnboardingModalV2.tsx`)

### **State-Based Wizard Pattern**

Uses `OnboardingSequenceV2` class to manage a multi-step wizard:

```typescript
const [sequenceState, setSequenceState] = useState<OnboardingSequenceState | null>(null);
const [sequence, setSequence] = useState<OnboardingSequenceV2 | null>(null);
```

### **Screen Selection Logic (Lines 200-400)**

```typescript
const renderContent = () => {
  if (!sequenceState) return null;

  switch (sequenceState.currentScreen) {
    case 'instructions':
      return <OnboardingInstructions onNext={() => sequence?.goNext()} />;
    
    case 'choose_name':
      return (
        <AskUserName
          value={sequenceState.data.userName}
          onChange={handleUserNameChange}
          onNext={handleUserNameNext}
        />
      );
    
    case 'choose_goal':
      return (
        <ChooseGoal
          onSelect={handleGoalSelect}
          onNext={handleGoalNext}
        />
      );
    
    // ... many more screens ...
    
    case 'plan_accepted':
      return (
        <PlanAccepted
          config={config}
          selectedCoach={sequenceState.data.selectedCoach}
          onStartChatting={handleStartChatting}  // <-- Completes onboarding!
        />
      );
    
    default:
      return null;
  }
};
```

### **How Screen Transitions Work:**

Each screen calls `sequence?.goNext()` when user clicks a button:

```typescript
// Example: User clicks "Next" on Choose Name screen
const handleUserNameNext = () => {
  sequence?.goNext();  // Updates sequenceState.currentScreen to next value
};
```

The `OnboardingSequenceV2` class internally updates `currentScreen`:

```typescript
// Inside OnboardingSequenceV2.ts
goNext() {
  this.state.currentScreen = this.getNextScreen();
  this.stateChangeCallback(this.state);  // Triggers re-render
}
```

### **Completing Onboarding:**

When user clicks "Let's start!" on `PlanAccepted`:

```typescript
const handleStartChatting = async () => {
  // This triggers the onComplete callback passed from app/index.tsx
  onComplete(sequenceState.data);  
  
  // Back in app/index.tsx, this runs:
  const handleOnboardingComplete = async (completeOnboardingData: Onboard) => {
    setOnboardingData(completeOnboardingData);
    setHasCompletedOnboarding(true);  // <-- KEY: Switches to MainAppContainer
    setShouldGenerateWelcome(true);
  };
};
```

### **Debugging Tips:**

```typescript
// Add to OnboardingModalV2 to track screen changes:
useEffect(() => {
  console.log('Onboarding Screen Changed:', {
    currentScreen: sequenceState?.currentScreen,
    nextScreen: sequence?.getNextScreen(),
    completionProgress: `${sequenceState?.completedScreens.length} completed`
  });
}, [sequenceState?.currentScreen]);
```

---

## 📍 Level 3: Main App (`MainAppContainer.tsx`)

### **State Variables**

```typescript
const [activeTab, setActiveTab] = useState<'home' | 'plan' | 'progress' | 'games'>('home');
const [showChat, setShowChat] = useState(false);
```

### **Navigation Logic (Lines 43-74)**

```typescript
const renderContent = () => {
  // PRIORITY 1: If chat is open, show ChatScreen
  if (showChat) {
    return (
      <ChatScreen
        onboardingData={onboardingData}
        onLogout={onLogout}
        // ... other props
      />
    );
  }

  // PRIORITY 2: Otherwise, show screen based on bottom tab
  switch (activeTab) {
    case 'home':
      return (
        <CoachDashboard
          onboardingData={onboardingData}
          onNavigateToChat={handleNavigateToChat}  // <-- Opens chat
        />
      );
    
    case 'plan':
      return <ProgressScreen />;  // Placeholder for now
    
    case 'progress':
      return <ProgressScreen />;
    
    case 'games':
      return <GamesScreen />;
    
    default:
      return null;
  }
};
```

### **Two Navigation Methods:**

#### **1. Bottom Tab Navigation**

```typescript
<BottomTabNavigation
  activeTab={activeTab}
  onTabPress={setActiveTab}  // Changes activeTab state
/>
```

When user taps a bottom tab icon:
```typescript
// In BottomTabNavigation.tsx
<TouchableOpacity onPress={() => onTabPress('home')}>
  {/* Home icon */}
</TouchableOpacity>
```

This calls `setActiveTab('home')` → Re-renders `renderContent()` → Shows `CoachDashboard`

#### **2. Coach Ribbon Navigation**

```typescript
<TouchableOpacity style={styles.coachRibbon} onPress={handleNavigateToChat}>
  <Image source={coachImages[coachName]} />
  <Text>Coach {coachName} Chat</Text>
</TouchableOpacity>

const handleNavigateToChat = () => {
  setShowChat(true);  // Overrides bottom tab navigation
};
```

When user taps coach ribbon → `showChat = true` → `renderContent()` returns `ChatScreen`

### **Navigation Hierarchy:**

```
showChat === true  → ChatScreen (highest priority)
     ↓ (if false)
activeTab === 'home'     → CoachDashboard
activeTab === 'plan'     → ProgressScreen
activeTab === 'progress' → ProgressScreen
activeTab === 'games'    → GamesScreen
```

### **Debugging Tips:**

```typescript
// Add to renderContent():
useEffect(() => {
  console.log('MainAppContainer State:', {
    showChat,
    activeTab,
    willRender: showChat ? 'ChatScreen' : activeTab
  });
}, [showChat, activeTab]);
```

---

## 🔍 Complete Navigation Flow Example

### **Scenario: User opens app → completes onboarding → navigates to chat**

```
1. App starts
   ├─ app/index.tsx initializes
   ├─ isLoading = true → Shows "Loading..."
   └─ initializeDatabase() runs

2. Database initialized
   ├─ isLoading = false
   ├─ getCurrentLoggedInUser() → returns null (new user)
   └─ hasCompletedOnboarding = false → Shows OnboardingModalV2

3. User goes through onboarding
   ├─ OnboardingModalV2 renders
   ├─ sequenceState.currentScreen = 'instructions'
   ├─ User clicks "Next" → sequence.goNext()
   ├─ currentScreen = 'choose_name'
   ├─ User enters name → sequence.updateData({ userName: 'John' })
   ├─ ... continues through all screens ...
   └─ currentScreen = 'plan_accepted'

4. User clicks "Let's start!"
   ├─ PlanAccepted calls onStartChatting()
   ├─ OnboardingModalV2 calls onComplete(sequenceState.data)
   ├─ app/index.tsx receives callback
   ├─ setHasCompletedOnboarding(true)
   ├─ setOnboardingData(completeData)
   └─ Re-render → Shows MainAppContainer

5. MainAppContainer renders
   ├─ activeTab = 'home' (default)
   ├─ showChat = false (default)
   └─ renderContent() → Shows CoachDashboard

6. User clicks coach ribbon
   ├─ handleNavigateToChat() runs
   ├─ setShowChat(true)
   ├─ Re-render
   └─ renderContent() → if (showChat) → Shows ChatScreen
```

---

## 🛠️ How to Add a New Screen

### **Example: Add "Plan Overview" screen**

#### **Step 1: Update MainAppContainer state**

```typescript
const [activeTab, setActiveTab] = useState<'home' | 'plan' | 'progress' | 'games'>('home');
```

#### **Step 2: Create the component**

```typescript
// components/PlanOverviewScreen.tsx
export const PlanOverviewScreen = ({ onboardingData }) => {
  return (
    <View>
      <Text>Your Plan</Text>
      {/* Plan details */}
    </View>
  );
};
```

#### **Step 3: Add to renderContent()**

```typescript
case 'plan':
  return <PlanOverviewScreen onboardingData={onboardingData} />;
```

#### **Step 4: Update bottom navigation**

```typescript
// In BottomTabNavigation.tsx
<TouchableOpacity onPress={() => onTabPress('plan')}>
  <Text>📋 Plan</Text>
</TouchableOpacity>
```

---

## 🐛 Debugging Navigation Issues

### **Issue: "Button doesn't navigate to next screen"**

**Check:**
1. Is the button's `onPress` calling the right function?
   ```typescript
   <TouchableOpacity onPress={handleNext}>  // ✅ Correct
   <TouchableOpacity>  // ❌ Missing onPress
   ```

2. Is the function updating state?
   ```typescript
   const handleNext = () => {
     setShowChat(true);  // ✅ Updates state
     console.log('clicked');  // ❌ Doesn't update state
   };
   ```

3. Is the component re-rendering?
   ```typescript
   useEffect(() => {
     console.log('State changed:', showChat);
   }, [showChat]);
   ```

### **Issue: "Wrong screen is showing"**

**Add debug logging:**
```typescript
const renderContent = () => {
  console.log('=== RENDER DECISION ===');
  console.log('showChat:', showChat);
  console.log('activeTab:', activeTab);
  
  if (showChat) {
    console.log('→ Rendering ChatScreen');
    return <ChatScreen />;
  }
  
  console.log(`→ Rendering ${activeTab} tab`);
  // ... rest of logic
};
```

### **Issue: "Navigation is slow/delayed"**

**Check for async operations:**
```typescript
// ❌ BAD: Async without handling
const handleNext = async () => {
  await saveData();
  setScreen('next');  // Might be delayed
};

// ✅ GOOD: Show loading state
const handleNext = async () => {
  setIsLoading(true);
  await saveData();
  setScreen('next');
  setIsLoading(false);
};
```

---

## 📊 State Flow Diagram

```
                    ┌─────────────┐
                    │ app/index.tsx│
                    │             │
                    │  isLoading  │
                    └──────┬──────┘
                           │
                ┌──────────┴──────────┐
                │                     │
         hasCompleted         hasCompleted
         Onboarding?          Onboarding?
           NO │                 YES │
              │                     │
     ┌────────▼─────────┐  ┌────────▼────────┐
     │OnboardingModalV2 │  │MainAppContainer │
     │                  │  │                 │
     │ sequenceState.   │  │  activeTab +    │
     │ currentScreen    │  │  showChat       │
     └─────────┬────────┘  └────────┬────────┘
               │                    │
       ┌───────┴────────┐   ┌───────┴────────┐
       │                │   │                │
  'instructions'  'choose  showChat?    activeTab?
  'choose_name'   _coach'    │            │
  'choose_goal'   etc...     │            │
       │                │   ChatScreen  CoachDashboard
       │                │              ProgressScreen
  'plan_accepted' ──────┘              GamesScreen
       │
       │ onComplete()
       └──► setHasCompletedOnboarding(true)
```

---

## 📝 Quick Reference: Key Files & Their Roles

| File | Role | Key State | Controls |
|------|------|-----------|----------|
| `app/index.tsx` | App entry point | `hasCompletedOnboarding`, `isLoading` | Shows onboarding vs main app |
| `OnboardingModalV2.tsx` | Onboarding wizard | `sequenceState.currentScreen` | Which onboarding screen to show |
| `OnboardingSequenceV2.ts` | Wizard logic | Internal state machine | Screen progression order |
| `MainAppContainer.tsx` | Main app shell | `activeTab`, `showChat` | Post-onboarding navigation |
| `BottomTabNavigation.tsx` | Tab bar | N/A (controlled by parent) | Bottom tab clicks |
| `CoachDashboard.tsx` | Home screen | `completedTasks` | Task completion state |
| `ChatScreen.tsx` | Chat interface | Message state | Chat messages |
| `PlanAccepted.tsx` | Onboarding finale | `isLoading` | Transition to main app |

---

## 🎯 Common Navigation Patterns

### **Pattern 1: Simple Screen Switch**
```typescript
// Use case: Bottom tab navigation
const [activeTab, setActiveTab] = useState('home');
<Button onPress={() => setActiveTab('profile')} />
```

### **Pattern 2: Modal/Overlay Navigation**
```typescript
// Use case: Chat overlay over main content
const [showChat, setShowChat] = useState(false);
if (showChat) return <ChatScreen />;
return <MainContent />;
```

### **Pattern 3: Wizard/Sequential Navigation**
```typescript
// Use case: Multi-step onboarding
const [currentStep, setCurrentStep] = useState(0);
const steps = ['name', 'goal', 'plan'];
<Button onPress={() => setCurrentStep(currentStep + 1)} />
```

### **Pattern 4: Callback-Based Navigation**
```typescript
// Use case: Child completes task, parent changes screen
<OnboardingModal onComplete={(data) => {
  setOnboardingData(data);
  setShowMainApp(true);
}} />
```

---

## 💡 Pro Tips

1. **Always use state for navigation** - Don't manipulate DOM directly
2. **Use descriptive state names** - `showChat` is better than `flag1`
3. **Log state changes** - Add console.logs to track navigation flow
4. **Handle loading states** - Show spinners during async transitions
5. **Reset state on logout** - Clear all navigation state when user logs out
6. **Test edge cases** - What if user presses back? What if network fails?
7. **Use TypeScript** - Type your state to catch navigation bugs early

---

## 🆘 Emergency Debugging Checklist

When navigation breaks, check these in order:

- [ ] Is the button's `onPress` handler defined?
- [ ] Is the state variable being updated?
- [ ] Is the component re-rendering after state change?
- [ ] Are there any console errors?
- [ ] Is there conditional logic preventing the render?
- [ ] Are props being passed correctly?
- [ ] Is there an async operation blocking navigation?
- [ ] Did you check the navigation hierarchy?
- [ ] Is there competing state (e.g., `showChat` overriding `activeTab`)?
- [ ] Have you added debug logs to track state changes?

---

**Document Generated:** 2025-10-30  
**App Version:** 1.0.0  
**Last Updated By:** Development Team

---

This documentation is a living document. Please update it as navigation patterns evolve!

