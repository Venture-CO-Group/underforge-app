# Backend Tests

This directory contains unit tests for the backend code, following the recommended structure for Modal deployments.

## Structure

```
tests/
  backend/
    send_notifications/
      test_clarifying_question.py  # Tests for ClarifyingQuestion model
      test_models.py               # Tests for other models (placeholder)
    common/
      # Future tests for common modules
    api/
      # Future tests for API modules
  conftest.py                      # Shared test configuration
  test_runner.py                   # Simple test runner script
```

## Running Tests

### Prerequisites:
```bash
cd backend
pip install -r requirements.txt
```

### Option 1: Using pytest (recommended)
```bash
# From the backend directory
cd backend
pytest ../tests/
```

### Option 2: Using the test runner script
```bash
# From the backend directory  
cd backend
python ../tests/test_runner.py
```

### Option 3: Run specific test file
```bash
# From the backend directory
cd backend  
python -m pytest ../tests/backend/send_notifications/test_clarifying_question.py -v
```

### With coverage:
```bash
cd backend
pytest ../tests/ --cov=send_notifications --cov-report=term-missing
```

## Current Test Coverage

### ClarifyingQuestion Model Tests
- ✅ Basic object creation with all fields
- ✅ Optional field handling (context, answer)
- ✅ Pydantic serialization/deserialization
- ✅ Field validation for required fields
- ✅ String representation
- ✅ Dict conversion round-trip

## Directory Structure Notes

The tests are structured to mirror the backend package structure:
- `tests/backend/send_notifications/` mirrors `backend/send_notifications/`
- Test files use the `test_*.py` naming convention
- The `conftest.py` provides shared fixtures and configuration

## Import Setup

Tests handle imports by:
1. Adding the backend directory to `sys.path` 
2. Using relative imports from the backend package structure
3. The `pytest.ini` configuration sets `pythonpath = backend`

## Troubleshooting

If you get import errors:
1. Make sure you're running from the `backend` directory
2. Check that `backend` is in your Python path
3. Verify the module structure matches the import statements

Example working directory structure:
```
longeviq-expo/
  backend/           # Run tests from here
    send_notifications/
      models.py
    tests/            # Test files reference this
      backend/
        send_notifications/
          test_clarifying_question.py
```