import os
import zoneinfo  # <-- added import
from datetime import datetime, timedelta, timezone  # added timedelta
from typing import List, Optional  # added Optional

import logfire
import modal
from exponent_server_sdk_async import AsyncPushClient, PushMessage, PushServerError
from pydantic import BaseModel
from supabase import Client, create_client

# Note: Resend is imported inside the function that uses it
# to avoid import errors during local deployment (package is only in Modal container)

from . import models, myconstants
from .llm import (
    ForgeProgressNotificationGenerator,
    PreWorkoutNotificationGenerator,
    WeeklyCheckinNotificationGenerator,
)

# Create the Modal app
app = modal.App(myconstants.MODAL_APP_NAME)

# Define the image with required dependencies
image = modal.Image.debian_slim().pip_install(
    [
        "fastapi[standard]>=0.116.1",
        "supabase>=2.17.0",
        "python-multipart",
        "uvicorn",
        "exponent-server-sdk-async>=2.1.7",
        "logfire>=4.0.0",
        "pydantic>=2.11.7",
        "pydantic-ai[logfire]>=0.4.7",
        "zoneinfo-backport; python_version<'3.9'",
        "resend>=2.0.0",  # Email service - no domain verification needed
    ]
)

# Secrets references
supabase_secret = modal.Secret.from_name("supabase-backend")
logfire_secret = modal.Secret.from_name("logfire")
llm_keys_secret = modal.Secret.from_name("llm-keys")
resend_secret = modal.Secret.from_name("resend")  # For email sending


def get_supabase_client() -> Client:
    """Get authenticated Supabase client using environment variables."""
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SECRET_KEY")

    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SECRET_KEY must be set")

    return create_client(url, key)



def _resolve_user_local_now(user_profile: models.UserProfile) -> datetime:
    """Return the current datetime in the user's local timezone."""
    tz_name = user_profile.timezone or "UTC"
    try:
        user_tz = zoneinfo.ZoneInfo(tz_name)
    except Exception:
        user_tz = timezone.utc
    return datetime.now(timezone.utc).astimezone(user_tz)


def _in_time_window(now_local: datetime, target_hour: int, target_minute: int, window_minutes: int = 5) -> bool:
    """Check if *now_local* is within [target, target + window) at minute precision."""
    target = now_local.replace(hour=target_hour, minute=target_minute, second=0, microsecond=0)
    upper = target + timedelta(minutes=window_minutes)
    now_minute = now_local.replace(second=0, microsecond=0)
    return target <= now_minute < upper


def get_forge_progress_notifications(
    user_profile: models.UserProfile,
    supabase_client: Client,
    now_local: datetime,
) -> List[models.UserNotificationWithProfile]:
    """Generate midday and/or evening context-aware progress notifications."""
    notifications: List[models.UserNotificationWithProfile] = []

    time_slot: Optional[str] = None
    if _in_time_window(now_local, 12, 0):
        time_slot = "midday"
    elif _in_time_window(now_local, 19, 0):
        time_slot = "evening"

    if not time_slot:
        return notifications

    meals_today = user_profile.get_meal_count_for_today(supabase_client)
    workout_scheduled = user_profile.has_workout_scheduled_today()
    workout_done = user_profile.get_completed_workout_count_for_today(supabase_client) > 0

    generator = ForgeProgressNotificationGenerator(
        user_profile=user_profile,
        time_slot=time_slot,
        meals_today=meals_today,
        workout_scheduled=workout_scheduled,
        workout_done=workout_done,
    )
    notif_data = generator.run()
    notifications.append(
        models.UserNotificationWithProfile(
            title=notif_data.title,
            body=notif_data.body,
            user_profile=user_profile,
            render_screen="quick_log",
        )
    )

    # PII policy: do NOT include the user's display name in Logfire payloads
    # (in the message or in kwargs). Identify the user by user_id only.
    logfire.info(
        f"Generated {time_slot} forge notification",
        user_id=user_profile.user_id,
        time_slot=time_slot,
        meals_today=meals_today,
        workout_scheduled=workout_scheduled,
        workout_done=workout_done,
    )
    return notifications


def get_pre_workout_notifications(
    user_profile: models.UserProfile,
    supabase_client: Client,
    now_local: datetime,
) -> List[models.UserNotificationWithProfile]:
    """Send a reminder ~5 min before each scheduled workout today."""
    notifications: List[models.UserNotificationWithProfile] = []
    workout_times = user_profile.get_workout_step_times_today()
    if not workout_times:
        return notifications

    already_done = user_profile.get_completed_workout_count_for_today(supabase_client) > 0
    if already_done:
        return notifications

    now_minute = now_local.replace(second=0, microsecond=0)

    for time_str in workout_times:
        try:
            hh, mm = time_str.split(":")
            hour, minute = int(hh), int(mm)
            workout_time = now_local.replace(hour=hour, minute=minute, second=0, microsecond=0)
            diff = (workout_time - now_minute).total_seconds() / 60

            # Fire when 3-7 minutes before workout (catches one 5-min cron cycle)
            if 3 <= diff <= 7:
                generator = PreWorkoutNotificationGenerator(user_profile=user_profile)
                notif_data = generator.run()
                notifications.append(
                    models.UserNotificationWithProfile(
                        title=notif_data.title,
                        body=notif_data.body,
                        user_profile=user_profile,
                        render_screen="quick_log",
                    )
                )
                logfire.info(
                    "Generated pre-workout notification",
                    user_id=user_profile.user_id,
                    workout_time=time_str,
                    minutes_until=diff,
                )
                break  # one reminder per cycle is enough
        except (ValueError, TypeError) as e:
            logfire.debug(
                "Skipping invalid workout time",
                user_id=user_profile.user_id,
                time_str=time_str,
                error=str(e),
            )

    return notifications


def get_weekly_checkin_notification(
    user_profile: models.UserProfile,
    now_local: datetime,
) -> List[models.UserNotificationWithProfile]:
    """Weekly check-in prompt.

    Fires on the weekday + hour selected by the user's schedule mode (matches the
    in-app local notification timing in `lib/weekly-report-notifications.ts`):
      - sun_sat_sun1800 (default): Sunday 18:00 local.
      - mon_sun_mon1800: Monday 18:00 local.
    Legacy/null rows are treated as the default.
    """
    notifications: List[models.UserNotificationWithProfile] = []

    mode = user_profile.weekly_checkin_schedule_mode or "sun_sat_sun1800"
    # Python weekday(): Monday=0 … Sunday=6
    if mode == "mon_sun_mon1800":
        target_weekday = 0  # Monday
    else:
        target_weekday = 6  # Sunday

    if now_local.weekday() != target_weekday:
        return notifications

    if not _in_time_window(now_local, 18, 0):
        return notifications

    generator = WeeklyCheckinNotificationGenerator(user_profile=user_profile)
    notif_data = generator.run()
    notifications.append(
        models.UserNotificationWithProfile(
            title=notif_data.title,
            body=notif_data.body,
            user_profile=user_profile,
            render_screen="checkin_weekly",
        )
    )
    logfire.info(
        "Generated weekly checkin notification",
        user_id=user_profile.user_id,
        schedule_mode=mode,
    )
    return notifications


async def get_notifications_for_profile(
    user_profile_row: dict,
    supabase_client: Client,
) -> List[models.UserNotificationWithProfile]:
    """Process a single profile and return a list of UserNotificationWithProfile objects."""
    # PII policy: never pass display_name or full user_profile_row dicts to
    # Logfire — those carry the user's name and may carry email-bearing JSON.
    logfire.info(
        "Starting notification processing for profile",
        user_id=user_profile_row.get("user_id"),
        has_expo_token=bool(user_profile_row.get("expo_push_token")),
        device_type=user_profile_row.get("device_type"),
        has_onboarding_json=bool(user_profile_row.get("onboarding_profile_json")),
    )

    # Convert dict to UserProfile model
    user_profile = models.UserProfile.from_db_row(user_profile_row)

    logfire.info(
        "User profile created from DB row",
        user_profile_user_id=user_profile.user_id,
        user_profile_timezone=user_profile.timezone,
        user_profile_has_onboard=bool(user_profile.onboard),
    )

    # Get current UTC time
    current_time_utc = datetime.now(timezone.utc)

    logfire.info(
        "Processing user profile for notifications",
        user_id=user_profile.user_id,
        current_time_utc=current_time_utc.isoformat(),
        current_time_utc_timestamp=current_time_utc.timestamp(),
        user_timezone=user_profile.timezone,
        processing_context={
            "utc_hour": current_time_utc.hour,
            "utc_minute": current_time_utc.minute,
            "utc_second": current_time_utc.second,
            "utc_weekday": current_time_utc.weekday(),
            "utc_day_name": current_time_utc.strftime("%A"),
            "utc_day_abbrev": current_time_utc.strftime("%a").lower(),
        },
    )

    # Add timezone conversion preview if user has timezone
    if user_profile.timezone:
        try:
            import zoneinfo

            user_tz = zoneinfo.ZoneInfo(user_profile.timezone)
            local_preview = current_time_utc.astimezone(user_tz)
            logfire.info(
                "Timezone conversion preview",
                user_id=user_profile.user_id,
                user_timezone=user_profile.timezone,
                utc_time=current_time_utc.isoformat(),
                local_time=local_preview.isoformat(),
                local_context={
                    "local_hour": local_preview.hour,
                    "local_minute": local_preview.minute,
                    "local_weekday": local_preview.weekday(),
                    "local_day_name": local_preview.strftime("%A"),
                    "local_day_abbrev": local_preview.strftime("%a").lower(),
                    "timezone_offset": local_preview.strftime("%z"),
                },
            )
        except Exception as e:
            logfire.error(
                "Failed to preview timezone conversion",
                user_id=user_profile.user_id,
                user_timezone=user_profile.timezone,
                error=str(e),
            )


    # ── Collect all notifications for this user ──────────────────────────────
    all_notifications: List[models.UserNotificationWithProfile] = []
    now_local = _resolve_user_local_now(user_profile)

    # 1) Existing task-based reminders (per-task or once-per-day streak reminders)
    # REMOVED: Task reminders and Streak Saver logic per user request.
    # if reminder_frequency == "every_task":
    #     ...
    # else:
    #     ...

    # 2) Midday / evening context-aware forge progress notifications
    try:
        forge_notifs = get_forge_progress_notifications(user_profile, supabase_client, now_local)
        all_notifications.extend(forge_notifs)
    except Exception as e:
        logfire.error(
            "Failed to generate forge progress notifications",
            user_id=user_profile.user_id,
            error=str(e),
        )

    # 3) Pre-workout reminders (5 min before scheduled workout)
    try:
        pre_workout_notifs = get_pre_workout_notifications(user_profile, supabase_client, now_local)
        all_notifications.extend(pre_workout_notifs)
    except Exception as e:
        logfire.error(
            "Failed to generate pre-workout notifications",
            user_id=user_profile.user_id,
            error=str(e),
        )

    # 4) Sunday weekly check-in
    # DISABLED per user request
    # try:
    #     weekly_notifs = get_weekly_checkin_notification(user_profile, now_local)
    #     all_notifications.extend(weekly_notifs)
    # except Exception as e:
    #     logfire.error(
    #         "Failed to generate weekly checkin notification",
    #         user_id=user_profile.user_id,
    #         error=str(e),
    #     )

    logfire.info(
        "Total notifications for user",
        user_id=user_profile.user_id,
        notification_count=len(all_notifications),
        notification_types=[n.render_screen for n in all_notifications],
    )

    return all_notifications


async def send_notifications(
    notifications: List[models.UserNotificationWithProfile],
) -> None:
    """Send push notifications to users."""
    if not notifications:
        logfire.warning("No notifications to send")
        logfire.info("No notifications to send")
        return

    # Extract valid tokens from notifications
    valid_notifications = [
        notif for notif in notifications if notif.user_profile.has_valid_expo_token()
    ]

    if not valid_notifications:
        logfire.warning("No valid expo tokens found in notifications")
        logfire.info("No valid expo tokens found")
        return

    logfire.info(f"Preparing to send {len(valid_notifications)} notifications")
    logfire.info(f"Found {len(valid_notifications)} valid notifications to send")

    # Send notifications using async client - send one at a time to handle failures gracefully
    client = AsyncPushClient()
    
    success_count = 0
    for notif in valid_notifications:
        try:
            msg = PushMessage(
                to=notif.user_profile.expo_push_token,
                body=notif.body,
                title=notif.title,
                data={"render_screen": notif.render_screen, "sender": "ai_coach"},
                sound="default",
                ttl=86400,  # 24 hours
                priority="normal",
                badge=None,
                category=None,
                channel_id=None,
                subtitle=None,
                mutable_content=False,
            )

            # Send single notification
            try:
                tickets = await client.publish_multiple([msg])

                if tickets and tickets[0].is_success():
                    success_count += 1
                    logfire.info(
                        "Notification sent successfully",
                        user_id=notif.user_profile.user_id,
                    )
                else:
                    error_msg = tickets[0].message if tickets else "Unknown error"
                    logfire.warning(
                        "Failed to send notification",
                        user_id=notif.user_profile.user_id,
                        error_message=error_msg,
                    )
            except PushServerError as e:
                logfire.error(
                    "PushServerError sending notification",
                    user_id=notif.user_profile.user_id,
                    error=str(e),
                    error_details=getattr(e, 'errors', None),
                    expo_token_preview=notif.user_profile.expo_push_token[:30] + "..." if notif.user_profile.expo_push_token else "None",
                )
        except Exception as e:
            logfire.error(
                "Exception sending notification",
                user_id=notif.user_profile.user_id,
                expo_token_preview=notif.user_profile.expo_push_token[:30] + "..." if notif.user_profile.expo_push_token else "None",
                error=str(e),
                error_type=type(e).__name__,
            )

    logfire.info(
        f"Successfully sent {success_count}/{len(valid_notifications)} notifications"
    )


async def generate_and_send_notifications():
    """Generate and send personalized notifications to users with valid expo tokens."""
    # Initialize Logfire
    logfire.configure()

    # Create Supabase client using the helper utility
    supabase = get_supabase_client()

    # Query user_profile table for users with valid expo tokens
    # Expo push tokens work for both iOS and Android (Expo handles FCM for Android internally)
    response = (
        supabase.table("user_profile")
        .select(
            "expo_push_token, onboarding_profile_json, user_id, display_name, timezone, reminder_frequency"
        )
        .not_.is_("expo_push_token", "null")
        .in_("device_type", ["ios_device", "android_device"])
        .eq("active", True)
        .execute()
    )

    # Log each user profile
    logfire.info(f"Found {len(response.data)} user profiles with valid expo tokens")

    # Generate notifications for each profile
    notifications = []
    for profile in response.data:
        try:
            profile_notifications = await get_notifications_for_profile(
                profile, supabase
            )  # pass client
            notifications.extend(profile_notifications)
        except Exception as e:
            # PII policy: do not log display_name or the full profile dict
            # (the latter includes display_name and onboarding JSON with name/email).
            logfire.exception(
                "Failed to generate notification for profile",
                user_id=profile.get("user_id"),
                has_expo_token=bool(profile.get("expo_push_token")),
                error_type=type(e).__name__,
                error_msg=str(e),
            )
            pass

    # Send all generated notifications
    await send_notifications(notifications)


@app.function(
    secrets=[
        modal.Secret.from_name("supabase-backend"),
        modal.Secret.from_name("logfire"),
        modal.Secret.from_name("llm-keys"),
    ],
    # Run at minutes 0, 5, 10, 15, etc. to align with step schedules
    schedule=modal.Cron("*/5 * * * *"),
    min_containers=1,  # Keep 1 container warm to reduce startup time
    timeout=300,  # 5 minute timeout for safety
    image=image,
)
async def send_expo_notifications():
    """Modal function to send Expo notifications."""
    try:
        await generate_and_send_notifications()
    except Exception as e:
        logfire.exception(
            "Failed to send expo notifications",
            error_type=type(e).__name__,
            error_msg=str(e),
        )
        raise


async def check_and_notify_coach_messages():
    """
    Check for new coach messages in the last hour and send push notifications to users.
    Filters out automated acknowledgment messages.
    """
    # Initialize Logfire
    logfire.configure()

    # Create Supabase client
    supabase = get_supabase_client()

    # Calculate time window (last hour)
    now = datetime.now(timezone.utc)
    one_hour_ago = now - timedelta(hours=1)

    logfire.info(
        "Checking for coach messages",
        time_window_start=one_hour_ago.isoformat(),
        time_window_end=now.isoformat(),
    )

    # Query chat_messages for human_coach messages in the last hour
    response = (
        supabase.table("chat_messages")
        .select("id, user_id, text, sender, timestamp, user_display_name")
        .eq("sender", "human_coach")
        .gte("timestamp", one_hour_ago.isoformat())
        .execute()
    )

    if not response.data:
        logfire.info("No coach messages found in the last hour")
        return

    logfire.info(
        "Found coach messages",
        message_count=len(response.data),
    )

    # Filter out automated acknowledgment messages
    # Pattern: "Thanks for your message <name>" or "Thanks for the message <name>"
    filtered_messages = []
    for msg in response.data:
        text = msg.get("text", "")
        # Skip automated acknowledgment messages
        if text.startswith("Thanks for your message") or text.startswith("Thanks for the message"):
            logfire.debug(
                "Skipping automated acknowledgment message",
                message_id=msg.get("id"),
                user_id=msg.get("user_id"),
            )
            continue
        filtered_messages.append(msg)

    if not filtered_messages:
        logfire.info("No non-automated coach messages to notify")
        return

    logfire.info(
        "Coach messages after filtering",
        filtered_count=len(filtered_messages),
    )

    # Get user profiles with push tokens for the affected users
    user_ids = list(set(msg.get("user_id") for msg in filtered_messages if msg.get("user_id")))
    
    if not user_ids:
        logfire.warning("No valid user IDs found in coach messages")
        return

    # Fetch user profiles with expo push tokens
    users_response = (
        supabase.table("user_profile")
        .select("user_id, display_name, expo_push_token, device_type, active")
        .in_("user_id", user_ids)
        .not_.is_("expo_push_token", "null")
        .in_("device_type", ["ios_device", "android_device"])
        .eq("active", True)
        .execute()
    )

    if not users_response.data:
        logfire.info("No users with valid push tokens found for coach messages")
        return

    # Create a map of user_id -> user profile
    user_map = {user["user_id"]: user for user in users_response.data}

    # Prepare and send notifications
    notifications_to_send = []
    for msg in filtered_messages:
        user_id = msg.get("user_id")
        if user_id not in user_map:
            logfire.debug(
                "User not found or no push token",
                user_id=user_id,
            )
            continue

        user = user_map[user_id]
        user_profile = models.UserProfile(
            user_id=user["user_id"],
            display_name=user.get("display_name"),
            expo_push_token=user.get("expo_push_token"),
            device_type=user.get("device_type", "ios_device"),
            active=user.get("active", True),
        )

        # Create notification with coach message
        message_text = msg.get("text", "")
        # Truncate message if too long for notification body
        if len(message_text) > 200:
            message_text = message_text[:197] + "..."

        notification = models.UserNotificationWithProfile(
            title="Message from your coach",
            body=message_text,
            user_profile=user_profile,
        )
        notifications_to_send.append(notification)

    if not notifications_to_send:
        logfire.info("No notifications to send for coach messages")
        return

    logfire.info(
        "Sending coach message notifications",
        notification_count=len(notifications_to_send),
    )

    # Send notifications using existing infrastructure
    await send_coach_message_notifications(notifications_to_send)


async def send_coach_message_notifications(
    notifications: List[models.UserNotificationWithProfile],
) -> None:
    """Send push notifications for coach messages."""
    if not notifications:
        logfire.warning("No coach message notifications to send")
        return

    valid_notifications = [
        notif for notif in notifications if notif.user_profile.has_valid_expo_token()
    ]

    if not valid_notifications:
        logfire.warning("No valid expo tokens found in coach message notifications")
        return

    logfire.info(f"Sending {len(valid_notifications)} coach message notifications")

    client = AsyncPushClient()
    success_count = 0

    for notif in valid_notifications:
        try:
            msg = PushMessage(
                to=notif.user_profile.expo_push_token,
                body=notif.body,
                title=notif.title,
                data={"render_screen": "chat", "sender": "human_coach"},
                sound="default",
                ttl=86400,  # 24 hours
                priority="high",  # High priority for coach messages
            )

            try:
                tickets = await client.publish_multiple([msg])
                if tickets and tickets[0].is_success():
                    success_count += 1
                    logfire.info(
                        "Coach message notification sent",
                        user_id=notif.user_profile.user_id,
                    )
                else:
                    error_msg = tickets[0].message if tickets else "Unknown error"
                    logfire.warning(
                        "Failed to send coach notification",
                        user_id=notif.user_profile.user_id,
                        error_message=error_msg,
                    )
            except PushServerError as e:
                logfire.error(
                    "PushServerError for coach notification",
                    user_id=notif.user_profile.user_id,
                    error=str(e),
                )
        except Exception as e:
            logfire.error(
                "Exception sending coach notification",
                user_id=notif.user_profile.user_id,
                error=str(e),
            )

    logfire.info(
        f"Coach message notifications: {success_count}/{len(valid_notifications)} sent successfully"
    )


@app.function(
    secrets=[
        modal.Secret.from_name("supabase-backend"),
        modal.Secret.from_name("logfire"),
    ],
    # Run at minute 15 of every hour (hh:15)
    schedule=modal.Cron("15 * * * *"),
    timeout=300,
    image=image,
)
async def send_coach_message_push_notifications():
    """Modal function to check for coach messages and send push notifications (runs hourly)."""
    try:
        await check_and_notify_coach_messages()
    except Exception as e:
        logfire.exception(
            "Failed to send coach message notifications",
            error_type=type(e).__name__,
            error_msg=str(e),
        )
        raise


async def send_email_to_coach(coach_email: str, user_name: str) -> bool:
    """
    Send email notification to coach when user sends a message.
    Uses Resend API (no domain verification needed).

    Args:
        coach_email: Coach's email address
        user_name: User's display name (used in the email body — never logged)

    Returns:
        True if email sent successfully, False otherwise

    PII policy: `user_name` is intentionally NOT logged. The email body legitimately
    requires it, but Logfire must never see the user's display name. Coach addresses
    are logged only as masked previews; `from_email` is the company sender and may
    be logged.
    """
    try:
        # Import resend module inside function to avoid issues with Modal's deployment
        # (package is installed in Modal container but not locally)
        try:
            import resend
        except ImportError as import_err:
            logfire.error(
                "Failed to import resend module",
                error=str(import_err),
            )
            return False

        resend_api_key = os.getenv("RESEND_API_KEY")
        if not resend_api_key:
            logfire.warning(
                "RESEND_API_KEY not configured, skipping email notification",
            )
            return False

        # Set API key on the module (this is how Resend SDK works)
        resend.api_key = resend_api_key

        subject = f"{user_name} has sent you a message"
        message = f"{user_name} has sent you a message"

        # Resend requires a "from" email - use info@glow360.dev  for testing
        # For production, verify your domain in Resend dashboard
        from_email = os.getenv("RESEND_FROM_EMAIL", "info@glow360.dev ")

        logfire.info(
            "Sending email notification to coach",
            coach_email_preview=coach_email[:3] + "***",
            from_email=from_email,
            has_api_key=bool(resend_api_key),
        )

        try:
            # Resend SDK API: resend.Emails.send() with capital E
            result = resend.Emails.send({
                "from": from_email,
                "to": coach_email,  # Can be string or list
                "subject": subject,
                "text": message,
            })
        except Exception as resend_error:
            logfire.exception(
                "Resend API call failed",
                error=str(resend_error),
                error_type=type(resend_error).__name__,
                from_email=from_email,
                to_email_preview=coach_email[:3] + "***",
            )
            return False

        # Handle result - Resend returns a dict with 'id' key on success
        email_id = result.get("id") if isinstance(result, dict) else getattr(result, "id", None)

        if email_id:
            logfire.info(
                "Email notification sent successfully",
                email_id=email_id,
                coach_email_preview=coach_email[:3] + "***",
            )
            return True
        else:
            logfire.error(
                "Failed to send email - no ID returned",
                result_type=type(result).__name__,
            )
            return False

    except Exception as e:
        logfire.exception(
            "Failed to send email notification to coach (outer exception)",
            error=str(e),
            error_type=type(e).__name__,
            coach_email_preview=coach_email[:3] + "***" if coach_email else "None",
        )
        return False




# Web endpoint for sending email notifications
# FastAPI imports - only needed for web endpoint function
# We use a try/except to allow local parsing, but FastAPI will be available in Modal container
try:
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
    _fastapi_available = True
except ImportError:
    # Create dummy classes for local parsing - will be replaced in Modal container
    class FastAPI:
        def post(self, *args, **kwargs):
            def decorator(func):
                return func
            return decorator
    
    class Request:
        pass
    
    class JSONResponse:
        def __init__(self, *args, **kwargs):
            pass
    
    _fastapi_available = False

# Always create FastAPI app - will work in Modal container
web_app = FastAPI() if _fastapi_available else None




# HTTP endpoint for sending email notifications
class EmailNotificationRequest(BaseModel):
    """Request body for email notification endpoint."""
    coach_email: str
    user_name: str


@app.function(
    secrets=[
        modal.Secret.from_name("supabase-backend"),
        modal.Secret.from_name("logfire"),
        modal.Secret.from_name("resend"),
    ],
    image=image,
)
@modal.web_endpoint(method="POST")
async def send_coach_email_endpoint(body: EmailNotificationRequest):
    """
    HTTP endpoint to send email notification to coach.
    Called from frontend when user sends a message to human coach.
    
    Expected JSON body:
        {
            "coach_email": "coach@example.com",
            "user_name": "John Doe"
        }
        
    Returns:
        JSON response with success status
    """
    try:
        # PII policy: do not log body.user_name — it is the user's display name.
        logfire.info(
            "Received email notification request",
            coach_email_preview=body.coach_email[:3] + "***" if body.coach_email else "None",
            has_user_name=bool(body.user_name),
        )

        if not body.coach_email or not body.user_name:
            logfire.warning(
                "Missing required fields in email notification request",
                has_coach_email=bool(body.coach_email),
                has_user_name=bool(body.user_name),
            )
            return {
                "success": False,
                "message": "Missing coach_email or user_name"
            }

        logfire.info(
            "Sending email notification",
            coach_email_preview=body.coach_email[:3] + "***",
        )
        
        success = await send_email_to_coach(body.coach_email, body.user_name)
        if success:
            logfire.info("Email notification sent successfully")
            return {
                "success": True,
                "message": "Email sent successfully"
            }
        else:
            logfire.warning("Email notification failed to send")
            return {
                "success": False,
                "message": "Failed to send email"
            }
    except Exception as e:
        logfire.exception(
            "Error in send_coach_email_endpoint",
            error_type=type(e).__name__,
            error_msg=str(e),
        )
        return {
            "success": False,
            "message": str(e)
        }


# Debug endpoint to test email with detailed error response
@app.function(
    secrets=[
        modal.Secret.from_name("supabase-backend"),
        modal.Secret.from_name("logfire"),
        modal.Secret.from_name("resend"),
    ],
    image=image,
)
@modal.web_endpoint(method="POST")
async def debug_send_email(body: EmailNotificationRequest):
    """Debug endpoint that returns detailed error information."""
    try:
        import resend
        
        resend_api_key = os.getenv("RESEND_API_KEY")
        from_email = os.getenv("RESEND_FROM_EMAIL", "info@glow360.dev ")
        
        if not resend_api_key:
            return {"success": False, "error": "RESEND_API_KEY not set", "env_keys": list(os.environ.keys())}
        
        resend.api_key = resend_api_key
        
        try:
            result = resend.Emails.send({
                "from": from_email,
                "to": body.coach_email,
                "subject": f"{body.user_name} has sent you a message",
                "text": f"{body.user_name} has sent you a message",
            })
            
            return {
                "success": True,
                "result": str(result),
                "result_type": type(result).__name__,
                "result_id": getattr(result, 'id', None) or (result.get('id') if isinstance(result, dict) else None),
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "error_type": type(e).__name__,
                "from_email": from_email,
                "to_email": body.coach_email,
            }
    except Exception as e:
        return {"success": False, "outer_error": str(e), "outer_error_type": type(e).__name__}
