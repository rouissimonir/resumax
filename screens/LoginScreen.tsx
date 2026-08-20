import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  Image,
  ActivityIndicator,
  Animated,
  Dimensions,
  Alert,
  Text,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LEGAL_URLS, openLegalUrl } from "@/constants/legal";

import GoogleSignInButton from "@/components/GoogleSignInButton";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  Typography,
  Gradients,
  Shadows,
  Animations,
} from "@/constants/theme";
import { useUser } from "@/contexts/UserContext";

WebBrowser.maybeCompleteAuthSession();

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export default function LoginScreen() {
  const { theme, colorScheme } = useTheme();
  const { signInWithGoogle, continueAsGuest } = useUser();
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const logoScaleAnim = useRef(new Animated.Value(0.8)).current;

  console.log(
    "🤖 Google Config - Android:",
    !!process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  );
  console.log(
    "🍎 Google Config - iOS:",
    !!process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  );
  console.log(
    "🌐 Google Config - Web:",
    !!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  );

  const hasGoogleConfig = !!(
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
  );

  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId:
      process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || "dummy_android_id",
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "dummy_ios_id",
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "dummy_web_id",
  });

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: Animations.slow,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        ...Animations.spring,
        useNativeDriver: true,
      }),
      Animated.spring(logoScaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  useEffect(() => {
    if (response?.type === "success") {
      const { authentication } = response;
      fetchUserInfo(authentication?.accessToken);
    }
  }, [response]);

  const fetchUserInfo = async (token: string | undefined) => {
    if (!token) return;
    setIsLoading(true);
    try {
      const userInfoResponse = await fetch(
        "https://www.googleapis.com/userinfo/v2/me",
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const userInfo = await userInfoResponse.json();
      signInWithGoogle({
        id: userInfo.id,
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
      });
    } catch (error) {
      console.error("Failed to fetch user info:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!hasGoogleConfig || !request) {
      handleGuestContinue();
      return;
    }
    setIsLoading(true);
    try {
      await promptAsync();
    } catch (error) {
      handleGuestContinue();
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestContinue = () => continueAsGuest();

  return (
    <View style={[styles.container, { backgroundColor: "#1A202C" }]}>
      <LinearGradient
        colors={["#1A202C", "#2D3748", "#4A5568"]} // Dark slate gray gradient
        style={StyleSheet.absoluteFill}
      />

      <View
        style={[styles.content, { paddingTop: insets.top + Spacing["3xl"] }]}
      >
        <Animated.View
          style={[
            styles.logoSection,
            { opacity: fadeAnim, transform: [{ scale: logoScaleAnim }] },
          ]}
        >
          <View style={[styles.logoContainer, Shadows.xl]}>
            <LinearGradient
              colors={["#2D3748", "#4A5568"]}
              style={styles.logoGradient}
            >
              <Image
                source={require("@/assets/images/icon.png")}
                style={styles.logo}
                resizeMode="contain"
              />
            </LinearGradient>
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.textSection,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <Text style={styles.title}>Resumax</Text>
          <Text style={styles.subtitle}>
            Transform your resume with AI-powered enhancements and professional
            Harvard-style formatting
          </Text>
        </Animated.View>

        <Animated.View
          style={[
            styles.buttonsSection,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          {hasGoogleConfig && (
            <GoogleSignInButton
              onPress={handleGoogleSignIn}
              isLoading={isLoading}
              disabled={!request}
            />
          )}
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
            ]}
            onPress={handleGuestContinue}
            disabled={isLoading}
          >
            <LinearGradient
              colors={["#6366F1", "#4F46E5"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.buttonGradient}
            >
              {isLoading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Text style={styles.buttonText}>
                    {hasGoogleConfig ? "Continue as Guest" : "Get Started"}
                  </Text>
                  <Feather
                    name="arrow-right"
                    size={20}
                    color="#E2E8F0"
                    style={{ marginLeft: 8 }}
                  />
                </>
              )}
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </View>

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg }]}
      >
        {/* The consent line has to be actionable, not decorative: it claims
            the user agreed to a policy, so the policy must be one tap away.
            Only names documents that actually have a URL configured. */}
        <Text style={styles.footerText}>
          By continuing, you agree to our{" "}
          {LEGAL_URLS.terms ? (
            <>
              <Text
                style={styles.footerLink}
                onPress={() => openLegalUrl(LEGAL_URLS.terms)}
              >
                Terms
              </Text>
              {" and "}
            </>
          ) : null}
          <Text
            style={styles.footerLink}
            onPress={() => openLegalUrl(LEGAL_URLS.privacy)}
          >
            Privacy Policy
          </Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: Spacing.xl, justifyContent: "center" },
  logoSection: { alignItems: "center", marginBottom: Spacing["2xl"] },
  logoContainer: {
    width: 100,
    height: 100,
    borderRadius: BorderRadius.xl,
    overflow: "hidden",
  },
  logoGradient: { flex: 1, alignItems: "center", justifyContent: "center" },
  logo: { width: 60, height: 60 },
  textSection: { alignItems: "center", marginBottom: Spacing.xl },
  title: {
    textAlign: "center",
    marginBottom: Spacing.sm,
    color: "#E2E8F0",
    fontSize: 36,
    fontWeight: "bold",
  },
  subtitle: {
    textAlign: "center",
    paddingHorizontal: Spacing.lg,
    lineHeight: 24,
    color: "#A0AEC0",
    fontSize: 16,
  },
  buttonsSection: {
    gap: Spacing.md,
    maxWidth: 340,
    alignSelf: "center",
    width: "100%",
  },
  primaryButton: {
    height: Spacing.buttonHeight,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    ...Shadows.glow,
  },
  buttonGradient: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  footer: { alignItems: "center", paddingHorizontal: Spacing.xl },
  buttonText: { color: "#E2E8F0", fontSize: 16, fontWeight: "bold" },
  footerText: { color: "#718096", fontSize: 12, textAlign: "center" },
  footerLink: {
    color: "#A0AEC0",
    fontSize: 12,
    textDecorationLine: "underline",
  },
});
