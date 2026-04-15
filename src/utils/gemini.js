import { GoogleGenerativeAI } from "@google/generative-ai";

// The API key provided by the user
// IMPORTANT SECURITY NOTE:
// The Gemini API key should be protected. 
// For Production: Use Google Cloud Console to restrict this key to your app's bundle ID.
const API_KEY = "AIzaSyBKLcZoktBBRbW2-DjCdOJrSl_rnhVpmOM"; // Restricted in Google Cloud Console

// Initialize Gemini
const genAI = new GoogleGenerativeAI(API_KEY);

export default genAI;
