import json
import os
import zoneinfo
from datetime import datetime, timedelta, timezone  # added timedelta, timezone
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

import logfire
from pydantic import BaseModel, Field, field_validator

"""
Warning: this code is all duplicated with onboard.ts data structures.  If changing here, you must also change in onboard.ts.

TODO: Use pydantic2ts or datamodel-code-generator to generate TypeScript interfaces from Pydantic models.

"""


class ClarifyingQuestion(BaseModel):
    id: str
    question: str
    context: Optional[str] = None
    answer: Optional[str] = None


class DetailedRationaleItem(BaseModel):
    text: str  # Main text of the rationale item
    citations: Optional[List[str]] = (
        None  # Optional citations or references to support the rationale
    )


class BonusHack(BaseModel):
    text: str
    citations: Optional[List[str]] = None
    citation_emojis: Optional[List[str]] = None


# --- Added (sync with types/onboard.ts ExpectedCheckin) ---
class ExpectedCheckin(BaseModel):
    step_id: str
    step_title: str
    dayOfWeek: str  # 'mon', 'tue', etc.
    timeOfDay: Optional[str] = None

    def calculate_timestamp_for_this_week_checkin(self) -> str:
        """
        Python equivalent of TS calculateTimestampForThisWeekCheckin():
        Finds the most recent occurrence (this week, possibly today;
        if future in this week, go back 7 days) of the specified dayOfWeek.
        If timeOfDay present, sets that HH:MM (seconds=0); else keeps current time.
        Returns ISO 8601 string (UTC).
        """
        now = datetime.now(timezone.utc)
        # Weekday mapping: Monday=0 ... Sunday=6 (Python), TS used getDay(): Sunday=0
        # TS mapping: {'sun':0,'mon':1,'tue':2,'wed':3,'thu':4,'fri':5,'sat':6}
        day_map = {"sun": 6, "mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5}
        dow_lower = self.dayOfWeek.lower()
        if dow_lower not in day_map:
            raise ValueError(f"Invalid dayOfWeek: {self.dayOfWeek}")
        target_python_weekday = day_map[dow_lower]
        today_python_weekday = now.weekday()  # Monday=0 ... Sunday=6
        days_diff = target_python_weekday - today_python_weekday
        if days_diff > 0:
            days_diff -= 7  # go to previous occurrence within current week window
        target_dt = now + timedelta(days=days_diff)
        if self.timeOfDay:
            try:
                hh, mm = self.timeOfDay.split(":")
                hour = int(hh)
                minute = int(mm)
                if not (0 <= hour <= 23 and 0 <= minute <= 59):
                    raise ValueError
                target_dt = target_dt.replace(
                    hour=hour, minute=minute, second=0, microsecond=0
                )
            except Exception:
                # If invalid time format, keep original time
                pass
        return target_dt.isoformat()


# --- End added ---


class HypothesisComponent(BaseModel):
    # Make all fields optional with safe defaults to avoid validation failures
    id: Optional[str] = None
    root_cause_hypothesis: Optional[str] = None
    fix_hypothesis: Optional[str] = None  # alternate naming sometimes used
    root_cause_hypothesis_components: Optional[List[str]] = None
    summary: Optional[str] = None

    def to_llm_string(self) -> str:
        lines: List[str] = []
        if self.root_cause_hypothesis or self.fix_hypothesis:
            lines.append(
                f"Root Cause Hypothesis: {self.root_cause_hypothesis or self.fix_hypothesis}"
            )
        if self.root_cause_hypothesis_components:
            lines.append("Root Cause Hypothesis Components:")
            for idx, comp in enumerate(self.root_cause_hypothesis_components):
                lines.append(f"  {idx + 1}. {comp}")
        if self.summary:
            lines.append(f"Summary: {self.summary}")
        return "\n".join(lines)


class Hypothesis(BaseModel):
    # All optional with defaults; unused subtree should not raise validation errors
    id: Optional[str] = None
    createdAt: Optional[str] = None  # ISO date string
    updatedAt: Optional[str] = None  # ISO date string
    overall_hypothesis: Optional[str] = None
    user_assessment_hypothesis: Optional[str] = None
    components: List[HypothesisComponent] = Field(default_factory=list)

    def to_llm_string(self) -> str:
        lines: List[str] = []
        if self.overall_hypothesis:
            lines.append(f"Overall Hypothesis: {self.overall_hypothesis}")
        if self.user_assessment_hypothesis:
            lines.append(
                f"The user assessment and additions to hypothesis: {self.user_assessment_hypothesis}"
            )
        if self.components:
            lines.append("Components:")
            for idx, comp in enumerate(self.components):
                lines.append(f"  Component {idx + 1}:")
                comp_str = comp.to_llm_string()
                if comp_str:
                    lines.extend([f"    {line}" for line in comp_str.split("\n")])
        return "\n".join(lines)


class DayOfWeek(str, Enum):
    MONDAY = "mon"
    TUESDAY = "tue"
    WEDNESDAY = "wed"
    THURSDAY = "thu"
    FRIDAY = "fri"
    SATURDAY = "sat"
    SUNDAY = "sun"


class CoachType(str, Enum):
    AI_ONLY = "ai_only"
    AI_HUMAN_HYBRID = "ai_human_hybrid"


class ActionStep(BaseModel):
    id: str
    title: str
    description: str
    rationale: str  # Explanation of why this step is important and how it helps achieve the goal
    detailed_rationale: Optional[List[DetailedRationaleItem]] = (
        None  # Detailed explanation with bullet points and citations
    )
    priority: Literal["high", "medium", "low"]
    dateAdded: str  # ISO date string
    dateModified: Optional[str] = None  # ISO date string
    daysOfWeek: Optional[List[str]] = (
        None  # Days when this recurring plan should be executed (accepts strings for flexibility)
    )
    timeOfDay: Optional[str] = (
        None  # Time of day for this step (e.g., '23:00', '07:30')
    )
    step_details: Union[
        str, List[Dict[str, Any]], Dict[str, Any]
    ]  # Additional details about the step - can be string, list of dicts with any value types, or single dict with any value types
    bonus_hacks: Optional[List[BonusHack]] = None
    step_title_scroll: Optional[str] = None  # Concise 2-3 word title for scrollable display

    @field_validator("daysOfWeek", mode="before")
    @classmethod
    def filter_valid_days(cls, v):
        """Filter out invalid day values like 'flexible', keeping only valid day abbreviations."""
        if v is None:
            return None
        valid_days = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}
        if isinstance(v, list):
            filtered = [day.lower() if isinstance(day, str) else str(day) for day in v]
            filtered = [day for day in filtered if day in valid_days]
            return filtered if filtered else None
        return v

    def to_llm_string(self) -> str:
        lines = [
            f"Title: {self.title}",
            f"Description: {self.description}",
            f"Rationale: {self.rationale}",
            f"Priority: {self.priority}",
            f"Date Added: {self.dateAdded}",
        ]

        if self.dateModified:
            lines.append(f"Date Modified: {self.dateModified}")

        lines.append(
            f"Days of Week: {', '.join(self.daysOfWeek) if self.daysOfWeek else 'N/A'}"
        )

        if self.timeOfDay:
            lines.append(f"Time of Day: {self.timeOfDay}")

        # Add detailed rationale if present
        if self.detailed_rationale:
            lines.append("Detailed Rationale:")
            for index, item in enumerate(self.detailed_rationale):
                lines.append(f"  {index + 1}. {item.text}")
                if item.citations:
                    lines.append(f"     Citations: {', '.join(item.citations)}")

        # Add step details if present
        if self.step_details:
            lines.append("Step Details:")
            if isinstance(self.step_details, str):
                lines.append(f"  {self.step_details}")
            elif isinstance(self.step_details, list):
                for index, detail in enumerate(self.step_details):
                    # Handle both simple text dicts and complex workout day dicts
                    if isinstance(detail, dict):
                        if 'text' in detail:
                            lines.append(f"  {index + 1}. {detail.get('text', '')}")
                        elif 'dayName' in detail:
                            # This is a workout day
                            day_name = detail.get('dayName', 'Unknown')
                            duration = detail.get('estimatedDuration', 'N/A')
                            lines.append(f"  {index + 1}. {day_name} (Duration: {duration} min)")
                        else:
                            # Unknown structure, just show it exists
                            lines.append(f"  {index + 1}. [Complex workout data]")
            elif isinstance(self.step_details, dict):
                # Single dict structure
                if 'dayName' in self.step_details:
                    day_name = self.step_details.get('dayName', 'Unknown')
                    duration = self.step_details.get('estimatedDuration', 'N/A')
                    lines.append(f"  {day_name} (Duration: {duration} min)")

        return "\n".join(line for line in lines if line)


class ActionPlan(BaseModel):
    id: Optional[str] = None  # Made optional for backward compatibility with old profiles
    createdAt: Optional[str] = None  # ISO date string - optional for old profiles
    updatedAt: Optional[str] = None  # ISO date string - optional for old profiles
    rationale: str  # Overall explanation of the plan's approach
    steps: List[ActionStep]


class RecentConversation(BaseModel):
    userMessage: str
    coachResponse: str
    timestamp: str


class Onboard(BaseModel):
    # Required fields
    name: str
    selectedCoach: str
    coach_type: CoachType  # Required field to record the coach type
    selectedModules: List[str]
    selectedGoal: str
    chronic_illnesses: List[str]
    medications: List[str]
    supplements: List[str]
    allergies: List[str]
    motivationLevel: int
    motivationWhy: str
    # --- Updated (sync with TS) ---
    selectedSecondaryGoal: Optional[Union[str, List[str]]] = None
    time_available: str
    expertise_level: str
    # --- End updated ---

    # Optional fields
    height: Optional[str] = None
    weight: Optional[str] = None
    localUserId: Optional[str] = None

    # System fields
    moduleData: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    clarifyingQuestions: Optional[List[ClarifyingQuestion]] = None
    actionPlan: Optional[ActionPlan] = None
    # --- Added (sync with TS) ---
    hypothesis: Optional[Hypothesis] = None
    # --- End added ---

    recentConversations: Optional[List[RecentConversation]] = None

    class Config:
        extra = "allow"

    def to_llm_string(self) -> str:
        lines: List[str] = []

        # Core user info
        lines.append(f"User: {self.name}")

        # Add user's goal
        if self.selectedGoal:
            lines.append(f"User's goal: {self.selectedGoal}")

        # Add user's secondary goal
        if self.selectedSecondaryGoal:
            if isinstance(self.selectedSecondaryGoal, list):
                secondary_goal_text = ", ".join(self.selectedSecondaryGoal)
            else:
                secondary_goal_text = self.selectedSecondaryGoal
            lines.append(f"User's secondary goal: {secondary_goal_text}")

        # Add coach type
        lines.append(f"Coach type: {self.coach_type}")

        # Add motivation data
        if self.motivationLevel:
            lines.append(f"User's motivation level: {self.motivationLevel}/10")

        if self.motivationWhy:
            lines.append(f"User's motivation why: {self.motivationWhy}")

        # --- Added (sync with TS) ---
        if self.time_available:
            lines.append(f"Time available to work on goals: {self.time_available}")
        if self.expertise_level:
            lines.append(
                f"Expertise level gained so far working on goals: {self.expertise_level}"
            )
        # --- End added ---

        # Coach information - lookup from config
        try:
            # Adjust path as needed for your project structure
            config_path = os.path.join(
                os.path.dirname(__file__),
                "../../assets/onboarding_config/onboarding_coaches.json",
            )
            with open(config_path, "r") as f:
                config = json.load(f)

            coach_info = (
                config.get("coach_selection", {})
                .get(self.selectedCoach)
            )
            if coach_info:
                lines.append("")
                lines.append("Coach Information:")
                # Assuming coach_to_llm_string function exists or implement similar logic
                coach_string = self._coach_to_llm_string(coach_info)
                lines.append(
                    "\n".join(f"  {line}" for line in coach_string.split("\n"))
                )
            else:
                lines.append(f"Coach: {self.selectedCoach} (no additional info found)")
        except Exception as error:
            print(f"Error loading coach config: {error}")
            lines.append(f"Coach: {self.selectedCoach} (config unavailable)")

        # Action plan
        if self.actionPlan and self.actionPlan.steps:
            lines.append("Action Plan:")
            for step in self.actionPlan.steps:
                lines.append(f'  Step to check in: "{step.title}" - {step.description}')
                lines.append(f"    Step rationale: {step.rationale}")
                lines.append(f"    Step priority: {step.priority}")
                lines.append(
                    f"    Step days: {', '.join(step.daysOfWeek) if step.daysOfWeek else 'N/A'}"
                )
                if step.timeOfDay:
                    lines.append(f"    Step time: {step.timeOfDay}")

        # Module data (simplified)
        if self.moduleData:
            lines.append("Module Data:")
            for module, data in self.moduleData.items():
                data_str = ", ".join(f"{k}={v}" for k, v in data.items())
                lines.append(f"  {module}: {data_str}")

        # Recent conversations for context
        if self.recentConversations:
            lines.append("Recent Conversations:")
            for index, conv in enumerate(self.recentConversations[-25:]):
                lines.append(f"  Conversation {index + 1}:")
                lines.append(f"    User: {conv.userMessage}")
                lines.append(f"    Coach: {conv.coachResponse}")
                lines.append(f"    Time: {conv.timestamp}")

        return "\n".join(lines)

    def _coach_to_llm_string(self, coach_info: Dict[str, Any]) -> str:
        """Helper method to convert coach info to LLM string format"""
        # Implement based on your coach_to_llm_string logic
        # This is a placeholder implementation
        lines = []
        if "name" in coach_info:
            lines.append(f"Name: {coach_info['name']}")
        if "description" in coach_info:
            lines.append(f"Description: {coach_info['description']}")
        if "expertise" in coach_info:
            lines.append(f"Expertise: {coach_info['expertise']}")
        return "\n".join(lines)

    # --- Added (sync with expectedWeeklyCheckinsForDayOfWeek in TS) ---
    def expected_weekly_checkins_for_day_of_week(
        self, day_of_week: str
    ) -> List[ExpectedCheckin]:
        """
        Returns ExpectedCheckin objects for steps scheduled on the given day_of_week
        ('mon','tue','wed','thu','fri','sat','sun').
        """
        expected: List[ExpectedCheckin] = []
        if not self.actionPlan or not self.actionPlan.steps:
            return expected

        dow_lower = day_of_week.lower()
        valid_days = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}
        if dow_lower not in valid_days:
            logfire.warning(
                "Invalid day_of_week passed to expected_weekly_checkins_for_day_of_week",
                provided=day_of_week,
            )
            return expected

        for step in self.actionPlan.steps:
            # daysOfWeek is now List[str] instead of List[DayOfWeek]
            if step.daysOfWeek and dow_lower in step.daysOfWeek:
                expected.append(
                    ExpectedCheckin(
                        step_id=step.id,
                        step_title=step.title,
                        dayOfWeek=dow_lower,
                        timeOfDay=step.timeOfDay,
                    )
                )
        return expected

    # --- End added ---


class UserProfile(BaseModel):
    user_id: str  # Primary key - emulate Clerk `sub` identifier
    display_name: Optional[str] = None
    onboarding_profile_json: Optional[str] = None
    onboarding_profile_ai_gen_json: Optional[str] = None
    timezone: Optional[str] = None  # user's timezone (e.g. "Europe/Berlin")
    expo_push_token: Optional[str] = None  # optional Expo push notification token
    device_type: Literal["ios_device", "ios_simulator", "android_device", "android_simulator"] = (
        "ios_simulator"  # device type enum
    )
    active: bool = False  # indicates if this profile is currently active
    created_at: Optional[datetime] = None
    reminder_frequency: Optional[Literal["once_per_day", "every_task"]] = (
        "once_per_day"  # reminder frequency preference
    )
    # Weekly check-in schedule. NULL/legacy rows are treated as the default.
    weekly_checkin_schedule_mode: Optional[
        Literal["sun_sat_sun1800", "mon_sun_mon1800"]
    ] = "sun_sat_sun1800"

    # Parsed onboarding data
    onboard: Optional[Onboard] = None

    @classmethod
    def from_db_row(cls, row: Dict[str, Any]) -> "UserProfile":
        """Create UserProfile from database row data.

        PII policy: Logfire must NEVER receive `display_name`, raw
        `onboarding_profile_json`, or parsed onboarding data — those carry the
        user's name (and may carry email). Identify the user by `user_id` and
        log only safe metadata (presence flags, lengths, structural counts).
        """
        logfire.info(
            "Creating UserProfile from database row",
            user_id=row.get("user_id"),
            has_display_name=bool(row.get("display_name")),
            has_onboarding_json=bool(row.get("onboarding_profile_json")),
            onboarding_json_length=len(row.get("onboarding_profile_json", "") or ""),
        )

        profile = cls(**row)

        # Parse onboarding_profile_json if present
        if profile.onboarding_profile_json:
            try:
                logfire.info(
                    "Attempting to parse onboarding JSON",
                    user_id=profile.user_id,
                    onboarding_json_length=len(profile.onboarding_profile_json or ""),
                )

                onboard_data = json.loads(profile.onboarding_profile_json)

                logfire.info(
                    "Successfully parsed onboarding JSON",
                    user_id=profile.user_id,
                    onboard_keys=sorted(list(onboard_data.keys())) if isinstance(onboard_data, dict) else None,
                )

                profile.onboard = Onboard(**onboard_data)

                # Log detailed action plan info if available
                if profile.onboard.actionPlan:
                    logfire.info(
                        "Action plan details",
                        user_id=profile.user_id,
                        action_plan_id=profile.onboard.actionPlan.id,
                        steps_count=len(profile.onboard.actionPlan.steps),
                        steps_details=[
                            {
                                "id": step.id,
                                "title": step.title,
                                "priority": step.priority,
                                "days_of_week": step.daysOfWeek or [],
                            }
                            for step in profile.onboard.actionPlan.steps
                        ],
                    )

            except json.JSONDecodeError as e:
                logfire.exception(
                    "Failed to parse onboarding JSON - JSONDecodeError",
                    user_id=profile.user_id,
                    error_msg=str(e),
                    error_pos=getattr(e, "pos", None),
                    error_lineno=getattr(e, "lineno", None),
                    error_colno=getattr(e, "colno", None),
                    onboarding_json_length=len(profile.onboarding_profile_json or ""),
                )
            except Exception as e:
                logfire.exception(
                    "Failed to parse onboarding JSON - Unexpected error",
                    user_id=profile.user_id,
                    error_type=type(e).__name__,
                    error_msg=str(e),
                    onboarding_json_length=len(profile.onboarding_profile_json or ""),
                )

        return profile

    def has_valid_expo_token(self) -> bool:
        """Check if this profile has a valid expo push token.
        
        Valid Expo push tokens should:
        - Not be None or empty
        - Start with 'ExponentPushToken[' and end with ']'
        """
        if not self.expo_push_token:
            return False
        token = self.expo_push_token.strip()
        if not token:
            return False
        # Expo tokens should start with ExponentPushToken[ and end with ]
        if token.startswith("ExponentPushToken[") and token.endswith("]"):
            return True
        logfire.warning(
            "Invalid Expo push token format",
            user_id=self.user_id,
            token_preview=token[:30] + "..." if len(token) > 30 else token,
        )
        return False

    def is_active_ios_device(self) -> bool:
        """Check if this is an active iOS device profile."""
        return self.active and self.device_type == "ios_device"

    def get_meal_count_for_today(self, supabase_client: Any) -> int:
        """Count meal_logs rows for today (user's timezone)."""
        if not supabase_client:
            return 0
        try:
            today_date = self._today_local_date()
            response = (
                supabase_client.table("meal_logs")
                .select("id", count="exact")
                .eq("user_id", self.user_id)
                .eq("log_date", today_date)
                .execute()
            )
            count = response.count if response.count is not None else len(response.data or [])
            logfire.info(
                "Meal count for today",
                user_id=self.user_id,
                today_date=today_date,
                count=count,
            )
            return count
        except Exception as e:
            logfire.error("Failed to get meal count", user_id=self.user_id, error=str(e))
            return 0

    def get_completed_workout_count_for_today(self, supabase_client: Any) -> int:
        """Count completed workout_logs rows for today (user's timezone)."""
        if not supabase_client:
            return 0
        try:
            today_date = self._today_local_date()
            response = (
                supabase_client.table("workout_logs")
                .select("id", count="exact")
                .eq("user_id", self.user_id)
                .eq("workout_date", today_date)
                .eq("status", "completed")
                .execute()
            )
            count = response.count if response.count is not None else len(response.data or [])
            logfire.info(
                "Completed workout count for today",
                user_id=self.user_id,
                today_date=today_date,
                count=count,
            )
            return count
        except Exception as e:
            logfire.error("Failed to get workout count", user_id=self.user_id, error=str(e))
            return 0

    def has_workout_scheduled_today(self) -> bool:
        """Check if the user's action plan has a workout step scheduled for today."""
        if not self.onboard or not self.onboard.actionPlan or not self.onboard.actionPlan.steps:
            return False
        day_abbrev = self._today_local_day_abbrev()
        for step in self.onboard.actionPlan.steps:
            if step.daysOfWeek and day_abbrev in step.daysOfWeek:
                if isinstance(step.step_details, dict) and (
                    "exercises" in step.step_details or "dayName" in step.step_details
                ):
                    return True
        return False

    def get_workout_step_times_today(self) -> List[str]:
        """Return timeOfDay values for workout steps scheduled today."""
        if not self.onboard or not self.onboard.actionPlan or not self.onboard.actionPlan.steps:
            return []
        day_abbrev = self._today_local_day_abbrev()
        times: List[str] = []
        for step in self.onboard.actionPlan.steps:
            if step.daysOfWeek and day_abbrev in step.daysOfWeek and step.timeOfDay:
                if isinstance(step.step_details, dict) and (
                    "exercises" in step.step_details or "dayName" in step.step_details
                ):
                    times.append(step.timeOfDay)
        return times

    def _today_local_date(self) -> str:
        """Return today's date as YYYY-MM-DD in user timezone."""
        tz_name = self.timezone or "UTC"
        try:
            user_tz = zoneinfo.ZoneInfo(tz_name)
        except Exception:
            user_tz = timezone.utc
        return datetime.now(timezone.utc).astimezone(user_tz).strftime("%Y-%m-%d")

    def _today_local_day_abbrev(self) -> str:
        """Return today's 3-letter day abbreviation (lowercase) in user timezone."""
        tz_name = self.timezone or "UTC"
        try:
            user_tz = zoneinfo.ZoneInfo(tz_name)
        except Exception:
            user_tz = timezone.utc
        return datetime.now(timezone.utc).astimezone(user_tz).strftime("%a").lower()


class UserNotification(BaseModel):
    title: str
    body: str


class UserNotificationWithProfile(BaseModel):
    title: str
    body: str
    user_profile: "UserProfile"
    render_screen: str = "checkin_daily"



# Keep Checkin class for backward compatibility but it won't be used
class Checkin(BaseModel):
    """Legacy class - kept for compatibility. Use TaskCompletion instead."""
    id: int
    user_id: str
    step_id: str
    step_title: str
    checked_in_at: str
    checkin_due_at: str
