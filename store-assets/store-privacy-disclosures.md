# Resumax — App Store & Play Console privacy disclosures

Filled in from what the backend actually does today (checked `backend/main.py`,
`backend/services/ai_service.py`, `backend/services/revenue_cat_service.py`).
Use this to fill the two store forms so they match reality — mismatches here
are a common rejection/removal reason on both stores.

## Apple: App Privacy ("Nutrition Label"), App Store Connect

Data types to declare as **collected**:

| Data type | Linked to identity? | Used for | Notes |
|---|---|---|---|
| **Other User Content** (CV/résumé text) | No | App Functionality | Sent to Groq and Gemini for rewriting. Not linked to identity — no account required. |
| **Photos** (optional headshot) | No | App Functionality | Only if the user adds one; embedded into the rendered PDF, not sent to the AI providers. |
| **Purchase History** | Yes (device/account ID via RevenueCat) | App Functionality | Subscription/entitlement status. |
| **Device ID** or **User ID** (RevenueCat identifier) | Yes | App Functionality | Used only to verify Pro entitlement. |

Mark **Data Not Collected** for: Contact Info, Health, Financial Info (payment
card details never reach your servers — App Store/Play handle those), Location,
Browsing History, Search History, Identifiers beyond the RevenueCat ID, Usage
Data / Analytics (unless you've since added an analytics SDK — check
`package.json` for one before submitting; none was present as of this audit).

**Tracking**: answer "No" to "Do you or your third-party partners use data
collected from this app to track users" — nothing here is used for
cross-app/cross-site ad tracking.

## Google Play: Data Safety form

| Question | Answer |
|---|---|
| Does your app collect or share user data? | Yes |
| Is data encrypted in transit? | Yes (HTTPS to Render + to Groq/Gemini/RevenueCat) |
| Can users request data deletion? | Data isn't retained beyond ~1 hour, so there's normally nothing to delete after that window — state this explicitly in the form's free-text field. |

Data types to declare:

- **Files and docs → Other files** (the CV text/PDF) — collected, not shared for
  advertising, purpose: "App functionality." Shared with Groq/Gemini as processors.
- **Photos** — collected only if the user adds one, purpose: "App functionality."
- **App info and performance → Crash logs / diagnostics** — declare only if
  you've added a crash-reporting SDK; none was found in this audit.
- **App activity → App interactions** — likely "not collected" unless you've
  added analytics.
- **Financial info → Purchase history** — collected via RevenueCat, purpose:
  "App functionality," not shared for advertising.

## Things to double check before submitting

1. **Hosting provider name** — fill in Section 3 of `privacy-policy.html`
   with your actual host (Render, per the checklist).
2. **Support email** — fill in Section 9 of `privacy-policy.html`.
3. If you've added any analytics/crash-reporting SDK since 2026-08-20, add it
   to both tables above — this doc only reflects what's in the repo as of
   this audit.
