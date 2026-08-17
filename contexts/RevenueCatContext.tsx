import React, { createContext, useContext, useEffect, useState } from "react";
import { Platform, Alert } from "react-native";
import Purchases, {
  CustomerInfo,
  PurchasesPackage,
} from "react-native-purchases";
import * as Crypto from "expo-crypto";

// Used only when the real RevenueCat native module is unavailable (e.g. Expo Go),
// so screens that require a userId (like PDF download) still work in dev.
const DEV_USER_ID = `dev-${Crypto.randomUUID()}`;

// Keys are now retrieved from environment variables for better security and flexibility
const API_KEYS = {
  apple: process.env.EXPO_PUBLIC_RC_IOS || "appl_PLACEHOLDER_IOS",
  google: process.env.EXPO_PUBLIC_RC_ANDROID || "goog_QBWwCoAiOgDVxgTkceZciGsxJSX",
};

interface RevenueCatContextType {
  isPro: boolean;
  currentOffering: PurchasesPackage | null;
  purchasePackage: (pack: PurchasesPackage) => Promise<void>;
  restorePurchases: () => Promise<void>;
  isLoading: boolean;
  userId: string | null;
}

const RevenueCatContext = createContext<RevenueCatContextType | undefined>(
  undefined,
);

export function RevenueCatProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isPro, setIsPro] = useState(false);
  const [currentOffering, setCurrentOffering] =
    useState<PurchasesPackage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    initRevenueCat();
  }, []);

  const initRevenueCat = async () => {
    try {
      // Debug logging to help identify which key is being used
      console.log(`[RevenueCat] Initializing for ${Platform.OS}...`);

      if (Platform.OS === "ios") {
        Purchases.configure({ apiKey: API_KEYS.apple });
      } else if (Platform.OS === "android") {
        Purchases.configure({ apiKey: API_KEYS.google });
      }

      const customerInfo = await Purchases.getCustomerInfo();
      checkEntitlements(customerInfo);

      const id = await Purchases.getAppUserID();
      setUserId(id);

      const offerings = await Purchases.getOfferings();
      if (offerings.current && offerings.current.availablePackages.length > 0) {
        console.log("[RevenueCat] Offerings found:", offerings.current.availablePackages.length);
        setCurrentOffering(offerings.current.availablePackages[0]);
      } else {
        console.warn("[RevenueCat] No offerings found. Check your RevenueCat dashboard configuration or if you are in Expo Go.");

        // DEVELOPMENT FALLBACK: If we are in development and no packages are found (common in Expo Go),
        // we can provide a mock package so the UI doesn't say "No packages available"
        if (__DEV__) {
          console.log("[RevenueCat] Development mode: Providing mock offering.");
          if (!userId) setUserId(DEV_USER_ID);
          setCurrentOffering({
            identifier: "pro_monthly_mock",
            packageType: "MONTHLY",
            product: {
              identifier: "pro_access",
              description: "Full access to all AI features",
              title: "Resumax Pro (Dev Mock)",
              price: 4.99,
              priceString: "$4.99",
              currencyCode: "USD",
              introPrice: null,
              discounts: [],
              subscriptionPeriod: "P1M",
            },
            offeringIdentifier: "default",
          } as any);
        }
      }
    } catch (e: any) {
      console.error("[RevenueCat] Init error:", e);

      // If we are in Expo Go, this error is expected unless using a Test Store key
      if (__DEV__) {
        console.log("[RevenueCat] Development mode: Providing mock offering after error.");
        // Purchases.configure() threw, so getAppUserID() never ran and userId
        // would otherwise stay null forever — use a stable dev-only id instead.
        setUserId(DEV_USER_ID);
        setCurrentOffering({
          identifier: "pro_monthly_mock",
          packageType: "MONTHLY",
          product: {
            identifier: "pro_access",
            description: "Full access to all AI features (Development Mode)",
            title: "Resumax Pro (Mock)",
            price: 7.99,
            priceString: "$7.99",
            currencyCode: "USD",
            introPrice: null,
            discounts: [],
            subscriptionPeriod: "P1M",
          },
          offeringIdentifier: "default",
        } as any);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const checkEntitlements = (customerInfo: CustomerInfo) => {
    // BYPASS: In production builds, grant full access automatically
    if (!__DEV__) {
      console.log("[RevenueCat] Production build: Automatically granting Pro access.");
      setIsPro(true);
      return;
    }

    if (customerInfo.entitlements.active["pro_access"]) {
      setIsPro(true);
    } else {
      setIsPro(false);
    }
  };

  const purchasePackage = async (pack: PurchasesPackage) => {
    try {
      // Simulate purchase if using mock package in development
      if (__DEV__ && pack.identifier === "pro_monthly_mock") {
        console.log("[RevenueCat] Simulating successful purchase for mock package...");
        setIsPro(true);
        Alert.alert("Success", "Development Mode: Pro access granted!");
        return;
      }

      const { customerInfo } = await Purchases.purchasePackage(pack);
      checkEntitlements(customerInfo);
    } catch (e: any) {
      if (!e.userCancelled) {
        Alert.alert("Purchase Error", e.message);
      }
    }
  };

  const restorePurchases = async () => {
    try {
      const customerInfo = await Purchases.restorePurchases();
      checkEntitlements(customerInfo);
      if (customerInfo.entitlements.active["pro_access"]) {
        Alert.alert("Success", "Purchases restored!");
      } else {
        Alert.alert("Notice", "No active subscriptions found.");
      }
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  return (
    <RevenueCatContext.Provider
      value={{
        isPro,
        currentOffering,
        purchasePackage,
        restorePurchases,
        isLoading,
        userId,
      }}
    >
      {children}
    </RevenueCatContext.Provider>
  );
}

export const useRevenueCat = () => {
  const context = useContext(RevenueCatContext);
  if (!context) {
    throw new Error("useRevenueCat must be used within a RevenueCatProvider");
  }
  return context;
};
