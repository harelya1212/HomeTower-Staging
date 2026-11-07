import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { HouseholdProvider } from "./src/store.tsx";
import DocumentsScreen from "./src/screens/DocumentsScreen.tsx";
import HomeScreen, { NAVY, TEAL } from "./src/screens/HomeScreen.tsx";
import IntakeScreen from "./src/screens/IntakeScreen.tsx";

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <HouseholdProvider>
      <NavigationContainer>
        <StatusBar style="dark" />
        <Tab.Navigator
          id="main-tabs"
          screenOptions={{
            headerStyle: { backgroundColor: NAVY },
            headerTintColor: "#FFFFFF",
            tabBarActiveTintColor: TEAL,
          }}
        >
          <Tab.Screen name="Home" component={HomeScreen} options={{ title: "HomeTower" }} />
          <Tab.Screen name="Documents" component={DocumentsScreen} />
          <Tab.Screen name="Intake" component={IntakeScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </HouseholdProvider>
  );
}
