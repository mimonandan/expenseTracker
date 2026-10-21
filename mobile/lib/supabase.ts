import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

export const authConfigured = Boolean(url && key);
const sessionStorage = Platform.OS === 'web' ? AsyncStorage : {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

export const supabase = authConfigured ? createClient(url, key, {
  auth: { storage: sessionStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
}) : null;
