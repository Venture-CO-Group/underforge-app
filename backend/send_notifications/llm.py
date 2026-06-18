import os
import random
from datetime import datetime
from typing import List, Type, TypeVar

import logfire
from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.openai import OpenAIModel

from . import models
from .forge_notifications import (
    PRE_WORKOUT,
    WEEKLY_CHECKIN,
    determine_tracking_state,
    get_templates_for_state,
)
# Model constants
DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-20250514"
DEFAULT_OPENAI_MODEL = "gpt-4o"
DEFAULT_FALLBACK_MODEL = "gpt-4o-mini"

T = TypeVar("T")


class LLMAgentFactory:
    def __init__(self):
        # Setup fallback model: try Claude 4 Sonnet first, then OpenAI GPT-4o, then GPT-4o-mini
        anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")

        if anthropic_api_key:
            self.model = FallbackModel(
                AnthropicModel(DEFAULT_CLAUDE_MODEL),
                OpenAIModel(DEFAULT_OPENAI_MODEL),
                OpenAIModel(DEFAULT_FALLBACK_MODEL),
            )
        else:
            # Fallback to OpenAI only if no Anthropic API key
            logfire.warning(
                "ANTHROPIC_API_KEY not found, falling back to OpenAI models only"
            )
            self.model = FallbackModel(
                OpenAIModel(DEFAULT_OPENAI_MODEL), OpenAIModel(DEFAULT_FALLBACK_MODEL)
            )

    def create_agent(
        self, result_type: Type[T], system_prompt: str = ""
    ) -> Agent[None, T]:
        logfire.info(
            "Creating LLM agent",
            model=self.model,
            system_prompt=system_prompt,
            result_type=result_type.__name__,
        )
        return Agent(
            model=self.model, system_prompt=system_prompt, result_type=result_type
        )


def _resolve_display_name(user_profile: models.UserProfile) -> str:
    if user_profile.display_name:
        return user_profile.display_name
    if user_profile.onboard and user_profile.onboard.name:
        return user_profile.onboard.name
    return "there"


def _resolve_coach_first_name(user_profile: models.UserProfile) -> str:
    """Return the coach's first name (e.g. 'Dey', 'Manu').
    selectedCoach is already the first name key."""
    if user_profile.onboard and user_profile.onboard.selectedCoach:
        return user_profile.onboard.selectedCoach
    return "Coach"


def _apply_substitutions(template: str, display_name: str, coach_name: str) -> str:
    return template.replace("${username}", display_name).replace("${coachname}", coach_name)


def _forge_title(raw_title: str, coach_name: str) -> str:
    """Prefix the template title with 'Coach <name>: '."""
    return f"Coach {coach_name}: {raw_title}"



class ForgeProgressNotificationGenerator(BaseModel):
    """Picks a condition-based notification from forge_notifications templates."""

    user_profile: models.UserProfile
    time_slot: str  # "midday" | "evening"
    meals_today: int
    workout_scheduled: bool
    workout_done: bool

    def run(self) -> models.UserNotification:
        state = determine_tracking_state(
            self.meals_today, self.workout_scheduled, self.workout_done
        )
        templates = get_templates_for_state(self.time_slot, state)
        template = random.choice(templates)

        display_name = _resolve_display_name(self.user_profile)
        coach_name = _resolve_coach_first_name(self.user_profile)
        body = _apply_substitutions(template["body"], display_name, coach_name)
        title = _forge_title(
            _apply_substitutions(template["title"], display_name, coach_name),
            coach_name,
        )

        result = models.UserNotification(title=title, body=body)
        # PII policy: do not log `title` — it is `${username}`-substituted and
        # contains the user's display name.
        logfire.info(
            "Generated forge progress notification",
            user_id=self.user_profile.user_id,
            time_slot=self.time_slot,
            state=state,
            meals_today=self.meals_today,
            workout_scheduled=self.workout_scheduled,
            workout_done=self.workout_done,
        )
        return result


class PreWorkoutNotificationGenerator(BaseModel):
    """Picks a pre-workout reminder from forge_notifications templates."""

    user_profile: models.UserProfile

    def run(self) -> models.UserNotification:
        template = random.choice(PRE_WORKOUT)
        display_name = _resolve_display_name(self.user_profile)
        coach_name = _resolve_coach_first_name(self.user_profile)
        body = _apply_substitutions(template["body"], display_name, coach_name)
        title = _forge_title(
            _apply_substitutions(template["title"], display_name, coach_name),
            coach_name,
        )
        result = models.UserNotification(title=title, body=body)
        # PII policy: `title` includes the substituted user name; do not log it.
        logfire.info(
            "Generated pre-workout notification",
            user_id=self.user_profile.user_id,
        )
        return result


class WeeklyCheckinNotificationGenerator(BaseModel):
    """Picks a weekly check-in prompt from forge_notifications templates."""

    user_profile: models.UserProfile

    def run(self) -> models.UserNotification:
        template = random.choice(WEEKLY_CHECKIN)
        display_name = _resolve_display_name(self.user_profile)
        coach_name = _resolve_coach_first_name(self.user_profile)
        body = _apply_substitutions(template["body"], display_name, coach_name)
        title = _forge_title(
            _apply_substitutions(template["title"], display_name, coach_name),
            coach_name,
        )
        result = models.UserNotification(title=title, body=body)
        # PII policy: `title` includes the substituted user name; do not log it.
        logfire.info(
            "Generated weekly checkin notification",
            user_id=self.user_profile.user_id,
        )
        return result
