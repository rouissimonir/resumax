import React, { useState, useRef, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  useWindowDimensions,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
  useAnimatedScrollHandler,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useUser } from "@/contexts/UserContext";
import CvPreferencesForm from "@/components/CvPreferencesForm";
import { resumeApi } from "@/services/resumeApi";

import { Image } from "react-native";
const slides = [
  {
    id: "1",
    title: "Welcome to Resumax",
    description:
      "Create professional, Harvard-standard resumes in seconds with the power of AI.",
    image: require("@/assets/images/icon.png"),
  },
  {
    id: "2",
    title: "AI-Powered Enhancements",
    description:
      "Our intelligent algorithms optimize your content to beat Applicant Tracking Systems (ATS).",
    icon: "sparkles-outline",
  },
  {
    id: "3",
    title: "Get Hired Faster",
    description:
      "Stand out from the crowd with premium templates designed by recruiters.",
    icon: "briefcase-outline",
  },
];

const OnboardingItem = ({
  item,
  index,
  scrollX,
}: {
  item: any;
  index: number;
  scrollX: any;
}) => {
  const { width } = useWindowDimensions();

  const animatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(
      scrollX.value,
      [(index - 1) * width, index * width, (index + 1) * width],
      [0.8, 1, 0.8],
      Extrapolation.CLAMP,
    );

    const opacity = interpolate(
      scrollX.value,
      [(index - 1) * width, index * width, (index + 1) * width],
      [0.5, 1, 0.5],
      Extrapolation.CLAMP,
    );

    return {
      transform: [{ scale }],
      opacity,
    };
  });

  return (
    <View style={[styles.itemContainer, { width }]}>
      <Animated.View style={[styles.iconContainer, animatedStyle]}>
        <LinearGradient
          colors={["#2D3748", "#4A5568"]} // Dark slate gray gradient
          style={styles.circle}
        >
          {item.image ? (
            <Image source={item.image} style={styles.image} />
          ) : (
            <Ionicons name={item.icon as any} size={100} color="#A0AEC0" /> // Cool gray
          )}
        </LinearGradient>
      </Animated.View>
      <View style={styles.textContainer}>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.description}>{item.description}</Text>
      </View>
    </View>
  );
};

const Paginator = ({ data, scrollX }: { data: any[]; scrollX: any }) => {
  const { width } = useWindowDimensions();

  return (
    <View style={styles.paginatorContainer}>
      {data.map((_, i) => {
        const inputRange = [(i - 1) * width, i * width, (i + 1) * width];

        const animatedDotStyle = useAnimatedStyle(() => {
          const dotWidth = interpolate(
            scrollX.value,
            inputRange,
            [10, 20, 10],
            Extrapolation.CLAMP,
          );

          const opacity = interpolate(
            scrollX.value,
            inputRange,
            [0.3, 1, 0.3],
            Extrapolation.CLAMP,
          );

          return {
            width: dotWidth,
            opacity,
            backgroundColor: "#6366F1", // Indigo
          };
        });

        return (
          <Animated.View
            key={i.toString()}
            style={[styles.dot, animatedDotStyle]}
          />
        );
      })}
    </View>
  );
};

export default function OnboardingScreen() {
  const { completeOnboarding } = useUser();
  // The questions are a second phase rather than extra carousel pages: a
  // paging FlatList swallows the horizontal drags that chips and a text input
  // need, and mixing the two makes both feel broken.
  const [showQuestions, setShowQuestions] = useState(false);
  const [templates, setTemplates] = useState<
    { id: string; name: string; badge?: string | null }[]
  >([]);

  useEffect(() => {
    // Best-effort: if the backend is unreachable the format question is simply
    // hidden and the rest of onboarding still works.
    resumeApi
      .getTemplates()
      .then((list: any) =>
        setTemplates(
          (Array.isArray(list) ? list : list?.templates || []).map((t: any) => ({
            id: t.id,
            name: t.name,
            badge: t.badge ?? null,
          })),
        ),
      )
      .catch(() => setTemplates([]));
  }, []);
  const { width } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollX = useSharedValue(0);
  const slidesRef = useRef<FlatList>(null);

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: any[] }) => {
      if (viewableItems.length > 0) {
        setCurrentIndex(viewableItems[0].index);
      }
    },
  ).current;

  const viewConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      slidesRef.current?.scrollToOffset({
        offset: (currentIndex + 1) * width,
        animated: true,
      });
    } else {
      setShowQuestions(true);
    }
  };

  if (showQuestions) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <LinearGradient
          colors={["#1A202C", "#2D3748", "#4A5568"]}
          style={StyleSheet.absoluteFillObject}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />

        <View style={styles.questionsHeader}>
          <Text style={styles.questionsTitle}>Set up your CVs</Text>
          <Text style={styles.questionsSubtitle}>
            All optional — everything here can be changed later in your profile.
          </Text>
        </View>

        <View style={styles.questionsBody}>
          <CvPreferencesForm dark templates={templates} />
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.button}
            onPress={completeOnboarding}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={["#6366F1", "#4F46E5"]}
              style={styles.buttonGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Text style={styles.buttonText}>Done</Text>
              <Ionicons
                name="arrow-forward"
                size={20}
                color="#E2E8F0"
                style={{ marginLeft: 8 }}
              />
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={completeOnboarding}
            style={styles.skipButton}
          >
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <LinearGradient
        colors={["#1A202C", "#2D3748", "#4A5568"]} // Dark slate gray gradient
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      <View style={{ flex: 3 }}>
        <Animated.FlatList
          data={slides}
          renderItem={({ item, index }) => (
            <OnboardingItem item={item} index={index} scrollX={scrollX} />
          )}
          horizontal
          showsHorizontalScrollIndicator={false}
          pagingEnabled
          bounces={false}
          keyExtractor={(item) => item.id}
          onScroll={scrollHandler}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewConfig}
          scrollEventThrottle={32}
          ref={slidesRef}
          getItemLayout={(data, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
        />
      </View>

      <View style={styles.footer}>
        <Paginator data={slides} scrollX={scrollX} />

        <TouchableOpacity
          style={styles.button}
          onPress={handleNext}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={["#6366F1", "#4F46E5"]} // Indigo gradient
            style={styles.buttonGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Text style={styles.buttonText}>
              {currentIndex === slides.length - 1 ? "Get Started" : "Next"}
            </Text>
            {currentIndex === slides.length - 1 && (
              <Ionicons
                name="arrow-forward"
                size={20}
                color="#E2E8F0"
                style={{ marginLeft: 8 }}
              />
            )}
          </LinearGradient>
        </TouchableOpacity>

        {currentIndex < slides.length - 1 && (
          <TouchableOpacity
            onPress={completeOnboarding}
            style={styles.skipButton}
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  questionsHeader: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 8 },
  questionsTitle: { fontSize: 26, fontWeight: "800", color: "#F7FAFC" },
  questionsSubtitle: {
    fontSize: 14,
    color: "#A0AEC0",
    marginTop: 6,
    lineHeight: 20,
  },
  questionsBody: { flex: 1, paddingHorizontal: 24, paddingTop: 12 },
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1A202C", // Dark slate gray
  },
  itemContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  iconContainer: {
    marginBottom: 40,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  circle: {
    width: 250,
    height: 250,
    borderRadius: 125,
    justifyContent: "center",
    alignItems: "center",
  },
  image: {
    width: 150,
    height: 150,
    resizeMode: "contain",
  },
  textContainer: {
    paddingHorizontal: 40,
    alignItems: "center",
  },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    marginBottom: 16,
    color: "#E2E8F0", // Light gray
    textAlign: "center",
  },
  description: {
    fontSize: 16,
    color: "#A0AEC0", // Cool gray
    textAlign: "center",
    lineHeight: 24,
  },
  footer: {
    // No flex here on purpose: this sits after questionsBody (flex: 1) in the
    // same column, so it only needs its own content height. It previously
    // had flex: 1 too, which made it claim half the remaining screen height
    // — space-between then spread "Done" and "Skip" across that whole extra
    // block instead of sitting near the actual bottom of the screen.
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 50,
    width: "100%",
  },
  paginatorContainer: {
    flexDirection: "row",
    height: 64,
  },
  dot: {
    height: 10,
    borderRadius: 5,
    backgroundColor: "#4A5568", // Gray
    marginHorizontal: 8,
  },
  button: {
    width: "80%",
    height: 56,
    borderRadius: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  buttonGradient: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 28,
    flexDirection: "row",
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  skipButton: {
    marginTop: 20,
    padding: 10,
  },
  skipText: {
    color: "#718096", // Gray
    fontSize: 16,
    fontWeight: "600",
  },
});
