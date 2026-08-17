import React from "react";
import { StyleSheet } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import MainTabNavigator from "@/navigation/MainTabNavigator";
import LoginScreen from "@/screens/LoginScreen";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ResumeProvider } from "@/contexts/ResumeContext";
import { UserProvider, useUser } from "@/contexts/UserContext";
import { PreferencesProvider } from "@/contexts/PreferencesContext";
// CreditsProvider removed
import { RevenueCatProvider } from "@/contexts/RevenueCatContext";

import OnboardingScreen from "@/screens/OnboardingScreen";

function AppContent() {
  const { isAuthenticated, hasSeenOnboarding, isLoading } = useUser();

  if (isLoading) {
    return null; // Or a loading spinner
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
