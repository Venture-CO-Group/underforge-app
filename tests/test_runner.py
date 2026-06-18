#!/usr/bin/env python3
"""
Simple test runner to verify imports and run ClarifyingQuestion tests.
Run this from the backend directory: python ../tests/test_runner.py
"""

import os
import sys

# Add current directory (backend) to path
sys.path.insert(0, os.getcwd())


def test_import():
    """Test that we can import ClarifyingQuestion"""
    try:
        from send_notifications.models import ClarifyingQuestion

        print("✅ Successfully imported ClarifyingQuestion")
        return True
    except ImportError as e:
        print(f"❌ Failed to import ClarifyingQuestion: {e}")
        return False


def test_clarifying_question():
    """Test basic ClarifyingQuestion functionality"""
    try:
        from send_notifications.models import ClarifyingQuestion

        # Test creation
        question = ClarifyingQuestion(
            id="test1",
            question="How are you feeling?",
            context="Daily check-in",
            answer="Good",
        )

        assert question.id == "test1"
        assert question.question == "How are you feeling?"
        assert question.context == "Daily check-in"
        assert question.answer == "Good"

        print("✅ ClarifyingQuestion creation test passed")

        # Test serialization
        data = question.model_dump()
        question2 = ClarifyingQuestion(**data)
        assert question2.id == question.id

        print("✅ ClarifyingQuestion serialization test passed")

        return True

    except Exception as e:
        print(f"❌ ClarifyingQuestion test failed: {e}")
        return False


if __name__ == "__main__":
    print("Testing ClarifyingQuestion import and functionality...")
    print(f"Current working directory: {os.getcwd()}")
    print(f"Python path: {sys.path[:3]}...")  # Show first 3 entries

    if test_import() and test_clarifying_question():
        print("\n🎉 All tests passed!")
        sys.exit(0)
    else:
        print("\n💥 Some tests failed!")
        sys.exit(1)
