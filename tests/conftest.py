"""
Shared test configuration and fixtures for the backend tests.
"""

import os
import sys
from unittest.mock import Mock

import pytest

# Ensure the backend directory is in the Python path
backend_dir = os.path.join(os.path.dirname(__file__), "..", "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)


@pytest.fixture
def mock_supabase_client():
    """Mock supabase client for testing"""
    client = Mock()

    # Mock table operations
    mock_table = Mock()
    mock_select = Mock()
    mock_eq = Mock()
    mock_gte = Mock()
    mock_lte = Mock()
    mock_order = Mock()

    client.table.return_value = mock_table
    mock_table.select.return_value = mock_select
    mock_select.eq.return_value = mock_eq
    mock_eq.gte.return_value = mock_gte
    mock_gte.lte.return_value = mock_lte
    mock_lte.order.return_value = mock_order

    return client


@pytest.fixture
def sample_onboard_data():
    """Sample onboarding data for tests"""
    return {
        "name": "Test User",
        "selectedCoach": "coach1",
        "coach_type": "ai_only",
        "selectedModules": ["sleep", "exercise"],
        "selectedGoal": "Improve sleep quality",
        "chronic_illnesses": ["diabetes"],
        "medications": ["metformin"],
        "supplements": ["vitamin_d"],
        "allergies": ["peanuts"],
        "motivationLevel": 8,
        "motivationWhy": "Want to feel better",
        "time_available": "1-2 hours daily",
        "expertise_level": "beginner",
    }


@pytest.fixture
def sample_user_profile_data():
    """Sample user profile data for tests"""
    return {
        "user_id": "user123",
        "display_name": "Test User",
        "timezone": "America/New_York",
        "expo_push_token": "ExponentPushToken[abc123]",
        "device_type": "ios_device",
        "active": True,
    }
