export const translateError = (error) => {
  const code = error?.code || '';
  
  const errorMap = {
    'auth/user-not-found': 'Account not found. Please sign up.',
    'auth/wrong-password': 'Incorrect password. Try again.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/email-already-in-use': 'Email is already registered. Try logging in.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/network-request-failed': 'Network error. Please check your internet.',
    'auth/too-many-requests': 'Too many failed attempts. Try again later.',
    'auth/invalid-credential': 'Invalid email or password. Please try again.',
  };

  return errorMap[code] || error.message || 'An unexpected error occurred.';
};
