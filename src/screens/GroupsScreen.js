import React, { useState, useEffect, useContext, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, TextInput, ActivityIndicator, Alert, SafeAreaView, useWindowDimensions, KeyboardAvoidingView, Platform, Share, ScrollView, BackHandler } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { collection, query, where, onSnapshot, addDoc, setDoc, serverTimestamp, doc, updateDoc, arrayUnion, getDoc, deleteDoc, arrayRemove, orderBy, limit } from 'firebase/firestore';
import { db, auth } from '../utils/firebase';
import { signOut, sendPasswordResetEmail } from 'firebase/auth';
import { AuthContext } from '../context/AuthContext';
import { colors } from '../theme/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NotificationContext } from '../context/NotificationContext';

const GroupsScreen = ({ navigation, route }) => {
  const { user } = useContext(AuthContext);
  const { resetNotifications } = useContext(NotificationContext);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [editGroupName, setEditGroupName] = useState('');
  const [joinGroupId, setJoinGroupId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [activeTab, setActiveTab] = useState('GROUPS'); // GROUPS, JOIN, CREATE
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('EXPENSES'); // EXPENSES, MEMBERS
  const [viewingGroupId, setViewingGroupId] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [newExpense, setNewExpense] = useState({ name: '', amount: '', category: 'GENERAL', location: '' });
  const [showMemberMenu, setShowMemberMenu] = useState(false);
  const [selectedMemberName, setSelectedMemberName] = useState('');
  const [showMemberEditModal, setShowMemberEditModal] = useState(false);
  const [memberEditName, setMemberEditName] = useState('');
  const [memberInput, setMemberInput] = useState('');
  const [showSettlementSummary, setShowSettlementSummary] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [customAlert, setCustomAlert] = useState({ visible: false, title: '', message: '', buttons: [] });

  const showThemeAlert = (title, message, buttons = [{ text: 'OK' }]) => {
    setCustomAlert({ visible: true, title, message, buttons });
  };
  useEffect(() => {
    if (!user) return;

    // Fetch groups where user is a member/invitee
    const q = query(
      collection(db, 'groups'),
      where('memberEmails', 'array-contains', user.email)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const groupData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setGroups(groupData);
      setLoading(false);
    }, (error) => {
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  // Unified function to update group activity and reset source user's dot
  const logActivity = async (groupId = null) => {
    if (!user) return;
    try {
      // 1. Mark group as active so OTHERS see the dot
      if (groupId) {
        await updateDoc(doc(db, 'groups', groupId), {
          lastActivityAt: serverTimestamp()
        });
      }
      // 2. Mark as viewed for ME so I don't see my own dot
      await setDoc(doc(db, 'users', user.uid), {
        lastGroupsViewedAt: serverTimestamp(),
        email: user.email,
        updatedAt: serverTimestamp()
      }, { merge: true });
      
      // 3. Clear dot LOCALLY immediately to prevent blink
      resetNotifications();
    } catch (error) {
      // Activity logging stalled (silently failed)
    }
  };

  // Track Last Viewed Time for Notifications (On Focus)
  useFocusEffect(
    useCallback(() => {
      logActivity(); // Reset dot when entering groups screen
    }, [user])
  );

  // Hardware Back Button Support (Android)
  useEffect(() => {
    const onBackPress = () => {
      if (viewingGroupId) {
        setViewingGroupId(null);
        return true; // Prevent app exit
      }
      return false; // Exit app normally
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [viewingGroupId]);

  // Fetch expenses for selected group
  useEffect(() => {
    if (!viewingGroupId) {
      setExpenses([]);
      return;
    }

    const q = query(
      collection(db, 'groups', viewingGroupId, 'expenses'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const expenseData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setExpenses(expenseData);
    }, (error) => {
      // Quiet fail or handle sync error
    });

    return () => unsubscribe();
  }, [viewingGroupId]);

  const groupData = groups.find(g => g.id === viewingGroupId);
  const totalGroupExpense = expenses.reduce((sum, exp) => sum + (parseFloat(exp.amount) || 0), 0);
  const memberCount = (groupData?.memberEmails?.length || 0) + (groupData?.manualMembers?.length || 0);
  const fairShare = memberCount > 0 ? totalGroupExpense / memberCount : 0;
  
  const myContribution = expenses
    .filter(exp => exp.paidBy === user.uid)
    .reduce((sum, exp) => sum + (parseFloat(exp.amount) || 0), 0);
    
  const myBalance = myContribution - fairShare;

  const getSettlements = () => {
    if (!groupData || expenses.length === 0) return [];
    
    const balances = {};
    const allMemberNames = [
      ...(groupData.memberEmails || []),
      ...(groupData.manualMembers || [])
    ];
    
    if (allMemberNames.length === 0) return [];

    // Initialize all balances to -fairShare (only for non-settlement expenses)
    const shareableExpensesTotal = expenses.filter(e => !e.isSettlement).reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    const correctedFairShare = shareableExpensesTotal / Math.max(allMemberNames.length, 1);

    allMemberNames.forEach(member => {
      balances[member] = -correctedFairShare;
    });

    // Add total paid by each member, but handle Settlements as direct transfers
    expenses.forEach(exp => {
      if (exp.isSettlement) {
         // Direct adjustment: From member loses balance (owes less), To member gains balance (receives more)
         // But in our math, creditors have + and debtors have -.
         // A settlement FROM member adds to their balance, TO member subtracts from their balance.
         if (balances[exp.fromMember] !== undefined) balances[exp.fromMember] += (parseFloat(exp.amount) || 0);
         if (balances[exp.toMember] !== undefined) balances[exp.toMember] -= (parseFloat(exp.amount) || 0);
      } else {
         const payer = exp.paidByEmail || exp.paidBy;
         if (balances[payer] !== undefined) {
           balances[payer] += (parseFloat(exp.amount) || 0);
         }
      }
    });

    const creditors = [];
    const debtors = [];

    Object.keys(balances).forEach(member => {
      const bal = balances[member];
      if (bal > 0.01) creditors.push({ name: member, amount: bal });
      else if (bal < -0.01) debtors.push({ name: member, amount: Math.abs(bal) });
    });

    const settlements = [];
    let i = 0, j = 0;

    while (i < debtors.length && j < creditors.length) {
      const amount = Math.min(debtors[i].amount, creditors[j].amount);
      
      const debtorName = debtors[i].name.includes('@') ? debtors[i].name.split('@')[0].toUpperCase() : debtors[i].name;
      const creditorName = creditors[j].name.includes('@') ? creditors[j].name.split('@')[0].toUpperCase() : creditors[j].name;

      settlements.push({
        from: debtorName,
        to: creditorName,
        amount: amount.toFixed(2)
      });

      debtors[i].amount -= amount;
      creditors[j].amount -= amount;

      if (debtors[i].amount < 0.01) i++;
      if (creditors[j].amount < 0.01) j++;
    }

    return settlements;
  };

  const settlementList = getSettlements();

  const getMemberSpending = () => {
    const spending = {};
    const allMembers = [
      ...(groupData?.memberEmails || []),
      ...(groupData?.manualMembers || [])
    ];
    
    allMembers.forEach(m => spending[m] = 0);
    
    expenses.forEach(exp => {
      const payer = exp.paidByEmail || exp.paidBy;
      if (spending[payer] !== undefined) {
        spending[payer] += (parseFloat(exp.amount) || 0);
      }
    });

    return Object.keys(spending).map(member => ({
      name: member.includes('@') ? member.split('@')[0].toUpperCase() : member,
      amount: spending[member]
    }));
  };

  const memberTotals = getMemberSpending();

  const generateGROUPId = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 10; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  useEffect(() => {
    if (route?.params?.id) {
      const incomingId = route.params.id;
      
      // Alert to confirm auto-join intent
      showThemeAlert(
        'JOIN GROUP',
        `WOULD YOU LIKE TO JOIN GROUP: ${incomingId}?`,
        [
          { text: 'CANCEL', style: 'cancel', onPress: () => navigation.setParams({ id: null }) },
          { 
            text: 'JOIN NOW', 
            onPress: () => {
               handleJoinGroupOverride(incomingId);
               navigation.setParams({ id: null });
            } 
          }
        ]
      );
    }
  }, [route?.params?.id]);

  const handleJoinGroupOverride = async (idToJoin) => {
     setIsJoining(true);
     try {
       const groupRef = doc(db, 'groups', idToJoin.trim());
       const groupSnap = await getDoc(groupRef);
 
       if (!groupSnap.exists()) {
         showThemeAlert('ERROR', 'INVALID GROUP ID. GROUP NOT FOUND.');
         return;
       }
 
       await updateDoc(groupRef, {
         members: arrayUnion(user.uid),
         memberEmails: arrayUnion(user.email)
       });
 
       await logActivity(idToJoin); // Reset dot and mark activity
       showThemeAlert('SUCCESS', 'YOU HAVE JOINED THE GROUP!');
       setViewingGroupId(idToJoin); // Direct to group view
     } catch (error) {
       showThemeAlert('ERROR', error.message.toUpperCase());
     } finally {
       setIsJoining(false);
     }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      showThemeAlert('Error', 'Please enter a group name');
      return;
    }

    setIsCreating(true);
    try {
      const customId = generateGROUPId();
      const groupDataObj = {
        name: newGroupName.trim(),
        createdBy: user.uid,
        creatorEmail: user.email,
        members: [user.uid],
        memberEmails: [user.email],
        admins: [user.uid],
        manualMembers: [],
        createdAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'groups', customId), groupDataObj);
      
      const newGroupData = {
        id: customId,
        ...groupDataObj
      };

      setNewGroupName('');
      setShowModal(false);
      
      // Land directly in the group dashboard on the Members tab
      setViewingGroupId(customId);
      setSelectedGroup(newGroupData);
      setActiveSubTab('MEMBERS');
      
      showThemeAlert('SUCCESS', 'GROUP CREATED! ADD MEMBERS BELOW.');
      await logActivity(customId);
    } catch (error) {
      showThemeAlert('ERROR', error.message.toUpperCase());
    } finally {
      setIsCreating(false);
    }
  };

  const handleShareGroup = async () => {
    if (!selectedGroup) return;
    try {
      const shareLink = `smartexpenseai://join?id=${selectedGroup.id}`;
      await Share.share({
        message: `Join my group "${selectedGroup.name}" on Smart Expense AI to track our bills together! \n\nTap here to join: ${shareLink}\n\nGroup ID: ${selectedGroup.id}`,
        title: `Invite to ${selectedGroup.name}`,
      });
    } catch (error) {
      showThemeAlert('ERROR', 'FAILED TO OPEN SHARE MENU');
    }
  };

  const handleJoinGroup = async () => {
    if (!joinGroupId.trim()) {
      showThemeAlert('ERROR', 'PLEASE ENTER A GROUP ID');
      return;
    }

    setIsJoining(true);
    try {
      const groupRef = doc(db, 'groups', joinGroupId.trim());
      const groupSnap = await getDoc(groupRef);

      if (!groupSnap.exists()) {
        showThemeAlert('ERROR', 'INVALID GROUP ID. GROUP NOT FOUND.');
        return;
      }

      await updateDoc(groupRef, {
        members: arrayUnion(user.uid),
        memberEmails: arrayUnion(user.email)
      });
      await logActivity(joinGroupId.trim());

      setJoinGroupId('');
      setShowJoinModal(false);
      showThemeAlert('SUCCESS', 'YOU HAVE JOINED THE GROUP!');
    } catch (error) {
      showThemeAlert('ERROR', error.message.toUpperCase());
    } finally {
      setIsJoining(false);
    }
  };

  const handleAddMemberName = async () => {
    if (!memberInput.trim() || !viewingGroupId) return;
    setIsActing(true);
    const nameToAdd = memberInput.trim().toUpperCase();
    try {
      await updateDoc(doc(db, 'groups', viewingGroupId), {
        manualMembers: arrayUnion(nameToAdd)
      });
      await logActivity(viewingGroupId);
      // Selected group state isn't strictly needed for the reactive list, 
      // but we update it if we are using it for ID display
      setMemberInput(''); // Clear input after success
      showThemeAlert('SUCCESS', 'MEMBER ADDED BY NAME');
    } catch (error) {
      showThemeAlert('ERROR', 'FAILED TO ADD MEMBER');
    } finally {
      setIsActing(false);
    }
  };

  const handleAddExpense = async () => {
    if (!newExpense.name.trim() || !newExpense.amount.trim() || !viewingGroupId) return;

    setIsActing(true);
    try {
      if (editingExpenseId) {
        // Update Existing
        await updateDoc(doc(db, 'groups', viewingGroupId, 'expenses', editingExpenseId), {
          ...newExpense,
          updatedAt: serverTimestamp(),
        });
        showThemeAlert('SUCCESS', 'EXPENSE UPDATED');
      } else {
        // Add New
        await addDoc(collection(db, 'groups', viewingGroupId, 'expenses'), {
          ...newExpense,
          paidBy: user.uid,
          paidByEmail: user.email,
          createdAt: serverTimestamp(),
        });
        showThemeAlert('SUCCESS', 'EXPENSE LOGGED');
      }
      
      await logActivity(viewingGroupId);
      setShowExpenseModal(false);
      setEditingExpenseId(null);
      setNewExpense({ name: '', amount: '', category: 'GENERAL', location: '' });
    } catch (error) {
      showThemeAlert('ERROR', error.message.toUpperCase());
    } finally {
      setIsActing(false);
    }
  };

  const handleSettleUp = async (from, to, amount) => {
    if (!viewingGroupId) return;
    
    showThemeAlert(
      'SETTLE BALANCE',
      `MARK ₹${amount} AS PAID FROM ${from} TO ${to}?`,
      [
        { text: 'CANCEL', style: 'cancel' },
        { 
          text: 'SETTLE NOW', 
          onPress: async () => {
            setIsActing(true);
            try {
              // Create a special settlement expense
              await addDoc(collection(db, 'groups', viewingGroupId, 'expenses'), {
                name: `SETTLEMENT: ${from} ➔ ${to}`,
                amount: amount,
                category: 'SETTLEMENT',
                location: 'SYSTEM',
                paidBy: user.uid, // The person who initiated/recorded the settlement
                paidByEmail: user.email,
                isSettlement: true,
                fromMember: from,
                toMember: to,
                createdAt: serverTimestamp(),
              });
              await logActivity(viewingGroupId);
              showThemeAlert('SUCCESS', 'SETTLEMENT RECORDED');
            } catch (error) {
              showThemeAlert('ERROR', 'FAILED TO SETTLE');
            } finally {
              setIsActing(false);
            }
          }
        }
      ]
    );
  };

  const handleDeleteExpense = async (expenseId) => {
    const expense = expenses.find(e => e.id === expenseId);
    if (expense && expense.paidBy !== user.uid) {
      showThemeAlert('DENIED', 'ONLY THE OWNER CAN DELETE THIS ENTRY');
      return;
    }

    showThemeAlert(
      'DELETE ENTRY',
      'ARE YOU SURE YOU WANT TO REMOVE THIS EXPENSE?',
      [
        { text: 'CANCEL', style: 'cancel' },
        { 
          text: 'DELETE', 
          style: 'destructive',
          onPress: async () => {
            try {
              setIsActing(true);
              await deleteDoc(doc(db, 'groups', viewingGroupId, 'expenses', expenseId));
              await logActivity(viewingGroupId);
            } catch (error) {
              showThemeAlert('ERROR', 'FAILED TO WIPE ENTRY');
            } finally {
              setIsActing(false);
            }
          }
        }
      ]
    );
  };

  const handleEditName = async () => {
    if (!editGroupName.trim() || !selectedGroup) return;
    setIsActing(true);
    try {
      await updateDoc(doc(db, 'groups', selectedGroup.id), {
        name: editGroupName.trim()
      });
      await logActivity(selectedGroup.id);
      setShowEditModal(false);
      showThemeAlert('SUCCESS', 'GROUP IDENTITY UPDATED');
    } catch (error) {
      showThemeAlert('ERROR', error.message.toUpperCase());
    } finally {
      setIsActing(false);
    }
  };

  const handleDeleteGroup = async (groupId) => {
    showThemeAlert(
      'DELETE GROUP',
      'ARE YOU SURE? THIS ACTION IS PERMANENT AND WILL WIPE ALL DATA.',
      [
        { text: 'CANCEL', style: 'cancel' },
        { 
          text: 'DELETE', 
          style: 'destructive',
          onPress: async () => {
             try {
                await deleteDoc(doc(db, 'groups', groupId));
                showThemeAlert('SUCCESS', 'GROUP DECOMMISSIONED');
             } catch (error) {
                showThemeAlert('ERROR', error.message.toUpperCase());
             }
          }
        }
      ]
    );
  };

  const handleLeaveGroup = async () => {
    if (!selectedGroup) return;
    showThemeAlert(
      'LEAVE GROUP',
      `ARE YOU SURE YOU WANT TO LEAVE ${selectedGroup.name.toUpperCase()}?`,
      [
        { text: 'CANCEL', style: 'cancel' },
        { 
          text: 'LEAVE', 
          style: 'destructive',
          onPress: async () => {
             try {
                setIsActing(true);
                await updateDoc(doc(db, 'groups', selectedGroup.id), {
                  members: arrayRemove(user.uid),
                  memberEmails: arrayRemove(user.email),
                  admins: arrayRemove(user.uid)
                });
                await logActivity(selectedGroup.id);
                setViewingGroupId(null);
                setSelectedGroup(null);
                showThemeAlert('SUCCESS', 'YOU HAVE LEFT THE GROUP');
             } catch (error) {
                showThemeAlert('ERROR', 'FAILED TO LEAVE GROUP');
             } finally {
                setIsActing(false);
             }
          }
        }
      ]
    );
  };

  const handleCopyID = async (id) => {
    await Clipboard.setStringAsync(id);
    showThemeAlert('COPIED', 'GROUP ID COPIED TO CLIPBOARD');
  };

  const handlePromoteMember = async (targetUid) => {
    if (!selectedGroup) return;
    const amIAdmin = selectedGroup.admins?.includes(user.uid) || selectedGroup.createdBy === user.uid;
    if (!amIAdmin) return;
    try {
      await updateDoc(doc(db, 'groups', selectedGroup.id), {
        admins: arrayUnion(targetUid)
      });
      await logActivity(selectedGroup.id);
      // Update local state to show change immediately in modal
      setSelectedGroup(prev => ({ ...prev, admins: [...prev.admins, targetUid] }));
      showThemeAlert('SUCCESS', 'MEMBER PROMOTED TO ADMIN');
    } catch (error) {
      showThemeAlert('ERROR', 'FAILED TO PROMOTE MEMBER');
    }
  };

  const handleKickMember = async (targetUid, targetEmail) => {
    if (!selectedGroup) return;
    const amIAdmin = selectedGroup.admins?.includes(user.uid) || selectedGroup.createdBy === user.uid;
    if (!amIAdmin) return;
    showThemeAlert(
      'REMOVE MEMBER',
      `ARE YOU SURE YOU WANT TO KICK ${targetEmail.split('@')[0].toUpperCase()}?`,
      [
        { text: 'CANCEL', style: 'cancel' },
        { 
          text: 'KICK', 
          style: 'destructive',
          onPress: async () => {
             try {
                await updateDoc(doc(db, 'groups', selectedGroup.id), {
                  members: arrayRemove(targetUid),
                  memberEmails: arrayRemove(targetEmail),
                  admins: arrayRemove(targetUid)
                });
                await logActivity(selectedGroup.id);
                // Update local state
                setSelectedGroup(prev => ({ 
                  ...prev, 
                  members: prev.members.filter(id => id !== targetUid),
                  memberEmails: prev.memberEmails.filter(e => e !== targetEmail),
                  admins: prev.admins.filter(id => id !== targetUid)
                }));
             } catch (error) {
                showThemeAlert('ERROR', 'FAILED TO REMOVE MEMBER');
             }
          }
        }
      ]
    );
  };

  const handleRemoveMember = async (name) => {
    if (!viewingGroupId) return;
    try {
      await updateDoc(doc(db, 'groups', viewingGroupId), {
        manualMembers: arrayRemove(name)
      });
      await logActivity(viewingGroupId);
      setShowMemberMenu(false);
      showThemeAlert('SUCCESS', 'MEMBER REMOVED FROM GROUP');
    } catch (error) {
      showThemeAlert('ERROR', 'FAILED TO REMOVE MEMBER');
    }
  };

  const handleUpdateMemberName = async () => {
    if (!memberEditName.trim() || !viewingGroupId || !selectedMemberName) return;
    setIsActing(true);
    const newName = memberEditName.trim().toUpperCase();
    try {
      // Since it's an array of strings, we remove old and add new
      await updateDoc(doc(db, 'groups', viewingGroupId), {
        manualMembers: arrayRemove(selectedMemberName)
      });
      await updateDoc(doc(db, 'groups', viewingGroupId), {
        manualMembers: arrayUnion(newName)
      });
      await logActivity(viewingGroupId);
      
      setShowMemberEditModal(false);
      setShowMemberMenu(false);
      showThemeAlert('SUCCESS', 'MEMBER NAME UPDATED');
    } catch (error) {
      showThemeAlert('ERROR', 'FAILED TO UPDATE NAME');
    } finally {
      setIsActing(false);
    }
  };

  const showMemberOptions = (name) => {
    const group = groups.find(g => g.id === viewingGroupId);
    if (!group || !group.admins?.includes(user.uid)) return; // Admin check
    setSelectedMemberName(name);
    setMemberEditName(name);
    setShowMemberMenu(true);
  };
  
  const handleShareApp = async () => {
    try {
      await Share.share({
        message: 'Check out Smart Expense AI! Simplify your bill splitting and group expenses today.',
      });
    } catch (error) {
      showThemeAlert('Error', 'Failed to open share menu');
    }
  };

  const handleChangePassword = async () => {
    try {
      if (user?.email) {
        await sendPasswordResetEmail(auth, user.email);
        showThemeAlert(
          'Email Sent', 
          `A password reset link has been sent to ${user.email}.`
        );
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
            } catch (error) {
              showThemeAlert('Error', 'Failed to log out.');
            }
          }
        }
      ]
    );
  };

  const showGroupMenu = (group) => {
    setSelectedGroup(group);
    setShowOptionsModal(true);
  };

  const renderGroupItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.groupCard}
      onPress={() => {
        setSelectedGroup(item);
        setViewingGroupId(item.id);
      }}
      onLongPress={() => showGroupMenu(item)}
      activeOpacity={0.7}
    >
      <View style={styles.groupIconBox}>
        <Text style={styles.groupIconText}>{item.name.charAt(0).toUpperCase()}</Text>
        <View style={styles.iconNeonBorder} />
      </View>
      <View style={styles.groupInfo}>
        <View style={styles.nameRow}>
          <Text style={styles.groupName}>{item.name.toUpperCase()}</Text>
          {item.admins?.includes(user.uid) && (
            <View style={styles.adminBadgeSmall}>
              <Text style={styles.adminBadgeTextSmall}>ADMIN</Text>
            </View>
          )}
        </View>
        <View style={styles.memberBadge}>
          <Ionicons name="people-outline" size={12} color={colors.primary} />
          <Text style={styles.groupMembers}>{item.members.length} MEMBERS ACTIVE</Text>
        </View>
      </View>
      <View style={styles.chevronBox}>
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
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

  return (
    <>
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <TouchableOpacity 
          style={[styles.headerIconBox, { top: Math.max(insets.top, 20) + 5 }]}
          disabled={!viewingGroupId}
          onPress={() => setViewingGroupId(null)}
        >
           <Ionicons name={viewingGroupId ? "arrow-back" : "people"} size={20} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.headerTextCol}>
           <Text style={styles.headerTitle}>{viewingGroupId ? (selectedGroup?.name?.toUpperCase() || 'GROUP') : 'MY GROUPS'}</Text>
           <Text style={styles.headerSubtitle}>{viewingGroupId ? 'ACTIVITY MONITOR' : 'GROUP NETWORK V1.2'}</Text>
        </View>
        {viewingGroupId && (
          <TouchableOpacity 
            style={[styles.settingsBtn, { top: Math.max(insets.top, 20) + 5, right: 60 }]} 
            onPress={handleLeaveGroup}
          >
            <Ionicons name="log-out-outline" size={22} color={colors.danger} />
          </TouchableOpacity>
        )}
        <TouchableOpacity 
          style={[styles.settingsBtn, { top: Math.max(insets.top, 20) + 5, right: 20 }]} 
          onPress={() => viewingGroupId ? handleCopyID(viewingGroupId) : setShowSettingsModal(true)}
        >
          <Ionicons name={viewingGroupId ? "copy-outline" : "settings-outline"} size={22} color={colors.text} />
        </TouchableOpacity>
      </View>
      <View style={styles.mainWrapper}>

        {!viewingGroupId ? (
          <>
            {/* Triple Action Row (Pill Style - Screenshot 1) */}
            <View style={styles.actionBar}>
              <TouchableOpacity 
                style={[styles.actionPill, activeTab === 'GROUPS' && styles.actionPillActive]}
                onPress={() => setActiveTab('GROUPS')}
              >
                <Text style={[styles.actionPillText, activeTab === 'GROUPS' && styles.actionPillTextActive]}>GROUPS</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.actionPill, activeTab === 'JOIN' && styles.actionPillActive]}
                onPress={() => {
                   setActiveTab('JOIN');
                   setShowJoinModal(true);
                }}
              >
                <Text style={[styles.actionPillText, activeTab === 'JOIN' && styles.actionPillTextActive]}>JOIN GROUP</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.actionPill, activeTab === 'CREATE' && styles.actionPillActive]}
                onPress={() => {
                   setActiveTab('CREATE');
                   setShowModal(true);
                }}
              >
                <Text style={[styles.actionPillText, activeTab === 'CREATE' && styles.actionPillTextActive]}>CREATE GROUP</Text>
              </TouchableOpacity>
            </View>

            {activeTab === 'GROUPS' ? (
              groups.length > 0 ? (
                <FlatList
                  data={groups}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity 
                      style={styles.groupCard}
                      onPress={() => {
                          setSelectedGroup(item);
                          setViewingGroupId(item.id);
                      }}
                      onLongPress={() => showGroupMenu(item)}
                    >
                      <View style={styles.groupIconBox}>
                         <Ionicons name="people" size={24} color="#FFF" />
                      </View>
                      <View style={styles.groupInfo}>
                         <Text style={styles.groupNameText}>{item.name}</Text>
                         <Text style={styles.membersCountText}>{(item.memberEmails?.length || 0) + (item.manualMembers?.length || 0)} MEMBERS LIST</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.3)" />
                    </TouchableOpacity>
                  )}
                  contentContainerStyle={styles.listContent}
                />
              ) : (
                <View style={styles.emptyContainer}>
                  <Ionicons name="people-outline" size={80} color={colors.primary} style={{ opacity: 0.2 }} />
                  <TouchableOpacity 
                     style={{ alignItems: 'center', marginTop: 30 }}
                     onPress={() => setShowModal(true)}
                  >
                     <Text style={[styles.emptyText, { marginTop: 0, marginBottom: 15 }]}>NO ACTIVE GROUP</Text>
                     <Ionicons name="add-circle-outline" size={36} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              )
            ) : activeTab === 'JOIN' ? (
              <View style={[styles.joinInlineContainer, { marginTop: 40 }]}>
                <Ionicons name="enter-outline" size={60} color={colors.primary} style={{ opacity: 0.2, marginBottom: 20 }} />
                <Text style={[styles.emptyText, { marginBottom: 30, textAlign: 'center' }]}>ENTER GROUP ID TO JOIN GROUP</Text>
                
                <View style={[styles.input, { width: '100%', marginBottom: 10, borderColor: 'rgba(255,255,255,0.1)' }]}>
                  <TextInput
                    style={{ color: '#FFF', fontSize: 13, fontWeight: '700' }}
                    placeholder="PASTE GROUP ID HERE..."
                    placeholderTextColor="rgba(255,255,255,0.2)"
                    value={joinGroupId}
                    onChangeText={setJoinGroupId}
                    autoCapitalize="none"
                  />
                </View>

                <TouchableOpacity 
                  style={[styles.saveBtn, { width: '100%' }, !joinGroupId.trim() && styles.saveBtnDisabled]} 
                  onPress={handleJoinGroup}
                  disabled={isJoining || !joinGroupId.trim()}
                >
                  {isJoining ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <>
                      <Ionicons name="log-in" size={20} color="#000" style={{ marginRight: 8 }} />
                      <Text style={styles.saveBtnText}>JOIN NOW</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
               /* CREATE TAB - Fallback or specialized UI */
               <View style={styles.emptyContainer}>
                  <Ionicons name="add-circle-outline" size={80} color={colors.primary} style={{ opacity: 0.2 }} />
                  <TouchableOpacity 
                     style={{ alignItems: 'center', marginTop: 30 }}
                     onPress={() => setShowModal(true)}
                  >
                     <Text style={[styles.emptyText, { marginTop: 0, marginBottom: 15 }]}>START A NEW GROUP</Text>
                     <Ionicons name="rocket-outline" size={36} color={colors.primary} />
                  </TouchableOpacity>
                </View>
            )}
            
          </>
        ) : (
          /* Screenshot 2 Detail View: GROUP DASHBOARD */
           <KeyboardAvoidingView 
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={{ flex: 1 }}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
           >
             <View style={styles.detailContainer}>
             {/* ID and Invite Header */}
             <View style={styles.detailTopActions}>
                <TouchableOpacity 
                   style={styles.idBadgePill} 
                   onPress={async () => {
                      if (selectedGroup?.id) {
                         await Clipboard.setStringAsync(selectedGroup.id);
                         showThemeAlert('COPIED', 'GROUP ID SAVED TO CLIPBOARD');
                      }
                   }}
                >
                   <Ionicons name="copy-outline" size={12} color={colors.primary} style={{ marginRight: 6 }} />
                   <Text style={styles.idBadgeText}>ID: {selectedGroup?.id?.toUpperCase()}</Text>
                </TouchableOpacity>
                 <TouchableOpacity style={styles.inviteFriendBtn} onPress={handleShareGroup}>
                    <Ionicons name="share-social-outline" size={16} color="#FFF" />
                    <Text style={styles.inviteFriendText}>INVITE FRIEND</Text>
                 </TouchableOpacity>
             </View>

             {activeSubTab === 'MEMBERS' && (
                 <View style={[styles.inviteBox, { marginBottom: 15, marginTop: 10 }]}>
                    <TextInput
                      style={styles.inviteInput}
                      placeholder="ENTER MEMBER NAME..."
                      placeholderTextColor="rgba(255,255,255,0.2)"
                      value={memberInput}
                      onChangeText={setMemberInput}
                      onSubmitEditing={handleAddMemberName}
                    />
                    <TouchableOpacity style={styles.inviteBtn} onPress={handleAddMemberName}>
                       <Ionicons name="person-add" size={16} color="#000" />
                    </TouchableOpacity>
                 </View>
              )}

              {/* Total Expense Summary Card - Only visible in EXPENSES tab */}
              {activeSubTab === 'EXPENSES' && (
                 <View style={styles.summaryCard}>
                    <View style={styles.summaryHeader}>
                       <Text style={styles.summaryLabel}>TOTAL GROUP EXPENSE</Text>
                       <Ionicons name="wallet-outline" size={20} color={myBalance >= 0 ? colors.primary : colors.danger} />
                    </View>
                    <Text style={styles.totalAmountText}>₹{totalGroupExpense.toFixed(0)}</Text>
                    
                    <View style={styles.contributionsArea}>
                       <Text style={styles.subLabel}>YOUR STATUS</Text>
                     <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                        <View style={[styles.contributionPill, { borderColor: myBalance >= 0 ? colors.primary + '40' : colors.danger + '40', borderWidth: 1, flex: 1, marginRight: 10, paddingVertical: 10 }]}>
                           <Text style={[styles.contributionText, { color: myBalance >= 0 ? '#FFF' : colors.danger, fontSize: 11, fontWeight: '700' }]}>
                             {myBalance >= 0 ? `SURPLUS: +₹${myBalance.toFixed(0)}` : `OWED: -₹${Math.abs(myBalance).toFixed(0)}`}
                           </Text>
                        </View>

                        <TouchableOpacity 
                           style={{ 
                              flexDirection: 'row', 
                              alignItems: 'center', 
                              backgroundColor: colors.primary, 
                              paddingHorizontal: 15, 
                              height: 40,
                              borderRadius: 12,
                              gap: 6
                           }} 
                           onPress={() => {
                             setEditingExpenseId(null);
                             setNewExpense({ name: '', amount: '', category: 'GENERAL', location: '' });
                             setShowExpenseModal(true);
                           }}
                        >
                           <Ionicons name="add" size={20} color="#000" />
                           <Text style={{ color: '#000', fontWeight: '900', fontSize: 11 }}>ADD</Text>
                        </TouchableOpacity>
                     </View>
                     </View>

                    <TouchableOpacity 
                       style={styles.settlementBtn} 
                       onPress={() => setShowSettlementSummary(true)}
                    >
                       <Ionicons name="swap-horizontal" size={18} color="rgba(255,255,255,0.6)" />
                       <Text style={styles.settlementBtnText}>VIEW FINAL SETTLEMENT</Text>
                    </TouchableOpacity>
                 </View>
              )}

             {/* Sub Tabs: EXPENSES vs MEMBERS vs SETTLEMENTS */}
             <View style={styles.subTabsRow}>
                <TouchableOpacity 
                   style={[styles.subTabItem, activeSubTab === 'MEMBERS' && styles.subTabActive]}
                   onPress={() => setActiveSubTab('MEMBERS')}
                >
                   <Text style={[styles.subTabText, activeSubTab === 'MEMBERS' && styles.subTabTextActive]}>MEMBERS</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.subTabItem, activeSubTab === 'EXPENSES' && styles.subTabActive]}
                  onPress={() => setActiveSubTab('EXPENSES')}
                >
                   <Text style={[styles.subTabText, activeSubTab === 'EXPENSES' && styles.subTabTextActive]}>EXPENSES</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.subTabItem, activeSubTab === 'SETTLEMENTS' && styles.subTabActive]}
                  onPress={() => setActiveSubTab('SETTLEMENTS')}
                >
                   <Text style={[styles.subTabText, activeSubTab === 'SETTLEMENTS' && styles.subTabTextActive]}>SETTLEMENTS</Text>
                </TouchableOpacity>
             </View>

             {activeSubTab === 'EXPENSES' ? (
                <>
                   <View style={styles.activityHeaderRow}>
                      <Text style={styles.activityLabel}>GROUP ACTIVITY</Text>
                   </View>
                   <FlatList
                      data={expenses}
                      keyExtractor={(item) => item.id}
                      renderItem={({ item }) => (
                         <View style={styles.expenseEntryCard}>
                            <View style={styles.expenseMainInfo}>
                               <View style={styles.expenseTextStack}>
                                  <View style={styles.categoryBadge}>
                                     <Text style={styles.categoryBadgeText}>{item.category || 'GENERAL'}</Text>
                                  </View>
                                  <Text style={styles.expenseTitle}>{item.name}</Text>
                                  <View style={styles.expenseMeta}>
                                     <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.4)" />
                                     <Text style={styles.metaText}>{item.location || 'NONE'}</Text>
                                     <View style={{width:10}} />
                                     <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.4)" />
                                     <Text style={styles.metaText}>{item.createdAt?.toDate ? item.createdAt.toDate().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'JUST NOW'}</Text>
                                  </View>
                               </View>
                               <Text style={styles.entryAmount}>₹{item.amount}</Text>
                            </View>
                            <View style={styles.expenseFooter}>
                               <View style={styles.paidByBox}>
                                  <View style={[styles.paidByIcon, { backgroundColor: item.paidBy === user.uid ? colors.primary : '#333' }]}><Text style={{color:item.paidBy === user.uid ? '#000':'#FFF', fontSize:8}}>{item.paidByEmail?.charAt(0).toUpperCase() || '?'}</Text></View>
                                  <Text style={styles.paidByLabel}>{item.paidBy === user.uid ? 'PAID BY ME' : `PAID BY ${item.paidByEmail?.split('@')[0].toUpperCase()}`}</Text>
                               </View>
                               <View style={styles.entryActionsRow}>
                                  {item.paidBy === user.uid && (
                                    <>
                                      <TouchableOpacity onPress={() => {
                                        setEditingExpenseId(item.id);
                                        setNewExpense({
                                          name: item.name,
                                          amount: String(item.amount),
                                          category: item.category || 'GENERAL',
                                          location: item.location || ''
                                        });
                                        setShowExpenseModal(true);
                                      }}>
                                        <Ionicons name="create-outline" size={18} color="rgba(255,255,255,0.3)" />
                                      </TouchableOpacity>
                                      <TouchableOpacity onPress={() => handleDeleteExpense(item.id)}>
                                        <Ionicons name="trash-outline" size={18} color="rgba(255,255,255,0.3)" />
                                      </TouchableOpacity>
                                    </>
                                  )}
                               </View>
                            </View>
                         </View>
                      )}
                      contentContainerStyle={{ paddingBottom: 100 }}
                      showsVerticalScrollIndicator={false}
                   />
                </>
             ) : activeSubTab === 'MEMBERS' ? (
                /* Member Management UI inside Group Detail */
                <View style={styles.membersDetailView}>
                   
                   <FlatList
                      style={{ flex: 1 }}
                      data={[...((groups.find(g => g.id === viewingGroupId))?.memberEmails || []), ...((groups.find(g => g.id === viewingGroupId))?.manualMembers || [])]}
                      keyExtractor={(item, index) => `${item}-${index}`}
                      renderItem={({ item }) => (
                         <TouchableOpacity 
                           style={styles.memberListItemCompact} 
                           onLongPress={() => showMemberOptions(item)}
                           activeOpacity={0.6}
                         >
                            <View style={styles.memberInfoRow}>
                               <View style={styles.memberIconSide}><Ionicons name="person" size={14} color="#FFF" /></View>
                               <Text style={styles.memberEntryName}>{item.includes('@') ? item.split('@')[0].toUpperCase() : item}</Text>
                            </View>
                         </TouchableOpacity>
                      )}
                   />
                </View>
             ) : (
                /* SETTLEMENTS TAB */
                <View style={styles.settlementsContainer}>
                   {settlementList.length > 0 ? (
                      <FlatList
                         data={settlementList}
                         keyExtractor={(item, index) => `${item.from}-${item.to}-${index}`}
                         renderItem={({ item }) => (
                            <View style={styles.settlementCard}>
                               <View style={styles.settlementMain}>
                                  <View style={styles.settlementNameBox}>
                                     <Text style={styles.settlementFrom}>{item.from}</Text>
                                     <Ionicons name="arrow-forward" size={16} color={colors.primary} style={{ marginHorizontal: 12 }} />
                                     <Text style={styles.settlementTo}>{item.to}</Text>
                                  </View>
                                  <View style={styles.settlementAmountBox}>
                                     <Text style={styles.settlementAmount}>₹{item.amount}</Text>
                                  </View>
                               </View>
                               <TouchableOpacity 
                                 style={styles.settleActionBtn}
                                 onPress={() => handleSettleUp(item.from, item.to, item.amount)}
                               >
                                 <Text style={styles.settleActionText}>SETTLE</Text>
                               </TouchableOpacity>
                            </View>
                         )}
                         contentContainerStyle={{ paddingBottom: 100 }}
                      />
                   ) : (
                      <View style={styles.emptySettlementBox}>
                         <Ionicons name="heart-outline" size={60} color={colors.primary} style={{ opacity: 0.2 }} />
                         <Text style={styles.emptySettlementText}>ALL ACCOUNTS BALANCED</Text>
                         <Text style={styles.emptySettlementSub}>NO PENDING PAYMENTS</Text>
                      </View>
                   )}
                </View>
             )}
                </View>
             </KeyboardAvoidingView>
          )}
      
      {/* Expense Modal (Add Expense logic) */}
      <Modal visible={showExpenseModal} animationType="slide" transparent={true}>
         <View style={styles.modalOverlay}>
            <View style={styles.modalGlassCard}>
               <Text style={styles.modalTitle}>{editingExpenseId ? 'EDIT EXPENSE' : 'LOG EXPENSE'}</Text>
               <TextInput 
                  style={styles.modalInput} 
                  placeholder="WHAT FOR? (TEA, CAB, ETC)" 
                  placeholderTextColor="#666"
                  value={newExpense.name}
                  onChangeText={(val) => setNewExpense(prev => ({...prev, name: val}))}
               />
               <TextInput 
                  style={styles.modalInput} 
                  placeholder="AMOUNT (₹)" 
                  keyboardType="numeric"
                  placeholderTextColor="#666"
                  value={newExpense.amount}
                  onChangeText={(val) => setNewExpense(prev => ({...prev, amount: val}))}
               />
               <TextInput 
                  style={styles.modalInput} 
                  placeholder="LOCATION (OPTIONAL)" 
                  placeholderTextColor="#666"
                  value={newExpense.location}
                  onChangeText={(val) => setNewExpense(prev => ({...prev, location: val}))}
               />
               <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.modalCancel} onPress={() => setShowExpenseModal(false)}>
                     <Text style={{color:'#FFF'}}>CANCEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.modalConfirm} onPress={handleAddExpense}>
                     <Text style={{color:'#000', fontWeight:'bold'}}>{editingExpenseId ? 'UPDATE' : 'ADD'}</Text>
                  </TouchableOpacity>
               </View>
            </View>
         </View>
      </Modal>

      {/* Create Group Modal */}
      <Modal visible={showModal} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalGlassCard}>
            <View style={[styles.modalHeader, { justifyContent: 'center' }]}>
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.modalTitle}>CREATE GROUP</Text>
                <Text style={styles.modalSubtitle}>FINOVO NETWORK V1.0</Text>
              </View>
              <TouchableOpacity style={[styles.closeModalBtn, { position: 'absolute', right: 0 }]} onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={20} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalInputBox}>
              <Text style={styles.inputLabel}>GROUP IDENTITY NAME</Text>
              <TextInput
                style={styles.input}
                placeholder="EX: TRIP TO GOA, ROOMMATES..."
                placeholderTextColor="rgba(255,255,255,0.2)"
                value={newGroupName}
                onChangeText={setNewGroupName}
                autoFocus
              />
            </View>

            <TouchableOpacity 
              style={[styles.saveBtn, !newGroupName.trim() && styles.saveBtnDisabled]} 
              onPress={handleCreateGroup}
              disabled={isCreating || !newGroupName.trim()}
            >
              {isCreating ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#000" style={{ marginRight: 8 }} />
                  <Text style={styles.saveBtnText}>CREATE GROUP</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Join Group Modal */}
      <Modal visible={showJoinModal} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalGlassCard}>
            <View style={[styles.modalHeader, { justifyContent: 'center' }]}>
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.modalTitle}>JOIN GROUP</Text>
                <Text style={styles.modalSubtitle}>ENTER ACCESS CODE</Text>
              </View>
              <TouchableOpacity style={[styles.closeModalBtn, { position: 'absolute', right: 0 }]} onPress={() => setShowJoinModal(false)}>
                <Ionicons name="close" size={20} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalInputBox}>

              <TextInput
                style={styles.input}
                placeholder="PASTE GROUP ID HERE..."
                placeholderTextColor="rgba(255,255,255,0.2)"
                value={joinGroupId}
                onChangeText={setJoinGroupId}
                autoFocus
                autoCapitalize="none"
              />
            </View>

            <TouchableOpacity 
              style={[styles.saveBtn, !joinGroupId.trim() && styles.saveBtnDisabled]} 
              onPress={handleJoinGroup}
              disabled={isJoining || !joinGroupId.trim()}
            >
              {isJoining ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Ionicons name="log-in" size={20} color="#000" style={{ marginRight: 8 }} />
                  <Text style={styles.saveBtnText}>JOIN NOW</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* GROUP Options Modal (Custom Replacement for OS Alert) */}
      <Modal visible={showOptionsModal} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalGlassCard, { backgroundColor: '#1A1A1A', borderColor: 'rgba(255,255,255,0.1)' }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{selectedGroup?.name?.toUpperCase()}</Text>
                <Text style={styles.modalSubtitle}>GROUP ID: {selectedGroup?.id}</Text>
              </View>
              <TouchableOpacity style={styles.closeModalBtn} onPress={() => setShowOptionsModal(false)}>
                <Ionicons name="close" size={20} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            <View style={{ gap: 12, marginTop: 10 }}>
               { (selectedGroup?.admins?.includes(user.uid) || selectedGroup?.createdBy === user.uid) && (
                  <>
                     <TouchableOpacity 
                        style={[styles.saveBtn, { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }]} 
                        onPress={() => {
                           setShowOptionsModal(false);
                           setEditGroupName(selectedGroup.name);
                           setShowEditModal(true);
                        }}
                     >
                        <Ionicons name="create-outline" size={20} color={colors.primary} style={{ marginRight: 10 }} />
                        <Text style={[styles.saveBtnText, { color: '#FFF' }]}>EDIT GROUP NAME</Text>
                     </TouchableOpacity>

                     <TouchableOpacity 
                        style={[styles.saveBtn, { backgroundColor: 'rgba(255,100,100,0.1)', borderWidth: 1, borderColor: 'rgba(255,100,100,0.2)' }]} 
                        onPress={() => {
                           setShowOptionsModal(false);
                           handleDeleteGroup(selectedGroup.id);
                        }}
                     >
                        <Ionicons name="trash-outline" size={20} color={colors.danger} style={{ marginRight: 10 }} />
                        <Text style={[styles.saveBtnText, { color: colors.danger }]}>DELETE GROUP</Text>
                     </TouchableOpacity>
                  </>
               )}
            </View>
          </View>
        </View>
      </Modal>
 
       {/* MEMBER Options Modal (Edit/Remove) */}
       <Modal visible={showMemberMenu} animationType="fade" transparent={true}>
         <View style={styles.modalOverlay}>
           <View style={[styles.modalGlassCard, { backgroundColor: '#1A1A1A', borderColor: 'rgba(255,255,255,0.1)' }]}>
             <View style={styles.modalHeader}>
               <View>
                 <Text style={styles.modalTitle}>{selectedMemberName?.toUpperCase()}</Text>
                 <Text style={styles.modalSubtitle}>MEMBER OPTIONS</Text>
               </View>
               <TouchableOpacity style={styles.closeModalBtn} onPress={() => setShowMemberMenu(false)}>
                 <Ionicons name="close" size={20} color="rgba(255,255,255,0.5)" />
               </TouchableOpacity>
             </View>
 
             <View style={{ gap: 12, marginTop: 10 }}>
                { !selectedMemberName?.includes('@') && (
                   <TouchableOpacity 
                      style={[styles.saveBtn, { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }]} 
                      onPress={() => setShowMemberEditModal(true)}
                   >
                      <Ionicons name="create-outline" size={20} color={colors.primary} style={{ marginRight: 10 }} />
                      <Text style={[styles.saveBtnText, { color: '#FFF' }]}>EDIT NAME</Text>
                   </TouchableOpacity>
                )}
 
                <TouchableOpacity 
                   style={[styles.saveBtn, { backgroundColor: 'rgba(255,100,100,0.1)', borderWidth: 1, borderColor: 'rgba(255,100,100,0.2)' }]} 
                   onPress={() => {
                      showThemeAlert(
                        'REMOVE MEMBER',
                        `ARE YOU SURE YOU WANT TO REMOVE ${selectedMemberName}?`,
                        [
                          { text: 'CANCEL', style: 'cancel' },
                          { text: 'REMOVE', style: 'destructive', onPress: () => handleRemoveMember(selectedMemberName) }
                        ]
                      );
                   }}
                >
                   <Ionicons name="trash-outline" size={20} color={colors.danger} style={{ marginRight: 10 }} />
                   <Text style={[styles.saveBtnText, { color: colors.danger }]}>REMOVE MEMBER</Text>
                </TouchableOpacity>
             </View>
           </View>
         </View>
       </Modal>
 
       {/* Member Edit Name Modal */}
       <Modal visible={showMemberEditModal} animationType="fade" transparent={true}>
         <View style={styles.modalOverlay}>
           <View style={styles.modalGlassCard}>
             <View style={styles.modalHeader}>
               <View>
                 <Text style={styles.modalTitle}>EDIT MEMBER</Text>
                 <Text style={styles.modalSubtitle}>UPDATE DISPLAY NAME</Text>
               </View>
               <TouchableOpacity style={styles.closeModalBtn} onPress={() => setShowMemberEditModal(false)}>
                 <Ionicons name="close" size={20} color="rgba(255,255,255,0.5)" />
               </TouchableOpacity>
             </View>
             
             <View style={styles.modalInputBox}>
               <Text style={styles.inputLabel}>NEW DISPLAY NAME</Text>
               <TextInput
                 style={styles.modalInput}
                 placeholder="ENTER NEW NAME"
                 placeholderTextColor="#666"
                 value={memberEditName}
                 onChangeText={setMemberEditName}
                 autoCapitalize="characters"
               />
             </View>
 
             <TouchableOpacity 
               style={[styles.saveBtn, !memberEditName.trim() && styles.saveBtnDisabled]} 
               onPress={handleUpdateMemberName}
               disabled={isActing || !memberEditName.trim()}
             >
               {isActing ? (
                 <ActivityIndicator color="#000" />
               ) : (
                 <>
                   <Ionicons name="checkmark-circle" size={20} color="#000" style={{ marginRight: 8 }} />
                   <Text style={styles.saveBtnText}>SAVE CHANGES</Text>
                 </>
               )}
             </TouchableOpacity>
          </View>
        </View>
      </Modal>

        {/* Settlement Summary Modal (Premium Dark Box) */}
        <Modal visible={showSettlementSummary} animationType="fade" transparent={true}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalGlassCard, { backgroundColor: '#1A1A1A', borderColor: 'rgba(255,255,255,0.1)', height: '85%', width: '90%', alignSelf: 'center' }]}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>FINAL SETTLEMENT</Text>
                  <Text style={styles.modalSubtitle}>GROUP BALANCE SHEET</Text>
                </View>
                <TouchableOpacity style={styles.closeModalBtn} onPress={() => setShowSettlementSummary(false)}>
                  <Ionicons name="close" size={20} color="rgba(255,255,255,0.5)" />
                </TouchableOpacity>
              </View>
  
              <View style={{ gap: 12 }}>
                 <View style={[styles.settlementAmountBox, { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14 }]}>
                    <Text style={[styles.subTabText, { fontSize: 10, letterSpacing: 1 }]}>TOTAL GROUP EXPENSE</Text>
                    <Text style={[styles.settlementAmount, { color: '#FFF', fontSize: 16 }]}>₹{totalGroupExpense.toFixed(0)}</Text>
                 </View>
 
                 <View style={[styles.settlementAmountBox, { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14 }]}>
                    <Text style={[styles.subTabText, { fontSize: 10, letterSpacing: 1 }]}>FAIR SHARE (PER HEAD)</Text>
                    <Text style={[styles.settlementAmount, { color: colors.primary, fontSize: 16 }]}>₹{fairShare.toFixed(0)}</Text>
                 </View>

                 <View style={{ marginTop: 10, height: 380 }}>
                    <Text style={[styles.modalSubtitle, { marginBottom: 15, textAlign: 'center', opacity: 0.5, fontSize: 10 }]}>MEMBER CONTRIBUTIONS</Text>
                    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                       {memberTotals.map((m, idx) => {
                          const isMe = m.name === (user.email?.split('@')[0].toUpperCase());
                          return (
                            <View key={idx} style={[styles.settlementAmountBox, { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, marginBottom: 12, borderColor: isMe ? colors.primary + '40' : 'rgba(255,255,255,0.05)' }]}>
                               <Text style={[styles.subTabText, { fontSize: 10, letterSpacing: 1, color: isMe ? colors.primary : 'rgba(255,255,255,0.6)' }]}>
                                  {m.name} {isMe ? '(YOU)' : ''}
                               </Text>
                               <Text style={[styles.settlementAmount, { color: '#FFF', fontSize: 15 }]}>₹{m.amount.toFixed(0)}</Text>
                            </View>
                          );
                       })}
                    </ScrollView>
                 </View>

              </View>
            </View>
          </View>
        </Modal>
 
       {/* Edit Name Modal */}
      <Modal visible={showEditModal} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalGlassCard}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>EDIT IDENTITY</Text>
                <Text style={styles.modalSubtitle}>RENAME YOUR GROUP</Text>
              </View>
              <TouchableOpacity style={styles.closeModalBtn} onPress={() => setShowEditModal(false)}>
                <Ionicons name="close" size={20} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.modalInputBox}>
              <Text style={styles.inputLabel}>NEW GROUP NAME</Text>
              <TextInput
                style={styles.input}
                value={editGroupName}
                onChangeText={setEditGroupName}
                autoFocus
              />
            </View>

            <TouchableOpacity 
              style={[styles.saveBtn, !editGroupName.trim() && styles.saveBtnDisabled]} 
              onPress={handleEditName}
              disabled={isActing || !editGroupName.trim()}
            >
              {isActing ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.saveBtnText}>UPDATE GROUP</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Advanced Manage Members Modal */}
      <Modal visible={showManageModal} animationType="slide" transparent={true}>
         <View style={styles.modalOverlay}>
            <View style={[styles.modalGlassCard, { height: '80%' }]}>
               <View style={styles.modalHeader}>
                 <View>
                   <Text style={styles.modalTitle}>GROUP MANAGEMENT</Text>
                   <Text style={styles.modalSubtitle}>MEMBERS & PRIVILEGES</Text>
                 </View>
                 <TouchableOpacity style={styles.closeModalBtn} onPress={() => setShowManageModal(false)}>
                   <Ionicons name="close" size={20} color="rgba(255,255,255,0.5)" />
                 </TouchableOpacity>
               </View>

               <View style={styles.idBox}>
                  <View>
                     <Text style={styles.idLabel}>GROUP ID (SHARE THIS)</Text>
                     <Text style={styles.idText} numberOfLines={1}>{selectedGroup?.id}</Text>
                  </View>
                  <TouchableOpacity style={styles.copyBtn} onPress={() => showThemeAlert('COPIED', 'ID COPIED TO CLIPBOARD')}>
                     <Ionicons name="copy-outline" size={18} color={colors.primary} />
                  </TouchableOpacity>
               </View>

               {/* Add Member by Name UI */}
               <View style={styles.inviteBox}>
                  <TextInput
                    style={styles.inviteInput}
                    placeholder="ENTER MEMBER NAME..."
                    placeholderTextColor="rgba(255,255,255,0.2)"
                    autoCapitalize="words"
                    value={memberInput}
                    onChangeText={setMemberInput}
                    onSubmitEditing={handleAddMemberName}
                  />
                  <TouchableOpacity style={styles.inviteBtn} onPress={handleAddMemberName}>
                     <Ionicons name="person-add" size={16} color="#000" />
                  </TouchableOpacity>
               </View>

               {(() => {
                 // Derived live data from the synced groups state
                 const liveGroup = groups.find(g => g.id === selectedGroup?.id) || selectedGroup;
                 const displayList = [
                   ...(liveGroup?.memberEmails || []).map(email => ({ email, type: 'ACCOUNT' })),
                   ...(liveGroup?.manualMembers || []).map(name => ({ name, type: 'MANUAL' }))
                 ];

                 return (
                   <FlatList
                     data={displayList}
                     keyExtractor={(item, index) => `${item.email || item.name}-${index}`}
                     renderItem={({ item, index }) => {
                        const isManual = item.type === 'MANUAL';
                        const email = !isManual ? item.email : null;
                        const name = isManual ? item.name : null;
                        
                        const uid = !isManual ? liveGroup.members[liveGroup.memberEmails.indexOf(email)] : null;
                        const isAdmin = !isManual && liveGroup.admins?.includes(uid);
                        const amIAdmin = liveGroup.admins?.includes(user.uid) || liveGroup.createdBy === user.uid;
                        const isMe = !isManual && (uid === user.uid || email === user.email);

                        return (
                          <View style={styles.memberListItem}>
                             <View style={styles.memberInfo}>
                                <Text style={styles.memberEmailText}>{isManual ? name : email.split('@')[0].toUpperCase()}</Text>
                                <Text style={styles.memberSubEmail}>{isManual ? 'MANUAL MEMBER' : email}</Text>
                                {isAdmin && (
                                  <View style={styles.adminBadge}>
                                    <Text style={styles.adminBadgeText}>ADMIN</Text>
                                  </View>
                                )}
                             </View>
                             <View style={styles.memberActions}>
                                {amIAdmin && !isAdmin && !isManual && (
                                  <TouchableOpacity style={styles.actionBtnIcon} onPress={() => handlePromoteMember(uid)}>
                                    <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
                                  </TouchableOpacity>
                                )}
                                {amIAdmin && !isMe && (
                                  <TouchableOpacity 
                                     style={styles.actionBtnIcon} 
                                     onPress={() => {
                                        if (isManual) {
                                           showThemeAlert('REMOVE', `REMOVING ${name}`, [
                                              { text: 'CANCEL' },
                                              { text: 'REMOVE', onPress: async () => {
                                                 await updateDoc(doc(db, 'groups', liveGroup.id), {
                                                    manualMembers: arrayRemove(name)
                                                 });
                                                 setSelectedGroup(prev => ({
                                                    ...prev,
                                                    manualMembers: (prev.manualMembers || []).filter(m => m !== name)
                                                 }));
                                              }}
                                           ]);
                                        } else {
                                           handleKickMember(uid, email);
                                        }
                                     }}
                                  >
                                    <Ionicons name="trash" size={20} color={colors.danger} />
                                  </TouchableOpacity>
                                )}
                             </View>
                          </View>
                        );
                     }}
                     showsVerticalScrollIndicator={false}
                   />
                 );
               })()}
            </View>
         </View>
      </Modal>

      {/* Theme Consistant Alert Modal (Replaces White OS Alerts) */}
      <Modal visible={customAlert.visible} animationType="fade" transparent={true}>
         <View style={styles.modalOverlay}>
            <View style={[styles.modalGlassCard, { width: '85%', alignSelf: 'center', padding: 30 }]}>
               <View style={{ alignItems: 'center', marginBottom: 20 }}>
                  <Text style={[styles.modalTitle, { color: colors.primary }]}>{customAlert.title?.toUpperCase()}</Text>
                  <View style={{ height: 1.5, width: 40, backgroundColor: colors.primary + '30', marginTop: 10 }} />
               </View>
               
               <Text style={[styles.modalSubtitle, { fontSize: 13, color: '#FFF', opacity: 0.8, lineHeight: 20, marginBottom: 30 }]}>
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
                              styles.modalCancel, 
                              { 
                                 flex: 1, 
                                 backgroundColor: isDestructive ? 'rgba(255,100,100,0.1)' : isCancel ? 'rgba(255,255,255,0.05)' : colors.primary,
                                 borderColor: isDestructive ? 'rgba(255,100,100,0.2)' : 'rgba(255,255,255,0.1)',
                                 borderWidth: 1
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
                        style={[styles.modalConfirm, { flex: 1 }]} 
                        onPress={() => setCustomAlert(prev => ({ ...prev, visible: false }))}
                     >
                        <Text style={{ color: '#000', fontWeight: 'bold' }}>OK</Text>
                     </TouchableOpacity>
                  )}
               </View>
            </View>
         </View>
      </Modal>

      </View>

      {/* Settings Modal */}
      <Modal visible={showSettingsModal} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
           <View style={styles.modalGlassCard}>
              <View style={styles.modalHeader}>
                 <View>
                   <Text style={styles.modalTitle}>SETTINGS</Text>
                   <Text style={styles.modalSubtitle}>ACCOUNT & OPTIONS</Text>
                 </View>
                 <TouchableOpacity style={styles.closeModalBtn} onPress={() => setShowSettingsModal(false)}>
                    <Ionicons name="close" size={24} color={colors.text} />
                 </TouchableOpacity>
              </View>

              <View style={styles.settingsSection}>
                 <View style={styles.emailContainer}>
                    <Text style={styles.emailLabel}>LOGGED IN AS</Text>
                    <Text style={styles.emailValue}>{user?.email}</Text>
                 </View>

                 <TouchableOpacity style={styles.settingRow} onPress={handleShareApp}>
                    <View style={styles.settingIconBox}>
                       <Ionicons name="share-social-outline" size={20} color={colors.primary} />
                    </View>
                    <Text style={styles.settingRowText}>SHARE APP</Text>
                    <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />
                 </TouchableOpacity>

                 <TouchableOpacity style={styles.settingRow} onPress={handleChangePassword}>
                    <View style={styles.settingIconBox}>
                       <Ionicons name="lock-closed-outline" size={20} color={colors.warning} />
                    </View>
                    <Text style={styles.settingRowText}>CHANGE PASSWORD</Text>
                    <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />
                 </TouchableOpacity>

                 <TouchableOpacity style={[styles.settingRow, { borderBottomWidth: 0 }]} onPress={handleLogout}>
                    <View style={styles.settingIconBox}>
                       <Ionicons name="log-out-outline" size={20} color={colors.danger} />
                    </View>
                    <Text style={[styles.settingRowText, { color: colors.danger }]}>LOGOUT</Text>
                    <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />
                 </TouchableOpacity>
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
    backgroundColor: '#000',
  },
  mainWrapper: {
    flex: 1,
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
  headerIconCircle: {
     width: 36,
     height: 36,
     borderRadius: 18,
     backgroundColor: '#222',
     justifyContent: 'center',
     alignItems: 'center',
     borderWidth: 1,
     borderColor: 'rgba(255,255,255,0.1)',
  },
  initialText: {
     color: '#FFF',
     fontWeight: 'bold',
     fontSize: 14,
  },
  headerTitleCenter: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
    marginTop: 20,
    marginHorizontal: 20,
    backgroundColor: '#111',
    padding: 6,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  actionPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: 'center',
  },
  actionPillActive: {
    backgroundColor: colors.primary,
  },
  actionPillText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  actionPillTextActive: {
    color: '#000',
  },
  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    marginHorizontal: 20, // Standardized to 20
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  groupIconBox: {
    width: 50,
    height: 50,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  groupInfo: {
    flex: 1,
  },
  groupNameText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  membersCountText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  detailContainer: {
     flex: 1,
  },
  detailTopActions: {
     flexDirection: 'row',
     justifyContent: 'space-between',
     marginBottom: 10,
     marginTop: 20,
     marginHorizontal: 20,
  },
  idBadgePill: {
     backgroundColor: 'rgba(255,255,255,0.05)',
     paddingHorizontal: 16,
     paddingVertical: 8,
     borderRadius: 15,
     borderWidth: 1,
     borderColor: 'rgba(255,255,255,0.1)',
  },
  idBadgeText: {
     color: 'rgba(255,255,255,0.6)',
     fontSize: 9,
     fontWeight: '900',
  },
  inviteFriendBtn: {
     flexDirection: 'row',
     alignItems: 'center',
     backgroundColor: 'rgba(255,255,255,0.05)',
     paddingHorizontal: 16,
     paddingVertical: 8,
     borderRadius: 15,
     borderWidth: 1,
     borderColor: 'rgba(255,255,255,0.1)',
     gap: 6,
  },
  inviteFriendText: {
     color: '#FFF',
     fontSize: 9,
     fontWeight: '900',
  },
   inlineIdCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.03)',
      borderRadius: 18,
      padding: 16,
      marginBottom: 10,
      marginHorizontal: 20,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.05)',
   },
  summaryCard: {
     backgroundColor: 'rgba(255,255,255,0.03)',
     borderRadius: 20,
     paddingVertical: 3,
     paddingHorizontal: 24,
     marginBottom: 10,
     borderWidth: 1,
     borderColor: 'rgba(255,255,255,0.08)',
     marginHorizontal: 20,
  },
  summaryHeader: {
     flexDirection: 'row',
     justifyContent: 'space-between',
     marginBottom: 4,
  },
  summaryLabel: {
     color: 'rgba(255,255,255,0.4)',
     fontSize: 10,
     fontWeight: '800',
     letterSpacing: 1,
  },
  totalAmountText: {
     color: '#FFF',
     fontSize: 42,
     fontWeight: '900',
     marginBottom: 8,
  },
  contributionsArea: {
     marginBottom: 10,
  },
  subLabel: {
     color: 'rgba(255,255,255,0.3)',
     fontSize: 9,
     fontWeight: '900',
     marginBottom: 10,
  },
  contributionPill: {
     backgroundColor: 'rgba(255,255,255,0.05)',
     padding: 10,
     borderRadius: 12,
     alignSelf: 'flex-start',
  },
  contributionText: {
     color: '#FFF',
     fontSize: 10,
     fontWeight: '700',
  },
  settlementBtn: {
     flexDirection: 'row',
     alignItems: 'center',
     justifyContent: 'center',
     gap: 10,
     marginTop: 5,
  },
  settlementBtnText: {
     color: 'rgba(255,255,255,0.6)',
     fontSize: 11,
     fontWeight: '900',
     letterSpacing: 0.5,
  },
  subTabsRow: {
     flexDirection: 'row',
     backgroundColor: 'rgba(255,255,255,0.03)',
     borderRadius: 20,
     padding: 4,
     marginBottom: 24,
     marginHorizontal: 20,
  },
  subTabItem: {
     flex: 1,
     paddingVertical: 10,
     alignItems: 'center',
     borderRadius: 10,
  },
  subTabActive: {
     backgroundColor: colors.primary,
  },
  subTabText: {
     color: 'rgba(255,255,255,0.4)',
     fontSize: 10,
     fontWeight: '800',
     letterSpacing: 0.5,
  },
  subTabTextActive: {
     color: '#000',
  },
  settlementsContainer: {
     flex: 1,
  },
  settlementCard: {
     backgroundColor: 'rgba(255,255,255,0.03)',
     borderRadius: 20,
     padding: 20,
     marginBottom: 16,
     marginHorizontal: 20,
     borderWidth: 1,
     borderColor: 'rgba(255,255,255,0.05)',
  },
  settlementMain: {
     flexDirection: 'row',
     justifyContent: 'space-between',
     alignItems: 'center',
     marginBottom: 15,
  },
  settlementNameBox: {
     flexDirection: 'row',
     alignItems: 'center',
     flex: 1,
  },
  settlementFrom: {
     color: '#FFF',
     fontSize: 13,
     fontWeight: '800',
     letterSpacing: 0.5,
  },
  settlementTo: {
     color: '#FFF',
     fontSize: 13,
     fontWeight: '800',
     letterSpacing: 0.5,
  },
  settlementAmountBox: {
     backgroundColor: 'rgba(255,255,255,0.05)',
     paddingHorizontal: 12,
     paddingVertical: 6,
     borderRadius: 10,
     borderWidth: 1,
     borderColor: 'rgba(255,255,255,0.1)',
  },
  settlementAmount: {
     color: colors.primary,
     color: 'rgba(255,100,100,0.6)',
     fontSize: 9,
     fontWeight: '900',
     letterSpacing: 1.5,
     textAlign: 'center',
  },
  emptySettlementBox: {
     alignItems: 'center',
     justifyContent: 'center',
     marginTop: 60,
  },
  emptySettlementText: {
     color: '#FFF',
     fontSize: 14,
     fontWeight: '900',
     marginTop: 20,
     letterSpacing: 1,
  },
  emptySettlementSub: {
     color: 'rgba(255,255,255,0.3)',
     fontSize: 10,
     fontWeight: '700',
     marginTop: 6,
     letterSpacing: 0.5,
  },
  activityHeaderRow: {
     flexDirection: 'row',
     justifyContent: 'center',
     alignItems: 'center',
     marginBottom: 10,
  },
  activityLabel: {
     color: 'rgba(255,255,255,0.4)',
     fontSize: 11,
     fontWeight: '900',
     letterSpacing: 1,
  },
  addExpenseBtn: {
     flexDirection: 'row',
     alignItems: 'center',
     backgroundColor: '#FFF',
     paddingHorizontal: 12,
     paddingVertical: 8,
     borderRadius: 10,
     gap: 4,
  },
  addExpenseText: {
     color: '#000',
     fontSize: 10,
     fontWeight: '900',
  },
  expenseEntryCard: {
     backgroundColor: 'rgba(255,255,255,0.02)',
     borderRadius: 20,
     padding: 16,
     marginBottom: 12,
     marginHorizontal: 20,
     borderWidth: 1,
     borderColor: 'rgba(255,255,255,0.04)',
  },
  expenseMainInfo: {
     flexDirection: 'row',
     justifyContent: 'space-between',
     alignItems: 'flex-start',
     marginBottom: 15,
  },
  expenseTextStack: {
     flex: 1,
  },
  categoryBadge: {
     backgroundColor: 'rgba(255,255,255,0.08)',
     paddingHorizontal: 8,
     paddingVertical: 3,
     borderRadius: 6,
     alignSelf: 'flex-start',
     marginBottom: 8,
  },
  categoryBadgeText: {
     color: 'rgba(255,255,255,0.6)',
     fontSize: 8,
     fontWeight: '900',
  },
  expenseTitle: {
     color: '#FFF',
     fontSize: 18,
     fontWeight: '900',
     marginBottom: 8,
  },
  expenseMeta: {
     flexDirection: 'row',
     alignItems: 'center',
  },
  metaText: {
     color: 'rgba(255,255,255,0.3)',
     fontSize: 9,
     fontWeight: '700',
     marginLeft: 4,
  },
  entryAmount: {
     color: '#FFF',
     fontSize: 20,
     fontWeight: '900',
  },
  expenseFooter: {
     flexDirection: 'row',
     justifyContent: 'space-between',
     alignItems: 'center',
     borderTopWidth: 1,
     borderTopColor: 'rgba(255,255,255,0.05)',
     paddingTop: 12,
  },
  paidByBox: {
     flexDirection: 'row',
     alignItems: 'center',
     gap: 8,
  },
  paidByIcon: {
     width: 18,
     height: 18,
     borderRadius: 9,
     backgroundColor: '#333',
     justifyContent: 'center',
     alignItems: 'center',
  },
  paidByLabel: {
     color: 'rgba(255,255,255,0.4)',
     fontSize: 9,
     fontWeight: '800',
  },
  entryActionsRow: {
     flexDirection: 'row',
     gap: 15,
  },
  backFab: {
     position: 'absolute',
     bottom: 100,
     right: 20,
     width: 56,
     height: 56,
     borderRadius: 28,
     backgroundColor: colors.primary,
     justifyContent: 'center',
     alignItems: 'center',
     shadowColor: '#000',
     shadowOpacity: 0.3,
     shadowRadius: 10,
     elevation: 5,
  },
  modalOverlay: {
     flex: 1,
     backgroundColor: 'rgba(0,0,0,0.85)',
     justifyContent: 'center',
     padding: 24,
  },
  modalGlassCard: {
     backgroundColor: '#121212',
     borderRadius: 25,
     padding: 25,
     borderWidth: 1,
     borderColor: 'rgba(255,255,255,0.1)',
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
  modalSubtitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 4,
    letterSpacing: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
  },
  closeModalBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalInputBox: {
    marginBottom: 30,
  },
  inputLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 9,
    fontWeight: '900',
    marginBottom: 12,
    letterSpacing: 1,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 15,
    padding: 18,
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  membersDetailView: {
     flex: 1,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF',
    paddingVertical: 18,
    borderRadius: 15,
    shadowColor: '#FFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  saveBtnDisabled: {
    opacity: 0.3,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  saveBtnText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  modalInput: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 15,
    padding: 15,
    color: '#FFF',
    marginBottom: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  modalActions: {
     flexDirection: 'row',
     gap: 10,
  },
  modalCancel: {
     flex: 1,
     padding: 15,
     alignItems: 'center',
     borderRadius: 12,
     backgroundColor: '#222',
  },
  modalConfirm: {
     flex: 2,
     padding: 15,
     alignItems: 'center',
     borderRadius: 12,
     backgroundColor: colors.primary,
  },
  inviteBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    padding: 6,
    paddingLeft: 16,
    marginBottom: 24,
    marginHorizontal: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  inviteInput: {
    flex: 1,
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  inviteBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberListItemCompact: {
     backgroundColor: 'rgba(255,255,255,0.03)',
     padding: 16,
     borderRadius: 15,
     marginBottom: 10,
     marginHorizontal: 20,
  },
  memberInfoRow: {
     flexDirection: 'row',
     alignItems: 'center',
     gap: 12,
  },
  memberIconSide: {
     width: 24,
     height: 24,
     borderRadius: 12,
     backgroundColor: 'rgba(255,255,255,0.1)',
     justifyContent: 'center',
     alignItems: 'center',
  },
  memberEntryName: {
     color: '#FFF',
     fontSize: 13,
     fontWeight: '800',
  },
  emptyContainer: {
     flex: 0.8,
     justifyContent: 'center',
     alignItems: 'center',
  },
  emptyText: {
     color: 'rgba(255,255,255,0.2)',
     marginTop: 20,
     fontWeight: '900',
     letterSpacing: 2,
  },
  sponsoredSection: {
     marginTop: 20,
     padding: 15,
     marginHorizontal: 20,
     borderTopWidth: 1,
     borderTopColor: 'rgba(255,255,255,0.05)',
  },
  sponsoredLabel: {
     color: 'rgba(255,255,255,0.2)',
     fontSize: 10,
     fontWeight: '900',
     textAlign: 'center',
     marginBottom: 15,
  },
   memberEntrySubText: {
     color: 'rgba(255,255,255,0.3)',
     fontSize: 8,
     fontWeight: '700',
     marginTop: 2,
  },
  inlineIdCard: {
     flexDirection: 'row',
     alignItems: 'center',
     backgroundColor: 'rgba(255,255,255,0.03)',
     borderRadius: 18,
     padding: 16,
     marginBottom: 10,
     marginHorizontal: 15,
     borderWidth: 1,
     borderColor: 'rgba(255,255,255,0.05)',
  },
  idLabel: {
     color: 'rgba(255,255,255,0.4)',
     fontSize: 8,
     fontWeight: '800',
     letterSpacing: 1,
     marginBottom: 4,
  },
  idSubText: {
     color: '#FFF',
     fontSize: 11,
     fontWeight: '700',
     opacity: 0.8,
  },
  copyBtnPill: {
     flexDirection: 'row',
     alignItems: 'center',
     backgroundColor: colors.primary + '15',
     paddingHorizontal: 12,
     paddingVertical: 6,
     borderRadius: 10,
     gap: 6,
  },
  copyBtnText: {
     color: colors.primary,
     fontSize: 10,
     fontWeight: '900',
  },
  memberListHeader: {
     color: 'rgba(255,255,255,0.3)',
     fontSize: 10,
     fontWeight: '900',
     letterSpacing: 2,
     marginBottom: 15,
     marginTop: 10,
     textAlign: 'center',
  },
  adPlaceholder: {
     flexDirection: 'row',
     alignItems: 'center',
     gap: 15,
     opacity: 0.3,
  },
  adIcon: {
     width: 40,
     height: 40,
     borderRadius: 20,
     backgroundColor: '#222',
     justifyContent: 'center',
     alignItems: 'center',
  },
  adLines: {
     flex: 1,
     gap: 8,
  },
  adLineFull: {
     height: 8,
     width: '100%',
     backgroundColor: '#222',
     borderRadius: 4,
  },
  adLineShort: {
     height: 8,
     width: '60%',
     backgroundColor: '#222',
     borderRadius: 4,
  },
  joinInlineContainer: {
     alignItems: 'center',
     marginHorizontal: 20,
  },
  settingsBtn: {
    position: 'absolute',
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsSection: {
    marginTop: 10,
  },
  emailContainer: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 20,
    borderRadius: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  emailLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 5,
  },
  emailValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  settingIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  settingRowText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  settleActionBtn: {
    backgroundColor: colors.primary + '20',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary + '40',
    marginTop: 10,
    alignItems: 'center',
  },
  settleActionText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
});

export default GroupsScreen;
