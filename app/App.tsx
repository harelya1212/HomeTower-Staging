import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import AdBanner, { AD_BANNER_HEIGHT } from "./src/components/AdBanner.tsx";
import DocumentsScreen from "./src/screens/DocumentsScreen.tsx";
import HomeScreen, { NAVY, TEAL } from "./src/screens/HomeScreen.tsx";
import IntakeScreen from "./src/screens/IntakeScreen.tsx";
import OnboardingScreen from "./src/screens/OnboardingScreen.tsx";
import PlanScreen from "./src/screens/PlanScreen.tsx";
import { HouseholdProvider, useHousehold } from "./src/store.tsx";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGO_MARK = require("./assets/logo-mark.png");

const Tab = createBottomTabNavigator();

function HeaderLockup() {
  return (
    <View style={styles.lockup}>
      <Image source={LOGO_MARK} style={styles.logo} resizeMode="contain" />
      <Text style={styles.wordmark}>HomeTower</Text>
    </View>
  );
}

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: "home",
  Documents: "document-text",
  Plan: "analytics",
  Intake: "person",
};

function Shell() {
  const { state, loaded } = useHousehold();
  if (!loaded) return null;
  if (!state.onboarded) return <OnboardingScreen />;
  return (
    <View style={styles.root}>
    <NavigationContainer>
      <StatusBar style="light" />
      <Tab.Navigator
        id="main-tabs"
        screenOptions={({ route }) => ({
          headerStyle: { backgroundColor: NAVY },
          headerTintColor: "#FFFFFF",
          headerTitleAlign: "center",
          headerTitle: () => <HeaderLockup />,
          tabBarActiveTintColor: TEAL,
          tabBarInactiveTintColor: "#7A8CA3",
          tabBarStyle: { height: 68, paddingBottom: 10, paddingTop: 6 },
          tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
          tabBarIcon: ({ color }) => <Ionicons name={TAB_ICONS[route.name] ?? "ellipse"} size={26} color={color} />,
        })}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Documents" component={DocumentsScreen} />
        <Tab.Screen name="Plan" component={PlanScreen} />
        <Tab.Screen name="Intake" component={IntakeScreen} />
      </Tab.Navigator>
    </NavigationContainer>
    <View style={styles.adOverlay}>
      <AdBanner />
    </View>
    </View>
  );
}

export default function App() {
  return (
    <HouseholdProvider>
      <Shell />
    </HouseholdProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  adOverlay: { position: "absolute", left: 0, right: 0, bottom: 68, height: AD_BANNER_HEIGHT },
  lockup: { flexDirection: "row", alignItems: "center", gap: 8 },
  logo: { width: 30, height: 30, borderRadius: 7 },
  wordmark: { color: "#FFFFFF", fontSize: 19, fontWeight: "800" },
});
