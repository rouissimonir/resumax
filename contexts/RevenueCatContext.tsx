import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform, Alert, AppState, AppStateStatus } from "react-native";
import Purchases, {
  CustomerInfo,
  PurchasesPackage,
} from "react-native-purchases";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";

// Used only when the real RevenueCat native module is unavailable (e.g. Expo Go),
// so screens that require a userId (like PDF download) still work in dev.
const DEV_USER_ID = `dev-${Crypto.randomUUID()}`;

// Real RevenueCat public SDK keys, injected at build time via eas.json's
// `env` blocks (see EXPO_PUBLIC_RC_IOS / EXPO_PUBLIC_RC_ANDROID there). No
// hardcoded fallback here on purpose — a fallback silently masks a missing
// env var with a value that looks like it works, and Purchases.configure()
// gives a much clearer error when the key is genuinely absent.
const API_KEYS = {
  apple: process.env.EXPO_PUBLIC_RC_IOS,
  google: process.env.EXPO_PUBLIC_RC_ANDROID,
};

if (!__DEV__ && (!API_KEYS.apple || !API_KEYS.google)) {
  console.error(
    "[RevenueCat] Missing EXPO_PUBLIC_RC_IOS / EXPO_PUBLIC_RC_ANDROID in a " +
      "production build — purchases will not work. Set them as EAS secrets " +
      "and reference them from eas.json before building.",
  );
}

/**
 * Store product identifiers. These MUST match what you create in App Store
 * Connect / Play Console exactly — access is derived from them by string
 * comparison below, so a typo silently means "user has no access".
 *
 * Both platforms deliberately use the same identifier string. Keeping them
 * identical means one entry in each array rather than platform branching
 * everywhere access is checked.
 */
const LIFETIME_PRODUCT_IDS = ["resumax_pro_lifetime"];
const PASS_PRODUCT_IDS = ["resumax_pro_7day"];

/** How long the pass grants access, in days. */
const PASS_DURATION_DAYS = 7;

const ENTITLEMENT_ID = "pro_access";

/** AsyncStorage key for the one free PDF download every install gets. */
const FREE_DOWNLOAD_KEY = "FREE_DOWNLOAD_USED";

interface RevenueCatContextType {
  isPro: boolean;
  /** When the current pass lapses. null when there is no pass (or it's lifetime). */
  passExpiresAt: Date | null;
  /** True when access comes from a permanent purchase rather than a pass. */
  ownsLifetime: boolean;
  /** Every package in the current offering, cheapest first. */
  packages: PurchasesPackage[];
  /** Cheapest package — used as the default highlight on the paywall. */
  currentOffering: PurchasesPackage | null;
  purchasePackage: (pack: PurchasesPackage) => Promise<void>;
  restorePurchases: () => Promise<void>;
  isLoading: boolean;
  userId: string | null;
  /** True once the install has spent its single free PDF download. */
  freeDownloadUsed: boolean;
  /** Pro access, or a free download still available. */
  canDownload: boolean;
  consumeFreeDownload: () => Promise<void>;
}

const RevenueCatContext = createContext<RevenueCatContextType | undefined>(
  undefined,
);

/**
 * Derive access from a CustomerInfo.
 *
 * This deliberately does NOT trust `entitlements.active[ENTITLEMENT_ID]` on
 * its own. RevenueCat does not auto-expire non-renewing subscriptions — per
 * their own docs, "it's up to you to track when access should be revoked by
 * checking the date it was purchased." So if the 7-day pass is attached to
 * the entitlement, that entitlement reads as active forever and the pass
 * silently becomes a lifetime unlock.
 *
 * Instead: the entitlement only counts toward lifetime access when the
 * product behind it is actually a lifetime product, and the pass is always
 * evaluated from its purchase date. That stays correct whichever way the
 * dashboard is configured.
 */
function deriveAccess(customerInfo: CustomerInfo): {
  ownsLifetime: boolean;
  passExpiresAt: Date | null;
} {
  const txns = customerInfo.nonSubscriptionTransactions ?? [];

  const activeEnt = customerInfo.entitlements.active[ENTITLEMENT_ID];
  const entIsLifetime =
    !!activeEnt && LIFETIME_PRODUCT_IDS.includes(activeEnt.productIdentifier);

  const ownsLifetime =
    entIsLifetime ||
    txns.some((t) => LIFETIME_PRODUCT_IDS.includes(t.productIdentifier));

  // Latest pass purchase wins, so buying a second pass extends access from
  // the newer purchase rather than the original one.
  let latestPassMs: number | null = null;
  for (const t of txns) {
    if (!PASS_PRODUCT_IDS.includes(t.productIdentifier)) continue;
    const ms = new Date(t.purchaseDate).getTime();
    if (Number.isNaN(ms)) continue;
    if (latestPassMs === null || ms > latestPassMs) latestPassMs = ms;
  }

  const passExpiresAt =
    latestPassMs === null
      ? null
      : new Date(latestPassMs + PASS_DURATION_DAYS * 24 * 60 * 60 * 1000);

  return { ownsLifetime, passExpiresAt };
}

export function RevenueCatProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isPro, setIsPro] = useState(false);
  const [ownsLifetime, setOwnsLifetime] = useState(false);
  const [passExpiresAt, setPassExpiresAt] = useState<Date | null>(null);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [freeDownloadUsed, setFreeDownloadUsed] = useState(false);

  // Dev-only simulated purchases live here so a mock "purchase" survives the
  // foreground re-check below, which would otherwise immediately overwrite
  // isPro with the real (empty) CustomerInfo.
  const devPurchasedRef = useRef(false);

  useEffect(() => {
    loadFreeDownloadState();
    initRevenueCat();
  }, []);

  const loadFreeDownloadState = async () => {
    try {
      const value = await AsyncStorage.getItem(FREE_DOWNLOAD_KEY);
      setFreeDownloadUsed(value === "true");
    } catch (e) {
      // A read failure shouldn't hand out unlimited free downloads, but it
      // also shouldn't block a paying user. Default to "unused" and let the
      // write below correct it on first download.
      console.warn("[RevenueCat] Could not read free-download state:", e);
    }
  };

  const consumeFreeDownload = useCallback(async () => {
    setFreeDownloadUsed(true);
    try {
      await AsyncStorage.setItem(FREE_DOWNLOAD_KEY, "true");
    } catch (e) {
      console.warn("[RevenueCat] Could not persist free-download state:", e);
    }
  }, []);

  const applyCustomerInfo = useCallback((customerInfo: CustomerInfo) => {
    const { ownsLifetime: lifetime, passExpiresAt: expiry } =
      deriveAccess(customerInfo);
    const passActive = expiry !== null && expiry.getTime() > Date.now();

    setOwnsLifetime(lifetime);
    setPassExpiresAt(expiry);
    setIsPro(lifetime || passActive || devPurchasedRef.current);
  }, []);

  const initRevenueCat = async () => {
    try {
      console.log(`[RevenueCat] Initializing for ${Platform.OS}...`);

      if (Platform.OS === "ios") {
        Purchases.configure({ apiKey: API_KEYS.apple });
      } else if (Platform.OS === "android") {
        Purchases.configure({ apiKey: API_KEYS.google });
      }

      const customerInfo = await Purchases.getCustomerInfo();
      applyCustomerInfo(customerInfo);

      const id = await Purchases.getAppUserID();
      setUserId(id);

      const offerings = await Purchases.getOfferings();
      if (offerings.current && offerings.current.availablePackages.length > 0) {
        console.log(
          "[RevenueCat] Offerings found:",
          offerings.current.availablePackages.length,
        );
        setPackages(sortByPrice(offerings.current.availablePackages));
      } else {
        console.warn(
          "[RevenueCat] No offerings found. Check your RevenueCat dashboard configuration or if you are in Expo Go.",
        );
        if (__DEV__) {
          console.log("[RevenueCat] Development mode: Providing mock offering.");
          if (!userId) setUserId(DEV_USER_ID);
          setPackages(MOCK_PACKAGES);
        }
      }
    } catch (e: any) {
      console.error("[RevenueCat] Init error:", e);

      // In Expo Go this is expected — the native module isn't present.
      if (__DEV__) {
        console.log(
          "[RevenueCat] Development mode: Providing mock offering after error.",
        );
        // Purchases.configure() threw, so getAppUserID() never ran and userId
        // would otherwise stay null forever — use a stable dev-only id instead.
        setUserId(DEV_USER_ID);
        setPackages(MOCK_PACKAGES);
      }
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Re-check access when the app returns to the foreground.
   *
   * Without this a pass never lapses in a session that's simply backgrounded
   * and resumed days later — isPro was computed once at launch and nothing
   * would recompute it.
   */
  useEffect(() => {
    const sub = AppState.addEventListener(
      "change",
      async (state: AppStateStatus) => {
        if (state !== "active") return;
        try {
          const info = await Purchases.getCustomerInfo();
          applyCustomerInfo(info);
        } catch {
          // Offline or no native module — keep whatever we last resolved.
        }
      },
    );
    return () => sub.remove();
  }, [applyCustomerInfo]);

  const purchasePackage = async (pack: PurchasesPackage) => {
    try {
      // Simulate purchase for the dev mocks, which have no store behind them.
      if (__DEV__ && pack.identifier.endsWith("_mock")) {
        console.log(
          `[RevenueCat] Simulating successful purchase for ${pack.identifier}...`,
        );
        devPurchasedRef.current = true;
        setIsPro(true);
        if (pack.identifier.includes("lifetime")) {
          setOwnsLifetime(true);
          setPassExpiresAt(null);
        } else {
          setPassExpiresAt(
            new Date(Date.now() + PASS_DURATION_DAYS * 24 * 60 * 60 * 1000),
          );
        }
        Alert.alert("Success", "Development Mode: Pro access granted!");
        return;
      }

      const { customerInfo } = await Purchases.purchasePackage(pack);
      applyCustomerInfo(customerInfo);
    } catch (e: any) {
      if (!e.userCancelled) {
        Alert.alert("Purchase Error", e.message);
      }
    }
  };

  const restorePurchases = async () => {
    try {
      const customerInfo = await Purchases.restorePurchases();
      applyCustomerInfo(customerInfo);

      const { ownsLifetime: lifetime, passExpiresAt: expiry } =
        deriveAccess(customerInfo);
      const passActive = expiry !== null && expiry.getTime() > Date.now();

      if (lifetime) {
        Alert.alert("Success", "Your lifetime access has been restored.");
      } else if (passActive) {
        Alert.alert(
          "Success",
          `Your pass has been restored — active until ${expiry!.toLocaleDateString()}.`,
        );
      } else if (expiry) {
        // Distinguishing an expired pass from "never bought anything" avoids
        // the confusing case where a real past customer is told nothing was
        // found, when in fact their pass simply ran out.
        Alert.alert(
          "Pass expired",
          `Your last pass ended on ${expiry.toLocaleDateString()}. Buy another to regain access.`,
        );
      } else {
        Alert.alert("Notice", "No previous purchase found for this account.");
      }
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  const canDownload = isPro || !freeDownloadUsed;

  return (
    <RevenueCatContext.Provider
      value={{
        isPro,
        passExpiresAt,
        ownsLifetime,
        packages,
        currentOffering: packages.length > 0 ? packages[0] : null,
        purchasePackage,
        restorePurchases,
        isLoading,
        userId,
        freeDownloadUsed,
        canDownload,
        consumeFreeDownload,
      }}
    >
      {children}
    </RevenueCatContext.Provider>
  );
}

/**
 * Whether a package grants permanent access.
 *
 * Checks the product identifier as well as packageType because packageType
 * depends on how the package was set up in the RevenueCat dashboard — if
 * both tiers get created as "custom" packages, packageType is "CUSTOM" for
 * both and the lifetime tier would silently render as a 7-day pass. The
 * product ID is the thing that actually determines what was sold.
 */
export function isLifetimePackage(pack: PurchasesPackage): boolean {
  return (
    pack.packageType === "LIFETIME" ||
    LIFETIME_PRODUCT_IDS.includes(pack.product?.identifier)
  );
}

/** Cheapest first, so the paywall ladder reads low → high. */
function sortByPrice(list: PurchasesPackage[]): PurchasesPackage[] {
  return [...list].sort(
    (a, b) => (a.product?.price ?? 0) - (b.product?.price ?? 0),
  );
}

/**
 * Dev-only stand-ins so the paywall is testable in Expo Go, where the native
 * purchases module isn't available. Shaped to match the real products: a
 * non-renewing pass and a non-consumable lifetime unlock, neither of which
 * is a subscription (hence no subscriptionPeriod).
 */
const MOCK_PACKAGES: PurchasesPackage[] = [
  {
    identifier: "pro_7day_mock",
    packageType: "CUSTOM",
    product: {
      identifier: PASS_PRODUCT_IDS[0],
      description: "Unlimited CVs and downloads for 7 days",
      title: "7-Day Pass",
      price: 4.99,
      priceString: "$4.99",
      currencyCode: "USD",
      introPrice: null,
      discounts: [],
      subscriptionPeriod: null,
    },
    offeringIdentifier: "default",
  } as any,
  {
    identifier: "pro_lifetime_mock",
    packageType: "LIFETIME",
    product: {
      identifier: LIFETIME_PRODUCT_IDS[0],
      description: "Unlimited CVs and downloads, forever",
      title: "Lifetime",
      price: 14.99,
      priceString: "$14.99",
      currencyCode: "USD",
      introPrice: null,
      discounts: [],
      subscriptionPeriod: null,
    },
    offeringIdentifier: "default",
  } as any,
];

export const useRevenueCat = () => {
  const context = useContext(RevenueCatContext);
  if (!context) {
    throw new Error("useRevenueCat must be used within a RevenueCatProvider");
  }
  return context;
};
