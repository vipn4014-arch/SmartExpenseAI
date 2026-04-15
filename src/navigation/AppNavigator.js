import React, { useContext } from 'react';
import { StyleSheet, StatusBar, View, Text, ActivityIndicator } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { AuthContext } from '../context/AuthContext';
import { NotificationContext } from '../context/NotificationContext';

// Screens
import LoginScreen from '../screens/LoginScreen';
import SignupScreen from '../screens/SignupScreen';
import AddExpenseScreen from '../screens/AddExpenseScreen';
import BillScanScreen from '../screens/BillScanScreen';
import DashboardScreen from '../screens/DashboardScreen';
import TransactionHistoryScreen from '../screens/TransactionHistoryScreen';
import AIAgentScreen from '../screens/AIAgentScreen';
import SplitBillScreen from '../screens/SplitBillScreen';
import GroupsScreen from '../screens/GroupsScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const AppTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.card,
    text: colors.text,
    border: colors.border,
  },
};

const TabNavigator = () => {
  const { hasGroupNotification } = useContext(NotificationContext);
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopLeftRadius: 25,
          borderTopRightRadius: 25,
          borderTopWidth: 0,
          elevation: 20,
          height: 70,
          paddingBottom: 12,
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'Dashboard') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'History') {
            iconName = focused ? 'time' : 'time-outline';
          } else if (route.name === 'Agent') {
            iconName = focused ? 'shield-checkmark' : 'shield-checkmark-outline';
          } else if (route.name === 'Split') {
            iconName = focused ? 'calculator' : 'calculator-outline';
          } else if (route.name === 'Groups') {
            iconName = focused ? 'people' : 'people-outline';
          }

          return (
            <View>
              <Ionicons name={iconName} size={size} color={color} />
              {route.name === 'Groups' && hasGroupNotification && !focused && (
                <View style={styles.notificationDot} />
              )}
            </View>
          );
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="History" component={TransactionHistoryScreen} options={{ tabBarLabel: 'Expense History' }} />
      <Tab.Screen name="Agent" component={AIAgentScreen} options={{ tabBarLabel: 'AI Agent' }} />
      <Tab.Screen name="Split" component={SplitBillScreen} options={{ tabBarLabel: 'Split Bill' }} />
      <Tab.Screen name="Groups" component={GroupsScreen} />
    </Tab.Navigator>
  );
};

const SplashScreen = () => (
  <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
    <StatusBar barStyle="light-content" />
    <View style={styles.splashLogoBox}>
       <Text style={styles.splashAppName}>FINOVO</Text>
       <View style={styles.splashLine} />
       <Text style={styles.splashTagline}>SMART EXPENSE AI</Text>
    </View>
    <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 20 }} />
  </View>
);

const AppNavigator = () => {
  const { user, loading } = useContext(AuthContext);

  if (loading) {
    return <SplashScreen />;
  }

  return (
    <NavigationContainer theme={AppTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Signup" component={SignupScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="MainTabs" component={TabNavigator} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="AddExpense" component={AddExpenseScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="BillScan" component={BillScanScreen} options={{ presentation: 'modal' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashLogoBox: {
    alignItems: 'center',
  },
  splashAppName: {
    color: colors.primary,
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 4,
  },
  splashLine: {
    width: 60,
    height: 3,
    backgroundColor: colors.primary,
    marginVertical: 10,
    borderRadius: 2,
  },
  splashTagline: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 3,
  },
  notificationDot: {
    position: 'absolute',
    right: -2,
    top: -2,
    backgroundColor: '#FF3B30',
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.card,
  },
});

export default AppNavigator;
