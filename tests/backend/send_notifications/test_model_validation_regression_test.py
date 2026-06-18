import json
import os
import sys

import pytest

# Add the backend directory to Python path for proper imports
backend_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend")
sys.path.insert(0, backend_dir)

from send_notifications.models import Onboard

problematic_onboarding_profile_json = open(
    os.path.join(os.path.dirname(__file__), "problematic_onboard.json")
).read()


class TestModelValidationRegression:
    """Regression tests for model validation issues found in production"""

    def test_problematic_onboarding_profile_json_loads_successfully(self):
        """
        Test that the problematic onboarding profile JSON from production
        can be successfully loaded into an Onboard object without validation errors.

        This is a regression test for a specific JSON payload that was causing issues.
        """
        # Parse the JSON string into a Python dict
        onboard_data = json.loads(problematic_onboarding_profile_json)

        # This should not raise any validation errors
        onboard = Onboard(**onboard_data)

        # Validate core required fields are present
        assert onboard.name == "Al"
        assert onboard.selectedCoach == "Joshua"
        assert onboard.coach_type == "ai_human_hybrid"
        assert onboard.selectedModules == ["Reduce Stress"]
        assert onboard.selectedGoal == "Reduce Stress"
        assert onboard.selectedSecondaryGoal == "Eat Healthier"
        assert onboard.motivationLevel == 6
        assert onboard.motivationWhy == "Do not worry too much about my problems "
        assert onboard.time_available == "2–4 hours per week"
        assert (
            onboard.expertise_level
            == "Intermediate: Use coping tools, moderate resilience, occasional mindfulness or relaxation techniques."
        )

        # Validate lists are properly handled
        assert onboard.chronic_illnesses == ["None"]
        assert onboard.medications == ["None"]
        assert onboard.supplements == ["None"]
        assert onboard.allergies == ["None"]

        # Validate clarifying questions loaded correctly
        assert onboard.clarifyingQuestions is not None
        assert len(onboard.clarifyingQuestions) == 40

        # Check a few specific clarifying questions
        q1 = onboard.clarifyingQuestions[0]
        assert q1.id == "q1"
        assert q1.question == "gender_question"
        assert q1.answer == "Male"

        q40 = onboard.clarifyingQuestions[39]
        assert q40.id == "q40"
        assert q40.question == "anything_else_for_coach"
        assert q40.answer == "Sometimes I feel depressed for weeks"

    def test_action_plan_validation(self):
        """Test that the action plan within the problematic JSON loads correctly"""
        onboard_data = json.loads(problematic_onboarding_profile_json)
        onboard = Onboard(**onboard_data)

        # Validate action plan exists
        assert onboard.actionPlan is not None
        assert onboard.actionPlan.id == "al_stress_reduction_plan_001"
        assert onboard.actionPlan.createdAt == "2025-09-07T07:48:22.142Z"
        assert onboard.actionPlan.updatedAt == "2025-09-07T08:02:45.500Z"
        assert (
            "Al, my plan targets the root of your stress cycle"
            in onboard.actionPlan.rationale
        )

        # Validate action steps
        assert len(onboard.actionPlan.steps) == 3

        # Check first step details
        step1 = onboard.actionPlan.steps[0]
        assert step1.id == "step_1"
        assert step1.title == "Morning Stress-Resilience Routine"
        assert step1.priority == "high"
        assert step1.timeOfDay == "07:00"
        assert step1.daysOfWeek == ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

        # Validate detailed rationale exists
        assert step1.detailed_rationale is not None
        assert len(step1.detailed_rationale) == 3
        assert (
            "Morning meditation activates parasympathetic nervous system"
            in step1.detailed_rationale[0].text
        )

        # Validate bonus hacks exist
        assert step1.bonus_hacks is not None
        assert len(step1.bonus_hacks) == 3

    def test_hypothesis_validation(self):
        """Test that the hypothesis within the problematic JSON loads correctly"""
        onboard_data = json.loads(problematic_onboarding_profile_json)
        onboard = Onboard(**onboard_data)

        # Validate hypothesis exists
        assert onboard.hypothesis is not None
        assert onboard.hypothesis.id == "hypothesis_al_stress_reduction_001"
        assert onboard.hypothesis.createdAt == "2024-12-19T10:30:00Z"
        assert onboard.hypothesis.updatedAt == "2024-12-19T10:30:00Z"

        # Check overall hypothesis
        assert (
            "Al, based on our conversation, I see you're caught in a cycle"
            in onboard.hypothesis.overall_hypothesis
        )


        # Validate hypothesis components
        assert len(onboard.hypothesis.components) == 3

        component1 = onboard.hypothesis.components[0]
        assert component1.id == "work_financial_stress_cycle"
        assert (
            "Work and financial pressures are creating a persistent stress cycle"
            in component1.root_cause_hypothesis
        )
        assert len(component1.root_cause_hypothesis_components) == 3

    def test_complex_step_details_validation(self):
        """Test that complex step_details structures are handled correctly"""
        onboard_data = json.loads(problematic_onboarding_profile_json)
        onboard = Onboard(**onboard_data)

        # Check step 2 which has step_details as a list of dicts
        step2 = onboard.actionPlan.steps[1]
        assert step2.id == "step_2"
        assert (
            step2.title == "Work-Day Stress Circuit Breakers with Movement Integration"
        )

        # step_details should be a list of dict objects
        assert isinstance(step2.step_details, list)
        assert len(step2.step_details) == 2
        assert isinstance(step2.step_details[0], dict)
        assert "text" in step2.step_details[0]
        assert "WORKDAY STRESS BREAKS" in step2.step_details[0]["text"]

    def test_onboard_serialization_roundtrip(self):
        """Test that the loaded Onboard object can be serialized back to dict/JSON"""
        onboard_data = json.loads(problematic_onboarding_profile_json)
        onboard = Onboard(**onboard_data)

        # Test model_dump (Pydantic serialization)
        serialized = onboard.model_dump()
        assert isinstance(serialized, dict)
        assert serialized["name"] == "Al"
        assert serialized["selectedCoach"] == "Joshua"

        # Test that we can create a new Onboard from the serialized data
        onboard2 = Onboard(**serialized)
        assert onboard2.name == onboard.name
        assert onboard2.selectedCoach == onboard.selectedCoach
        assert len(onboard2.clarifyingQuestions) == len(onboard.clarifyingQuestions)

    def test_to_llm_string_method(self):
        """Test that the to_llm_string method works with the complex data"""
        onboard_data = json.loads(problematic_onboarding_profile_json)
        onboard = Onboard(**onboard_data)

        # This should not raise any errors
        llm_string = onboard.to_llm_string()

        # Validate key information is present in the LLM string
        assert "User: Al" in llm_string
        assert "User's goal: Reduce Stress" in llm_string
        assert "User's secondary goal: Eat Healthier" in llm_string
        assert "User's motivation level: 6/10" in llm_string
        assert "Time available to work on goals: 2–4 hours per week" in llm_string
        assert "Action Plan:" in llm_string


if __name__ == "__main__":
    pytest.main([__file__])
