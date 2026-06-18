# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## User Interface

This is an expo app.  Everything must satisfy apple human interface guidelines (HIG) or get rejected from app store.

Apple HIG issues to avoid:

	1.	Wrong nav pattern (modal/sheet for hierarchy) → Use a push (horizontal slide) in a navigation stack for hierarchical drill-down; reserve modals/sheets for short, self-contained tasks.
	2.	Custom back buttons / hidden back affordance → Keep the system back button visible in a UINavigationBar; avoid custom icons unless you retain default behavior and title.
	3.	Deep stacks with no escape → Provide a clear root and limited depth; use search/filter or shortcuts to reduce drilling.

  	5.	Tiny touch targets → Ensure 44×44 pt minimum tappable areas; add padding to icons/text buttons.
	6.	Unreadable text → Use Dynamic Type, system fonts, sufficient contrast (WCAG AA+), and avoid fixed font sizes.
	7.	Hard-coded light/dark → Respect system appearance; provide app-wide Dark Mode compatibility and test both themes.

  	8.	Inconsistent spacing & alignment → Use system layout margins, consistent 8-pt grid, and Auto Layout/Flexbox rules; avoid pixel-perfect magic numbers.
	9.	Iconography off-style → Prefer SF Symbols or a consistent set; match weight, scale, and rendering modes.
	10.	Over-customized nav bars → Keep standard nav bars with clear titles, large titles when appropriate, and primary actions in the trailing position.

  	11.	Floating actions that conflict with system UI → Place primary actions in nav bar or obvious inline buttons; avoid Android-style FABs that occlude content.
	12.	Ambiguous destructive actions → Mark destructive actions as destructive (red), require confirmation when impactful, and position last in actions list.
	13.	Confusing alerts → Use brief, actionable alerts with up to two buttons; move complex decisions into a full screen or sheet.

  	19.	Non-native pickers/inputs → Use native pickers (date, time, lists, share, photo) and keyboard types matching the input (email, number).
	20.	Keyboard overlaps inputs → Ensure views scroll/avoid the keyboard; dismiss keyboard on scroll/tap; use keyboardShouldPersistTaps thoughtfully.

## Development Commands

### Building and Running
- `npm start` - Start Expo development server
- `npm run ios` - Run on iOS simulator
- `npm run android` - Run on Android emulator
- `npm run web` - Run web version
- `npx expo run:ios` - Alternative iOS run command
- `npx expo run:ios --device` - Run on connected iOS device

### Linting
- `npm run lint` - Run ESLint on the codebase

### Package Management
- `npx expo install` - Refresh dependencies (use after pulling main)
- `npx expo install <package>` - Install new Expo-compatible packages

### Testing and Debugging
- In iOS simulator: Command-D then reload to refresh app
- Clear iOS simulator data: `xcrun simctl uninstall <udid> com.aprid89.longeviq`
- Clean build when encountering pod errors: `npx expo prebuild --clean --platform ios`

### EAS Build and Deploy
- `eas build --platform ios --profile dev_self_contained` - Build for dev testing
- `eas build --platform ios --profile prod_self_contained` - Build for production
- `eas update --branch dev_self_contained --message "..."` - Deploy updates to dev
- `eas update --branch prod_self_contained --message "..."` - Deploy to production

## Architecture Overview

### Tech Stack
- **Framework**: Expo 53 with React Native 0.79
- **Navigation**: Expo Router with file-based routing
- **Database**: Supabase for backend, SQLite for local storage
- **AI Integration**: OpenAI API with Instructor for structured responses
- **State Management**: React hooks and context
- **Styling**: React Native StyleSheet with TypeScript

### Key Directories
- `/app/` - File-based routing with Expo Router (main app entry points)
- `/components/` - React components organized by feature (onboarding, chat, plan management)
- `/lib/` - Core business logic and services
  - `supabase_db.ts` - Supabase client and database operations
  - `llm-service.ts` - OpenAI integration and AI conversation handling
  - `storage.ts` - Local SQLite storage management
  - `domain-specific-*.ts` - App-specific constants and prompts
- `/types/` - TypeScript type definitions
- `/hooks/` - Custom React hooks
- `/constants/` - App-wide constants and configuration

### Core Features
This is a health/longevity coaching app with:
- **Onboarding Flow**: Multi-step user profile setup with goal selection and coach assignment
- **AI Chat Interface**: Conversational coaching powered by OpenAI with structured responses
- **Plan Management**: Action plan generation, review, and tracking
- **Coach System**: Multiple AI coaches with different personalities and specializations
- **Data Sync**: Offline-first with Supabase sync for cross-device persistence

### Database Architecture
- **Local**: SQLite for offline functionality and fast reads
- **Remote**: Supabase for user data, conversations, and cross-device sync
- **Sync Strategy**: Local-first with background sync to Supabase

### Environment Configuration
- Uses Expo environment variables (EXPO_PUBLIC_*)
- Supabase credentials required: `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- OpenAI API key for LLM functionality

### Development Patterns
- Components follow React functional component patterns with hooks
- TypeScript strict mode enabled
- File-based routing with Expo Router
- Environment-specific builds (dev_self_contained vs prod_self_contained)
- Structured logging with custom logger (`glow-logger.ts`)

### Key Integration Points
- OpenAI Instructor for structured AI responses
- Supabase real-time subscriptions for data sync
- Expo notifications for push messaging
- React Navigation for complex navigation flows within Expo Router