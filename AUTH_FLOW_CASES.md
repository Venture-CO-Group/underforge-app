# Authentication Flow Cases

## Case Matrix

| Flow Type | Action | isNewUser | emailVerified | Profile Found | Expected Behavior |
|-----------|--------|-----------|---------------|---------------|-------------------|
| **New User Flow** (`isNewUserFlow=true`) |
| New User | Signup | `true` | `false` | No | Show email confirmation screen |
| New User | Signup | `true` | `true` | No | Save profile → Show main app |
| New User | Signin | `false` | N/A | No | Shouldn't happen (new user can't sign in) |
| **Existing User Flow** (`isNewUserFlow=false`) |
| Existing User | Signin | `false` | `true` | Yes (by auth_user_id) | Restore profile → Show main app |
| Existing User | Signin | `false` | `true` | Yes (by email, legacy) | Link profile → Restore → Show main app |
| Legacy User | Signup | `true` | `false` | Yes (by email) | Link profile → Restore → Show email confirmation |
| Legacy User | Signup | `true` | `true` | Yes (by email) | Link profile → Restore → Show main app |
| New User (wrong flow) | Signup | `true` | `false` | No | Proceed to onboarding |

## Key Points

1. **New User Flow**: User goes through onboarding first, then signs up
2. **Existing User Flow**: User clicks "I have account" → signs in or signs up (legacy)
3. **Legacy User**: Has profile in DB but no auth account yet → signs up to create auth credentials
4. **Main App Access**: Requires `hasCompletedOnboarding && onboardingData && isAuthenticated && isEmailVerified`

