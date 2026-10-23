import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { authConfigured, supabase } from './lib/supabase';

WebBrowser.maybeCompleteAuthSession();

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const processedAuthCodes = useRef(new Set<string>());
  const otpVerificationInProgress = useRef(false);

  const exchangeAuthCode = async (url: string) => {
    if (!supabase) return;
    const code = Linking.parse(url).queryParams?.code;
    if (typeof code !== 'string' || !code || processedAuthCodes.current.has(code)) return;
    processedAuthCodes.current.add(code);
    setBusy(true); setError('');
    try {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) setError(exchangeError.message);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Sign-in could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!supabase || Platform.OS === 'web') return;
    const subscription = Linking.addEventListener('url', ({ url }) => { void exchangeAuthCode(url); });
    void Linking.getInitialURL().then((url) => { if (url) return exchangeAuthCode(url); });
    return () => subscription.remove();
  }, []);

  const sendOtp = async () => {
    if (!supabase) return;
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) { setError('Enter a valid email address.'); return; }
    setBusy(true); setError('');
    try {
      const { error: requestError } = await supabase.auth.signInWithOtp({ email: normalized, options: { shouldCreateUser: true, emailRedirectTo: Linking.createURL('auth/callback') } });
      if (requestError) setError(requestError.message); else { setEmail(normalized); setSent(true); }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not send the sign-in code. Check your connection and try again.');
    } finally { setBusy(false); }
  };

  const verifyOtp = async (candidate = otp) => {
    if (!supabase || otpVerificationInProgress.current) return;
    const token = candidate.replace(/\D/g, '').slice(0, 6);
    if (token.length !== 6) { setError('Enter the 6-digit code from your email.'); return; }
    otpVerificationInProgress.current = true;
    setBusy(true); setError('');
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'email' });
      if (verifyError) setError(verifyError.message);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Code verification failed. Please try again.');
    } finally {
      otpVerificationInProgress.current = false;
      setBusy(false);
    }
  };

  const handleOtpChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setOtp(digits);
    if (error) setError('');
    // The OS may offer the email code as an autofill suggestion. Verify as soon
    // as autofill or manual entry supplies all six digits.
    if (digits.length === 6) void verifyOtp(digits);
  };

  const googleSignIn = async () => {
    if (!supabase) return;
    setBusy(true); setError('');
    try {
      const redirectTo = Linking.createURL('auth/callback');
      if (Platform.OS === 'web') {
        const { error: oauthError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
        if (oauthError) setError(oauthError.message);
        return;
      }
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
      if (oauthError || !data.url) { setError(oauthError?.message || 'Google sign-in could not start.'); return; }
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success' && result.url) {
        const code = Linking.parse(result.url).queryParams?.code;
        if (typeof code !== 'string' || !code) { setError('Google sign-in did not return an authorization code. Please try again.'); return; }
        await exchangeAuthCode(result.url);
      }
    } catch (oauthError) {
      setError(oauthError instanceof Error ? oauthError.message : 'Google sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"><View style={styles.card}>
    <View style={styles.mark}><Text style={styles.markText}>₹</Text></View>
    <Text style={styles.brand}>PAISA PILOT</Text>
    <Text style={styles.title}>Your money, in view.</Text>
    <Text style={styles.body}>Log in or create your account to securely track and sync your expenses.</Text>
    {!authConfigured ? <View style={styles.setup}><Text style={styles.setupTitle}>Connect your Supabase project</Text><Text style={styles.setupCopy}>Add the project URL and publishable key to mobile/.env. Copy mobile/.env.example and fill those two public values to enable email OTP and Google sign-in.</Text></View> : <>
      {!sent ? <>
        <Text style={styles.label}>EMAIL ADDRESS</Text>
        <TextInput value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" style={styles.input} />
        <Pressable disabled={busy} onPress={sendOtp} style={styles.primary}>{busy ? <ActivityIndicator color="white" /> : <Text style={styles.primaryText}>Log in with email</Text>}</Pressable>
      </> : <>
        <Text style={styles.label}>6-DIGIT SIGN-IN CODE</Text>
        <Text style={styles.codeHint}>Enter the code we sent to {email}</Text>
        <View style={styles.otpWrap}>
          <View pointerEvents="none" style={styles.otpBoxes}>{Array.from({ length: 6 }, (_, index) => <View key={index} style={[styles.otpBox, otp.length === index && styles.otpBoxActive]}><Text style={styles.otpDigit}>{otp[index] || ''}</Text></View>)}</View>
          <TextInput value={otp} onChangeText={handleOtpChange} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" editable={!busy} accessibilityLabel="Six digit sign-in code" style={styles.otpInput} />
        </View>
        <Text style={styles.codeFoot}>The code verifies automatically when all 6 digits are entered.</Text>
        <Pressable disabled={busy} onPress={() => void verifyOtp(otp)} style={styles.primary}>{busy ? <ActivityIndicator color="white" /> : <Text style={styles.primaryText}>Verify and sign in</Text>}</Pressable>
        <Pressable onPress={() => { setSent(false); setOtp(''); }}><Text style={styles.back}>Use a different email</Text></Pressable>
      </>}
      <View style={styles.separator}><View style={styles.rule} /><Text style={styles.or}>OR</Text><View style={styles.rule} /></View>
      <Pressable disabled={busy} onPress={googleSignIn} style={styles.google}><Text style={styles.googleG}>G</Text><Text style={styles.googleText}>Continue with Google</Text></Pressable>
    </>}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Text style={styles.privacy}>Your reviewed spending is private to your account. Only verified sign-ins can access it.</Text>
  </View></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F8F5' }, keyboard: { flex: 1 }, scroll: { flexGrow: 1, justifyContent: 'center', padding: 20 }, card: { backgroundColor: '#FFFFFF', borderRadius: 26, padding: 24, borderWidth: 1, borderColor: '#E8EDE8', shadowColor: '#20362B', shadowOpacity: .05, shadowRadius: 22, shadowOffset: { width: 0, height: 9 }, elevation: 2 },
  mark: { width: 45, height: 45, borderRadius: 15, backgroundColor: '#E6F4EA', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }, markText: { fontSize: 25, color: '#176B52', fontWeight: '800' }, brand: { color: '#176B52', letterSpacing: 1.5, fontSize: 10, fontWeight: '800' }, title: { color: '#18241F', fontSize: 25, fontWeight: '800', marginTop: 9 }, body: { color: '#738079', fontSize: 13, lineHeight: 19, marginTop: 7, marginBottom: 23 },
  label: { color: '#738079', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 7 }, input: { backgroundColor: '#F8FAF8', borderColor: '#E8EDE8', borderWidth: 1, borderRadius: 12, height: 49, paddingHorizontal: 13, color: '#18241F', marginBottom: 12 }, primary: { height: 49, borderRadius: 12, backgroundColor: '#176B52', alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  separator: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 18 }, rule: { height: 1, backgroundColor: '#E8EDE8', flex: 1 }, or: { color: '#9CA8A1', fontSize: 9, fontWeight: '700' }, google: { height: 49, borderRadius: 12, borderWidth: 1, borderColor: '#DDE4DE', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }, googleG: { color: '#4285F4', fontWeight: '900', fontSize: 17 }, googleText: { color: '#18241F', fontSize: 12, fontWeight: '700' },
  codeHint: { color: '#738079', fontSize: 12, lineHeight: 18, marginTop: -1, marginBottom: 16 }, otpWrap: { height: 56, marginBottom: 7 }, otpBoxes: { flexDirection: 'row', justifyContent: 'space-between', gap: 7 }, otpBox: { flex: 1, height: 53, borderRadius: 12, borderWidth: 1, borderColor: '#E3EAE4', backgroundColor: '#F8FAF8', alignItems: 'center', justifyContent: 'center' }, otpBoxActive: { borderColor: '#176B52', backgroundColor: '#F1F8F3' }, otpDigit: { fontSize: 21, fontWeight: '700', color: '#18241F' }, otpInput: { position: 'absolute', left: 0, right: 0, top: 0, height: 54, opacity: 0.02, color: 'transparent' }, codeFoot: { color: '#8B9890', fontSize: 10, marginBottom: 13 },
  back: { color: '#176B52', fontSize: 11, fontWeight: '700', textAlign: 'center', paddingTop: 12 }, error: { color: '#AF453D', fontSize: 11, lineHeight: 16, marginTop: 12 }, setup: { borderRadius: 13, padding: 15, backgroundColor: '#FFF4D8' }, setupTitle: { color: '#70571F', fontSize: 12, fontWeight: '800' }, setupCopy: { color: '#786B4C', fontSize: 11, lineHeight: 16, marginTop: 5 }, privacy: { color: '#8B9890', fontSize: 9, lineHeight: 14, textAlign: 'center', marginTop: 19 },
});
