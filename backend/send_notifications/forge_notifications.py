"""
Condition-based notification templates for UnderForge.

Notifications are selected based on the user's tracking state:
  - meals_today: number of meals logged today
  - workout_scheduled: whether a workout is on the plan for today
  - workout_done: whether the workout has been logged

Each template supports ${username} placeholder replacement.

┌─────────────────────────────┬───────────────────────────────────────────────────┐
│  State Key                  │  Condition                                        │
├─────────────────────────────┼───────────────────────────────────────────────────┤
│  forge_cold                 │  0 meals, no workout done                         │
│  workout_only               │  0 meals, workout IS done                         │
│  meals_going_workout_pending│  1+ meals, workout scheduled but NOT done         │
│  meals_going_rest_day       │  1+ meals, no workout scheduled today             │
│  crushing_it                │  1+ meals AND workout done                        │
└─────────────────────────────┴───────────────────────────────────────────────────┘

Time slots: "midday" (~12:00) and "evening" (~19:00).
Pre-workout: standalone set for 5-min-before reminders.
"""

from typing import Dict, List

# ── Midday notifications (sent around 12:00 local) ────────────────────────────

MIDDAY_FORGE_COLD: List[Dict[str, str]] = [
    {
        "title": "The forge awaits 🔥",
        "body": "Hey ${username}, no logs yet today. Time to light the fire — log your first meal and start forging!",
    },
    {
        "title": "Cold iron won't shape itself",
        "body": "${username}, the forge is waiting for its first spark. Log a meal and get the heat going!",
    },
    {
        "title": "Time to fire up the forge",
        "body": "Nothing logged yet — but the day is young. Come get forged, ${username}!",
    },
    {
        "title": "Your forge needs fuel ⚒️",
        "body": "No meals or workouts logged yet. Even the finest blade starts with the first strike — log something!",
    },
]

MIDDAY_WORKOUT_ONLY: List[Dict[str, str]] = [
    {
        "title": "Workout forged! Now fuel up 💪",
        "body": "${username}, the iron is shaped — now give it strength. Log a meal to keep the forge roaring!",
    },
    {
        "title": "Strong start at the anvil",
        "body": "Workout done, but the smith needs fuel! Log your meals, ${username}, and keep forging.",
    },
    {
        "title": "The anvil rang this morning ⚒️",
        "body": "Great workout, ${username}! Now feed the forge — log what you've been eating.",
    },
]

MIDDAY_MEALS_GOING_WORKOUT_PENDING: List[Dict[str, str]] = [
    {
        "title": "Fuel is in — time to hammer 🔨",
        "body": "${username}, meals are logged! Your workout is still on the anvil — ready to forge it?",
    },
    {
        "title": "The forge has fuel",
        "body": "Meals going strong! Don't let today's workout cool off, ${username}. Time to strike!",
    },
    {
        "title": "Good fuel, now bring the heat",
        "body": "${username}, you've fed the forge. Your workout is waiting to be hammered out!",
    },
    {
        "title": "Iron's warm, workout's waiting ⚒️",
        "body": "Meals logged — great. Now let's shape that iron! Log your workout today, ${username}.",
    },
]

MIDDAY_MEALS_GOING_REST_DAY: List[Dict[str, str]] = [
    {
        "title": "Forge fueled up ✅",
        "body": "${username}, meals logged and no workout on the anvil today. Rest day fueling done right!",
    },
    {
        "title": "Keeping the fire steady 🔥",
        "body": "Nice meal logging, ${username}! Rest days forge recovery. Keep tracking what you eat!",
    },
    {
        "title": "Recovery fuel on point",
        "body": "Meals logged, rest day on the schedule. Even the forge cools between blades, ${username}.",
    },
]

MIDDAY_CRUSHING_IT: List[Dict[str, str]] = [
    {
        "title": "The forge is ROARING 🔥",
        "body": "${username}, meals and workout logged — you're hammering it today! Keep forging.",
    },
    {
        "title": "White-hot progress ⚒️",
        "body": "Workout done, meals tracked — ${username}, you're shaping something incredible today!",
    },
    {
        "title": "Forged and fueled 💪",
        "body": "${username}, you've already hit meals and workout today. Legendary smith energy!",
    },
    {
        "title": "Absolute anvil day",
        "body": "Meals ✅ Workout ✅ ${username}, the forge is proud. Keep this heat going!",
    },
]


# ── Evening notifications (sent around 19:00 local) ───────────────────────────

EVENING_FORGE_COLD: List[Dict[str, str]] = [
    {
        "title": "Day's not over yet",
        "body": "${username}, the forge is still warm. Log what you've eaten — every bit counts!",
    },
    {
        "title": "Still time to strike ⚒️",
        "body": "Nothing logged today, ${username} — but the evening is a great time to catch up. Log your meals!",
    },
    {
        "title": "Late sparks still forge",
        "body": "Hey ${username}, the day may be winding down but it's not too late to log. Come get forged!",
    },
]

EVENING_WORKOUT_ONLY: List[Dict[str, str]] = [
    {
        "title": "Workout done — feed the smith 🍽️",
        "body": "${username}, great workout today! Don't forget to log your meals — the forge needs fuel.",
    },
    {
        "title": "Hammered the workout ✅",
        "body": "Iron shaped, but meals untracked. Log your dinner, ${username}, and complete the forge!",
    },
    {
        "title": "Strong at the anvil today",
        "body": "Workout logged — now give the smith some dinner, ${username}. Log those meals!",
    },
]

EVENING_MEALS_GOING_WORKOUT_PENDING: List[Dict[str, str]] = [
    {
        "title": "Meals tracked, workout still on the anvil",
        "body": "${username}, you've fueled up nicely. Did you get that workout in? Log it before the forge cools!",
    },
    {
        "title": "Fuel's there — did you hammer? 🔨",
        "body": "Meals going strong, ${username}! If you did your workout, log it now and seal the day.",
    },
    {
        "title": "Don't let the iron cool",
        "body": "${username}, meals are tracked. If you trained today, log it — your evening forge awaits!",
    },
]

EVENING_MEALS_GOING_REST_DAY: List[Dict[str, str]] = [
    {
        "title": "Solid rest day, ${username} 🔥",
        "body": "Meals tracked, rest day earned. The forge recovers tonight — come back stronger tomorrow!",
    },
    {
        "title": "Recovery day well fueled",
        "body": "${username}, great job logging meals on your rest day. Smart smiths know when to cool the forge.",
    },
    {
        "title": "Rest day forged right ✅",
        "body": "Meals logged, body recovering. Tomorrow the anvil rings again, ${username}!",
    },
]

EVENING_CRUSHING_IT: List[Dict[str, str]] = [
    {
        "title": "What a forge day! 🔥",
        "body": "${username}, meals and workout locked in. Today's blade is sharp — you earned this evening!",
    },
    {
        "title": "Fully forged today 💪",
        "body": "Workout ✅ Meals ✅ ${username}, the smith is proud. Rest up and do it again tomorrow!",
    },
    {
        "title": "Anvil day complete ⚒️",
        "body": "${username}, everything logged, everything forged. This is how legends are made. Rest well!",
    },
    {
        "title": "The forge glows tonight",
        "body": "Incredible day, ${username} — meals tracked, workout hammered. Sleep well, forgemaster!",
    },
]


# ── Pre-workout reminders (5 min before scheduled time) ───────────────────────

PRE_WORKOUT: List[Dict[str, str]] = [
    {
        "title": "Time to hit the anvil ⚒️",
        "body": "Your workout starts soon, ${username}! Lace up and get ready to forge.",
    },
    {
        "title": "The forge is heating up 🔥",
        "body": "${username}, workout time in 5 min! Time to shape some iron.",
    },
    {
        "title": "Anvil's calling, ${username}",
        "body": "Your workout is about to begin. Warm up and come get forged!",
    },
    {
        "title": "Ready to forge? 💪",
        "body": "5 minutes until workout time, ${username}. The iron is hot — time to strike!",
    },
    {
        "title": "Smith up, ${username}!",
        "body": "Workout incoming! Grab your gear and let's forge some muscle.",
    },
]


# ── Weekly check-in prompts (Sunday 16:00) ─────────────────────────────────────

WEEKLY_CHECKIN: List[Dict[str, str]] = [
    {
        "title": "Weekly forge review 📋",
        "body": "Hey ${username}, ready for a quick check-in? Your coach has a summary of this week's forging!",
    },
    {
        "title": "Time for your weekly review ⚒️",
        "body": "${username}, let's look at what you forged this week. Your coach is ready!",
    },
    {
        "title": "How was this week at the forge?",
        "body": "Your coach has a quick recap of the week, ${username}. Tap to check in!",
    },
]


# ── Lookup helpers ─────────────────────────────────────────────────────────────

_MIDDAY_MAP: Dict[str, List[Dict[str, str]]] = {
    "forge_cold": MIDDAY_FORGE_COLD,
    "workout_only": MIDDAY_WORKOUT_ONLY,
    "meals_going_workout_pending": MIDDAY_MEALS_GOING_WORKOUT_PENDING,
    "meals_going_rest_day": MIDDAY_MEALS_GOING_REST_DAY,
    "crushing_it": MIDDAY_CRUSHING_IT,
}

_EVENING_MAP: Dict[str, List[Dict[str, str]]] = {
    "forge_cold": EVENING_FORGE_COLD,
    "workout_only": EVENING_WORKOUT_ONLY,
    "meals_going_workout_pending": EVENING_MEALS_GOING_WORKOUT_PENDING,
    "meals_going_rest_day": EVENING_MEALS_GOING_REST_DAY,
    "crushing_it": EVENING_CRUSHING_IT,
}


def get_templates_for_state(
    time_slot: str,
    state: str,
) -> List[Dict[str, str]]:
    """Return the list of template dicts for *time_slot* ('midday' | 'evening')
    and the evaluated *state* key."""
    if time_slot == "midday":
        return _MIDDAY_MAP.get(state, MIDDAY_FORGE_COLD)
    elif time_slot == "evening":
        return _EVENING_MAP.get(state, EVENING_FORGE_COLD)
    raise ValueError(f"Unknown time_slot: {time_slot}")


def determine_tracking_state(
    meals_today: int,
    workout_scheduled: bool,
    workout_done: bool,
) -> str:
    """Evaluate the user's tracking state for today.

    Returns one of:
      forge_cold, workout_only, meals_going_workout_pending,
      meals_going_rest_day, crushing_it
    """
    if meals_today == 0 and not workout_done:
        return "forge_cold"
    if meals_today == 0 and workout_done:
        return "workout_only"
    # meals_today >= 1 from here on
    if workout_done:
        return "crushing_it"
    if workout_scheduled:
        return "meals_going_workout_pending"
    return "meals_going_rest_day"
