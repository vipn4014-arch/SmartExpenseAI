import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, Alert, FlatList, Image, Dimensions, useWindowDimensions, Modal, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import genAI from '../utils/gemini';
import * as ImageManipulator from 'expo-image-manipulator';
import { collection, query, where, getDocs, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../utils/firebase';
import { AuthContext } from '../context/AuthContext';
import { colors } from '../theme/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const AIAgentScreen = () => {
  const { width, height } = useWindowDimensions();
  const isTablet = width > 600;
  const contentWidth = isTablet ? 800 : width;
  
  const { user } = useContext(AuthContext);
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState('SUBSCRIPTION');
  const [isScanning, setIsScanning] = useState(false);
  const [subscriptions, setSubscriptions] = useState([]);
  const [hasScanned, setHasScanned] = useState(false);

  // Bill Auditor State
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState(null);
  const [scannedImage, setScannedImage] = useState(null);
  const [pendingImageBase64, setPendingImageBase64] = useState(null);
  const [customAlert, setCustomAlert] = useState({ visible: false, title: '', message: '', buttons: [] });

  const showThemeAlert = (title, message, buttons = [{ text: 'OK' }]) => {
    setCustomAlert({ visible: true, title, message, buttons });
  };

  // Spending Insight State
  const [spendingInsight, setSpendingInsight] = useState(null);
  const [isLoadingInsight, setIsLoadingInsight] = useState(false);

  useEffect(() => {
    if (user) {
      fetchSpendingInsight();
    }
  }, [user]);

  const fetchSpendingInsight = async () => {
    if (!user) return;
    setIsLoadingInsight(true);
    try {
      const now = new Date();
      // Strictly Last Month
      const lastMonthIndex = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const lastMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

      const q = query(
        collection(db, 'expenses'),
        where('userId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );

      const querySnapshot = await getDocs(q);
      
      const categoryTotals = {};
      let hasLastData = false;
      
      querySnapshot.forEach(doc => {
        const data = doc.data();
        if (!data.createdAt) return;
        
        const createdDate = data.createdAt.toDate();
        const expMonth = createdDate.getMonth();
        const expYear = createdDate.getFullYear();
        
        if (expMonth === lastMonthIndex && expYear === lastMonthYear) {
          hasLastData = true;
          const cat = data.category || 'Other';
          if (!categoryTotals[cat]) categoryTotals[cat] = { total: 0, count: 0 };
          categoryTotals[cat].total += parseFloat(data.amount) || 0;
          categoryTotals[cat].count += 1;
        }
      });

      if (!hasLastData) {
        setSpendingInsight({ no_data: true, period: "LAST MONTH" });
        return;
      }

      // Find max
      let topCategory = null;
      let maxTotal = 0;

      Object.keys(categoryTotals).forEach(cat => {
        if (categoryTotals[cat].total > maxTotal) {
          maxTotal = categoryTotals[cat].total;
          topCategory = {
            name: cat,
            total: maxTotal,
            count: categoryTotals[cat].count,
            period: "LAST MONTH"
          };
        }
      });

      setSpendingInsight(topCategory);
    } catch (error) {
      console.error("Spending Insight Error:", error);
    } finally {
      setIsLoadingInsight(false);
    }
  };

  const scanSubscriptions = async () => {
    if (!user) return;
    setIsScanning(true);
    
    try {
      const q = query(
        collection(db, 'expenses'),
        where('userId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
      
      const querySnapshot = await getDocs(q);
      const allExpenses = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Logic: Group by description and check frequency
      const groups = {};
      allExpenses.forEach(exp => {
        const key = exp.description.toLowerCase().trim();
        if (!groups[key]) groups[key] = [];
        groups[key].push(exp);
      });

      const KNOWN_LEAK_KEYWORDS = ['NETFLIX', 'SPOTIFY', 'PRIME', 'GYM', 'RENT', 'ELECTRICITY', 'BILL', 'INSURANCE', 'YOUTUBE', 'CLOUD', 'ADOBE', 'RECHARGE', 'WIFI', 'INTERNET', 'BROADBAND', 'GAS', 'MAID', 'MILK', 'NEWSPAPER'];

      const detected = [];
      Object.keys(groups).forEach(key => {
        const items = groups[key];
        const descriptionUpper = key.toUpperCase();
        const categoryUpper = (items[0].category || '').toUpperCase();
        
        // Logic: Flag if it repeats (>=3) OR if it matches a known keyword and has at least 2 occurrences for extra certainty
        const isKnownLeak = KNOWN_LEAK_KEYWORDS.some(kw => descriptionUpper.includes(kw));
        
        if (items.length >= 3 || (isKnownLeak && items.length >= 2)) {
          const avgAmount = items.reduce((sum, item) => sum + item.amount, 0) / items.length;
          detected.push({
            name: items[0].description,
            avgAmount: avgAmount,
            count: items.length,
            category: items[0].category
          });
        }
      });

      setSubscriptions(detected);
      setHasScanned(true);
    } catch (error) {
      showThemeAlert("Scan Error", error.message);
    } finally {
      setIsScanning(false);
    }
  };

  const handleScanAndAudit = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        showThemeAlert('Permission Denied', 'Camera access is required to scan bills.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false, // Turn off mandatory editing
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets[0].base64) {
        setScannedImage(result.assets[0].uri);
        setPendingImageBase64(result.assets[0].base64);
        setAuditResult(null); // Clear previous results
      }
    } catch (error) {
      showThemeAlert("Camera Error", error.message);
    }
  };

  const handlePickAndAudit = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showThemeAlert('Permission Denied', 'Gallery access is required to upload bills.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false, // Turn off mandatory editing
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets[0].base64) {
        setScannedImage(result.assets[0].uri);
        setPendingImageBase64(result.assets[0].base64);
        setAuditResult(null); // Clear previous results
      }
    } catch (error) {
      showThemeAlert("Gallery Error", error.message);
    }
  };

  const handleManualCrop = async () => {
    // Re-pick current image with editing enabled
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets[0].base64) {
        setScannedImage(result.assets[0].uri);
        setPendingImageBase64(result.assets[0].base64);
      }
    } catch (error) {
       // Silent fail for image cropping errors
    }
  };

  const handleRotate = async () => {
    if (!scannedImage) return;
    setIsAuditing(true); // Show loader while manipulating
    try {
      const manipResult = await ImageManipulator.manipulateAsync(
        scannedImage,
        [{ rotate: 90 }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      setScannedImage(manipResult.uri);
      setPendingImageBase64(manipResult.base64);
      // Silent fail or handle error UI
    } catch (error) {
      showThemeAlert("ERROR", "FAILED TO ROTATE IMAGE");
    } finally {
      setIsAuditing(false);
    }
  };

  const performBillAudit = async (base64Image) => {
    setIsAuditing(true);
    setAuditResult(null);

    const tryAudit = async (modelName, attempt = 1) => {
      try {
        const model = genAI.getGenerativeModel({ model: modelName }, { apiVersion: 'v1' });
        
        const prompt = `
          You are a professional Forensic Accountant and Senior Bill Auditor. 
          Analyze the provided bill image with 100% strictness. 
          
          MANDATORY AUDIT RULES (Apply these for consistency):
          1. MATH RULE: (Quantity * Unit Price) MUST equal the Line Total. The sum of all line totals + taxes + charges MUST equal the Grand Total. If variance > ₹0.50, flag as HIGH SEVERITY MATH ERROR.
          2. HANDWRITING RULE: If you detect any pen markings, crossed-out numbers, checkmarks, or handwritten overwrites (especially near totals), flag as HIGH SEVERITY FRAUD RISK.
          3. HIDDEN CHARGE RULE: Automatically flag 'Utility Fee', 'Fixed Charge', 'Convenience Fee', or 'Miscellaneous' as HIGH SEVERITY SUSPICIOUS CHARGE in restaurant/shop bills.
          4. SERVICE CHARGE RULE: In India, Service Charge is voluntary. If present, flag as MEDIUM SEVERITY (inform user it is optional).
          5. TAX RULE: Check if GST (CGST/SGST) is calculated correctly based on the subtotal. CGST and SGST must be equal.

          SEVERITY RUBRIC:
          - HIGH: Math errors, Handwriting/Tampering, Arbitrary Fees (Utility/Fixed), Duplicate items.
          - MEDIUM: Optional Service Charges, No GSTIN on a tax bill, Date mismatches.
          - LOW: Small rounding adjustments, minor typos in item names.

          GOALS:
          1. Identify Store Name, Date, and GSTIN.
          2. Extract line items strictly.
          3. Perform the Math Check.
          4. Check Tax Legitimacy (Indian Context).
          5. Provide a clear recommendation on whether to challenge the bill.

          Return ONLY a JSON object. IMPORTANT: Do not use markdown symbols like * or # inside the JSON values. 
          Return this structure:
          {
            "summary": { "name": "...", "date": "...", "total": "..." },
            "status": "clean" | "warning" | "error",
            "overall_assessment": "...",
            "audit_findings": [
              { "type": "math" | "tax" | "tampering" | "hidden_charge", "severity": "low" | "medium" | "high", "message": "...", "is_error": boolean }
            ],
            "math_check": { "is_correct": boolean, "details": "..." },
            "tax_check": { "is_correct": boolean, "details": "..." },
            "recommendation": "..."
          }
        `;

        const result = await model.generateContent([
          prompt,
          {
            inlineData: {
              data: base64Image,
              mimeType: "image/jpeg",
            },
          },
        ]);

        const response = await result.response;
        return response.text();
      } catch (error) {
        // If 503 (High Demand) and we have retries left, wait and try again
        if (error?.message?.includes('503') && attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          return tryAudit(modelName, attempt + 1);
        }
        throw error;
      }
    };

    try {
      let text;
      try {
        // Primary attempt with 1.5-flash (stable)
        text = await tryAudit("gemini-1.5-flash");
      } catch (e) {
        // Fallback (same as primary for now as flash is incredibly fast)
        text = await tryAudit("gemini-1.5-flash");
      }

      let jsonStr = text.trim();
      // Extract only the JSON portion
      const startIdx = jsonStr.indexOf('{');
      const endIdx = jsonStr.lastIndexOf('}');
      if (startIdx !== -1 && endIdx !== -1) {
        jsonStr = jsonStr.substring(startIdx, endIdx + 1);
      }

      // Cleanup common AI escape errors
      jsonStr = jsonStr.replace(/\\\*/g, "*").replace(/\\#/g, "#");
      
      const parsed = JSON.parse(jsonStr);
      
      setAuditResult(parsed);
    } catch (error) {
      console.error("Audit Error:", error);
      showThemeAlert("Audit Error", "AI encountered an issue reading the bill. Please try again or check your connection.");
    } finally {
      setIsAuditing(false);
    }
  };

  const renderSubscriptionItem = ({ item }) => (
    <View style={styles.subCard}>
      <View style={styles.subIconBox}>
        <Ionicons name="repeat" size={20} color={colors.primary} />
      </View>
      <View style={styles.subInfo}>
        <Text style={styles.subName}>{item.name.toUpperCase()}</Text>
        <Text style={styles.subDetails}>{(item.count + ' PAYMENTS DETECTED • ' + item.category).toUpperCase()}</Text>
        <Text style={styles.yearlyProjection}>ESTIMATED YEARLY SPEND: ₹{(item.avgAmount * 12).toFixed(0)}</Text>
      </View>
      <View style={styles.subAmountCol}>
        <Text style={styles.subAmountText}>₹{item.avgAmount.toFixed(0)}</Text>
        <Text style={styles.subFreqText}>/MO</Text>
      </View>
    </View>
  );

  return (
    <>
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <View style={[styles.headerIconBox, { top: Math.max(insets.top, 20) + 5 }]}>
          <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
        </View>
        <View style={styles.headerTextCol}>
          <Text style={[styles.headerTitle, { textAlign: 'center' }]}>YOUR AGENT AI</Text>
          <Text style={[styles.headerSubtitle, { textAlign: 'center' }]}>GUARDIAN ENGINE V1.2</Text>
        </View>
      </View>
      <View style={styles.mainWrapper}>

      {/* Monthly Spending Insight Card (Hidden during scan to save space) */}
      {spendingInsight && !isLoadingInsight && !pendingImageBase64 && (
        <View style={styles.insightCard}>
          <View style={styles.insightIconBox}>
            <Ionicons name={spendingInsight.no_data ? "analytics" : "trending-up"} size={18} color={colors.primary} />
          </View>
          <View style={styles.insightContent}>
            <Text style={styles.insightLabel}>
              SPENDING INSIGHT: {spendingInsight.no_data 
                ? "NO MAJOR SPENDING DETECTED" 
                : `${spendingInsight.name.toUpperCase()} ₹${spendingInsight.total.toFixed(0)} (${spendingInsight.count}X)`
              }
            </Text>
          </View>
        </View>
      )}

      <View style={styles.tabContainer}>
        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'BILL' && styles.tabButtonActive]}
          onPress={() => setActiveTab('BILL')}
        >
          <Text style={[styles.tabText, activeTab === 'BILL' && styles.tabTextActive]}>BILL AUDITOR</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tabButton, activeTab === 'SUBSCRIPTION' && styles.tabButtonActive]}
          onPress={() => setActiveTab('SUBSCRIPTION')}
        >
          <Text style={[styles.tabText, activeTab === 'SUBSCRIPTION' && styles.tabTextActive]}>SUBSCRIPTION AUDIT</Text>
        </TouchableOpacity>
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'SUBSCRIPTION' ? (
          <>
            {!hasScanned ? (
              <View style={styles.actionCard}>
                <View style={styles.centerIconWrap}>
                  <Ionicons name="sparkles" size={24} color={colors.textSecondary} />
                </View>
                <View style={styles.infoAlertBox}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.text} style={{ marginRight: 8 }} />
                  <Text style={styles.infoAlertText}>
                    OUR AI SCANS YOUR RECORDED EXPENSES TO FIND RECURRING LEAKS (NETFLIX, GYM, ETC.).
                  </Text>
                </View>
                <TouchableOpacity 
                  style={styles.primaryButton}
                  onPress={scanSubscriptions}
                  disabled={isScanning}
                >
                  {isScanning ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <>
                      <Ionicons name="sync" size={20} color="#000" style={{ marginRight: 10 }} />
                      <Text style={styles.primaryButtonText}>SCAN RECURRING EXPENSES</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.resultSection}>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultTitle}>Audit Results</Text>
                  <TouchableOpacity onPress={scanSubscriptions}>
                    <Text style={styles.reScanText}>RE-SCAN</Text>
                  </TouchableOpacity>
                </View>

                {subscriptions.length > 0 ? (
                  <>
                    {subscriptions.map((sub, index) => (
                      <View key={index}>
                        {renderSubscriptionItem({ item: sub })}
                      </View>
                    ))}
                    
                    {/* Total Yearly Leak Summary */}
                    <View style={styles.totalLeakCard}>
                      <View style={styles.totalLeakHeader}>
                        <Ionicons name="alert-circle" size={24} color={colors.danger} />
                        <Text style={styles.totalLeakTitle}>TOTAL ESTIMATED YEARLY LEAK</Text>
                      </View>
                      <Text style={styles.totalLeakAmount}>
                        ₹{subscriptions.reduce((sum, sub) => sum + (sub.avgAmount * 12), 0).toLocaleString('en-IN')}
                      </Text>
                      <Text style={styles.totalLeakSub}>STOP THESE RECURRING PAYMENTS TO SAVE MORE</Text>
                    </View>
                  </>
                ) : (
                  <View style={styles.noResultBox}>
                    <Ionicons name="checkmark-circle" size={40} color={colors.success} />
                    <Text style={styles.noResultText}>No major recurring leaks found!</Text>
                  </View>
                )}
              </View>
            )}
          </>
        ) : (
          <View style={styles.billAuditorContent}>
            {auditResult ? (
              <View style={styles.resultContainer}>
                {/* ... existing audit result view ... */}
                <View style={[styles.statusBanner, { 
                  backgroundColor: '#121212',
                  borderColor: auditResult.status === 'error' ? colors.danger : auditResult.status === 'warning' ? '#D97706' : colors.success,
                  borderWidth: 1.5
                }]}>
                  <Ionicons 
                    name={auditResult.status === 'error' ? "alert-circle" : auditResult.status === 'warning' ? "warning" : "checkmark-circle"} 
                    size={24} 
                    color={auditResult.status === 'error' ? colors.danger : auditResult.status === 'warning' ? '#D97706' : colors.success} 
                  />
                  <View style={styles.statusTextCol}>
                    <Text style={[styles.statusTitle, { color: auditResult.status === 'error' ? '#B91C1C' : auditResult.status === 'warning' ? '#92400E' : '#166534' }]}>
                      {auditResult.status.toUpperCase()} DETECTED
                    </Text>
                    <Text style={styles.statusSub}>{auditResult.overall_assessment}</Text>
                  </View>
                </View>

                {/* Bill Metadata */}
                <View style={styles.metadataCard}>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>MERCHANT</Text>
                    <Text style={styles.metaValue}>{auditResult.summary.name}</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.metaLabel}>AMOUNT</Text>
                    <Text style={styles.metaValue}>{auditResult.summary.total}</Text>
                  </View>
                </View>

                {/* Audit Findings */}
                <Text style={styles.sectionTitleSmall}>GUARDIAN AUDIT LOG</Text>
                {auditResult.audit_findings.map((finding, idx) => (
                  <View key={idx} style={[styles.findingCard, { borderLeftColor: finding.severity === 'high' ? colors.danger : finding.severity === 'medium' ? '#D97706' : colors.success }]}>
                    <View style={styles.findingHeader}>
                      <Text style={styles.findingType}>{finding.type.replace('_', ' ').toUpperCase()}</Text>
                      <View style={[styles.severityBadge, { backgroundColor: finding.severity === 'high' ? colors.danger + '20' : finding.severity === 'medium' ? '#D97706' + '20' : colors.success + '20' }]}>
                        <Text style={[styles.severityText, { color: finding.severity === 'high' ? colors.danger : finding.severity === 'medium' ? '#D97706' : colors.success }]}>
                          {finding.severity.toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.findingMsg}>{finding.message.toUpperCase()}</Text>
                  </View>
                ))}

                {/* Final Recommendation */}
                <View style={styles.recommendationCard}>
                   <Ionicons name="bulb-outline" size={24} color={colors.primary} />
                   <View style={{ flex: 1, marginLeft: 15 }}>
                    <Text style={styles.recTitle}>RECOMMENDATION</Text>
                    <Text style={styles.recText}>{auditResult.recommendation.toUpperCase()}</Text>
                   </View>
                </View>

                  <TouchableOpacity 
                     style={styles.reScanBtnLarge}
                     onPress={() => {
                       setAuditResult(null);
                       setScannedImage(null);
                       setPendingImageBase64(null);
                     }}
                  >
                    <Text style={styles.reScanBtnTextLarge}>AUDIT ANOTHER BILL</Text>
                  </TouchableOpacity>

                  {auditResult.status !== 'clean' && (
                    <TouchableOpacity 
                       style={styles.trustOverrideBtn}
                       onPress={() => {
                         showThemeAlert(
                           'TRUST BILL',
                           'BY TRUSTING THIS BILL, YOU ARE MARKING IT AS SAFE MANUALLY. PROCEED?',
                           [
                             { text: 'CANCEL', style: 'cancel' },
                             { 
                               text: 'YES, I TRUST IT', 
                               onPress: () => {
                                 setAuditResult(prev => ({ 
                                   ...prev, 
                                   status: 'clean', 
                                   overall_assessment: 'MANUALLY VERIFIED BY USER • SAFE',
                                   audit_findings: [] 
                                 }));
                               } 
                             }
                           ]
                         );
                       }}
                    >
                      <Ionicons name="shield-outline" size={16} color="rgba(255,255,255,0.4)" />
                      <Text style={styles.trustOverrideText}>I TRUST THIS BILL (OVERRIDE AI)</Text>
                    </TouchableOpacity>
                  )}
                </View>
            ) : pendingImageBase64 ? (
              <View style={styles.previewContainer}>
                <View style={styles.previewHeader}>
                  <Text style={styles.previewTitle}>BILL PREVIEW</Text>
                  <TouchableOpacity onPress={() => { setScannedImage(null); setPendingImageBase64(null); }}>
                    <Ionicons name="close-circle" size={28} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.imageBox}>
                  <Image source={{ uri: scannedImage }} style={styles.previewImage} resizeMode="contain" />
                  
                  {/* Floating Rotate Button */}
                  <TouchableOpacity 
                    style={styles.rotateFloatingBtn} 
                    onPress={handleRotate}
                    disabled={isAuditing}
                  >
                    <Ionicons name="refresh-outline" size={24} color={colors.primary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.previewActions}>
                  <TouchableOpacity 
                    style={styles.primaryButton}
                    onPress={() => performBillAudit(pendingImageBase64)}
                    disabled={isAuditing}
                  >
                    {isAuditing ? (
                      <ActivityIndicator color="#000" />
                    ) : (
                      <>
                        <Ionicons name="shield-checkmark" size={20} color="#000" style={{ marginRight: 10 }} />
                        <Text style={styles.primaryButtonText}>START SMART AUDIT</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 15 }}>
                    <TouchableOpacity 
                      style={[styles.secondaryButton, { flex: 1, marginTop: 0 }]} 
                      onPress={handleManualCrop}
                      disabled={isAuditing}
                    >
                      <Ionicons name="crop" size={18} color={colors.text} style={{ marginRight: 8 }} />
                      <Text style={styles.secondaryButtonText}>CROP / EDIT</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.secondaryButton, { flex: 1, marginTop: 0 }]} 
                      onPress={handlePickAndAudit}
                      disabled={isAuditing}
                    >
                      <Ionicons name="camera-reverse" size={18} color={colors.text} style={{ marginRight: 8 }} />
                      <Text style={styles.secondaryButtonText}>CHANGE</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ) : isAuditing ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.text} />
                <Text style={styles.loadingText}>AI GUARDIAN IS ANALYZING THE BILL...</Text>
                <Text style={styles.loadingSub}>CHECKING MATH, TAXES, AND HIDDEN FEES</Text>
              </View>
            ) : (
              <View style={styles.actionCard}>
                <View style={styles.centerIconWrap}>
                  <Ionicons name="shield-checkmark" size={24} color={colors.textSecondary} />
                </View>
                <View style={styles.infoAlertBox}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.text} style={{ marginRight: 8 }} />
                  <Text style={styles.infoAlertText}>
                    SCAN YOUR BILL TO CATCH HIDDEN CHARGES AND MATH ERRORS.
                  </Text>
                </View>
                <TouchableOpacity 
                  style={styles.primaryButton}
                  onPress={handleScanAndAudit}
                  disabled={isAuditing}
                >
                  {isAuditing ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <>
                      <Ionicons name="scan" size={20} color="#000" style={{ marginRight: 10 }} />
                      <Text style={styles.primaryButtonText}>SCAN BILL</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.secondaryButton, { marginTop: 12, height: 56, justifyContent: 'center', alignItems: 'center' }]}
                  onPress={handlePickAndAudit}
                  disabled={isAuditing}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="images" size={20} color={colors.text} style={{ marginRight: 10 }} />
                    <Text style={styles.secondaryButtonText}>UPLOAD BILL FROM GALLERY</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </ScrollView>
      </View>
    </SafeAreaView>

    {/* Theme Consistant Alert Modal */}
    <Modal visible={customAlert.visible} animationType="fade" transparent={true}>
       <View style={[styles.mainWrapper, { backgroundColor: 'rgba(0,0,0,0.6)', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }]}>
          <View style={[styles.actionCard, { width: '85%', padding: 30, backgroundColor: colors.card }]}>
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
                            styles.primaryButton, 
                            { 
                               flex: 1, 
                               backgroundColor: isCancel ? 'rgba(255,255,255,0.05)' : colors.primary,
                               paddingVertical: 12
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
                      style={[styles.primaryButton, { flex: 1, backgroundColor: colors.primary, paddingVertical: 12 }]} 
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
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
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
  previewContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    marginTop: -10, // Move box up
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  previewTitle: {
    color: '#FFF',
    fontSize: 16, // Slightly smaller
    fontWeight: '900',
    letterSpacing: 2,
  },
  imageBox: {
    width: '100%',
    height: 280, // Reduced from 400 for better fit
    backgroundColor: '#121212',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 15, // Reduced from 20
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  rotateFloatingBtn: {
    position: 'absolute',
    top: 15,
    right: 15,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1.5,
    borderColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  previewActions: {
    width: '100%',
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 22, // Larger font
    fontWeight: '900',
    letterSpacing: 1.5, // Professional spacing
    lineHeight: 26,
    textTransform: 'uppercase',
  },
  headerSubtitle: {
    color: colors.primary, // Using primary color for sub-text
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    marginTop: 2,
  },
  tabContainer: {
    flexDirection: 'row',
    marginBottom: 24,
    marginHorizontal: 20,
    backgroundColor: '#121212',
    borderRadius: 16,
    padding: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  sponsoredSection: {
     marginTop: 20,
     padding: 15,
     marginHorizontal: 20,
     borderTopWidth: 1,
     borderTopColor: 'rgba(255,255,255,0.05)',
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
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '900',
  },
  tabTextActive: {
    color: '#000',
  },
  // Insight Card Styles
  insightCard: {
    backgroundColor: '#121212',
    borderRadius: 20,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 20,
    marginHorizontal: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  insightIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  insightContent: {
    flex: 1,
  },
  insightLabel: {
    color: colors.primary,
    fontSize: 11, // Standardized to 11
    fontWeight: '900',
    letterSpacing: 1, // Restored consistent spacing
    textAlign: 'center',
  },
  insightText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  highlightText: {
    color: colors.primary,
    fontWeight: '800',
  },
  scrollContent: {
    // Standardized to parent padding
    paddingTop: 10,
    paddingBottom: 40,
  },
  actionCard: {
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 22,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    marginHorizontal: 20,
  },
  centerIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
  },
  infoAlertBox: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    padding: 16,
    borderRadius: 14,
    marginBottom: 30,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoAlertText: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    width: '100%',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  resultSection: {
    flex: 1,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    marginHorizontal: 20,
  },
  resultTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  totalLeakCard: {
    backgroundColor: colors.danger + '10',
    borderRadius: 24,
    padding: 24,
    marginTop: 10,
    marginBottom: 30,
    marginHorizontal: 20,
    borderWidth: 2,
    borderColor: colors.danger + '30',
    alignItems: 'center',
  },
  totalLeakHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  totalLeakTitle: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '900',
    marginLeft: 10,
    letterSpacing: 1,
  },
  totalLeakAmount: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '900',
    marginBottom: 8,
  },
  totalLeakSub: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  reScanText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  subCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121212',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    marginHorizontal: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 15,
    elevation: 4,
  },
  subIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  subInfo: {
    flex: 1,
  },
  subName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  subDetails: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  yearlyProjection: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '900',
    marginTop: 6,
    letterSpacing: 0.5,
  },
  subAmountCol: {
    alignItems: 'flex-end',
  },
  subAmountText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  subFreqText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  noResultBox: {
    padding: 40,
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: 20,
  },
  noResultText: {
    color: colors.text,
    marginTop: 15,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  billAuditorBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },
  billAuditorText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 20,
    marginHorizontal: 40,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  // Bill Auditor UI Styles
  billAuditorContent: {
    flex: 1,
  },
// Cleaned up featureList and introContainer styles
  loadingContainer: {
    paddingVertical: 100,
    alignItems: 'center',
  },
  loadingText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
    marginTop: 20,
  },
  loadingSub: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 8,
  },
  resultContainer: {
    flex: 1,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 20,
    marginHorizontal: 20,
  },
  statusTextCol: {
    marginLeft: 15,
    flex: 1,
  },
  statusTitle: {
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 4,
  },
  statusSub: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
  metadataCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 20,
    marginBottom: 24,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  metaLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    width: 80,
    marginTop: 2,
  },
  metaValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    textAlign: 'right',
  },
  sectionTitleSmall: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 16,
    marginLeft: 20,
  },
  findingCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    marginHorizontal: 20,
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  findingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  findingType: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '900',
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  severityText: {
    fontSize: 9,
    fontWeight: '900',
  },
  findingMsg: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  recommendationCard: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    padding: 20,
    borderRadius: 20,
    marginTop: 12,
    marginBottom: 24,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  recTitle: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 6,
  },
  recText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
  },
  reScanBtnLarge: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 40,
    marginHorizontal: 20,
  },
  reScanBtnTextLarge: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  trustOverrideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginBottom: 40,
    marginTop: -20, // Negative margin to bring it closer to Audit another button
    opacity: 0.6,
    gap: 8,
  },
  trustOverrideText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  }
});

export default AIAgentScreen;
