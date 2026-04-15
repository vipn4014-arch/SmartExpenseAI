import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { AuthProvider } from './src/context/AuthContext';
import { NotificationProvider } from './src/context/NotificationContext';

import { LogBox } from 'react-native';

LogBox.ignoreLogs(['Could not reach Cloud Firestore backend']);

export default function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <SafeAreaProvider>
          <AppNavigator />
          <StatusBar style="light" />
        </SafeAreaProvider>
      </NotificationProvider>
    </AuthProvider>
  );
}
