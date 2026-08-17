# RevenueCat Integration Setup

The codebase has been updated to use RevenueCat for handling "Pro Access" subscriptions instead of the previous credit-based system.

## 1. Environment Variables

You need to configure your API keys.

### Frontend (.env)
Create or update the `.env` file in the root directory (where `App.tsx` is) with your RevenueCat public SDK keys:

```bash
EXPO_PUBLIC_RC_IOS=appl_YourIosPublicKey
EXPO_PUBLIC_RC_ANDROID=goog_YourAndroidPublicKey
```

### Backend (backend/.env)
Update the backend environment variables to include your RevenueCat secret API key (for verifying subscriptions on the server):

```bash
REVENUECAT_API_KEY=your_secret_revenuecat_api_key
```

## 2. app.json Configuration

To ensure the native code is properly configured during prebuilds, add the `react-native-purchases` plugin to your `app.json`:

```json
{
  "expo": {
    // ...
    "plugins": [
      // ... other plugins
      "react-native-purchases"
    ]
  }
}
```

## 3. RevenueCat Dashboard

1.  **Create an App**: Set up your app in the RevenueCat dashboard.
2.  **Configure Products**: Create an "Entitlement" called `pro_access`.
3.  **Offerings**: Create an "Offering" (e.g., "Default") and attach your packages (products) to it.
    *   The `PricingScreen` automatically displays the "Current" offering.
4.  **Connect to Stores**: Ensure your Apple App Store / Google Play Store credentials are set up in RevenueCat.

## 4. Testing

*   **Emulator/Simulators**: StoreKit/Play Billing won't work fully in simulators without configuration. Use a physical device for best results.
*   **Debug Mode**: If keys are missing, the app will log a warning but won't crash. Authentication might default to "Free" status.
