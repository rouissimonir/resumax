import logging
import os
import requests
from datetime import datetime
from urllib.parse import quote

logger = logging.getLogger(__name__)

REVENUECAT_API_KEY = os.getenv("REVENUECAT_API_KEY", "mock_key")
REVENUECAT_API_URL = "https://api.revenuecat.com/v1"
REVENUECAT_TIMEOUT_SECONDS = 10

class RevenueCatService:
    def __init__(self):
        self.api_key = REVENUECAT_API_KEY

    def verify_pro_access(self, user_id: str) -> bool:
        """
        Verify if the user has active 'pro_access' entitlement.
        """
        # MOCK MODE: with no real API key set, every user is treated as Pro.
        if self.api_key == "mock_key":
            logger.warning("RevenueCat running in MOCK MODE. Granting access.")
            return True

        try:
            url = f"{REVENUECAT_API_URL}/subscribers/{quote(user_id, safe='')}"
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json"
            }

            response = requests.get(url, headers=headers, timeout=REVENUECAT_TIMEOUT_SECONDS)
            
            if response.status_code != 200:
                logger.error(f"RevenueCat API error: {response.status_code} - {response.text}")
                return False
                
            data = response.json()
            entitlements = data.get("subscriber", {}).get("entitlements", {})
            pro_access = entitlements.get("pro_access", {})
            
            if not pro_access:
                return False
                
            # Check expiration
            expires_date_str = pro_access.get("expires_date")
            if not expires_date_str:
                # Lifetime access or consumable that hasn't "expired" in RC terms
                return True
                
            expires_date = datetime.fromisoformat(expires_date_str.replace('Z', '+00:00'))
            if expires_date > datetime.now(expires_date.tzinfo):
                return True
                
            return False

        except Exception as e:
            logger.error(f"Error verifying RevenueCat access: {str(e)}")
            return False

revenue_cat_service = RevenueCatService()
