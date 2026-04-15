import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ActivityIndicator, Image, Alert, Modal } from 'react-native';
import { Camera, CameraView } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import genAI from '../utils/gemini';

const BillScanScreen = ({ navigation }) => {
  const [hasPermission, setHasPermission] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [processing, setProcessing] = useState(false);
  const cameraRef = useRef(null);
  const [customAlert, setCustomAlert] = useState({ visible: false, title: '', message: '', buttons: [] });

  const showThemeAlert = (title, message, buttons = [{ text: 'OK' }]) => {
    setCustomAlert({ visible: true, title, message, buttons });
  };

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const takePicture = async () => {
    if (cameraRef.current) {
      try {
        const photoData = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: 0.5,
        });
        setPhoto(photoData);
      } catch (error) {
        showThemeAlert("Error", "Failed to capture image.");
      }
    }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showThemeAlert("Permission Denied", "Gallery access is required.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
      base64: true,
    });

    if (!result.canceled) {
      setPhoto(result.assets[0]);
    }
  };

  const processBill = async () => {
    if (!photo || !photo.base64) return;
    setProcessing(true);

    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }, { apiVersion: 'v1' });
      const prompt = `
        Analyze this receipt/bill image and extract the following details in strict JSON format. 
        Do not output any text other than the JSON.
        {
          "amount": (numeric total amount, no currency symbol),
          "description": (short summary of what was bought or the store name),
          "category": (choose ONLY one: "Food", "Transport", "Shopping", "Bills", "Entertainment", "Others")
        }
      `;
      
      const imagePart = {
        inlineData: {
          data: photo.base64,
          mimeType: "image/jpeg"
        },
      };

      const result = await model.generateContent([prompt, imagePart]);
      const responseText = result.response.text();
      
      let parsedData;
      try {
         // Attempt to clean markdown json blocks if Gemini outputs them
         let cleanedStr = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
         parsedData = JSON.parse(cleanedStr);
      } catch (e) {
         throw new Error("Failed to parse AI response");
      }

      setProcessing(false);
      showThemeAlert(
        "AI Scan Result",
        `Amount: ₹${parsedData.amount}\nDescription: ${parsedData.description}\nCategory: ${parsedData.category}`,
        [
          { text: "Cancel", style: "cancel", onPress: () => setPhoto(null) },
          { 
            text: "Save Expense", 
            onPress: () => {
              // Pass the prefilled data to AddExpense Screen!
              navigation.replace('AddExpense', { 
                scannedAmount: String(parsedData.amount),
                scannedDescription: parsedData.description,
                scannedCategory: parsedData.category
              });
            }
          }
        ]
      );
    } catch (error) {
      setProcessing(false);
      showThemeAlert("AI Processing Error", error.message);
      setPhoto(null);
    }
  };

  if (hasPermission === null) {
    return <SafeAreaView style={styles.container}><ActivityIndicator color={colors.primary} /></SafeAreaView>;
  }
  if (hasPermission === false) {
    return <SafeAreaView style={styles.container}><Text style={{color: '#fff'}}>No access to camera</Text></SafeAreaView>;
  }

  return (
    <>
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scan Bill</Text>
        <View style={{ width: 28 }} />
      </View>

      {!photo ? (
        <View style={styles.cameraContainer}>
          <CameraView 
            style={styles.camera} 
            facing="back"
            ref={cameraRef}
          />
          <View style={styles.cameraControls}>
            <TouchableOpacity style={styles.galleryButton} onPress={pickImage}>
              <Ionicons name="images" size={28} color="#fff" />
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
              <View style={styles.captureInner} />
            </TouchableOpacity>

            <View style={{ width: 44 }} /> 
          </View>
        </View>
      ) : (
        <View style={styles.previewContainer}>
          <Image source={{ uri: photo.uri }} style={styles.previewImage} />
          {processing ? (
            <View style={styles.processingOverlay}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.processingText}>Gemini AI is reading your bill...</Text>
            </View>
          ) : (
            <View style={styles.previewControls}>
              <TouchableOpacity style={styles.retakeBtn} onPress={() => setPhoto(null)}>
                <Text style={styles.btnText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.processBtn} onPress={processBill}>
                <Ionicons name="sparkles" size={20} color="#fff" />
                <Text style={[styles.btnText, {marginLeft: 5}]}>Extract Data</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>

    {/* Theme Consistant Alert Modal */}
    <Modal visible={customAlert.visible} animationType="fade" transparent={true}>
       <View style={[styles.container, { backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }]}>
          <View style={[styles.retakeBtn, { width: '85%', padding: 30, backgroundColor: colors.card, height: 'auto', marginRight: 0, alignItems: 'stretch' }]}>
             <View style={{ alignItems: 'center', marginBottom: 20 }}>
                <Text style={[styles.headerTitle, { color: colors.primary, fontSize: 18 }]}>{customAlert.title?.toUpperCase()}</Text>
                <View style={{ height: 1.5, width: 40, backgroundColor: colors.primary + '30', marginTop: 10 }} />
             </View>
             
             <Text style={[styles.btnText, { fontSize: 13, color: '#FFF', opacity: 0.8, lineHeight: 20, marginBottom: 30, textAlign: 'center' }]}>
                {customAlert.message}
             </Text>

             <View style={{ flexDirection: 'row', gap: 12 }}>
                {customAlert.buttons?.map((btn, idx) => {
                   const isCancel = btn.style === 'cancel' || btn.text === 'CANCEL';
                   return (
                      <TouchableOpacity 
                         key={idx}
                         style={[
                            styles.processBtn, 
                            { 
                               flex: 1, 
                               backgroundColor: isCancel ? 'rgba(255,255,255,0.05)' : colors.primary,
                               marginLeft: 0,
                               padding: 12
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
                      style={[styles.processBtn, { flex: 1, backgroundColor: colors.primary, marginLeft: 0 }]} 
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
    fontSize: 20,
    fontWeight: 'bold',
  },
  cameraContainer: {
    flex: 1,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: 'hidden',
  },
  camera: {
    flex: 1,
  },
  cameraControls: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    padding: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  galleryButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    left: '50%',
    marginLeft: -5, // Compensating for the absolute position inside flex row
  },
  captureInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
  },
  previewContainer: {
    flex: 1,
  },
  previewImage: {
    flex: 1,
    resizeMode: 'contain',
  },
  previewControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 20,
    backgroundColor: colors.card,
  },
  retakeBtn: {
    padding: 15,
    backgroundColor: colors.border,
    borderRadius: 12,
    flex: 1,
    marginRight: 10,
    alignItems: 'center',
  },
  processBtn: {
    padding: 15,
    backgroundColor: colors.primary,
    borderRadius: 12,
    flex: 1,
    marginLeft: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingText: {
    color: '#fff',
    marginTop: 20,
    fontWeight: 'bold',
    fontSize: 16,
  }
});

export default BillScanScreen;
