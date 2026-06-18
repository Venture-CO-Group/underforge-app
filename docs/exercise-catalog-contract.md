# Exercise Catalog — Training Data Contract

**Audience:** the external coach-dashboard repo (and anyone editing user training plans or adding exercises, in the app or directly).

**Why this file exists:** the dashboard edits user **training plans**, which reference exercises by `id` and render the same **muscle-activation maps** the app shows. `assets/exercises/exercises.json` is the canonical catalog, but raw JSON doesn't tell you *which classification values are legal*, *what the muscle-map slugs are*, *how activation becomes a heat map*, or *what an added/changed exercise must carry*. This document is that contract — the training-plan analogue of [`coach-dashboard-data-model.md`](coach-dashboard-data-model.md), which covers the Supabase shape.

This is the **catalog + muscle-map contract**, not the whole training feature. Start here, then pull files from **underforge_app** only as the task needs them.

---

## Related files in the app repo (read on demand)

| If you need to understand… | Read in underforge_app |
| --- | --- |
| **Canonical catalog** (all exercises + taxonomy blocks) | `assets/exercises/exercises.json` |
| **Spanish names + videos** (one entry per id, 100% coverage) | `assets/exercises/exercise_es_overrides.json` |
| **Exercise / classification TypeScript types** | `types/workout.ts` (`Exercise`, `MuscleGroup`, `BodyRegion`, `BodyPartSlug`, `MuscleActivation`, `ExerciseCategory`, `CustomExercise`) |
| **Muscle-map logic** (slug set, group→slug fallback, aggregation, heatmap bucketing) | `lib/muscle-activation.ts` |
| **Load weighting** (heavier sets count more on the map) | `lib/workout-energy.ts` (`loadFactorForSet`) |
| **Strength-vs-cardio focus split** | `lib/training-focus.ts` |
| **Map renderer** (read-only body highlighter) | `components/MuscleActivationMap.tsx` |
| **Display-time id/name resolution** (legacy plan/log ids → catalog) | `lib/exercise-catalog.ts` (`resolveCatalogExercise`) |
| **Where the map appears** | `components/StepDetailContent.tsx` (plan day + whole-plan overlay), `components/WorkoutLogModal.tsx` (post-workout), `components/WeeklyProgressReportModal.tsx` (weekly check-in) |
| **Change-exercise picker** (muscle-group filter chips + All/Strength/Endurance category control) | `components/ExerciseSubstitutionModal.tsx`, `lib/exercise-search.ts` (`exerciseMatchesPickerCategory`) |
| **Add-your-own-exercise modal** (the custom-exercise create form) | `components/CustomExerciseModal.tsx` |
| **Reps vs duration input** (the picker that sets reps/time, and how `reps` is stored) | `lib/exercise-duration.ts`, `components/WorkoutLogModal.tsx` (reps picker) |
| **User-created custom exercises** (SQLite + the muscle-map fallback path) | `lib/custom-exercise-storage.ts`, `lib/db.ts` |
| **Dedup / homologation** (same movement → one entry) | `lib/exercise-harmonization.ts` |
| **How this doc stays in sync** | `scripts/generate-exercise-catalog-doc.js`, `docs/exercise-catalog-contract.config.json`, `package.json` (`exercise-catalog` scripts) |
| **Generators for derived files** | `scripts/generate_exercise_list.py` (→ `lib/exercise-list.ts`, LLM prompt list), `scripts/generate_muscle_activation.py` (→ `muscleActivation` data) |

The exercise **plan shape** itself (`WorkoutPlan` / `PlannedExercise` inside `step_details`) is documented with the rest of the plan blob in [`coach-dashboard-data-model.md`](coach-dashboard-data-model.md) (`types/workout.ts` is the source of truth). This contract covers the **catalog those plans draw from**.

---

## How this file stays correct (read before editing)

The inventory at the bottom is **generated** from `assets/exercises/exercises.json` + `exercise_es_overrides.json` + the muscle-map contract in `lib/muscle-activation.ts`, by `scripts/generate-exercise-catalog-doc.js`. You do not edit it by hand.

- It regenerates automatically on `npm start` / `npm run ios|android|web` and during EAS builds (wired through `package.json`), so it tracks the catalog without anyone remembering.
- CI / pre-commit can run `npm run exercise-catalog:check`, which **fails** if the doc is stale *or* the catalog violates any integrity rule.
- The prose **above** the generated block is hand-written; keep it current when behavior changes.
- Human descriptions of each classification axis live in `docs/exercise-catalog-contract.config.json`.

### Integrity rules enforced (the forcing function)

`exercise-catalog:check` fails the build if any of these are false — so the catalog can never drift out of contract:

1. Every `id` is unique and kebab-case; every exercise has an English `name`.
2. `bodyRegion`, `muscleGroup`, `movementType`, `category`, and every `equipment` token are values **declared in the taxonomy blocks** of `exercises.json`. `loggingUnit` is `reps` or `seconds`.
3. A `muscleGroup` belongs to the `bodyRegion` it's filed under.
4. Every `muscleActivation[].slug` is a `TRAINABLE_SLUG` (from `lib/muscle-activation.ts`) and `level` is 1–3.
5. Every exercise is renderable on the muscle map — it has explicit `muscleActivation`, **or** its `muscleGroup` has a `MUSCLE_GROUP_TO_SLUGS` fallback. Every muscle group has such a fallback.
6. Every `substitutionsRecommended` id resolves to a real exercise.
7. Every exercise has a Spanish `nameEs` + `videoUrlEs`, and no Spanish-override key is orphaned.

---

## The muscle map (how plans visualize worked muscles)

Plans display a body heat map per workout day and for the whole program; the dashboard should render the **same** map from the same data. The logic lives in `lib/muscle-activation.ts` — read it rather than reimplementing, but the algorithm is:

1. **Per exercise → activation.** Use `muscleActivation` if present (`{slug, level}` pairs, level 3/2/1). If absent (e.g. a custom exercise), fall back to `MUSCLE_GROUP_TO_SLUGS[muscleGroup]` at level 3. (`activationForExercise`.)
2. **Weight by volume.** Each exercise contributes `level × weight`, where `weight` is the summed per-set **load factor** (`loadFactorForSet` in `lib/workout-energy.ts`: a saturating `1 + 0.3·ln(1 + load/bodyweight)`, so heavy sets count more but a bodyweight set still registers at 1.0). In a *plan* the weight is the planned set count; in a *logged* workout it's the logged load. (`aggregateActivation`.)
3. **Bucket to a heatmap.** Normalize each muscle's summed score against the highest-scoring muscle and bucket into intensity 1–3 (`≥0.66 → 3`, `≥0.33 → 2`, else 1), so the map reads relatively regardless of absolute volume. (`scoresToBodyData`.)
4. The renderer is `components/MuscleActivationMap.tsx` (a read-only `react-native-body-highlighter`); slug labels come from the shared `bodymap` i18n namespace via `getSlugLabel`.

### Rendering it so it looks identical to the app

The app draws the map with **`react-native-body-highlighter` `^3.1.4`** (npm; there's a web build). To match the app's look exactly, feed `scoresToBodyData(...)` output (`{slug, intensity}` where intensity ∈ 1–3) into the `Body` component with these exact props — this is the whole recipe from `MuscleActivationMap.tsx`:

```jsx
// HEAT palette: index 0 = intensity 1 (low) → index 2 = intensity 3 (high)
const HEAT_COLORS = ['#EAC58F', '#E8A13C', '#F4552B']; // soft amber → amber → red-orange

// Two figures SIDE BY SIDE — render both, front then back:
['front', 'back'].map((side) => (
  <Body
    data={bodyData}              // [{ slug, intensity }] from scoresToBodyData()
    gender={gender}              // default 'female'; thread the user's gender when known
    side={side}
    scale={scale}                // app uses min((screenWidth * 0.42) / 220, 1) * sizeFactor
    border="#3A4D52"             // overlay mode uses 'rgba(255,255,255,0.35)'
    colors={HEAT_COLORS}         // intensity 1/2/3 → these three colors
    defaultFill="#1E2A2C"        // unworked muscles; overlay mode uses 'rgba(255,255,255,0.14)'
  />
))
```

Look-parity checklist: **front + back figures side by side** (not just front), the **`HEAT_COLORS` ramp** mapped to intensity 1→2→3, dark `defaultFill`/`border` for unworked muscles, and a **Light / Moderate / High** legend using the same three colors (i18n keys `bodymap:legendLow|legendMed|legendHigh`). The `intensity` values must come from step 3 above (relative bucketing) — passing raw scores or 0–100 will not match. There's also an `overlay` variant (transparent background, faint white fill, no side labels) used to float the figures over the plan-section image on the overview tab.

The **strength-vs-cardio focus bar** shown alongside the map is a separate split (`lib/training-focus.ts`): `power` counts as strength, `endurance`+`conditioning` as cardio, `mobility` excluded.

> **Legacy ids.** Older plans/logs store generic ids (`deadlift`, `dumbbell-press`) that don't match catalog ids (`barbell-deadlift`). Resolve them with `resolveCatalogExercise(id, name)` (`lib/exercise-catalog.ts`) **before** reading `category`/`muscleActivation`, or the map and focus split silently lose data.

---

## Adding or changing an exercise (use the muscle-map logic)

Whether the dashboard adds a catalog exercise or a user creates a custom one, the new entry **must satisfy the integrity rules above** — that's what keeps the map renderable and the plan editable:

- Pick `bodyRegion` / `muscleGroup` / `movementType` / `category` / `equipment` **only from the declared vocabulary** in the inventory below. A new value means first adding it to the taxonomy block in `exercises.json` (and, for a muscle group, a `MUSCLE_GROUP_TO_SLUGS` entry + the SQLite `CHECK` in `lib/db.ts`).
- Provide `muscleActivation` as `{slug, level}` pairs using **`TRAINABLE_SLUGS`** (level 3 primary / 2 secondary / 1 stabilizer). If you omit it, the map falls back to the muscle group's primary slugs — acceptable for quick custom entries, but explicit activation is more accurate. This is exactly the data the muscle map consumes, so an added exercise lights up the body map with no extra wiring.
- For catalog (non-custom) exercises, add the Spanish `nameEs` + `videoUrlEs` to `exercise_es_overrides.json`, and regenerate derived files: `python3 scripts/generate_muscle_activation.py` (activation) and `python3 scripts/generate_exercise_list.py` (the LLM prompt list `lib/exercise-list.ts`).
- The in-app **change-exercise** picker (`ExerciseSubstitutionModal.tsx`) filters candidates by muscle group via the same taxonomy; keeping `muscleGroup` correct is what makes an exercise show up under the right filter chip.

Per-field edit permissions for the dashboard are in `docs/exercise-catalog-contract.config.json` (`dashboardAccess`).

### Where the muscle map shows during add / change (today)

Be precise about what the app renders so the dashboard can match (or improve on) it:

- **Change exercise** (`ExerciseSubstitutionModal.tsx`): filters candidates along **two** independent dimensions.
  - A horizontal strip of **mini muscle-map chips** — one tiny `Body` per *muscle group*, the group highlighted. Tapping a chip filters the candidate list via `exerciseWorksMuscleGroup` (broad for `legs`, narrow for `calves`). It does **not** render the selected exercise's own `muscleActivation` heat map.
  - An **All / Strength / Endurance** segmented control (`ExercisePickerCategory` + `exerciseMatchesPickerCategory` in `lib/exercise-search.ts`) that filters by **catalog `category`**: `all` → no filter (the **default**); `strength` → category ≠ `endurance` and ≠ `conditioning`; `endurance` → category `endurance` **or** `conditioning`. Note this is a coarser two-way split layered on top of the finer catalog categories (so `power`/`mobility`/`strength` all fall under the picker's `strength`), and it is **distinct** from the `ExerciseCategory` taxonomy itself. The default landed on `all` so a substitution search starts unfiltered; a dashboard equivalent should default the same way.
- **Add your own exercise** (`CustomExerciseModal.tsx`): collects only `name`, `bodyRegion`, `muscleGroup`, `movementType`, `category` — **no map preview and no per-muscle activation editor.** A custom exercise therefore has no explicit `muscleActivation`; the map falls back to `MUSCLE_GROUP_TO_SLUGS[muscleGroup]` at level 3 (`activationForExercise`), so it still renders, just coarsely.

So the answer to "does the map show when adding/changing?" today: a **group-level** map drives the change-exercise *filter*, and the add-custom form shows **no** map. If the dashboard wants a live `MuscleActivationMap` preview (recommended — it makes the activation data tangible while editing), it can render `components/MuscleActivationMap.tsx` from `activationForExercise(exercise)` directly; the data contract already supports it. (Adding that preview to the in-app modals is a small follow-up if you want parity.)

### Adductors vs. abductors

We added `adductors` (inner thigh) because it is a real `react-native-body-highlighter` slug with its own drawable region, so the map can shade it. **There is no `abductors` slug** in the library (`Slug` = abs, adductors, biceps, calves, chest, deltoids, forearm, gluteal, hamstring, lower-back, obliques, quadriceps, tibialis, trapezius, triceps, upper-back, …). Hip **abduction** (gluteus medius/minimus) has no separate shape — it is rendered on `gluteal`, which is exactly how the catalog already classifies it (`hip-abduction` → `muscleGroup: glutes`, activation `gluteal`). So **don't add an `abductors` group**: it couldn't be drawn and would split glute work artificially. If finer glute detail is ever wanted, it belongs as activation nuance under `gluteal`, not a new group.

---

## Setting reps & duration (the overloaded `reps` field)

A plan/log row's `reps` is a **single string field that means different things by exercise**, and the app picks the input affordance from the exercise's `category` + `loggingUnit`. The dashboard must honor the same encoding when it edits a `PlannedExercise.reps`, or the app will mis-render and mis-aggregate it. Logic lives in `lib/exercise-duration.ts`; the in-app picker is in `components/WorkoutLogModal.tsx`.

| Exercise kind | Detected by | `reps` stores | Picker shown | Displayed as |
| --- | --- | --- | --- | --- |
| Strength / hypertrophy (default) | everything else | a **rep count or range** string, e.g. `"10"`, `"8-12"`, `"AMRAP"` | reps wheel **1–100** | the string itself |
| Isometric hold (plank, levers, wall sit) | `loggingUnit: 'seconds'`, non-endurance | **seconds** (integer), e.g. `"45"` | seconds wheel **5–600** (5s steps) | seconds |
| Steady-state cardio (run, bike, row…) | `category: 'endurance'` + `loggingUnit: 'seconds'` | **seconds**, e.g. `"1800"` for 30 min | **minutes** wheel (5–60 by 5, 70–120 by 10, 135–240 by 15) | minutes (`minutesToStorageSeconds` / `formatDurationMinutesForLog`) |

Rules the dashboard should follow:

- **Cardio/isometric `reps` is seconds, not reps.** For endurance the picker is in *minutes* but the stored value is **seconds** (minutes × 60). Use `isEnduranceDurationExercise(exercise)` to branch, `defaultRepsForExercise` for the default (5 min for cardio), and `formatStoredRepsForDisplay` / `parseDisplayToStoredSeconds` to convert for display/edit.
- **The picker snaps to presets** (`buildRepsPickerValues` + `findClosestPickerIndex`) rather than free text — it's a scroll wheel, so an edited value should land on a sensible step. The dashboard can offer free numeric entry, but should keep rep ranges as strings (`"8-12"`) and durations as whole seconds.
- **`sets`, `restTimeSeconds`, `rir`, `notes`** are separate `PlannedExercise` fields (see `types/workout.ts`); rest time has its own preset picker (`REST_TIME_OPTIONS`). Only `reps` carries the reps/seconds overload.

---

<!-- BEGIN GENERATED: exercise-inventory (managed by scripts/generate-exercise-catalog-doc.js — do not edit by hand) -->

<!-- catalog fingerprint: a267c44d9c63 -->

> This section is generated from `assets/exercises/exercises.json`,
> `assets/exercises/exercise_es_overrides.json`, and the muscle-map contract in
> `lib/muscle-activation.ts`. Do not edit it by hand — run `npm run exercise-catalog`.
> Catalog version **1.3.1** (updated 2026-06-10) · **192** exercises · Spanish coverage **192/192**.

### Integrity

✅ Catalog passes every integrity rule (see "Integrity rules enforced" above).

### Classification axes (the legal vocabulary)

Every exercise — including ones the dashboard adds — must use only these values.

**Body regions**

- `upper` — Upper body — chest, back, shoulders, arms. → muscle groups: `chest`, `back`, `shoulders`, `arms`
- `lower` — Lower body — legs and the hip/thigh/calf groups. → muscle groups: `legs`, `quads`, `hamstrings`, `glutes`, `adductors`, `calves`
- `core` — Trunk — abs and obliques. → muscle groups: `abs`, `obliques`

**Muscle groups** (the coarse `muscleGroup` field — one per exercise)

| group | region | exercises | maps to muscle-map slugs (fallback) | note |
| --- | --- | --- | --- | --- |
| `chest` | `upper` | 20 | `chest` | Pressing / pec-dominant. |
| `back` | `upper` | 30 | `upper-back` | Pulls, rows, spinal-erector work (incl. good-morning, back extension, rack pull — treated as back). |
| `shoulders` | `upper` | 25 | `deltoids` | Deltoid-dominant (presses, raises, face pulls, shrugs). |
| `arms` | `upper` | 19 | `biceps`, `triceps` | Biceps / triceps / forearm isolation. |
| `legs` | `lower` | 40 | `quadriceps`, `gluteal`, `hamstring` | Legs (compound) — general multi-joint leg work (squats, leg press, lunges, conventional + trap-bar deadlift, step-ups, jumps, sled, and running/cycling cardio). |
| `quads` | `lower` | 4 | `quadriceps` | Quad isolation (leg extension, sissy squat, wall sit). |
| `hamstrings` | `lower` | 6 | `hamstring` | Hamstring-dominant (RDL, stiff-leg DL, leg curls, Nordic curl). |
| `glutes` | `lower` | 11 | `gluteal` | Glute-dominant (hip thrust, glute bridge, sumo deadlift, pull-through, KB swing, abduction, kickbacks). |
| `adductors` | `lower` | 1 | `adductors` | Inner-thigh dominant (hip adduction, Copenhagen plank, lateral/Cossack squats & lunges). |
| `calves` | `lower` | 8 | `calves` | Gastrocnemius / soleus / tibialis lower-leg work. |
| `abs` | `core` | 18 | `abs` | Rectus abdominis / anterior core (incl. isometric holds like plank, levers). |
| `obliques` | `core` | 10 | `obliques` | Lateral core / rotation / anti-rotation (side plank, Russian twist, woodchop, Pallof). |

**Categories** (training emphasis; defaults to `strength` when omitted)

- `strength` (162) — Resistance / weightlifting, including isometric holds. The strength-vs-cardio focus split counts this (and power) as strength.
- `endurance` (13) — Steady-state cardio / locomotion (run, bike, row, swim, jump rope, elliptical, stair climber, walk, hike). Counts as cardio in the focus split.
- `conditioning` (9) — Higher-intensity metabolic work (burpee, mountain climber, battle rope, sled push, bear crawl). Counts as cardio in the focus split.
- `mobility` (4) — Flexibility / range-of-motion drills (stretches, dynamic mobility). Excluded from the strength-vs-cardio split.
- `power` (4) — Explosive / ballistic work (Olympic lifts, jumps & plyometrics, KB swing). Counts as strength in the focus split.

**Movement types**: `compound` — Multi-joint. · `isolation` — Single-joint.

**Logging units**: `reps` (default) · `seconds` — 27 exercise(s) log in seconds (isometrics + steady-state cardio).

**Equipment vocabulary** (61 tokens): `bodyweight`, `barbell`, `dumbbell`, `kettlebell`, `cable_machine`, `bench`, `incline_bench`, `decline_bench`, `preacher_bench`, `pull_up_bar`, `dip_bars`, `squat_rack`, `power_rack`, `smith_machine`, `leg_press_machine`, `hack_squat_machine`, `leg_extension_machine`, `leg_curl_machine`, `seated_leg_curl_machine`, `calf_raise_machine`, `seated_calf_raise_machine`, `donkey_calf_machine`, `hip_abduction_machine`, `glute_kickback_machine`, `hip_adduction_machine`, `pec_deck_machine`, `machine_chest_press`, `rowing_machine`, `row_machine`, `resistance_band`, `assistance_band`, `medicine_ball`, `ab_wheel`, `ez_bar`, `rope`, `ankle_strap`, `belt`, `t_bar`, `box`, `plyo_box`, `battle_rope`, `sled`, `pool`, `bike`, `stationary_bike`, `treadmill`, `outdoor`, `assisted_pullup_machine`, `dip_assist_machine`, `shoulder_press_machine`, `trap_bar`, `single_handle`, `wall`, `tib_bar`, `roman_chair`, `rings`, `parallettes`, `light_dumbbells`, `elliptical_machine`, `stair_climber_machine`, `jump_rope`.

### Muscle-map slugs (`muscleActivation[].slug`)

Finer than `muscleGroup`. These are the `react-native-body-highlighter` slugs the app and dashboard draw on the body map. `level` is 3 = primary, 2 = secondary, 1 = stabilizer. The renderer's canonical list is `TRAINABLE_SLUGS` in `lib/muscle-activation.ts`.

| slug | exercises using it |
| --- | --- |
| `chest` | 26 |
| `upper-back` | 33 |
| `lower-back` | 18 |
| `trapezius` | 38 |
| `deltoids` | 51 |
| `biceps` | 26 |
| `triceps` | 39 |
| `forearm` | 44 |
| `abs` | 35 |
| `obliques` | 14 |
| `quadriceps` | 55 |
| `hamstring` | 56 |
| `gluteal` | 65 |
| `adductors` | 28 |
| `calves` | 23 |
| `tibialis` | 2 |

### Full exercise inventory

Grouped by region → muscle group. `activation` is `slug:level`; `subs` are recommended substitution ids. The machine-readable source is `assets/exercises/exercises.json`; this table is the human-readable contract.

#### upper · chest (20)

| id | name | nameEs | movement | category | unit | equipment | activation | subs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `archer-push-up` | Archer Push-Up | Flexión arquero | compound | strength | reps | bodyweight | chest:3 triceps:2 deltoids:1 |  |
| `assisted-dip` | Assisted Dip (Band or Machine) | Fondos asistidos (banda o máquina) | compound | strength | reps | dip_bars assistance_band dip_assist_machine | chest:3 triceps:2 deltoids:1 | dip tricep-dip machine-chest-press |
| `barbell-bench-press` | Barbell Bench Press | Press de banca con barra | compound | strength | reps | barbell bench | chest:3 triceps:2 deltoids:1 | dumbbell-bench-press push-up machine-chest-press |
| `barbell-decline-bench-press` | Barbell Decline Bench Press | Press de banca declinado con barra | compound | strength | reps | barbell decline_bench | chest:3 triceps:2 deltoids:1 | dumbbell-bench-press push-up machine-chest-press |
| `barbell-incline-bench-press` | Barbell Incline Bench Press | Press de banca inclinado con barra | compound | strength | reps | barbell incline_bench | chest:3 triceps:2 deltoids:1 | dumbbell-bench-press push-up machine-chest-press |
| `cable-crossover` | Cable Crossover | Cruce de cables | isolation | strength | reps | cable_machine | chest:3 deltoids:1 | chest-fly pec-deck |
| `chest-fly` | Dumbbell Chest Fly | Aperturas con mancuernas (pecho) | isolation | strength | reps | dumbbell bench | chest:3 deltoids:1 | cable-crossover pec-deck |
| `clap-push-up` | Clap Push-Up | Flexiones con palmada | compound | strength | reps | bodyweight | chest:3 triceps:2 deltoids:1 |  |
| `decline-dumbbell-press` | Decline Dumbbell Press | Press declinado con mancuernas | compound | strength | reps | dumbbell decline_bench | chest:3 triceps:2 deltoids:1 | barbell-decline-bench-press dumbbell-bench-press dip |
| `diamond-push-up` | Diamond Push-Up | Flexiones en diamante | compound | strength | reps | bodyweight | triceps:3 chest:2 deltoids:1 |  |
| `dip` | Chest Dip | Fondos en paralelas (pecho) | compound | strength | reps | dip_bars | chest:3 triceps:2 deltoids:1 | push-up barbell-bench-press close-grip-bench-press |
| `dumbbell-bench-press` | Dumbbell Bench Press | Press de banca con mancuernas | compound | strength | reps | dumbbell bench | chest:3 triceps:2 deltoids:1 | barbell-bench-press push-up machine-chest-press |
| `dumbbell-fly` | Dumbbell Fly | Cruce con mancuernas (pecho) | isolation | strength | reps | dumbbell bench | chest:3 deltoids:1 | chest-fly cable-crossover pec-deck |
| `dumbbell-pullover` | Dumbbell Pullover | Pullover con mancuerna | isolation | strength | reps | dumbbell bench | chest:3 upper-back:2 triceps:1 | straight-arm-pulldown cable-crossover |
| `incline-cable-fly` | Incline Cable Fly | Aperturas en polea inclinada | isolation | strength | reps | cable_machine incline_bench | chest:3 deltoids:1 | cable-crossover chest-fly incline-dumbbell-press |
| `incline-dumbbell-press` | Incline Dumbbell Press | Press inclinado con mancuernas | compound | strength | reps | dumbbell incline_bench | chest:3 triceps:2 deltoids:1 | barbell-bench-press push-up machine-chest-press |
| `incline-push-up` | Incline Push-Up | Flexiones inclinadas | compound | strength | reps | bodyweight bench | chest:3 triceps:2 deltoids:1 |  |
| `machine-chest-press` | Machine Chest Press | Press de pecho en máquina | compound | strength | reps | machine_chest_press | chest:3 triceps:2 deltoids:1 | dumbbell-bench-press barbell-bench-press push-up |
| `pec-deck` | Pec Deck Machine | Aperturas en máquina (Pec deck) | isolation | strength | reps | pec_deck_machine | chest:3 deltoids:1 |  |
| `push-up` | Push-Up | Flexiones | compound | strength | reps | bodyweight | chest:3 triceps:2 deltoids:1 |  |

#### upper · back (30)

| id | name | nameEs | movement | category | unit | equipment | activation | subs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `assisted-pull-up` | Assisted Pull-Up (Band or Machine) | Dominada asistida | compound | strength | reps | pull_up_bar assistance_band assisted_pullup_machine | upper-back:3 biceps:2 forearm:1 trapezius:1 | lat-pulldown chin-up pull-up |
| `back-extension` | Back Extension (Neutral Spine) | Hiperextensión de espalda (columna neutra) | isolation | strength | reps | roman_chair bodyweight | lower-back:3 gluteal:2 hamstring:2 |  |
| `back-lever` | Back Lever | Back lever | isolation | strength | seconds | pull_up_bar rings | upper-back:3 chest:1 forearm:1 |  |
| `barbell-row` | Barbell Row | Remo con barra | compound | strength | reps | barbell | upper-back:3 biceps:2 forearm:1 trapezius:1 | dumbbell-row seated-cable-row t-bar-row chest-supported-row |
| `bird-dog` | Bird Dog | Bird dog | compound | strength | reps | bodyweight | abs:2 lower-back:2 gluteal:1 |  |
| `cat-cow` | Cat-Cow | Gato-camello (Cat-Cow) | compound | mobility | reps | bodyweight | abs:1 lower-back:1 | bird-dog thoracic-open-book worlds-greatest-stretch |
| `chest-supported-row` | Chest-Supported Row | Remo con apoyo de pecho | compound | strength | reps | bench dumbbell barbell | upper-back:3 biceps:2 forearm:1 trapezius:1 | dumbbell-row barbell-row seated-cable-row |
| `chin-up` | Chin-Up | Dominadas en supinación | compound | strength | reps | pull_up_bar | upper-back:3 biceps:2 forearm:1 trapezius:1 | assisted-pull-up lat-pulldown pull-up |
| `dumbbell-row` | Dumbbell Row | Remo con mancuerna | compound | strength | reps | dumbbell bench | upper-back:3 biceps:2 forearm:1 trapezius:1 | barbell-row seated-cable-row chest-supported-row |
| `face-pull` | Face Pull | Face pull | isolation | strength | reps | cable_machine rope | deltoids:3 trapezius:2 upper-back:2 | reverse-fly cable-crossover |
| `front-lever` | Front Lever | Front lever | isolation | strength | seconds | pull_up_bar | upper-back:3 abs:2 forearm:1 | tuck-front-lever |
| `good-morning` | Good Morning | Good morning | compound | strength | reps | barbell | hamstring:3 lower-back:3 gluteal:2 |  |
| `human-flag` | Human Flag | Bandera humana | isolation | strength | seconds | bodyweight | obliques:3 upper-back:3 deltoids:2 forearm:1 |  |
| `inverted-row` | Inverted Row | Remo invertido | compound | strength | reps | bodyweight barbell smith_machine | upper-back:3 biceps:2 forearm:1 trapezius:1 |  |
| `lat-pulldown` | Lat Pulldown | Jalón al pecho | compound | strength | reps | cable_machine | upper-back:3 biceps:2 forearm:1 trapezius:1 | pull-up assisted-pull-up chin-up |
| `machine-row` | Machine Row | Remo en máquina | compound | strength | reps | row_machine | upper-back:3 biceps:2 forearm:1 trapezius:1 | seated-cable-row chest-supported-row single-arm-cable-row |
| `muscle-up` | Muscle-Up | Muscle-up | compound | strength | reps | pull_up_bar | upper-back:3 biceps:2 triceps:2 chest:1 |  |
| `one-arm-dumbbell-row` | One-Arm Dumbbell Row | Remo con una mano | compound | strength | reps | dumbbell bench | upper-back:3 biceps:2 forearm:1 trapezius:1 | dumbbell-row seated-cable-row chest-supported-row |
| `pendlay-row` | Pendlay Row | Remo Pendlay | compound | strength | reps | barbell | upper-back:3 biceps:2 forearm:1 trapezius:1 | barbell-row t-bar-row |
| `pull-up` | Pull-Up | Dominadas en pronación | compound | strength | reps | pull_up_bar | upper-back:3 biceps:2 forearm:1 trapezius:1 | assisted-pull-up lat-pulldown chin-up |
| `rack-pull` | Rack Pull | Peso muerto parcial (rack pull) | compound | strength | reps | barbell power_rack | lower-back:3 gluteal:2 hamstring:2 trapezius:2 upper-back:2 forearm:1 |  |
| `rowing-machine` | Rowing Machine | Remoergómetro | compound | endurance | seconds | rowing_machine | upper-back:3 quadriceps:2 biceps:1 lower-back:1 |  |
| `seated-cable-row` | Seated Cable Row | Remo sentado en polea | compound | strength | reps | cable_machine | upper-back:3 biceps:2 forearm:1 trapezius:1 | barbell-row dumbbell-row t-bar-row |
| `single-arm-cable-row` | Single-Arm Cable Row | Remo en polea a un brazo | compound | strength | reps | cable_machine single_handle | upper-back:3 biceps:2 forearm:1 trapezius:1 | seated-cable-row one-arm-dumbbell-row machine-row |
| `ski-erg` | Ski Erg | Ski Erg (esquí ergómetro) | compound | endurance | seconds | rowing_machine | upper-back:3 triceps:2 abs:1 lower-back:1 |  |
| `straight-arm-pulldown` | Straight Arm Pulldown | Pullover en polea con brazos rectos | isolation | strength | reps | cable_machine | upper-back:3 triceps:1 |  |
| `swimming` | Swimming | Natación | compound | endurance | seconds | pool | upper-back:3 deltoids:2 chest:1 triceps:1 |  |
| `t-bar-row` | T-Bar Row | Remo en barra T | compound | strength | reps | t_bar barbell | upper-back:3 biceps:2 forearm:1 trapezius:1 |  |
| `thoracic-open-book` | Thoracic Open Book | Apertura torácica (libro abierto) | isolation | mobility | reps | bodyweight | obliques:1 upper-back:1 | cat-cow worlds-greatest-stretch wall-slide |
| `tuck-front-lever` | Tuck Front Lever | Front lever en tuck | isolation | strength | seconds | pull_up_bar | upper-back:3 abs:2 forearm:1 |  |

#### upper · shoulders (25)

| id | name | nameEs | movement | category | unit | equipment | activation | subs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `arnold-press` | Arnold Press | Press Arnold | compound | strength | reps | dumbbell | deltoids:3 triceps:2 trapezius:1 | dumbbell-shoulder-press dumbbell-overhead-press barbell-overhead-press |
| `band-external-rotation` | Band External Rotation | Rotación externa con banda | isolation | strength | reps | resistance_band | deltoids:2 | band-pull-apart face-pull prone-y-t-raises |
| `band-pull-apart` | Band Pull-Apart | Apertura con banda | isolation | strength | reps | resistance_band | deltoids:2 upper-back:2 trapezius:1 | face-pull reverse-fly prone-y-t-raises |
| `barbell-overhead-press` | Barbell Overhead Press | Press militar con barra | compound | strength | reps | barbell | deltoids:3 triceps:2 trapezius:1 | dumbbell-overhead-press dumbbell-shoulder-press arnold-press |
| `barbell-shrug` | Barbell Shrug | Encogimientos con barra | isolation | strength | reps | barbell dumbbell | trapezius:3 forearm:1 | dumbbell-shrug |
| `battle-rope` | Battle Rope Waves | Ondas con cuerda | compound | conditioning | seconds | battle_rope | deltoids:3 abs:2 forearm:2 |  |
| `cable-lateral-raise` | Cable Lateral Raise | Elevaciones laterales en polea | isolation | strength | reps | cable_machine | deltoids:3 | lateral-raise dumbbell-shoulder-press |
| `clean-and-press` | Clean and Press | Cargada y press | compound | power | reps | barbell dumbbell | deltoids:3 gluteal:2 quadriceps:2 trapezius:2 lower-back:1 triceps:1 |  |
| `dumbbell-overhead-press` | Dumbbell Overhead Press | Press vertical con mancuernas | compound | strength | reps | dumbbell | deltoids:3 triceps:2 trapezius:1 | barbell-overhead-press arnold-press dumbbell-shoulder-press |
| `dumbbell-shoulder-press` | Dumbbell Shoulder Press | Press de hombros con mancuernas | compound | strength | reps | dumbbell | deltoids:3 triceps:2 trapezius:1 | barbell-overhead-press arnold-press |
| `dumbbell-shrug` | Dumbbell Shrug | Encogimientos con mancuernas | isolation | strength | reps | dumbbell | trapezius:3 forearm:1 | barbell-shrug |
| `front-raise` | Front Raise | Elevaciones frontales | isolation | strength | reps | dumbbell | deltoids:3 | lateral-raise barbell-overhead-press |
| `half-kneeling-single-arm-db-press` | Half-Kneeling Single-Arm Dumbbell Press | Press con una mancuerna arrodillado | compound | strength | reps | dumbbell | deltoids:3 triceps:2 trapezius:1 | barbell-overhead-press arnold-press dumbbell-shoulder-press |
| `handstand-push-up` | Handstand Push-Up | Flexión en pino | compound | strength | reps | bodyweight | deltoids:3 triceps:2 abs:1 |  |
| `landmine-press` | Landmine Press | Press landmine | compound | strength | reps | barbell | deltoids:3 triceps:2 trapezius:1 | dumbbell-shoulder-press machine-shoulder-press |
| `lateral-raise` | Lateral Raise | Elevaciones laterales | isolation | strength | reps | dumbbell | deltoids:3 | cable-curl front-raise |
| `machine-shoulder-press` | Machine Shoulder Press | Press de hombros en máquina | compound | strength | reps | shoulder_press_machine | deltoids:3 triceps:2 trapezius:1 | dumbbell-shoulder-press dumbbell-overhead-press seated-overhead-press |
| `prone-y-t-raises` | Prone Y-T Raises | Elevaciones en Y-T prono | isolation | strength | reps | bodyweight light_dumbbells | deltoids:2 trapezius:2 upper-back:2 |  |
| `reverse-fly` | Reverse Fly | Pájaro (elevaciones posteriores) | isolation | strength | reps | dumbbell | deltoids:3 upper-back:2 trapezius:1 | face-pull |
| `scapular-push-up` | Scapular Push-Up | Flexión escapular | isolation | strength | reps | bodyweight | trapezius:2 chest:1 | push-up wall-slide band-pull-apart |
| `seated-overhead-press` | Seated Overhead Press | Press militar sentado | compound | strength | reps | barbell bench | deltoids:3 triceps:2 trapezius:1 | barbell-overhead-press dumbbell-shoulder-press |
| `shadow-boxing` | Shadow Boxing | Boxeo de sombra | compound | conditioning | seconds | bodyweight | deltoids:2 obliques:2 abs:1 |  |
| `skin-the-cat` | Skin the Cat | Skin the cat | isolation | strength | reps | pull_up_bar rings | deltoids:2 upper-back:2 forearm:1 |  |
| `upright-row` | Upright Row | Remo al mentón | compound | strength | reps | barbell dumbbell | deltoids:3 trapezius:2 biceps:1 |  |
| `wall-slide` | Wall Slide | Deslizamiento en la pared | isolation | strength | reps | wall | deltoids:1 trapezius:1 | band-external-rotation band-pull-apart prone-y-t-raises |

#### upper · arms (19)

| id | name | nameEs | movement | category | unit | equipment | activation | subs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `barbell-curl` | Barbell Curl | Curl de bíceps con barra | isolation | strength | reps | barbell | biceps:3 forearm:1 | dumbbell-curl hammer-curl cable-curl |
| `cable-curl` | Cable Curl | Curl en polea baja | isolation | strength | reps | cable_machine | biceps:3 forearm:1 |  |
| `cable-tricep-extension` | Cable Tricep Extension | Extensiones de tríceps en polea alta | isolation | strength | reps | cable_machine | triceps:3 | tricep-pushdown rope-pushdown skull-crusher |
| `close-grip-bench-press` | Close Grip Bench Press | Press de banca agarre cerrado | compound | strength | reps | barbell bench | triceps:3 chest:2 deltoids:1 | tricep-dip skull-crusher tricep-pushdown |
| `concentration-curl` | Concentration Curl | Curl concentrado | isolation | strength | reps | dumbbell | biceps:3 forearm:1 |  |
| `dumbbell-curl` | Dumbbell Curl | Curl de bíceps con mancuernas | isolation | strength | reps | dumbbell | biceps:3 forearm:1 | barbell-curl hammer-curl cable-curl |
| `ez-bar-curl` | EZ Bar Curl | Curl con barra Z | isolation | strength | reps | ez_bar | biceps:3 forearm:1 | barbell-curl dumbbell-curl preacher-curl |
| `hammer-curl` | Hammer Curl | Curl martillo | isolation | strength | reps | dumbbell | biceps:3 forearm:2 | dumbbell-curl barbell-curl cable-curl |
| `incline-dumbbell-curl` | Incline Dumbbell Curl | Curl inclinado con mancuernas | isolation | strength | reps | dumbbell incline_bench | biceps:3 forearm:1 | seated-dumbbell-curl dumbbell-curl hammer-curl |
| `lying-tricep-extension` | Lying Tricep Extension | Extensiones de tríceps tumbado | isolation | strength | reps | ez_bar dumbbell bench | triceps:3 | skull-crusher overhead-tricep-extension tricep-pushdown |
| `overhead-tricep-extension` | Overhead Tricep Extension | Extensiones de tríceps por encima de la cabeza | isolation | strength | reps | dumbbell | triceps:3 | tricep-pushdown rope-pushdown skull-crusher |
| `preacher-curl` | Preacher Curl | Curl en banco Scott | isolation | strength | reps | ez_bar preacher_bench | biceps:3 forearm:1 |  |
| `reverse-wrist-curl` | Reverse Wrist Curl | Curl de muñecas inverso | isolation | strength | reps | barbell dumbbell | forearm:3 |  |
| `rope-pushdown` | Rope Tricep Pushdown | Extensiones de tríceps con cuerda | isolation | strength | reps | cable_machine rope | triceps:3 | overhead-tricep-extension cable-tricep-extension |
| `seated-dumbbell-curl` | Seated Dumbbell Curl | Curl sentado con mancuernas | isolation | strength | reps | dumbbell bench | biceps:3 forearm:1 | dumbbell-curl incline-dumbbell-curl preacher-curl |
| `skull-crusher` | Skull Crusher | Press francés (skull crusher) | isolation | strength | reps | ez_bar bench | triceps:3 |  |
| `tricep-dip` | Tricep Dip | Fondos de tríceps | compound | strength | reps | dip_bars bench | triceps:3 | close-grip-bench-press tricep-pushdown skull-crusher |
| `tricep-pushdown` | Tricep Pushdown | Press de tríceps en polea alta | isolation | strength | reps | cable_machine | triceps:3 | rope-pushdown overhead-tricep-extension cable-tricep-extension |
| `wrist-curl` | Wrist Curl | Curl de muñecas | isolation | strength | reps | barbell dumbbell | forearm:3 |  |

#### lower · legs (40)

| id | name | nameEs | movement | category | unit | equipment | activation | subs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `assault-bike` | Assault Bike (Air Bike) | Bicicleta de asalto (Air Bike) | compound | endurance | seconds | bike | quadriceps:3 calves:2 gluteal:2 hamstring:2 |  |
| `barbell-back-squat` | Barbell Back Squats | Sentadilla trasera con barra | compound | strength | reps | barbell squat_rack | quadriceps:3 gluteal:2 adductors:1 hamstring:1 |  |
| `barbell-deadlift` | Barbell Deadlift | Peso muerto con barra | compound | strength | reps | barbell | gluteal:3 hamstring:3 lower-back:3 forearm:2 quadriceps:2 trapezius:2 upper-back:1 |  |
| `barbell-front-squat` | Barbell Front Squat | Sentadilla frontal con barra | compound | strength | reps | barbell squat_rack | quadriceps:3 gluteal:2 adductors:1 hamstring:1 | dumbbell-front-squat goblet-squat barbell-back-squat |
| `box-jump` | Box Jump | Salto al cajón | compound | power | reps | plyo_box | quadriceps:3 calves:2 gluteal:2 hamstring:1 |  |
| `box-squat` | Box Squat | Sentadilla al cajón | compound | strength | reps | box barbell | quadriceps:3 calves:2 gluteal:2 hamstring:1 | barbell-back-squat barbell-front-squat |
| `bulgarian-split-squat` | Bulgarian Split Squat | Zancada búlgara | compound | strength | reps | bench dumbbell | quadriceps:3 gluteal:2 adductors:1 hamstring:1 | reverse-lunge walking-lunge step-up |
| `cossack-squat` | Cossack Squat | Sentadilla cosaca | compound | strength | reps | bodyweight dumbbell kettlebell | adductors:3 gluteal:2 quadriceps:2 hamstring:1 | lateral-lunge lateral-squat hip-adduction-machine |
| `cycling` | Cycling | Ciclismo | compound | endurance | seconds | bike stationary_bike | quadriceps:3 calves:2 gluteal:2 hamstring:2 |  |
| `dumbbell-deadlift` | Dumbbell Deadlift | Peso muerto con mancuernas | compound | strength | reps | dumbbell | gluteal:3 hamstring:3 forearm:2 lower-back:2 quadriceps:2 |  |
| `dumbbell-front-squat` | Dumbbell Front Squat | Sentadilla frontal con mancuernas | compound | strength | reps | dumbbell | quadriceps:3 gluteal:2 adductors:1 hamstring:1 | barbell-front-squat goblet-squat kettlebell-front-squat-single |
| `elliptical` | Elliptical | Elíptica | compound | endurance | seconds | elliptical_machine | quadriceps:3 calves:2 gluteal:2 hamstring:2 |  |
| `goblet-squat` | Goblet Squat | Sentadilla goblet | compound | strength | reps | dumbbell kettlebell | quadriceps:3 gluteal:2 adductors:1 hamstring:1 | dumbbell-front-squat barbell-front-squat kettlebell-front-squat-single |
| `hack-squat` | Hack Squat | Sentadilla en máquina hack | compound | strength | reps | hack_squat_machine | quadriceps:3 gluteal:2 adductors:1 hamstring:1 |  |
| `high-knees` | High Knees | Rodillas altas | compound | conditioning | reps | bodyweight | quadriceps:3 gluteal:2 adductors:1 hamstring:1 |  |
| `hiking` | Hiking | Senderismo | compound | endurance | reps | outdoor | quadriceps:3 calves:2 gluteal:2 hamstring:2 | walking incline-walking stair-climber |
| `incline-walking` | Incline Walking | Caminata inclinada | compound | endurance | reps | treadmill | quadriceps:3 calves:2 gluteal:2 hamstring:2 | walking hiking stair-climber |
| `jump-squat` | Jump Squat | Sentadilla con salto | compound | power | reps | bodyweight | quadriceps:3 calves:2 gluteal:2 hamstring:1 |  |
| `kettlebell-front-squat-double` | Double Kettlebell Front Squat | Sentadilla frontal con dos kettlebells | compound | strength | reps | kettlebell | quadriceps:3 gluteal:2 adductors:1 hamstring:1 | goblet-squat dumbbell-front-squat barbell-front-squat |
| `kettlebell-front-squat-single` | Single Kettlebell Front Squat | Sentadilla frontal con una kettlebell | compound | strength | reps | kettlebell | quadriceps:3 gluteal:2 adductors:1 hamstring:1 | goblet-squat dumbbell-front-squat barbell-front-squat |
| `lateral-lunge` | Lateral Lunge | Zancada lateral | compound | strength | reps | bodyweight dumbbell kettlebell | adductors:3 gluteal:2 quadriceps:2 | lateral-squat cossack-squat reverse-lunge |
| `lateral-squat` | Lateral Squat (Crab Squat) | Sentadilla lateral (cangrejo) | compound | strength | reps | bodyweight dumbbell | adductors:3 gluteal:2 quadriceps:2 |  |
| `leg-press` | Leg Press | Prensa de piernas | compound | strength | reps | leg_press_machine | quadriceps:3 gluteal:2 adductors:1 hamstring:1 | barbell-back-squat barbell-front-squat hack-squat |
| `pistol-squat` | Pistol Squat | Sentadilla pistola | compound | strength | reps | bodyweight | quadriceps:3 gluteal:2 adductors:1 hamstring:1 |  |
| `reverse-lunge` | Reverse Lunge | Zancada inversa | compound | strength | reps | bodyweight dumbbell | quadriceps:3 gluteal:2 adductors:1 hamstring:1 | walking-lunge bulgarian-split-squat step-up |
| `rucking` | Rucking | Marcha con mochila lastrada | compound | endurance | seconds | outdoor | quadriceps:3 calves:2 gluteal:2 hamstring:2 |  |
| `running` | Running | Correr | compound | endurance | seconds | treadmill outdoor | quadriceps:3 calves:2 gluteal:2 hamstring:2 |  |
| `shrimp-squat` | Shrimp Squat | Sentadilla gamba | compound | strength | reps | bodyweight | quadriceps:3 gluteal:2 adductors:1 hamstring:1 |  |
| `sled-push` | Sled Push | Trineo (empuje) | compound | conditioning | seconds | sled | quadriceps:3 gluteal:2 adductors:1 hamstring:1 |  |
| `split-squat` | Split Squat | Sentadilla dividida (split) | compound | strength | reps | bodyweight dumbbell | quadriceps:3 gluteal:2 adductors:1 hamstring:1 | reverse-lunge walking-lunge bulgarian-split-squat |
| `sprint-intervals` | Sprint Intervals | Sprints por intervalos | compound | conditioning | seconds | outdoor | quadriceps:3 calves:2 gluteal:2 hamstring:2 |  |
| `stair-climber` | Stair Climber | Subida de escaleras (máquina) | compound | endurance | seconds | stair_climber_machine | quadriceps:3 calves:2 gluteal:2 hamstring:2 |  |
| `step-up` | Step-Up | Subidas al cajón | compound | strength | reps | box dumbbell | quadriceps:3 gluteal:2 adductors:1 hamstring:1 | walking-lunge bulgarian-split-squat reverse-lunge |
| `sumo-squat` | Sumo Squat | Sentadilla sumo | compound | strength | reps | bodyweight dumbbell kettlebell | gluteal:3 quadriceps:3 adductors:2 hamstring:1 |  |
| `thruster` | Thruster | Thruster | compound | strength | reps | barbell dumbbell | quadriceps:3 calves:2 gluteal:2 hamstring:1 |  |
| `trap-bar-deadlift` | Trap / Hex Bar Deadlift | Peso muerto con barra hexagonal | compound | strength | reps | trap_bar | gluteal:3 quadriceps:3 forearm:2 hamstring:2 lower-back:2 trapezius:2 | barbell-deadlift dumbbell-deadlift sumo-deadlift |
| `walking` | Walking | Caminar | compound | endurance | reps | outdoor treadmill | quadriceps:3 calves:2 gluteal:2 hamstring:2 | incline-walking hiking elliptical |
| `walking-lunge` | Walking Lunge | Zancada caminando | compound | strength | reps | bodyweight dumbbell | quadriceps:3 calves:2 gluteal:2 hamstring:2 | reverse-lunge bulgarian-split-squat step-up |
| `worlds-greatest-stretch` | World's Greatest Stretch | El mejor estiramiento del mundo | compound | mobility | reps | bodyweight | adductors:1 gluteal:1 hamstring:1 quadriceps:1 | couch-stretch 90-90-hip-switch thoracic-open-book |
| `zercher-squat` | Zercher Squat | Sentadilla Zercher | compound | strength | reps | barbell squat_rack | quadriceps:3 gluteal:2 adductors:1 hamstring:1 | barbell-front-squat goblet-squat barbell-back-squat |

#### lower · quads (4)

| id | name | nameEs | movement | category | unit | equipment | activation | subs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `couch-stretch` | Couch Stretch | Estiramiento del sofá | isolation | mobility | reps | bodyweight bench wall | quadriceps:1 | worlds-greatest-stretch split-squat lateral-lunge |
| `leg-extension` | Leg Extension | Extensiones de rodilla en máquina | isolation | strength | reps | leg_extension_machine | quadriceps:3 | barbell-back-squat leg-press |
| `sissy-squat` | Sissy Squat | Sissy squat | isolation | strength | reps | bodyweight | quadriceps:3 gluteal:2 adductors:1 hamstring:1 |  |
| `wall-sit` | Wall Sit | Cuadrado en pared | isolation | strength | seconds | bodyweight | quadriceps:3 |  |

#### lower · hamstrings (6)

| id | name | nameEs | movement | category | unit | equipment | activation | subs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `leg-curl` | Lying Leg Curl | Curl femoral tumbado | isolation | strength | reps | leg_curl_machine | hamstring:3 gluteal:1 | romanian-deadlift seated-leg-curl nordic-hamstring-curl |
| `nordic-hamstring-curl` | Nordic Hamstring Curl | Curl nórdico de isquios | isolation | strength | reps | bodyweight | hamstring:3 gluteal:1 |  |
| `romanian-deadlift` | Romanian Deadlift | Peso muerto rumano | compound | strength | reps | barbell dumbbell | gluteal:3 hamstring:3 lower-back:2 forearm:1 | barbell-deadlift stiff-leg-deadlift good-morning |
| `seated-leg-curl` | Seated Leg Curl | Curl femoral sentado | isolation | strength | reps | seated_leg_curl_machine | hamstring:3 gluteal:1 | romanian-deadlift leg-curl nordic-hamstring-curl |
| `single-leg-romanian-deadlift` | Single-Leg Romanian Deadlift | Peso muerto rumano a una pierna | compound | strength | reps | bodyweight dumbbell kettlebell | gluteal:3 hamstring:3 abs:1 lower-back:1 | romanian-deadlift stiff-leg-deadlift good-morning |
| `stiff-leg-deadlift` | Stiff Leg Deadlift | Peso muerto con piernas rígidas | compound | strength | reps | barbell | hamstring:3 gluteal:2 lower-back:2 | romanian-deadlift barbell-deadlift good-morning |

#### lower · glutes (11)

| id | name | nameEs | movement | category | unit | equipment | activation | subs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `90-90-hip-switch` | 90/90 Hip Switch | Cambio de cadera 90/90 | compound | strength | reps | bodyweight | gluteal:2 adductors:1 | worlds-greatest-stretch couch-stretch clamshell |
| `cable-kickback` | Cable Kickback | Patada trasera en polea | isolation | strength | reps | cable_machine ankle_strap | gluteal:3 hamstring:1 | glute-kickback donkey-kick hip-abduction |
| `cable-pull-through` | Cable Pull Through | Pull-through en polea baja | compound | strength | reps | cable_machine rope | gluteal:3 hamstring:2 lower-back:1 |  |
| `clamshell` | Clamshell | Concha (clam shell) | isolation | strength | reps | resistance_band bodyweight | gluteal:3 |  |
| `donkey-kick` | Donkey Kick | Patada de burro | isolation | strength | reps | bodyweight | gluteal:3 hamstring:1 | cable-kickback glute-kickback hip-abduction |
| `glute-bridge` | Glute Bridge | Puente de glúteos | compound | strength | reps | bodyweight barbell | gluteal:3 hamstring:2 | hip-thrust sumo-deadlift |
| `glute-kickback` | Glute Kickback Machine | Patada de glúteo en máquina | isolation | strength | reps | glute_kickback_machine | gluteal:3 hamstring:1 | cable-kickback donkey-kick hip-abduction |
| `hip-abduction` | Hip Abduction Machine | Abducción de cadera en máquina | isolation | strength | reps | hip_abduction_machine | gluteal:3 adductors:1 |  |
| `hip-thrust` | Hip Thrust | Elevación de cadera (hip thrust) | compound | strength | reps | barbell bench | gluteal:3 hamstring:2 quadriceps:1 | glute-bridge romanian-deadlift sumo-deadlift |
| `kettlebell-swing` | Kettlebell Swing | Swing con kettlebell | compound | power | reps | kettlebell | gluteal:3 hamstring:2 lower-back:2 deltoids:1 forearm:1 quadriceps:1 |  |
| `sumo-deadlift` | Sumo Deadlift | Peso muerto sumo | compound | strength | reps | barbell | gluteal:3 adductors:2 hamstring:2 lower-back:2 quadriceps:2 forearm:1 trapezius:1 |  |

#### lower · adductors (1)

| id | name | nameEs | movement | category | unit | equipment | activation | subs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `hip-adduction-machine` | Hip Adduction Machine | Máquina de aducción de cadera | isolation | strength | reps | hip_adduction_machine | adductors:3 gluteal:1 | copenhagen-plank lateral-lunge cossack-squat |

#### lower · calves (8)

| id | name | nameEs | movement | category | unit | equipment | activation | subs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ankle-rocks` | Ankle Rocks | Balanceo de tobillos | isolation | strength | reps | bodyweight wall | calves:1 tibialis:1 | tibialis-raise calf-raise couch-stretch |
| `calf-raise` | Calf Raises | Elevaciones de gemelos | isolation | strength | reps | calf_raise_machine smith_machine bodyweight | calves:3 |  |
| `donkey-calf-raise` | Donkey Calf Raise | Gemelo en burro | isolation | strength | reps | donkey_calf_machine belt | calves:3 |  |
| `jump-rope` | Jump Rope | Saltar a la comba | compound | endurance | seconds | jump_rope | calves:3 quadriceps:1 |  |
| `seated-calf-raise` | Seated Calf Raise | Gemelo sentado | isolation | strength | reps | seated_calf_raise_machine | calves:3 |  |
| `single-leg-calf-raise` | Single Leg Calf Raise | Gemelo a una pierna | isolation | strength | reps | bodyweight dumbbell | calves:3 |  |
| `standing-calf-raise` | Standing Calf Raise | Gemelo de pie | isolation | strength | reps | calf_raise_machine smith_machine | calves:3 |  |
| `tibialis-raise` | Tibialis Raise | Elevación de tibial | isolation | strength | reps | bodyweight wall tib_bar | tibialis:3 | single-leg-calf-raise calf-raise ankle-rocks |

#### core · abs (18)

| id | name | nameEs | movement | category | unit | equipment | activation | subs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ab-rollout` | Ab Rollout | Rueda abdominal | compound | strength | reps | ab_wheel barbell | abs:3 lower-back:1 |  |
| `bear-crawl` | Bear Crawl | Caminata del oso | compound | conditioning | seconds | bodyweight | abs:3 deltoids:2 quadriceps:2 triceps:1 |  |
| `burpee` | Burpee | Burpee | compound | conditioning | reps | bodyweight | abs:2 chest:2 quadriceps:2 deltoids:1 triceps:1 |  |
| `cable-crunch` | Cable Crunch | Abdominales en polea alta | isolation | strength | reps | cable_machine rope | abs:3 | sit-up leg-raise |
| `crunch` | Crunch | Abdominales cortos (crunch) | isolation | strength | reps | bodyweight | abs:3 | sit-up leg-raise cable-crunch |
| `dead-bug` | Dead Bug | Dead bug | compound | strength | reps | bodyweight | abs:3 | plank hollow-body-hold bird-dog |
| `farmers-walk` | Farmer's Walk | Farmer walk | compound | strength | seconds | dumbbell kettlebell | forearm:3 abs:2 trapezius:2 gluteal:1 |  |
| `hanging-leg-raise` | Hanging Leg Raise | Elevación de piernas colgado | compound | strength | reps | pull_up_bar | abs:3 forearm:1 | crunch v-up |
| `hollow-body-hold` | Hollow Body Hold | Hollow body | compound | strength | seconds | bodyweight | abs:3 |  |
| `jumping-jack` | Jumping Jack | Saltos de tijera | compound | conditioning | reps | bodyweight | calves:2 deltoids:2 quadriceps:1 |  |
| `l-sit` | L-Sit | L-sit | isolation | strength | seconds | bodyweight parallettes | abs:3 quadriceps:1 |  |
| `leg-raise` | Lying Leg Raise | Elevación de piernas tumbado | isolation | strength | reps | bodyweight | abs:3 | hanging-leg-raise crunch v-up |
| `mountain-climber` | Mountain Climber | Mountain climber | compound | conditioning | reps | bodyweight | abs:3 quadriceps:2 deltoids:1 |  |
| `plank` | Plank | Plancha frontal | compound | strength | seconds | bodyweight | abs:3 obliques:1 | dead-bug hollow-body-hold ab-rollout |
| `reverse-crunch` | Reverse Crunch | Crunch invertido | isolation | strength | reps | bodyweight | abs:3 | leg-raise crunch dead-bug |
| `sit-up` | Sit-Up | Abdominales completos | compound | strength | reps | bodyweight | abs:3 |  |
| `toes-to-bar` | Toes-to-Bar | Pies a la barra | isolation | strength | reps | pull_up_bar | abs:3 forearm:1 upper-back:1 |  |
| `v-up` | V-Up | Abdominal en V | compound | strength | reps | bodyweight | abs:3 |  |

#### core · obliques (10)

| id | name | nameEs | movement | category | unit | equipment | activation | subs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `bicycle-crunch` | Bicycle Crunch | Abdominal en bicicleta | compound | strength | reps | bodyweight | abs:3 obliques:2 |  |
| `copenhagen-plank` | Copenhagen Plank | Plancha de Copenhague | compound | strength | reps | bodyweight bench | adductors:3 obliques:2 | side-plank side-plank-knees-bent hip-adduction-machine |
| `oblique-crunch` | Oblique Crunch | Abdominal oblicuo | isolation | strength | reps | bodyweight | obliques:3 abs:1 |  |
| `pallof-press` | Pallof Press | Pallof press | compound | strength | reps | cable_machine resistance_band | obliques:3 abs:2 | standing-pallof-hold woodchop russian-twist |
| `russian-twist` | Russian Twist | Giro ruso | isolation | strength | reps | bodyweight medicine_ball | obliques:3 abs:2 | bicycle-crunch oblique-crunch woodchop |
| `side-plank` | Side Plank | Plancha lateral | compound | strength | seconds | bodyweight | obliques:3 abs:1 | side-plank-knees-bent oblique-crunch |
| `side-plank-knees-bent` | Side Plank (Knees Bent) | Plancha lateral con rodillas flexionadas | compound | strength | seconds | bodyweight | obliques:3 abs:1 | side-plank oblique-crunch |
| `standing-pallof-hold` | Standing Pallof Hold | Pallof press isométrico de pie | isolation | strength | seconds | cable_machine resistance_band | obliques:3 abs:2 | pallof-press woodchop russian-twist |
| `suitcase-carry` | Suitcase Carry | Transporte tipo maletín | compound | strength | reps | dumbbell kettlebell | obliques:3 forearm:2 abs:1 trapezius:1 | farmers-walk side-plank pallof-press |
| `woodchop` | Cable Woodchop | Corte de madera en polea | compound | strength | reps | cable_machine | obliques:3 abs:1 deltoids:1 |  |

<!-- END GENERATED: exercise-inventory -->
