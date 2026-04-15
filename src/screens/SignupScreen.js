import React, { useState, useContext } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, SafeAreaView, Alert, ActivityIndicator, Modal } from 'react-native';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { auth } from '../utils/firebase';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { AuthContext } from '../context/AuthContext';

import { translateError } from '../utils/errors';

const SignupScreen = ({ navigation }) => {
  const { setUser } = useContext(AuthContext);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [customAlert, setCustomAlert] = useState({ visible: false, title: '', message: '', buttons: [] });

  const showThemeAlert = (title, message, buttons = [{ text: 'OK' }]) => {
    setCustomAlert({ visible: true, title, message, buttons });
  };

  const handleSignup = async () => {
    if (!name || !email || !password) {
      showThemeAlert('Signup Incomplete', 'Please fill in your name, email, and password to create an account.');
      return;
    }

    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName: name });
      setUser(userCredential.user); 
    } catch (error) {
      showThemeAlert('Signup Failed', translateError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Start tracking everything smartly</Text>
        </View>

        <View style={styles.formContainer}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput 
            style={styles.input}
            placeholder="Enter your name"
            placeholderTextColor={colors.textSecondary}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Email Address</Text>
          <TextInput 
            style={styles.input}
            placeholder="Enter your email"
            placeholderTextColor={colors.textSecondary}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordContainer}>
            <TextInput 
              style={styles.passwordInput}
              placeholder="Create a strong password"
              placeholderTextColor={colors.textSecondary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity 
              style={styles.eyeIcon} 
              onPress={() => setShowPassword(!showPassword)}
            >
              <Ionicons 
                name={showPassword ? "eye-off-outline" : "eye-outline"} 
                size={22} 
                color={colors.textSecondary} 
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.button} onPress={handleSignup} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign Up</Text>}
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text style={styles.loginText}>Log In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>

    {/* Theme Consistant Alert Modal */}
    <Modal visible={customAlert.visible} animationType="fade" transparent={true}>
       <View style={[styles.container, { backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }]}>
          <View style={[styles.formContainer, { width: '85%', padding: 30, backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderRadius: 24 }]}>
             <View style={{ alignItems: 'center', marginBottom: 20 }}>
                <Text style={[styles.title, { color: colors.primary, fontSize: 18 }]}>{customAlert.title?.toUpperCase()}</Text>
                <View style={{ height: 1.5, width: 40, backgroundColor: colors.primary + '30', marginTop: 10 }} />
             </View>
             
             <Text style={[styles.label, { fontSize: 13, color: '#FFF', opacity: 0.8, lineHeight: 20, marginBottom: 30, textAlign: 'center' }]}>
                {customAlert.message}
             </Text>

             <View style={{ flexDirection: 'row', gap: 12 }}>
                {customAlert.buttons?.map((btn, idx) => {
                   const isCancel = btn.style === 'cancel' || btn.text === 'CANCEL';
                   return (
                      <TouchableOpacity 
                         key={idx}
                         style={[
                            styles.button, 
                            { 
                               flex: 1, 
                               backgroundColor: isCancel ? 'rgba(255,255,255,0.05)' : colors.primary,
                               padding: 12,
                               marginBottom: 0,
                               shadowOpacity: isCancel ? 0 : 0.3
                            }
                         ]} 
                         onPress={() => {
                            setCustomAlert(prev => ({ ...prev, visible: false }));
                            if (btn.onPress) btn.onPress();
                         }}
                      >
                         <Text style={{ 
                            color: isCancel ? 'rgba(255,255,255,0.6)' : '#000', 
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
                      style={[styles.button, { flex: 1, backgroundColor: colors.primary, padding: 12, marginBottom: 0 }]} 
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
  keyboardView: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    marginBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  formContainer: {
    width: '100%',
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    color: colors.text,
    fontSize: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingRight: 15,
  },
  passwordInput: {
    flex: 1,
    padding: 16,
    color: colors.text,
    fontSize: 16,
  },
  eyeIcon: {
    padding: 5,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 10,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  footerText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  loginText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: 'bold',
  },
});

export default SignupScreen;
