## Initial Setup

### Setup uv and modal

```
uv venv
source .venv/bin/activate
uv pip install modal
```

### Create a new modal workspace and profile

```
modal token set --token-id ... --token-secret .. --profile=glow360
modal profile activate glow360
```
