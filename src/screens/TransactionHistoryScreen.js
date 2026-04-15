import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, SafeAreaView, Dimensions, TouchableOpacity, Modal, ScrollView, useWindowDimensions, BackHandler } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { collection, query, where, orderBy, onSnapshot, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import { AuthContext } from '../context/AuthContext';
import { colors } from '../theme/colors';
import { PieChart } from 'react-native-chart-kit';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from 'react-native';

// Removed static width variable

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const categoryColors = {
  Food: '#F59E0B',
  Rent: '#6366F1',
  EMI: '#EF4444',
  Shopping: '#8B5CF6',
  Recharge: '#06B6D4',
  Subscription: '#EC4899',
  Entertainment: '#10B981',
  Household: '#84CC16',
  Miscellaneous: '#F97316',
  Others: '#94A3B8',
};

const getCategoryIcon = (category) => {
  switch(category) {
    case 'Food': return 'fast-food-outline';
    case 'Rent': return 'home-outline';
    case 'EMI': return 'card-outline';
    case 'Shopping': return 'cart-outline';
    case 'Recharge': return 'phone-portrait-outline';
    case 'Subscription': return 'repeat-outline';
    case 'Entertainment': return 'game-controller-outline';
    case 'Household': return 'basket-outline';
    case 'Miscellaneous': return 'grid-outline';
    default: return 'wallet-outline';
  }
};

const TransactionHistoryScreen = () => {
  const { width, height } = useWindowDimensions();
  const isTablet = width > 600;
  const contentWidth = isTablet ? 800 : width;
  
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(now.getFullYear());

  const [allExpenses, setAllExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [customAlert, setCustomAlert] = useState({ visible: false, title: '', message: '', buttons: [] });

  const showThemeAlert = (title, message, buttons = [{ text: 'OK' }]) => {
    setCustomAlert({ visible: true, title, message, buttons });
  };
  const [indexError, setIndexError] = useState(null);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'expenses'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const expenseData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        date: doc.data().createdAt?.toDate() || new Date()
      }));
      setAllExpenses(expenseData);
      setLoading(false);
    }, (error) => {
      if (error.message.includes('index')) {
        const link = error.message.split(' ').find(word => word.startsWith('https://'));
        setIndexError(link);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    const onBackPress = () => {
      // Logic handled by Navigator usually, but we block root exit if needed
      return false; // Let default navigation happen for history (back to Dashboard)
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, []);

  // Filter by selected month/year
  const expenses = allExpenses.filter(exp => {
    const d = exp.date;
    return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
  });

  const goToPrevMonth = () => {
    if (selectedMonth === 0) {
      setSelectedMonth(11);
      setSelectedYear(y => y - 1);
    } else {
      setSelectedMonth(m => m - 1);
    }
  };

  const goToNextMonth = () => {
    const isCurrentMonth = selectedMonth === now.getMonth() && selectedYear === now.getFullYear();
    if (isCurrentMonth) return; // Don't go into future
    if (selectedMonth === 11) {
      setSelectedMonth(0);
      setSelectedYear(y => y + 1);
    } else {
      setSelectedMonth(m => m + 1);
    }
  };

  const isCurrentMonth = selectedMonth === now.getMonth() && selectedYear === now.getFullYear();

  const generateChartData = () => {
    const categoryTotals = {};
    expenses.forEach(exp => {
      if (!categoryTotals[exp.category]) categoryTotals[exp.category] = 0;
      categoryTotals[exp.category] += exp.amount;
    });
    return Object.keys(categoryTotals).map((cat) => ({
      name: cat,
      amount: categoryTotals[cat],
      color: categoryColors[cat] || categoryColors.Others,
      legendFontColor: colors.textSecondary,
      legendFontSize: 12
    }));
  };

  const totalSpent = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  const handleDeleteExpense = (id, description) => {
    showThemeAlert(
      "Delete Expense",
      `Are you sure you want to delete "${description}"?`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive", 
          onPress: async () => {
            try {
              await deleteDoc(doc(db, 'expenses', id));
              // Snapshot listener will auto-update the UI
            } catch (error) {
              showThemeAlert("Error", "Could not delete expense: " + error.message);
            }
          }
        }
      ]
    );
  };

  const renderExpenseItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.expenseItem}
      onLongPress={() => handleDeleteExpense(item.id, item.description)}
      delayLongPress={300}
    >
      <View style={styles.iconBox}>
        <Ionicons name={getCategoryIcon(item.category)} size={22} color={categoryColors[item.category] || categoryColors.Others} />
      </View>
      <View style={styles.expenseDetails}>
        <Text style={styles.expenseTitle}>{item.description.toUpperCase()}</Text>
        <Text style={styles.expenseDate}>{item.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}</Text>
      </View>
      <View style={styles.amountCol}>
        <Text style={styles.expenseCategory}>{item.category.toUpperCase()}</Text>
        <Text style={styles.expenseAmount}>-₹{item.amount?.toLocaleString('en-IN')}</Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const chartData = generateChartData();

  return (
    <>
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <View style={[styles.headerIconBox, { top: Math.max(insets.top, 20) + 5 }]}>
          <Ionicons name="receipt" size={20} color={colors.primary} />
        </View>
        <View style={styles.headerTextCol}>
          <Text style={[styles.headerTitle, { textAlign: 'center' }]}>EXPENSE HISTORY</Text>
          <Text style={[styles.headerSubtitle, { textAlign: 'center' }]}>ANALYTICS ENGINE V1.2</Text>
        </View>
      </View>
      <View style={styles.mainWrapper}>

        {/* Month Navigator */}
        <View style={styles.monthNav}>
          <TouchableOpacity style={styles.navArrow} onPress={goToPrevMonth}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.monthLabel} onPress={() => { setPickerYear(selectedYear); setShowMonthPicker(true); }}>
            <Text style={styles.monthLabelText}>{(MONTHS[selectedMonth] + ' ' + selectedYear).toUpperCase()}</Text>
            <Ionicons name="calendar-outline" size={16} color={colors.primary} style={{ marginLeft: 8 }} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navArrow, isCurrentMonth && styles.navArrowDisabled]}
            onPress={goToNextMonth}
            disabled={isCurrentMonth}
          >
            <Ionicons name="chevron-forward" size={22} color={isCurrentMonth ? colors.border : colors.text} />
          </TouchableOpacity>
        </View>

      {/* Removed Summary Card, content moved to pie chart */}

      {indexError ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="warning-outline" size={60} color={colors.danger} />
          <Text style={[styles.emptyText, { textAlign: 'center', marginHorizontal: 30 }]}>
            FIRESTORE REQUIRES AN INDEX FOR THIS QUERY.
          </Text>
        </View>
      ) : expenses.length > 0 ? (
        <>
          {chartData.length > 0 && (
            <View style={styles.chartRowWrapper}>
              <View style={styles.pieContainer}>
                <PieChart
                  data={chartData}
                  width={160}
                  height={150}
                  chartConfig={{ color: (opacity = 1) => `rgba(255, 255, 255, ${opacity})` }}
                  accessor={"amount"}
                  backgroundColor={"transparent"}
                  paddingLeft={"35"}
                  hasLegend={false}
                  absolute
                />
              </View>
              <View style={styles.detailsSide}>
                <Text style={styles.sideSummaryLabel}>TOTAL EXPENSES</Text>
                <Text style={styles.sideSummaryAmount} numberOfLines={1} adjustsFontSizeToFit>₹{totalSpent.toLocaleString('en-IN')}</Text>
                <Text style={styles.sideSummaryCount}>{expenses.length} TRANSACTION{expenses.length !== 1 ? 'S' : ''}</Text>
              </View>
            </View>
          )}
          <FlatList
            data={expenses}
            keyExtractor={(item) => item.id}
            renderItem={renderExpenseItem}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
          />
        </>
      ) : (
        <View style={styles.emptyContainer}>
          <Ionicons name="receipt-outline" size={60} color={colors.border} />
          <Text style={styles.emptyText}>NO EXPENSES IN {SHORT_MONTHS[selectedMonth].toUpperCase()} {selectedYear}</Text>
          <Text style={styles.emptySubText}>USE THE ARROWS TO BROWSE OTHER MONTHS</Text>
        </View>
      )}
      </View>

      {/* Month Picker Modal */}
      <Modal visible={showMonthPicker} animationType="slide" transparent={true}>
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerContainer}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>SELECT MONTH</Text>
              <TouchableOpacity onPress={() => setShowMonthPicker(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Year selector */}
            <View style={styles.yearRow}>
              <TouchableOpacity onPress={() => setPickerYear(y => y - 1)}>
                <Ionicons name="chevron-back" size={22} color={colors.text} />
              </TouchableOpacity>
              <Text style={styles.pickerYear}>{pickerYear}</Text>
              <TouchableOpacity
                onPress={() => setPickerYear(y => y + 1)}
                disabled={pickerYear >= now.getFullYear()}
              >
                <Ionicons name="chevron-forward" size={22} color={pickerYear >= now.getFullYear() ? colors.border : colors.text} />
              </TouchableOpacity>
            </View>

            {/* Month grid */}
            <View style={styles.monthGrid}>
              {SHORT_MONTHS.map((m, i) => {
                const isFuture = pickerYear === now.getFullYear() && i > now.getMonth();
                const isSelected = i === selectedMonth && pickerYear === selectedYear;
                return (
                  <TouchableOpacity
                    key={m}
                    style={[
                      styles.monthCell,
                      isSelected && styles.monthCellSelected,
                      isFuture && styles.monthCellDisabled,
                    ]}
                    onPress={() => {
                      if (!isFuture) {
                        setSelectedMonth(i);
                        setSelectedYear(pickerYear);
                        setShowMonthPicker(false);
                      }
                    }}
                    disabled={isFuture}
                  >
                    <Text style={[
                      styles.monthCellText,
                      isSelected && styles.monthCellTextSelected,
                      isFuture && styles.monthCellTextDisabled,
                    ]}>{m}</Text>
                  </TouchableOpacity>
                );
              })}
          </View>
        </View>
      </View>
      </Modal>

      {/* Theme Consistant Alert Modal */}
      <Modal visible={customAlert.visible} animationType="fade" transparent={true}>
         <View style={styles.pickerOverlay}>
            <View style={[styles.pickerContainer, { width: '85%', alignSelf: 'center', borderRadius: 24, padding: 30, backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, marginBottom: 'auto', marginTop: 'auto' }]}>
               <View style={{ alignItems: 'center', marginBottom: 20 }}>
                  <Text style={[styles.pickerTitle, { color: colors.primary, fontSize: 18 }]}>{customAlert.title?.toUpperCase()}</Text>
                  <View style={{ height: 1.5, width: 40, backgroundColor: colors.primary + '30', marginTop: 10 }} />
               </View>
               
               <Text style={[styles.monthCellText, { fontSize: 13, color: '#FFF', opacity: 0.8, lineHeight: 20, marginBottom: 30, textAlign: 'center' }]}>
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
                              styles.monthCell, 
                              { 
                                 flex: 1, 
                                 backgroundColor: isDestructive ? 'rgba(255,100,100,0.1)' : isCancel ? 'rgba(255,255,255,0.05)' : colors.primary,
                                 borderColor: isDestructive ? 'rgba(255,100,100,0.2)' : 'rgba(255,255,255,0.1)',
                                 borderWidth: 1,
                                 width: 'auto'
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
                        style={[styles.monthCell, { flex: 1, backgroundColor: colors.primary, width: 'auto' }]} 
                        onPress={() => setCustomAlert(prev => ({ ...prev, visible: false }))}
                     >
                        <Text style={{ color: '#000', fontWeight: 'bold' }}>OK</Text>
                     </TouchableOpacity>
                  )}
               </View>
            </View>
         </View>
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
  centerContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
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
    borderRadius: 10,
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
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24, 
    marginTop: 20,
    marginHorizontal: 15,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 14, 
    borderWidth: 1,
    borderColor: colors.border + '50',
  },
  navArrow: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: colors.background,
  },
  navArrowDisabled: {
    opacity: 0.4,
  },
  monthLabel: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  monthLabelText: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  chartRowWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 20, 
    paddingVertical: 28, // Increased from 20
    paddingHorizontal: 24,
    marginBottom: 24, // Increased from 20
    marginHorizontal: 15,
    borderWidth: 1,
    borderColor: colors.border + '40',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  pieContainer: {
    width: 150,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  detailsSide: {
    flex: 1,
    marginLeft: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sideSummaryLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 6,
  },
  sideSummaryAmount: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '900',
    marginBottom: 6,
  },
  sideSummaryCount: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  listContainer: {
    // Standardized to parent padding
    paddingBottom: 40,
  },
  expenseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121212',
    padding: 20,
    borderRadius: 20,
    marginBottom: 14,
    marginHorizontal: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 4,
  },
  deleteBtn: {
    marginLeft: 15,
    padding: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 69, 58, 0.08)',
  },
  iconBox: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  expenseDetails: {
    flex: 1,
  },
  expenseTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 3,
  },
  expenseDate: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  amountCol: {
    alignItems: 'flex-end',
  },
  expenseCategory: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 3,
  },
  expenseAmount: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: '900',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 80,
  },
  emptyText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 15,
  },
  emptySubText: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 8,
    fontWeight: '500',
  },
  // Month Picker
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  pickerContainer: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: 40,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  pickerTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  yearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 24,
  },
  pickerYear: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
    minWidth: 60,
    textAlign: 'center',
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  monthCell: {
    width: '22%',
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.border,
    alignItems: 'center',
  },
  monthCellSelected: {
    backgroundColor: colors.primary,
  },
  monthCellDisabled: {
    opacity: 0.35,
  },
  monthCellText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  monthCellTextSelected: {
    color: '#FFFFFF',
  },
  monthCellTextDisabled: {
    color: colors.textSecondary,
  },
});

export default TransactionHistoryScreen;
