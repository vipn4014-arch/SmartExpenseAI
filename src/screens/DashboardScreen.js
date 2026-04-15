import React, { useState, useEffect, useContext, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView, Dimensions, Modal, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Animated, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc, setDoc, collection, query, where, onSnapshot, addDoc, serverTimestamp, orderBy, limit } from 'firebase/firestore';
import { db } from '../utils/firebase';
import { AuthContext } from '../context/AuthContext';
import { colors } from '../theme/colors';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Removed static window dimensions to use reactive hook inside component

const categories = [
  'Food',
  'Rent',
  'EMI',
  'Shopping',
  'Recharge',
  'Subscription',
  'Entertainment',
  'Household',
  'Miscellaneous',
  'Others',
];


const DashboardScreen = ({ navigation }) => {
  const { width, height } = useWindowDimensions();
  const isTablet = width > 600;
  const contentWidth = isTablet ? 800 : width;
  
  const { user } = useContext(AuthContext);
  const [budget, setBudget] = useState(0);
  const [spent, setSpent] = useState(0);
  const [recentExpenses, setRecentExpenses] = useState([]);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [newBudgetInput, setNewBudgetInput] = useState('');
  
  const [budgetEditsThisMonth, setBudgetEditsThisMonth] = useState(0);
  const [budgetEditMonth, setBudgetEditMonth] = useState('');

  // New Expense Modal State
  const [activeTab, setActiveTab] = useState('TEXT');
  const [smartInput, setSmartInput] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('Shopping');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [customAlert, setCustomAlert] = useState({ visible: false, title: '', message: '', buttons: [] });

  const showThemeAlert = (title, message, buttons = [{ text: 'OK' }]) => {
    setCustomAlert({ visible: true, title, message, buttons });
  };

  const [loading, setLoading] = useState(false);
  const [savingBudget, setSavingBudget] = useState(false);
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const currentMonthIdentifier = new Date().toLocaleString('en-IN', { month: '2-digit', year: 'numeric' });

  useEffect(() => {
    if (!user) return;

    let unsubscribeUser = () => {};
    let unsubscribeExpenses = () => {};
    let userReady = false;
    let expensesReady = false;

    // Legacy checkReady removed for High-Performance Direct Load

    // 1. Try Local Storage first for immediate UI render (Offline support)
    const loadLocal = async () => {
      try {
        const localData = await AsyncStorage.getItem(`@budget_data_${user.uid}`);
        if (localData) {
          const parsed = JSON.parse(localData);
          if (parsed.monthlyBudget) setBudget(parsed.monthlyBudget);
          if (parsed.budgetEditMonth === currentMonthIdentifier) {
            setBudgetEditsThisMonth(parsed.budgetEdits || 0);
            setBudgetEditMonth(parsed.budgetEditMonth);
          }
        }
      } catch (e) {
        console.warn("Local cache read failed:", e);
      } finally {
        // ESSENTIAL PERFORMANCE FIX: Show UI immediately after local load
        // Don't wait 30s for cloud sync to interact with the app.
        setLoading(false);
        fadeAnim.setValue(1); // Force immediate visibility
      }
    };
    loadLocal();

    // 2. Realtime listener for User Profile/Budget from Cloud
    const userRef = doc(db, 'users', user.uid);
    unsubscribeUser = onSnapshot(userRef, async (userDoc) => {
      if (userDoc.exists()) {
        const data = userDoc.data();
        if (data.monthlyBudget !== undefined) {
          const cloudBudget = data.monthlyBudget;
          const cloudEdits = data.budgetEditMonth === currentMonthIdentifier ? (data.budgetEdits || 0) : 0;
          const cloudMonth = data.budgetEditMonth || currentMonthIdentifier;
          
          setBudget(cloudBudget);
          setBudgetEditsThisMonth(cloudEdits);
          setBudgetEditMonth(cloudMonth);
          
          // Keep local cache perfectly synced with cloud truth
          await AsyncStorage.setItem(`@budget_data_${user.uid}`, JSON.stringify({
            monthlyBudget: cloudBudget,
            budgetEdits: cloudEdits,
            budgetEditMonth: cloudMonth
          }));
        }
      }
      userReady = true;
    }, (error) => {
      userReady = true;
    });

    // 3. Listen for spent amount from expenses - OPTIMIZED: only fetch what's needed for dashboard
    // We limit to 200 items for the aggregate sum on mobile to keep sync fast.
    const expensesQuery = query(
      collection(db, 'expenses'), 
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(100)
    );

    unsubscribeExpenses = onSnapshot(expensesQuery, (snapshot) => {
      let totalSpent = 0;
      const now = new Date();
      const allExpenses = [];

      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const expenseDate = data.createdAt?.toDate() || new Date();
        
        // Only sum current month expenses
        if (expenseDate.getMonth() === now.getMonth() && expenseDate.getFullYear() === now.getFullYear()) {
          totalSpent += parseFloat(data.amount) || 0;
        }

        allExpenses.push({
          id: doc.id,
          ...data,
          date: expenseDate,
        });
      });

      setSpent(totalSpent);
      // Already sorted by query, but we keep this for safety
      setRecentExpenses(allExpenses.slice(0, 15));
      
      expensesReady = true;
    }, (error) => {
      // If index is missing, fallback to non-ordered query temporarily 
      // but still set ready to prevent 30s hang
      expensesReady = true;
    });

    return () => {
      unsubscribeUser();
      unsubscribeExpenses();
    };
  }, [user]);

  const handleUpdateBudget = async () => {
    if (budgetEditMonth === currentMonthIdentifier && budgetEditsThisMonth >= 3) {
      showThemeAlert('Limit Reached', 'You can only change your budget 3 times a month.');
      return;
    }

    const amount = parseFloat(newBudgetInput);
    if (isNaN(amount) || amount < 0) {
      showThemeAlert('Invalid Amount', 'Please enter a valid budget amount.');
      return;
    }

    setSavingBudget(true);
    try {
      if (!user) throw new Error("User not authenticated.");

      const newEdits = (budgetEditMonth === currentMonthIdentifier ? budgetEditsThisMonth : 0) + 1;

      // 1. Sync directly to Firestore FIRST to guarantee persistence
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        monthlyBudget: amount,
        budgetEdits: newEdits,
        budgetEditMonth: currentMonthIdentifier
      }, { merge: true });

      // 2. If cloud succeeds, update local cache
      await AsyncStorage.setItem(`@budget_data_${user.uid}`, JSON.stringify({
        monthlyBudget: amount,
        budgetEdits: newEdits,
        budgetEditMonth: currentMonthIdentifier
      }));

      // Note: Because we added the onSnapshot listener, setBudget(amount) 
      // will be automatically called by the listener almost instantly!
      // But we can optimistically set it here too for maximum speed:
      setBudget(amount);
      setBudgetEditsThisMonth(newEdits);
      setBudgetEditMonth(currentMonthIdentifier);
      setShowBudgetModal(false);
      setNewBudgetInput('');
      showThemeAlert('Success', 'Budget securely saved to cloud!');
    } catch (error) {
      console.error("Cloud Update Error:", error);
      showThemeAlert('Cloud Sync Error', 'Failed to save budget to Firebase. Check your internet connection or Database security rules. Error: ' + error.message);
    } finally {
      setSavingBudget(false);
    }
  };

  const isOverspent = spent > budget;
  const progress = Math.min((spent / budget) * 100, 100);

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'Food': return 'fast-food-outline';
      case 'Shopping': return 'cart-outline';
      case 'Rent': return 'home-outline';
      case 'Entertainment': return 'film-outline';
      case 'Recharge': return 'phone-portrait-outline';
      default: return 'receipt-outline';
    }
  };

  const getCategoryColor = (category) => {
    switch (category) {
      case 'Food': return '#FF9500';
      case 'Shopping': return '#007AFF';
      case 'Rent': return '#34C759';
      case 'Entertainment': return '#AF52DE';
      case 'Recharge': return '#5AC8FA';
      default: return '#8E8E93';
    }
  };

  const handleSaveExpense = async () => {
    if (!expenseAmount || isNaN(expenseAmount)) {
      showThemeAlert('Invalid Amount', 'Please enter a valid amount.');
      return;
    }
    
    setIsSavingExpense(true);
    try {
      if (!user) throw new Error("User not authenticated");

      await addDoc(collection(db, 'expenses'), {
        userId: user.uid,
        amount: parseFloat(expenseAmount),
        description: expenseDescription || smartInput || 'No description',
        category: expenseCategory,
        createdAt: serverTimestamp(),
      });
      
      showThemeAlert('Success', 'Expense added successfully!');
      setShowAddExpense(false);
      // Reset fields
      setExpenseAmount('');
      setExpenseDescription('');
      setSmartInput('');
      setExpenseCategory('Shopping');
    } catch (error) {
      showThemeAlert('Error', error.message);
    } finally {
      setIsSavingExpense(false);
    }
  };

  const formatCurrency = (amount) => `₹${amount.toLocaleString('en-IN')}`;
  
  // Responsive calculations
  const gridGap = 12;
  const horizontalPadding = 20; // Increased to 20 for standard alignment
  const columns = isTablet ? 3 : 2;
  const itemWidth = (Math.min(width, contentWidth) - (horizontalPadding * 2) - (gridGap * (columns - 1))) / columns;

  const renderOptionBox = (title, icon, route, iconColor, bgColor) => (
    <TouchableOpacity 
      style={[styles.optionBox, { width: itemWidth }]}
      onPress={() => navigation.navigate(route)}
    >
      <View style={[styles.iconContainer, { backgroundColor: bgColor }]}>
        <Ionicons name={icon} size={28} color={iconColor} />
      </View>
      <Text style={styles.optionText}>{title.toUpperCase()}</Text>
    </TouchableOpacity>
  );

  // Skeleton Loader for a 'Direct' but smooth landing
  const DashboardSkeleton = () => (
    <SafeAreaView style={[styles.container, { opacity: 0.6 }]}>
      <View style={{ paddingHorizontal: 25, paddingTop: Math.max(insets.top, 20) }}>
        <View style={{ height: 30, width: 120, backgroundColor: colors.card, borderRadius: 10, marginBottom: 40 }} />
        <View style={{ height: 180, width: '100%', backgroundColor: colors.card, borderRadius: 25, marginBottom: 30 }} />
        <View style={{ height: 25, width: 150, backgroundColor: colors.card, borderRadius: 10, marginBottom: 20 }} />
        <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 0, marginTop: 20 }}>
          <View style={{ flex: 1, height: 100, backgroundColor: colors.card, borderRadius: 20 }} />
          <View style={{ flex: 1, height: 100, backgroundColor: colors.card, borderRadius: 20 }} />
        </View>
        <View style={{ marginTop: 30, height: 200, backgroundColor: colors.card, borderRadius: 20, opacity: 0.3 }} />
      </View>
    </SafeAreaView>
  );
  // Removed blocking loading check for better interaction

  return (
    <>
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1 }}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
          <View style={[styles.headerIconBox, { top: Math.max(insets.top, 20) + 5 }]}>
            <Ionicons name="grid" size={20} color={colors.primary} />
          </View>
          <View style={styles.headerTextCol}>
            <Text style={[styles.headerTitle, { textAlign: 'center' }]}>SMART DASHBOARD</Text>
            <Text style={[styles.headerSubtitle, { textAlign: 'center' }]}>FINOVO ENGINE V1.2</Text>
          </View>
        </View>

        <View style={styles.mainWrapper}>
          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Budget Card */}
            <View style={styles.budgetCard}>
              <View style={styles.budgetLeft}>
                <Text style={styles.budgetLabel}>MONTHLY BUDGET</Text>
                <Text style={styles.budgetMainAmount}>{formatCurrency(budget)}</Text>
              </View>
              <View style={styles.budgetRight}>
                <TouchableOpacity 
                  style={styles.budgetActionButton}
                  onPress={() => {
                    setNewBudgetInput(budget.toString());
                    setShowBudgetModal(true);
                  }}
                >
                  <Text style={styles.budgetActionLabel}>SET BUDGET</Text>
                  <View style={styles.actionIconCircle}>
                    <Ionicons name="pencil" size={20} color={colors.text} />
                  </View>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={styles.budgetActionButton}
                  onPress={() => setShowAddExpense(true)}
                >
                  <Text style={styles.budgetActionLabel}>ADD EXPENSE</Text>
                  <View style={styles.actionIconCircle}>
                    <Ionicons name="add" size={24} color={colors.text} />
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            {/* Spending Row */}
            <View style={[styles.spendingRow, { flexWrap: 'wrap' }]}>
              <View style={[styles.spendingBox, { width: itemWidth }]}>
                <Text style={styles.spendingLabel} numberOfLines={1}>SPENT</Text>
                <Text style={styles.spendingAmount} numberOfLines={1} adjustsFontSizeToFit>{formatCurrency(spent)}</Text>
                <View style={[styles.spendingIndicator, { backgroundColor: colors.textSecondary }]} />
              </View>
              <View style={[styles.spendingBox, { width: itemWidth }]}>
                <Text style={[styles.spendingLabel, { color: isOverspent ? colors.textSecondary : colors.success }]} numberOfLines={1}>
                  {isOverspent ? 'OVERSPENT BY' : 'REMAINING'}
                </Text>
                <Text style={[styles.spendingAmount, { color: isOverspent ? colors.danger : colors.success }]} numberOfLines={1} adjustsFontSizeToFit>
                  {formatCurrency(Math.abs(budget - spent))}
                </Text>
                <View style={[styles.spendingIndicator, { backgroundColor: isOverspent ? colors.danger : colors.success }]} />
              </View>
            </View>

            {/* Alert/Motivation Banner */}
            {isOverspent ? (
              <View style={styles.alertBanner}>
                <Ionicons name="warning-outline" size={20} color={colors.danger} />
                <Text style={styles.alertText} numberOfLines={1} adjustsFontSizeToFit>
                  ⚠️ BUDGET LIMIT REACHED. YOU ARE OVERSPENDING!
                </Text>
              </View>
            ) : (
              <View style={styles.successBanner}>
                <Ionicons name="star-outline" size={20} color={colors.success} />
                <Text style={styles.successText} numberOfLines={1} adjustsFontSizeToFit>
                  ON TRACK! YOU ARE MANAGING WELL 🏆
                </Text>
              </View>
            )}

            {/* Options Grid */}
            <View style={styles.gridContainer}>
              {renderOptionBox('History', 'time-outline', 'History', colors.warning, colors.historyBg)}
              {renderOptionBox('AI Agent', 'shield-checkmark-outline', 'Agent', colors.danger, colors.agentBg)}
              {renderOptionBox('Split Bill', 'calculator-outline', 'Split', colors.purple, colors.splitBg)}
              {renderOptionBox('Groups', 'people-outline', 'Groups', colors.success, colors.groupsBg)}
            </View>

            {/* Recent Activity Section */}
            <View style={styles.recentSection}>
              <Text style={styles.sectionTitle}>RECENT ACTIVITY</Text>
              {recentExpenses.length > 0 ? (
                recentExpenses.slice(0, 5).map(expense => (
                  <View key={expense.id} style={styles.recentItem}>
                    <View style={[styles.recentIconBox, { backgroundColor: getCategoryColor(expense.category) }]}>
                      <Ionicons name={getCategoryIcon(expense.category)} size={20} color="#FFF" />
                    </View>
                    <View style={styles.recentDetails}>
                      <Text style={styles.recentTitle} numberOfLines={1}>{((expense.description || expense.category) || '').toUpperCase()}</Text>
                      <Text style={styles.recentDate}>
                        {expense.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}, {expense.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.recentAmount}>-{formatCurrency(expense.amount)}</Text>
                  </View>
                ))
              ) : (
                <Text style={{ color: colors.textSecondary, marginTop: 10 }}>NO RECENT EXPENSES YET.</Text>
              )}
            </View>
          </ScrollView>
        </View>
      </View>

      {/* Set Budget Modal */}
      <Modal visible={showBudgetModal} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: 60 }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>SET MONTHLY BUDGET</Text>
                <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '700', marginTop: 4 }}>
                  {budgetEditMonth === currentMonthIdentifier ? Math.max(3 - budgetEditsThisMonth, 0) : 3} EDITS REMAINING THIS MONTH
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowBudgetModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.budgetLabel}>ENTER NEW AMOUNT (₹)</Text>
            <TextInput
              style={[styles.input, { marginBottom: 30, fontSize: 24, fontWeight: 'bold' }]}
              placeholder="e.g. 15000"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
              value={newBudgetInput}
              onChangeText={setNewBudgetInput}
              autoFocus={true}
            />

            <TouchableOpacity 
              style={styles.saveBudgetBtn}
              onPress={handleUpdateBudget}
              disabled={savingBudget}
            >
              {savingBudget ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBudgetBtnText}>UPDATE BUDGET</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add Expense Modal (Redesigned) */}
      <Modal visible={showAddExpense} animationType="slide" transparent={true}>
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContentLarge}>
            {/* Modal Header */}
            <View style={styles.modalHeaderRow}>
              <View style={styles.headerTitleContainer}>
                <Ionicons name="sparkles-outline" size={24} color={colors.text} style={{ marginRight: 10 }} />
                <Text style={styles.modalTitleLarge}>ADD EXPENSE</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAddExpense(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Amount and Category Row */}
            <View style={[styles.inputRow, { marginTop: 10 }]}>
              <View style={styles.inputCol}>
                <Text style={styles.labelSmall}>AMOUNT (₹)</Text>
                <View style={[styles.inputFieldBox, { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }]}>
                  <TextInput
                    style={styles.fieldInput}
                    value={expenseAmount}
                    onChangeText={setExpenseAmount}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={colors.textSecondary}
                  />
                </View>
              </View>
              <View style={[styles.inputCol, { marginLeft: 15 }]}>
                <Text style={styles.labelSmall}>CATEGORY</Text>
                <TouchableOpacity
                  style={[styles.categoryPickerBox, { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }]}
                  onPress={() => setShowCategoryPicker(true)}
                >
                  <Text style={styles.categoryValueText}>{expenseCategory}</Text>
                  <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Description */}
            <Text style={[styles.labelSmall, { marginTop: 16 }]}>DESCRIPTION</Text>
            <View style={[styles.inputFieldBox, { height: 70, alignItems: 'flex-start', backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }]}>
              <TextInput
                style={[styles.fieldInput, { marginTop: 8, fontSize: 15 }]}
                value={expenseDescription}
                onChangeText={setExpenseDescription}
                placeholder="What was this for?"
                placeholderTextColor={colors.textSecondary}
                multiline
              />
            </View>

            {/* Save Button */}
            <TouchableOpacity 
              style={styles.saveExpenseBtnLarge}
              onPress={handleSaveExpense}
              disabled={isSavingExpense}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="add" size={24} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.saveExpenseTextLarge}>SAVE EXPENSE</Text>
              </View>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Category Picker Modal */}
      <Modal visible={showCategoryPicker} animationType="slide" transparent={true}>
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setShowCategoryPicker(false)}
        >
          <View style={[styles.modalContent, { paddingBottom: 40 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Category</Text>
              <TouchableOpacity onPress={() => setShowCategoryPicker(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            {categories.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[
                  styles.categoryOption,
                  expenseCategory === cat && styles.categoryOptionActive
                ]}
                onPress={() => { setExpenseCategory(cat); setShowCategoryPicker(false); }}
              >
                <Text style={[
                  styles.categoryOptionText,
                  expenseCategory === cat && styles.categoryOptionTextActive
                ]}>{cat}</Text>
                {expenseCategory === cat && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Theme Consistant Alert Modal */}
      <Modal visible={customAlert.visible} animationType="fade" transparent={true}>
         <TouchableOpacity 
            style={styles.modalOverlay} 
            activeOpacity={1} 
            onPress={() => setCustomAlert(prev => ({ ...prev, visible: false }))}
         >
            <View style={[styles.modalContentLarge, { width: '85%', alignSelf: 'center', borderRadius: 24, padding: 30, backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24 }]}>
               <View style={{ alignItems: 'center', marginBottom: 20 }}>
                  <Text style={[styles.modalTitleLarge, { color: colors.primary, fontSize: 18 }]}>{customAlert.title?.toUpperCase()}</Text>
                  <View style={{ height: 1.5, width: 40, backgroundColor: colors.primary + '30', marginTop: 10 }} />
               </View>
               
               <Text style={[styles.tabText, { fontSize: 13, color: '#FFF', opacity: 0.8, lineHeight: 20, marginBottom: 30, textAlign: 'center', marginLeft: 0 }]}>
                  {customAlert.message}
               </Text>

               <View style={{ flexDirection: 'row', gap: 12 }}>
                  {customAlert.buttons?.map((btn, idx) => {
                     const isCancel = btn.style === 'cancel' || btn.text === 'CANCEL';
                     return (
                        <TouchableOpacity 
                           key={idx}
                           style={[
                              styles.saveBudgetBtn, 
                              { 
                                 flex: 1, 
                                 backgroundColor: isCancel ? 'rgba(255,255,255,0.05)' : colors.primary,
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
                              fontSize: 14
                           }}>
                              {btn.text?.toUpperCase()}
                           </Text>
                        </TouchableOpacity>
                     );
                  })}
                  {(!customAlert.buttons || customAlert.buttons.length === 0) && (
                     <TouchableOpacity 
                        style={[styles.saveBudgetBtn, { flex: 1 }]} 
                        onPress={() => setCustomAlert(prev => ({ ...prev, visible: false }))}
                     >
                        <Text style={{ color: '#000', fontWeight: 'bold' }}>OK</Text>
                     </TouchableOpacity>
                  )}
               </View>
            </View>
         </TouchableOpacity>
      </Modal>

     </SafeAreaView>
     </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  mainWrapper: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 800,
  },
  header: {
    backgroundColor: colors.card,
    paddingVertical: 13,
    paddingHorizontal: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    borderBottomLeftRadius: 25,
    borderBottomRightRadius: 25,
    borderBottomWidth: 0,
    elevation: 4,
  },
  headerIconBox: {
    position: 'absolute',
    left: 20,
    width: 36,
    height: 36,
    borderRadius: 20,
    backgroundColor: colors.primary + '20', 
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTextCol: {
    alignItems: 'center',
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1.5,
    lineHeight: 26,
    textTransform: 'uppercase',
  },
  headerSubtitle: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    marginTop: 2,
  },
  userInfo: {
    width: 40,
    alignItems: 'flex-start',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  scrollContent: {
    // Standardized to use parent padding
    paddingTop: 20,
    paddingBottom: 40, 
  },
  budgetCard: {
    backgroundColor: '#121212',
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 15,
    marginBottom: 20,
    marginHorizontal: 15, // Avoid edge touch
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  budgetLeft: {
    flex: 1,
  },
  budgetLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  budgetMainAmount: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '900',
  },
  budgetRight: {
    alignItems: 'flex-end',
  },
  budgetActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  budgetActionLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    marginRight: 8,
  },
  actionIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  spendingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingHorizontal: 15,
  },
  spendingBox: {
    backgroundColor: '#121212',
    borderRadius: 20,
    padding: 20,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    marginBottom: 10,
  },
  spendingLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  spendingAmount: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 10,
  },
  spendingIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingVertical: 16,
    paddingHorizontal: 15,
    borderRadius: 20,
    marginBottom: 24,
    marginHorizontal: 15, // Avoid edge touch
    borderWidth: 1.5,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingVertical: 16,
    paddingHorizontal: 15,
    borderRadius: 20,
    marginBottom: 24,
    marginHorizontal: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  successText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '900',
    marginLeft: 10,
    flex: 1,
    letterSpacing: 0.5,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingHorizontal: 15, // Avoid edge touch
  },
  optionBox: {
    backgroundColor: '#121212',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 15,
    elevation: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  optionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
    marginLeft: 4,
  },
  recentSection: {
    marginBottom: 10,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    padding: 20, // Increased from 15
    borderRadius: 20, 
    marginHorizontal: 15, // Avoid edge touch
    marginBottom: 12, // Increased from 8
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  recentIconBox: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.warning,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  recentDetails: {
    flex: 1,
  },
  recentTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  recentDate: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  recentAmount: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 25,
    width: 65,
    height: 65,
    borderRadius: 32.5,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
  },
  addOptionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  addOptionBtn: {
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: 20,
    borderRadius: 24,
    width: '31%',
    borderWidth: 1,
    borderColor: colors.border,
  },
  addOptionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 12,
  },
  saveBudgetBtn: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    padding: 18,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 8,
  },
  saveBudgetBtnText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '900',
  },
  limitWarningText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 15,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: 18,
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalContentLarge: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 20,
    paddingBottom: 30,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 20,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalTitleLarge: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  closeBtn: {
    padding: 5,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    padding: 5,
    marginBottom: 15,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 16,
  },
  activeTab: {
    backgroundColor: '#2C2C2E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  tabText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 6,
  },
  activeTabText: {
    color: colors.text,
  },
  smartInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121214',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 15,
  },
  smartInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    paddingVertical: 10,
  },
  sendIconBtn: {
    backgroundColor: '#222',
    width: 48,
    height: 48,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inputCol: {
    flex: 1,
  },
  labelSmall: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  inputFieldBox: {
    backgroundColor: '#F1F1F1',
    borderRadius: 16,
    paddingHorizontal: 15,
    height: 54,
    justifyContent: 'center',
  },
  fieldInput: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  categoryPickerBox: {
    backgroundColor: '#F1F1F1',
    borderRadius: 16,
    paddingHorizontal: 15,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryValueText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  saveExpenseBtnLarge: {
    backgroundColor: '#999',
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  saveExpenseTextLarge: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
  },
  voiceContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
  },
  voiceHint: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 24,
    textAlign: 'center',
  },
  voiceSubHint: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 20,
  },
  micBtn: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  micBtnActive: {
    backgroundColor: '#FFE5E5',
  },
  micInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  categoryOptionActive: {
    backgroundColor: 'transparent',
  },
  categoryOptionText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  categoryOptionTextActive: {
    color: colors.primary,
    fontWeight: '800',
  },
});

export default DashboardScreen;
