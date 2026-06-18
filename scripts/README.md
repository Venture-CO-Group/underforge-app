# Scripts

This directory contains utility scripts for managing the UnderForge app.

## restructure-training-step.js

Converts existing text-based workout plans into the new structured format using AI.

### Prerequisites

1. **Install dependencies:**
   ```bash
   npm install @anthropic-ai/sdk
   # or
   yarn add @anthropic-ai/sdk
   ```

2. **Set environment variable:**
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-your-api-key-here"
   ```

### Usage

```bash
node scripts/restructure-training-step.js <user_id>
```

### Example

```bash
# Set API key
export ANTHROPIC_API_KEY="sk-ant-api03-..."

# Run for a specific user
node scripts/restructure-training-step.js dde537d9-57c1-4530-9756-832d85e41c81
```

### What it does

1. 📡 Fetches the user's profile and action plan from Supabase
2. 🔍 Finds the training step in their action plan
3. 🤖 **Primary approach:** Uses Claude AI to restructure existing training step content into structured format (supports both single workouts and multiple workout days)
4. 📁 **Fallback approach:** If LLM fails or no content exists, reconstructs from workout history (`workout_exercise_logs_rows.csv` in Downloads)
5. 📊 Shows you the changes (before/after)
6. ❓ Asks for confirmation
7. 💾 If confirmed, saves the restructured workout content to the step_details field in Supabase

### The New Workout Format

The script converts text-based workouts into this structured JSON format:

```json
{
  "dayName": "Upper Body Day",
  "dayType": "strength",
  "estimatedDuration": 60,
  "warmup": "5 min light cardio, dynamic stretches",
  "cooldown": "5 min walking, static stretches",
  "exercises": [
    {
      "exerciseId": "bench-press",
      "name": "Bench Press",
      "sets": 3,
      "reps": "8-10",
      "restTimeSeconds": 120,
      "rir": 2,
      "notes": "Focus on form"
    }
  ],
  "recoveryHints": {
    "stretching": "Hip flexor stretch - 30s each",
    "fasciaMassage": "Foam roll chest and shoulders",
    "supplementation": "Protein shake post-workout"
  }
}
```

### Reconstruction from Workout History (Fallback)

The script primarily uses AI to restructure existing training step content. Workout history CSV reconstruction is used as a fallback when:

- The LLM fails to process the existing training step content
- There's no meaningful training step content to restructure
- You want to create a plan based entirely on past workout logs

The CSV file should contain the user's actual workout logs to reconstruct their training plan from real data.

**CSV Format Required:**
The CSV should have these columns:
- `workout_log_id`: Unique ID for each workout session
- `exercise_id`: Exercise identifier (e.g., "bench-press")
- `exercise_name`: Human-readable exercise name
- `set_number`: Set number (1, 2, 3, etc.)
- `reps`: Number of repetitions performed
- `weight_value`: Weight used (optional)
- `weight_unit`: Unit (e.g., "lbs", "kg")
- `rest_time_seconds`: Rest time between sets
- `rir`: Reps in Reserve (0-5)

**How it works:**
1. Script groups exercises by `workout_log_id` to identify distinct workout sessions
2. Analyzes exercise patterns to identify workout types (Push/Pull/Leg/Full Body)
3. Calculates typical values (average sets, rep ranges, rest times, RiR)
4. Constructs structured workout plan(s) based on the actual logged data

**Example CSV export:**
```csv
workout_log_id,exercise_id,exercise_name,set_number,reps,weight_value,weight_unit,rest_time_seconds,rir
135,bench-press,Barbell Bench Press,1,8,135,lbs,120,2
135,bench-press,Barbell Bench Press,2,8,135,lbs,120,2
136,deadlift,Conventional Deadlift,1,6,185,lbs,150,2
```

**Benefits of using workout history:**
- ✅ More accurate workout structure based on actual user behavior
- ✅ Preserves exact exercises the user has been doing
- ✅ Uses real rest times and RiR values instead of estimates
- ✅ Automatically identifies workout split (Push/Pull/Legs, etc.)

### Benefits

After restructuring:
- ✅ Users can log workouts with the "+ Log Workout" button
- ✅ Workout details display properly in the plan view
- ✅ Progress charts will work with tracked exercises
- ✅ Includes rest time, RiR (Reps in Reserve), and recovery hints
- ✅ Supports multiple workout days within a single training step

### Troubleshooting

**"@anthropic-ai/sdk not found"**
- Run: `npm install @anthropic-ai/sdk`

**"ANTHROPIC_API_KEY must be set"**
- Set the environment variable: `export ANTHROPIC_API_KEY="your-key"`

**"model: claude-3-5-sonnet-... not found"**
- The script uses Claude 3.5 Sonnet. If you get a model not found error, the model version may need updating in the script.

**"No training step found"**
- The user needs a step with `wellness_dimension: "training"` in their action plan
- Create one through the onboarding flow first

### Safety

- The script always shows you the changes before applying them
- You must explicitly confirm (type 'y') before it saves to Supabase
- Type 'n' to exit without making changes

