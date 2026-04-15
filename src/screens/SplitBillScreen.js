import React, { useState, useEffect, useContext } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity, 
  ScrollView, 
  SafeAreaView, 
  ActivityIndicator, 
  Alert, 
  KeyboardAvoidingView, 
  Platform,
  useWindowDimensions,
  FlatList,
  Modal,
  BackHandler
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../utils/firebase';
import { AuthContext } from '../context/AuthContext';
import { colors } from '../theme/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SplitBillScreen = ({ route, navigation }) => {
  const { width, height } = useWindowDimensions();
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  
  // Explicitly nullified to ensure Page 4 is independent and crash-free
  const groupId = null;
  const groupName = null;
  
  const [activeTab, setActiveTab] = useState('EQUALLY');
  const [equalAmount, setEqualAmount] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [numPeople, setNumPeople] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [groupMembers, setGroupMembers] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [customAlert, setCustomAlert] = useState({ visible: false, title: '', message: '', buttons: [] });

  const showThemeAlert = (title, message, buttons = [{ text: 'OK' }]) => {
    setCustomAlert({ visible: true, title, message, buttons });
  };

  // Custom Split State
  const [userPaid, setUserPaid] = useState('');
  const [customMembers, setCustomMembers] = useState([
    { id: 1, name: '', paid: '' }
  ]);
  const [showSettlement, setShowSettlement] = useState(false);

  useEffect(() => {
    if (!groupId) {
      setLoading(false);
      return;
    }

    const fetchMembers = async () => {
      try {
        const groupRef = doc(db, 'groups', groupId);
        const groupDoc = await getDoc(groupRef);
        if (groupDoc.exists()) {
          const data = groupDoc.data();
          const members = data.memberEmails.map((email, index) => ({
            id: data.members[index],
            email: email,
            name: email.split('@')[0]
          }));
          setGroupMembers(members);
          setSelectedMembers(data.members);
          setNumPeople(data.members.length.toString());
        }
      } catch (error) {
        showThemeAlert('ERROR', 'FAILED TO FETCH GROUP MEMBERS');
      } finally {
        setLoading(false);
      }
    };

    fetchMembers();
  }, [groupId]);

  const handleClearAll = () => {
    setEqualAmount('');
    setCustomAmount('');
    setNumPeople('');
    setDescription('');
    setUserPaid('');
    setCustomMembers([{ id: 1, name: '', paid: '' }]);
    showThemeAlert('CLEARED', 'ALL INPUTS HAVE BEEN RESET');
  };

  useEffect(() => {
    const onBackPress = () => {
      // Allow default tab navigation
      return false;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, []);

  const toggleMember = (memberId) => {
    if (selectedMembers.includes(memberId)) {
      if (selectedMembers.length > 1) {
        const newList = selectedMembers.filter(id => id !== memberId);
        setSelectedMembers(newList);
        setNumPeople(newList.length.toString());
      }
    } else {
      const newList = [...selectedMembers, memberId];
      setSelectedMembers(newList);
      setNumPeople(newList.length.toString());
    }
  };

  const addCustomMember = () => {
    setCustomMembers([...customMembers, { id: Date.now(), name: '', paid: '' }]);
  };

  const removeCustomMember = (id) => {
    setCustomMembers(customMembers.filter(m => m.id !== id));
  };

  const resetCustomSplit = () => {
    setCustomMembers([{ id: Date.now(), name: '', paid: '' }]);
    setUserPaid('');
    setCustomAmount('');
    setShowSettlement(false);
  };

  const resetEqualSplit = () => {
    setEqualAmount('');
    if (!groupId) setNumPeople('');
  };

  const updateCustomMember = (id, field, value) => {
    setCustomMembers(customMembers.map(m => 
      m.id === id ? { ...m, [field]: value } : m
    ));
  };

  const handleSaveSplit = async () => {
    const targetAmount = activeTab === 'EQUALLY' ? equalAmount : customAmount;
    if (!targetAmount || isNaN(targetAmount) || parseFloat(targetAmount) <= 0) {
      showThemeAlert('ERROR', 'PLEASE ENTER A VALID AMOUNT');
      return;
    }

    setIsSaving(true);
    try {
      const splitAmount = parseFloat(activeTab === 'EQUALLY' ? equalAmount : customAmount);
      const peopleCount = activeTab === 'EQUALLY' ? (parseInt(numPeople) || 1) : (customMembers.length + 1);
      const perPerson = splitAmount / peopleCount;

      // Smart Validation for Custom Mode
      if (activeTab === 'CUSTOM') {
        const totalPaid = (parseFloat(userPaid) || 0) + customMembers.reduce((sum, m) => sum + (parseFloat(m.paid) || 0), 0);
        if (Math.abs(totalPaid - splitAmount) > 0.1) {
          showThemeAlert('ERROR', `BILL NOT BALANCED. ₹${Math.abs(splitAmount - totalPaid).toFixed(0)} ${totalPaid > splitAmount ? 'EXCESS' : 'REMAINING'}.`);
          setIsSaving(false);
          return;
        }
      }

      // 1. Save to Splits collection (if group exists and in Equal mode)
      if (groupId && activeTab === 'EQUALLY') {
        await addDoc(collection(db, 'splits'), {
          groupId,
          groupName,
          totalAmount: splitAmount,
          description: description.trim() || 'SPLIT BILL',
          perPersonAmount: perPerson,
          participants: selectedMembers,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        });
      }

      // 2. Always Save my share as a personal expense
      await addDoc(collection(db, 'expenses'), {
        userId: user.uid,
        amount: perPerson,
        description: `SPLIT: ${description.trim() || 'BILL SPLIT'}`,
        category: 'OTHERS',
        createdAt: serverTimestamp(),
      });

      showThemeAlert('SUCCESS', 'BILL SPLIT AND SAVED TO YOUR EXPENSES!');
      if (!groupId) {
        if (activeTab === 'EQUALLY') setEqualAmount('');
        else setCustomAmount('');
        setNumPeople('');
        setDescription('');
        setUserPaid('');
        setCustomMembers([{ id: 1, name: '', paid: '' }]);
      } else {
        navigation.goBack();
      }
    } catch (error) {
      showThemeAlert('ERROR', error.message.toUpperCase());
    } finally {
      setIsSaving(false);
    }
  };

  const currentAmount = activeTab === 'EQUALLY' ? equalAmount : customAmount;
  const personalShare = (parseFloat(currentAmount) || 0) / (activeTab === 'EQUALLY' ? (parseInt(numPeople) || 1) : (customMembers.length + 1));
  
  // Smart Analysis for Custom Mode
  const totalPaidAtVenue = (parseFloat(userPaid) || 0) + customMembers.reduce((sum, m) => sum + (parseFloat(m.paid) || 0), 0);
  const remainingToMatch = (parseFloat(currentAmount) || 0) - totalPaidAtVenue;
  const isBalanced = Math.abs(remainingToMatch) < 0.1 && (parseFloat(currentAmount) > 0);

  const isSaveReady = activeTab === 'EQUALLY' 
    ? (parseFloat(equalAmount) > 0 && (groupId ? selectedMembers.length > 0 : parseInt(numPeople) > 0))
    : (isBalanced);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <View style={[styles.headerIconBox, { top: Math.max(insets.top, 20) + 5 }]}>
          <Ionicons name="calculator" size={20} color={colors.primary} />
        </View>
        <View style={styles.headerTextCol}>
          <Text style={styles.headerTitle}>SPLIT YOUR BILL</Text>
          <Text style={styles.headerSubtitle}>{groupName ? groupName.toUpperCase() : 'FINOVO ENGINE V1.2'}</Text>
        </View>
      </View>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={styles.mainWrapper}>

          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Tab Switcher */}
            <View style={styles.tabContainer}>
              <TouchableOpacity 
                style={[styles.tabButton, activeTab === 'EQUALLY' && styles.tabButtonActive]}
                onPress={() => setActiveTab('EQUALLY')}
              >
                <Text style={[styles.tabText, activeTab === 'EQUALLY' && styles.tabTextActive]}>SPLIT EQUALLY</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.tabButton, activeTab === 'CUSTOM' && styles.tabButtonActive]}
                onPress={() => setActiveTab('CUSTOM')}
              >
                <Text style={[styles.tabText, activeTab === 'CUSTOM' && styles.tabTextActive]}>CUSTOM SPLIT</Text>
              </TouchableOpacity>
            </View>

            {/* Input Sections */}
            {activeTab === 'EQUALLY' ? (
              <>
                <View style={styles.inputContainer}>
                  <Text style={styles.label}>TOTAL BILL AMOUNT</Text>
                  <View style={styles.glassInputBox}>
                    <Text style={styles.currencyPrefix}>₹</Text>
                    <TextInput
                      style={styles.mainInput}
                      value={equalAmount}
                      onChangeText={setEqualAmount}
                      keyboardType="numeric"
                      placeholder="0.00"
                      placeholderTextColor="rgba(255,255,255,0.2)"
                    />
                  </View>
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.label}>NUMBER OF PEOPLE</Text>
                  <View style={styles.glassInputBox}>
                    <Ionicons name="people-outline" size={20} color={colors.primary} style={{ marginRight: 15 }} />
                    <TextInput
                      style={styles.mainInput}
                      value={numPeople}
                      onChangeText={setNumPeople}
                      keyboardType="numeric"
                      placeholder="2"
                      placeholderTextColor="rgba(255,255,255,0.2)"
                      editable={!groupId}
                    />
                  </View>
                </View>

                {/* Group Selection */}
                {groupId && (
                  <View style={styles.memberSection}>
                    <Text style={styles.label}>SPLIT WITH ({selectedMembers.length})</Text>
                    <View style={styles.memberGrid}>
                      {groupMembers.map((member) => (
                        <TouchableOpacity 
                          key={member.id}
                          style={[
                            styles.memberChip,
                            selectedMembers.includes(member.id) && styles.memberChipActive
                          ]}
                          onPress={() => toggleMember(member.id)}
                        >
                           <Text style={[styles.chipText, selectedMembers.includes(member.id) && styles.chipTextActive]}>
                             {member.name.toUpperCase()}
                           </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                {/* Reset Button for Equal Split */}
                {(equalAmount !== '' || (!groupId && numPeople !== '')) && (
                  <TouchableOpacity style={styles.discardBtn} onPress={resetEqualSplit}>
                    <Ionicons name="refresh-outline" size={16} color="rgba(255,255,255,0.3)" />
                    <Text style={styles.discardText}>RESET ALL FIELDS</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <View style={styles.customSection}>
                <View style={[styles.inputContainer, { marginBottom: 15 }]}>
                  <Text style={styles.label}>TOTAL BILL AMOUNT</Text>
                  <View style={[styles.glassInputBox, { paddingVertical: 14 }]}>
                    <Text style={[styles.currencyPrefix, { fontSize: 20 }]}>₹</Text>
                    <TextInput
                      style={[styles.mainInput, { fontSize: 20 }]}
                      value={customAmount}
                      onChangeText={setCustomAmount}
                      keyboardType="numeric"
                      placeholder="0.00"
                      placeholderTextColor="rgba(255,255,255,0.2)"
                    />
                  </View>
                </View>

                {/* Validation Status Bar */}
                {parseFloat(customAmount) > 0 && (
                  <View style={[styles.statusBanner, isBalanced ? styles.statusBalanced : styles.statusUnbalanced]}>
                    <Ionicons 
                      name={isBalanced ? "checkmark-circle" : "alert-circle"} 
                      size={18} 
                      color={isBalanced ? colors.success : colors.danger} 
                    />
                    <Text style={[styles.statusText, { color: isBalanced ? colors.success : colors.danger }]}>
                      {isBalanced ? 'BILL IS PERFECTLY BALANCED' : `TOTAL PAID: ₹${totalPaidAtVenue.toFixed(0)} (₹${Math.abs(remainingToMatch).toFixed(0)} ${remainingToMatch > 0 ? 'REMAINING' : 'EXCESS'})`}
                    </Text>
                  </View>
                )}

                <Text style={styles.shareLabel}>SHARE PER PERSON: ₹{personalShare.toFixed(0)}</Text>

                {/* User Payment Card */}
                <View style={[styles.memberCard, { borderColor: colors.primary + '30' }]}>
                  <View style={styles.cardHeader}>
                    <Text style={[styles.cardNameLabel, { color: colors.primary }]}>YOU (ME)</Text>
                    <Ionicons name="person" size={16} color={colors.primary} />
                  </View>
                  <View style={styles.cardInputRow}>
                    <TextInput
                      style={styles.cardAmountInput}
                      value={userPaid}
                      onChangeText={setUserPaid}
                      keyboardType="numeric"
                      placeholder="HOW MUCH DID YOU PAY?"
                      placeholderTextColor="rgba(255,255,255,0.2)"
                    />
                  </View>
                </View>

                {/* Custom Member List */}
                {customMembers.map((m, index) => (
                  <View key={m.id} style={styles.memberCard}>
                    <View style={styles.cardHeader}>
                      <TextInput
                        style={styles.cardNameInput}
                        value={m.name}
                        onChangeText={(v) => updateCustomMember(m.id, 'name', v)}
                        placeholder="FRIEND'S NAME"
                        placeholderTextColor="rgba(255,255,255,0.3)"
                      />
                      <TouchableOpacity onPress={() => removeCustomMember(m.id)}>
                        <Ionicons name="trash-outline" size={18} color={colors.danger} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.cardInputRow}>
                      <TextInput
                        style={styles.cardAmountInput}
                        value={m.paid}
                        onChangeText={(v) => updateCustomMember(m.id, 'paid', v)}
                        keyboardType="numeric"
                        placeholder="PAID BY THEM"
                        placeholderTextColor="rgba(255,255,255,0.2)"
                      />
                    </View>
                  </View>
                ))}

                <TouchableOpacity style={styles.addMemberBtn} onPress={addCustomMember}>
                  <Ionicons name="person-add-outline" size={20} color={colors.primary} />
                  <Text style={styles.addMemberText}>ADD ANOTHER FRIEND</Text>
                </TouchableOpacity>

                {/* Get Settlement Button */}
                {isBalanced && !showSettlement && (
                  <TouchableOpacity 
                    style={styles.getSettlementBtn} 
                    onPress={() => setShowSettlement(true)}
                  >
                    <Ionicons name="flash-outline" size={20} color="#000" />
                    <Text style={styles.getSettlementText}>GET SETTLEMENT</Text>
                  </TouchableOpacity>
                )}

                {/* Reset/Discard Button */}
                {(customMembers.length > 0 || userPaid !== '' || customAmount !== '') && (
                  <TouchableOpacity style={styles.discardBtn} onPress={resetCustomSplit}>
                    <Ionicons name="refresh-outline" size={16} color="rgba(255,255,255,0.3)" />
                    <Text style={styles.discardText}>DISCARD & RESET ALL</Text>
                  </TouchableOpacity>
                )}

                {/* Settlement Advice Section */}
                {isBalanced && showSettlement && (
                  <View style={styles.settlementSection}>
                    <Text style={styles.label}>FINAL SETTLEMENT ADVICE</Text>
                    {(() => {
                      const participants = [
                        { name: 'ME (YOU)', balance: (parseFloat(userPaid) || 0) - personalShare },
                        ...customMembers.map(m => ({
                          name: m.name || 'FRIEND',
                          balance: (parseFloat(m.paid) || 0) - personalShare
                        }))
                      ];
                      
                      const debtors = participants.filter(p => p.balance < -0.1).map(p => ({...p, balance: Math.abs(p.balance)}));
                      const creditors = participants.filter(p => p.balance > 0.1);
                      const advice = [];
                      
                      let dIdx = 0;
                      let cIdx = 0;
                      
                      while (dIdx < debtors.length && cIdx < creditors.length) {
                        const amount = Math.min(debtors[dIdx].balance, creditors[cIdx].balance);
                        advice.push(`${debtors[dIdx].name.toUpperCase()} PAY TO ${creditors[cIdx].name.toUpperCase()} ₹${amount.toFixed(0)}`);
                        
                        debtors[dIdx].balance -= amount;
                        creditors[cIdx].balance -= amount;
                        
                        if (debtors[dIdx].balance < 0.1) dIdx++;
                        if (creditors[cIdx].balance < 0.1) cIdx++;
                      }
                      
                      return advice.map((txt, i) => (
                        <View key={i} style={styles.settlementCard}>
                          <Text style={[styles.settlementVerb, { color: colors.primary }]}>{txt}</Text>
                        </View>
                      ));
                    })()}
                  </View>
                )}
              </View>
            )}

            {/* Result Card - Premium 3D */}
            <View style={styles.resultCard}>
              <View style={styles.resultInfo}>
                <Text style={styles.resultLabel}>YOUR PERSONAL SHARE</Text>
                <Text style={styles.resultAmount}>₹{personalShare.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</Text>
              </View>
              
              <View style={styles.resultActions}>
                <TouchableOpacity 
                  style={[styles.saveBtn, { flex: 1, marginTop: 0 }, !isSaveReady && styles.saveBtnDisabled]}
                  onPress={handleSaveSplit}
                  disabled={isSaving || !isSaveReady}
                >
                  {isSaving ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <>
                      <Ionicons 
                        name={isSaveReady ? "checkmark-circle" : "lock-closed"} 
                        size={20} 
                        color="#000" 
                        style={{ marginRight: 8 }} 
                      />
                      <Text style={styles.saveBtnText}>SAVE MY SHARE</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.saveBtn, { width: 56, marginTop: 0, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }]} 
                  onPress={handleClearAll}
                >
                  <Ionicons name="refresh-outline" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <View style={styles.neonIndicator} />
            </View>

          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>

    {/* Theme Consistant Alert Modal */}
    <Modal visible={customAlert.visible} animationType="fade" transparent={true}>
       <View style={[styles.mainWrapper, { backgroundColor: 'rgba(0,0,0,0.6)', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }]}>
          <View style={[styles.memberCard, { width: '85%', padding: 30, backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderRadius: 24 }]}>
             <View style={{ alignItems: 'center', marginBottom: 20 }}>
                <Text style={[styles.headerTitle, { color: colors.primary, fontSize: 18 }]}>{customAlert.title?.toUpperCase()}</Text>
                <View style={{ height: 1.5, width: 40, backgroundColor: colors.primary + '30', marginTop: 10 }} />
             </View>
             
             <Text style={[styles.tabText, { fontSize: 13, color: '#FFF', opacity: 0.8, lineHeight: 20, marginBottom: 30, textAlign: 'center' }]}>
                {customAlert.message}
             </Text>

             <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
                {customAlert.buttons?.map((btn, idx) => {
                   const isCancel = btn.style === 'cancel' || btn.text === 'CANCEL';
                   return (
                      <TouchableOpacity 
                         key={idx}
                         style={[
                            styles.getSettlementBtn, 
                            { 
                               flex: 1, 
                               backgroundColor: isCancel ? 'rgba(255,255,255,0.05)' : colors.primary,
                               height: 44,
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
                      style={[styles.getSettlementBtn, { flex: 1, backgroundColor: colors.primary, height: 44 }]} 
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
    backgroundColor: '#000',
  },
  mainWrapper: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
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
  scrollContent: {
    paddingBottom: 40,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#121212',
    borderRadius: 16,
    padding: 6,
    marginBottom: 30,
    marginTop: 20,
    marginHorizontal: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 12,
  },
  tabButtonActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  tabTextActive: {
    color: '#000',
  },
  inputContainer: {
    marginBottom: 24,
    paddingHorizontal: 15,
  },
  label: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 12,
    marginLeft: 4,
  },
  glassInputBox: {
    backgroundColor: '#121212',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 15,
    elevation: 6,
  },
  currencyPrefix: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: '900',
    marginRight: 15,
  },
  mainInput: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '900',
    flex: 1,
  },
  memberSection: {
    marginBottom: 30,
  },
  memberGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: 20,
  },
  memberChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  memberChipActive: {
    backgroundColor: colors.primary + '20',
    borderColor: colors.primary,
  },
  chipText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: '800',
  },
  chipTextActive: {
    color: colors.primary,
  },
  resultCard: {
    backgroundColor: '#121212',
    borderRadius: 24,
    padding: 24,
    marginTop: 10,
    marginHorizontal: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
    overflow: 'hidden',
  },
  resultInfo: {
    marginBottom: 15,
    alignItems: 'center',
  },
  resultLabel: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 6,
  },
  resultAmount: {
    color: '#FFF',
    fontSize: 42,
    fontWeight: '900',
    textAlign: 'center',
  },
  resultActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: '#000',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  neonIndicator: {
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
  // Custom Split Styles
  customSection: {
    marginTop: 0,
  },
  shareLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginHorizontal: 15,
    marginBottom: 20,
    marginTop: 10,
  },
  memberCard: {
    backgroundColor: '#121212',
    borderRadius: 20,
    padding: 20,
    marginBottom: 12,
    marginHorizontal: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardNameInput: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
    flex: 1,
  },
  cardInputRow: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  cardAmountInput: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  addMemberBtn: {
    backgroundColor: '#121212',
    borderRadius: 20,
    height: 60,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    marginHorizontal: 15,
    borderColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  addMemberText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    marginLeft: 10,
    letterSpacing: 0.5,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 15,
    marginHorizontal: 15,
    borderWidth: 1,
  },
  statusBalanced: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  statusUnbalanced: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    marginLeft: 10,
    letterSpacing: 0.5,
  },
  cardNameLabel: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },
  settlementSection: {
    marginTop: 10,
    marginBottom: 20,
  },
  settlementCard: {
    backgroundColor: '#161616',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    marginHorizontal: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  settlementMember: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  settlementVerb: {
    fontSize: 12,
    fontWeight: '900',
  },
  saveBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    opacity: 0.6,
  },
  getSettlementBtn: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    height: 54,
    marginHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    marginBottom: 10,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  getSettlementText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
    marginLeft: 10,
  },
  discardBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
  },
  discardText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginLeft: 8,
  },
});

export default SplitBillScreen;
