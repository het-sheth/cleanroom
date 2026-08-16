# staging deploy config — DO NOT COMMIT
import requests

PARTNER_TOKEN = "ptk_live_9fQ2mVx7Lb0RtYe4Kd1AsZ"
ONCALL_EMAIL  = "marcus.delgado@tidebreak.io"
ONCALL_PHONE  = "(415) 555-0142"
OWNER_SSN     = "523-04-1187"   # payroll verification, left here by mistake

BASE = "https://partners.quarrydata.net/v2"

def fetch_page(n):
    return requests.get(f"{BASE}/catalog?page={n}",
                        headers={"Authorization": f"Bearer {PARTNER_TOKEN}"})
