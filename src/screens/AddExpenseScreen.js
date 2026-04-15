import React, { useState, useContext } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, SafeAreaView, ActivityIndicator, Alert, ScrollView, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../utils/firebase';
import { AuthContext } from '../context/AuthContext';
import { colors } from '../theme/colors';

const categories = ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Others'];

const AddExpenseScreen = ({ route, navigation }) => {
  const { user } = useContext(AuthContext);
  
  // Extract AI pre-filled data if available
  const { scannedAmount = '', scannedDescription = '', scannedCategory = categories[0] } = route.params || {};

  const [amount, setAmount] = useState(scannedAmount);
  const [description, setDescription] = useState(scannedDescription);
  const [selectedCategory, setSelectedCategory] = useState(scannedCategory);
  const [loading, setLoading] = useState(false);
  const [customAlert, setCustomAlert] = useState({ visible: false, title: '', message: '', buttons: [] });

  const showThemeAlert = (title, message, buttons = [{ text: 'OK' }]) => {
    setCustomAlert({ visible: true, title, message, buttons });
  };
  const insets = useSafeAreaInsets();

  const handleSave = async () => {
    if (!amount || isNaN(amount)) {
      showThemeAlert('Invalid Amount', 'Please enter a valid number.');
      return;
    }
    if (!description.trim()) {
      showThemeAlert('Missing Description', 'Please enter what this expense was for.');
      return;
    }

    setLoading(true);
    try {
      if (!user) throw new Error("User not authenticated");

      await addDoc(collection(db, 'expenses'), {
        userId: user.uid,
        amount: parseFloat(amount),
        description: description,
        category: selectedCategory,
        createdAt: serverTimestamp(),
      });
      
      showThemeAlert('Success', 'Expense added successfully!', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (error) {
      showThemeAlert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 10) }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Expense</Text>
        <View style={{ width: 28 }} />
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.label}>Amount (₹)</Text>
          <TextInput 
            style={[styles.input, styles.amountInput]}
            placeholder="0"
            placeholderTextColor={colors.textSecondary}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
          />

          <Text style={styles.label}>Description</Text>
          <TextInput 
            style={styles.input}
            placeholder="What was this for?"
            placeholderTextColor={colors.textSecondary}
            value={description}
            onChangeText={setDescription}
          />

          <Text style={styles.label}>Category</Text>
          <View style={styles.categoryContainer}>
            {categories.map((cat) => (
              <TouchableOpacity 
                key={cat} 
                style={[
                  styles.categoryChip, 
                  selectedCategory === cat && styles.categoryChipSelected
                ]}
                onPress={() => setSelectedCategory(cat)}
              >
                <Text style={[
                  styles.categoryText,
                  selectedCategory === cat && styles.categoryTextSelected
                ]}>{cat}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Save Expense</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>

    {/* Theme Consistant Alert Modal */}
    <Modal visible={customAlert.visible} animationType="fade" transparent={true}>
       <View style={[styles.container, { backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }]}>
          <View style={[styles.input, { width: '85%', padding: 30, backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderRadius: 24, height: 'auto' }]}>
             <View style={{ alignItems: 'center', marginBottom: 20 }}>
                <Text style={[styles.headerTitle, { color: colors.primary, fontSize: 18 }]}>{customAlert.title?.toUpperCase()}</Text>
                <View style={{ height: 1.5, width: 40, backgroundColor: colors.primary + '30', marginTop: 10 }} />
             </View>
             
             <Text style={[styles.label, { fontSize: 13, color: '#FFF', opacity: 0.8, lineHeight: 20, marginBottom: 30, textAlign: 'center', marginTop: 0 }]}>
                {customAlert.message}
             </Text>

             <View style={{ flexDirection: 'row', gap: 12 }}>
                {customAlert.buttons?.map((btn, idx) => {
                   const isCancel = btn.style === 'cancel' || btn.text === 'CANCEL';
                   return (
                      <TouchableOpacity 
                         key={idx}
                         style={[
                            styles.saveButton, 
                            { 
                               flex: 1, 
                               backgroundColor: isCancel ? 'rgba(255,255,255,0.05)' : colors.primary,
                               padding: 12,
                               marginTop: 0,
                               shadowOpacity: isCancel ? 0 : 0.25
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
                      style={[styles.saveButton, { flex: 1, padding: 12, marginTop: 0 }]} 
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 15,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  amountInput: {
    fontSize: 34,
    fontWeight: '900',
    color: colors.primary,
    paddingVertical: 24,
  },
  categoryContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    marginBottom: 30,
  },
  categoryChip: {
    backgroundColor: colors.card,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    marginRight: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
  },
  categoryTextSelected: {
    color: '#FFF',
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 8,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '900',
  },
});

export default AddExpenseScreen;
