import React, { useContext, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, SafeAreaView, ScrollView, Share, Platform, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { AuthContext } from '../context/AuthContext';
import { auth } from '../utils/firebase';
import { sendPasswordResetEmail, signOut } from 'firebase/auth';

const SettingsScreen = ({ navigation }) => {
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [customAlert, setCustomAlert] = useState({ visible: false, title: '', message: '', buttons: [] });

  const showThemeAlert = (title, message, buttons = [{ text: 'OK' }]) => {
    setCustomAlert({ visible: true, title, message, buttons });
  };

  const handleShareApp = async () => {
    try {
      await Share.share({
        message: 'Check out Finovo, an amazing Smart Expense AI app! Simplify your budget management today.',
      });
    } catch (error) {
      showThemeAlert('Error', error.message);
    }
  };

  const handleChangePassword = async () => {
    try {
      if (user?.email) {
        await sendPasswordResetEmail(auth, user.email);
        showThemeAlert(
          'Email Sent', 
          `A password reset link has been sent to ${user.email}.\n\nPlease check your Inbox and Spam folder.`
        );
      } else {
        showThemeAlert('Error', 'No email found for current user.');
      }
    } catch (error) {
      showThemeAlert('Error', error.message);
    }
  };

  const handleLogout = async () => {
    showThemeAlert(
      "Logout",
      "Are you sure you want to log out?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Logout", 
          style: "destructive",
          onPress: async () => {
            try {
              await signOut(auth);
              navigation.replace('Login');
            } catch (error) {
              showThemeAlert('Error', 'Failed to log out.');
            }
          }
        }
      ]
    );
  };

  const renderSettingOption = (icon, title, onPress, customColor = colors.text) => (
    <TouchableOpacity style={styles.optionContainer} onPress={onPress}>
      <View style={styles.optionLeft}>
        <View style={styles.iconBox}>
          <Ionicons name={icon} size={22} color={customColor} />
        </View>
        <Text style={[styles.optionTitle, { color: customColor }]}>{title}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  return (
    <>
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, { paddingTop: Platform.OS === 'android' ? Math.max(insets.top, 45) : Math.max(insets.top, 15) }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>SETTINGS</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.profileSection}>
          <View style={styles.profileAvatar}>
            <Text style={styles.avatarLetter}>{user?.email ? user.email.charAt(0).toUpperCase() : 'U'}</Text>
          </View>
          <Text style={styles.profileEmail}>{user?.email || 'No Email'}</Text>
        </View>

        <View style={styles.settingsGroup}>
          {renderSettingOption('share-outline', 'Share App', handleShareApp)}
          {renderSettingOption('lock-closed-outline', 'Change Password', handleChangePassword)}
        </View>

        <View style={[styles.settingsGroup, { marginTop: 20 }]}>
          {renderSettingOption('log-out-outline', 'Logout', handleLogout, colors.danger)}
        </View>
      </ScrollView>
    </SafeAreaView>

    {/* Theme Consistant Alert Modal */}
    <Modal visible={customAlert.visible} animationType="fade" transparent={true}>
       <View style={[styles.container, { backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }]}>
          <View style={[styles.settingsGroup, { width: '85%', padding: 30, backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderRadius: 24 }]}>
             <View style={{ alignItems: 'center', marginBottom: 20 }}>
                <Text style={[styles.headerTitle, { color: colors.primary, fontSize: 18 }]}>ALERTS</Text>
                <View style={{ height: 1.5, width: 40, backgroundColor: colors.primary + '30', marginTop: 10 }} />
             </View>
             
             <Text style={[styles.optionTitle, { fontSize: 13, color: '#FFF', opacity: 0.8, lineHeight: 20, marginBottom: 30, textAlign: 'center' }]}>
                {customAlert.message}
             </Text>

             <View style={{ flexDirection: 'row', gap: 12 }}>
                {customAlert.buttons?.map((btn, idx) => {
                   const isDestructive = btn.style === 'destructive';
                   const isCancel = btn.style === 'cancel' || btn.text === 'CANCEL';
                   
                   return (
                      <TouchableOpacity 
                         key={idx}
                         style={[
                            styles.backBtn, 
                            { 
                               flex: 1, 
                               backgroundColor: isDestructive ? 'rgba(255,100,100,0.1)' : isCancel ? 'rgba(255,255,255,0.05)' : colors.primary,
                               padding: 12,
                               borderRadius: 12,
                               alignItems: 'center'
                            }
                         ]} 
                         onPress={() => {
                            setCustomAlert(prev => ({ ...prev, visible: false }));
                            if (btn.onPress) btn.onPress();
                         }}
                      >
                         <Text style={{ 
                            color: isDestructive ? colors.danger : isCancel ? 'rgba(255,255,255,0.6)' : '#000', 
                            fontWeight: '900',
                            fontSize: 12
                         }}>
                            {btn.text?.toUpperCase()}
                         </Text>
                      </TouchableOpacity>
                   );
                })}
                {(!customAlert.buttons || customAlert.buttons.length === 0) && (
                   <TouchableOpacity 
                      style={[styles.backBtn, { flex: 1, backgroundColor: colors.primary, padding: 12, borderRadius: 12, alignItems: 'center' }]} 
                      onPress={() => setCustomAlert(prev => ({ ...prev, visible: false }))}
                   >
                      <Text style={{ color: '#000', fontWeight: 'bold' }}>OK</Text>
                   </TouchableOpacity>
                )}
             </View>
          </View>
       </View>
    </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomLeftRadius: 25,
    borderBottomRightRadius: 25,
  },
  backBtn: {
    padding: 5,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  profileSection: {
    alignItems: 'center',
    marginBottom: 40,
    backgroundColor: colors.card,
    paddingVertical: 30,
    borderRadius: 20,
    marginHorizontal: 15,
    borderWidth: 1,
    borderColor: colors.border,
  },
  profileAvatar: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  avatarLetter: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFF',
  },
  profileEmail: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  settingsGroup: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: 15,
    overflow: 'hidden',
  },
  optionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export default SettingsScreen;
