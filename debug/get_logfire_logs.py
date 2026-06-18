
import requests
import csv
from datetime import datetime, timezone
import os
import time

# Configuration - REPLACE WITH YOUR VALUES
READ_TOKEN = "pylf_v1_us_pnR3TQ8d8SsTv19v2L2fnb8DwpQgHCsGFNvM2qNv9Nd5"  # From Logfire Settings > Read tokens
PROJECT_SLUG = "glow360"  # Format: organization/project
OUTPUT_FILE = "debug/logfire_details.csv"

# API endpoint
BASE_URL = "https://logfire-api.pydantic.dev/v1/query"

# Filter by specific times (CET) - converting to UTC
start_time = datetime(2025, 12, 7, 21, 55, 0, tzinfo=timezone.utc)  # 19:47 CET = 18:47 UTC
end_time = datetime(2025, 12, 7, 21, 56, 0, tzinfo=timezone.utc)    # 19:51 CET = 18:51 UTC

# SQL query for all records (logs/traces) in time range
sql_query = f"""
SELECT
    start_timestamp,
    end_timestamp,
    service_name,
    span_name,
    span_id,
    attributes,
    otel_events,
    level,
    message
FROM records
WHERE service_name = 'com.aprid89.glow360:glow360'
ORDER BY start_timestamp
"""

headers = {
    'Authorization': f'Bearer {READ_TOKEN}',
    'Accept': 'text/csv'
}

params = {
    'sql': sql_query,
    'project': PROJECT_SLUG  # May be needed depending on token scope
}

print("Fetching Logfire data...")

# Collect all records with pagination (up to 10,000 records)
all_data = []
header_written = False
total_records = 0
page_size = 500
max_records = 10000

for offset in range(0, max_records, page_size):
    # Update SQL query with LIMIT and OFFSET
    paginated_sql = f"""
    SELECT
        start_timestamp,
        end_timestamp,
        service_name,
        span_name,
        span_id,
        attributes,
        otel_events,
        level,
        message
    FROM records
    WHERE service_name = 'com.aprid89.glow360:glow360'
    ORDER BY start_timestamp
    LIMIT {page_size} OFFSET {offset}
    """

    params['sql'] = paginated_sql
    response = requests.get(BASE_URL, params=params, headers=headers)

    if response.status_code == 429:
        # Rate limit exceeded - wait longer and retry
        print(f"⏳ Rate limit exceeded on page {offset // page_size + 1}, waiting 30 seconds...")
        time.sleep(30)
        response = requests.get(BASE_URL, params=params, headers=headers)
        if response.status_code != 200:
            print(f"❌ Error after retry: {response.status_code}")
            print(response.text)
            break
    elif response.status_code != 200:
        print(f"❌ Error on page {offset // page_size + 1}: {response.status_code}")
        print(response.text)
        break

    # Parse CSV response
    lines = response.text.strip().split('\n')
    if not lines or (len(lines) == 1 and not header_written):
        # No more data
        break

    if not header_written:
        # First page - include header
        all_data.extend(lines)
        header_written = True
    else:
        # Subsequent pages - skip header, only add data rows
        if len(lines) > 1:  # Has header + data
            all_data.extend(lines[1:])  # Skip header row
        else:
            # Only header, no data
            break

    page_records = len(lines) - (0 if not header_written else 1)
    total_records += page_records
    print(f"📄 Page {offset // page_size + 1}: {page_records} records (total: {total_records})")

    # Stop if we got fewer records than requested (last page)
    if page_records < page_size:
        break

    # Stop if we've reached the max limit
    if total_records >= max_records:
        print(f"⚠️  Reached maximum limit of {max_records} records")
        break

    # Add delay to avoid rate limiting (1 second between requests)
    time.sleep(1)

# Write all collected data to CSV
with open(OUTPUT_FILE, 'w', newline='', encoding='utf-8') as f:
    f.write('\n'.join(all_data))
    f.write('\n')  # Ensure trailing newline

print(f"✅ Exported {len(all_data)} rows to {OUTPUT_FILE}")
