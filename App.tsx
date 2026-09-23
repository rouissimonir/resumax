import React, { useState, useEffect } from "react";
import { StyleSheet } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as ExpoSplashScreen from "expo-splash-screen";

import MainTabNavigator from "@/navigation/MainTabNavigator";
import LoginScreen from "@/screens/LoginScreen";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ResumeProvider } from "@/contexts/ResumeContext";
import { UserProvider, useUser } from "@/contexts/UserContext";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
// CreditsProvider removed
import { RevenueCatProvider } from "@/contexts/RevenueCatContext";

import OnboardingScreen from "@/screens/OnboardingScreen";
import { SplashScreen } from "@/components/SplashScreen";
import { resumeApi } from "@/services/resumeApi";

// Kick off the templates fetch immediately on app launch, before any screen
// mounts, so a cold Render backend has the whole splash/onboarding window to
// wake up instead of stalling the upload/profile screens later.
resumeApi.prefetchTemplates();

// Keep Expo's native splash (the static image from app.json) on screen until
// we explicitly hide it below. Without this it auto-hides the instant the JS
// bundle mounts — before our animated splash has painted a single frame —
// so the two splashes race and the animated one never gets seen.
ExpoSplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden / not supported (e.g. web) — safe to ignore.
});

// Our animated splash's own minimum on-screen time. UserContext's
// AsyncStorage check usually resolves in well under 50ms, so gating purely
// on `isLoading` let the splash disappear before its "draw" animation (which
// takes ~1.2s per loop) ever completed. This floor guarantees it's actually
// seen regardless of how fast the real loading finishes.
const MIN_SPLASH_MS = 2200;

function AppContent() {
  const { isAuthenticated, hasSeenOnboarding, isLoading } = useUser();
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [nativeSplashHidden, setNativeSplashHidden] = useState(false);

  // Hand off from the native splash to our animated one on first paint.
  useEffect(() => {
    ExpoSplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => setNativeSplashHidden(true));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setMinTimeElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  const appDataReady = !isLoading;
  const showSplash = !(minTimeElapsed && appDataReady && nativeSplashHidden);

  if (showSplash) {
    return <SplashScreen />;
  }

  if (!hasSeenOnboarding) {
    return <OnboardingScreen />;
  }

  return (
    <NavigationContainer>
      {isAuthenticated ? <MainTabNavigator /> : <LoginScreen />}
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <GestureHandlerRootView style={styles.root}>
          <KeyboardProvider>
            <UserProvider>
              <RevenueCatProvider>
                <PreferencesProvider>
                  <ResumeProvider>
                    <AppContent />
                    <StatusBar style="auto" />
                  </ResumeProvider>
                </PreferencesProvider>
              </RevenueCatProvider>
            </UserProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
