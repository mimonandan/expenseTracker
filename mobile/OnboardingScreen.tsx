import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

type Props = {
  name: string;
  income: string;
  error: string;
  busy: boolean;
  onNameChange: (value: string) => void;
  onIncomeChange: (value: string) => void;
  onContinue: () => void;
};

export default function OnboardingScreen({ name, income, error, busy, onNameChange, onIncomeChange, onContinue }: Props) {
  return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.mark}><Text style={styles.markText}>₹</Text></View>
        <Text style={styles.eyebrow}>PAISA PILOT · YOUR STARTING POINT</Text>
        <Text style={styles.title}>Let’s make your money plan yours.</Text>
        <Text style={styles.subtitle}>We’ll use your name for a warm welcome and your monthly take-home income to create a flexible daily guide.</Text>
        <Text style={styles.label}>WHAT SHOULD WE CALL YOU?</Text>
        <TextInput value={name} onChangeText={onNameChange} placeholder="Your name" placeholderTextColor="#A0AAA3" autoCapitalize="words" autoComplete="name" returnKeyType="next" style={styles.input} accessibilityLabel="Your name" />
        <Text style={styles.label}>MONTHLY TAKE-HOME INCOME</Text>
        <View style={styles.moneyInput}><Text style={styles.rupee}>₹</Text><TextInput value={income} onChangeText={onIncomeChange} placeholder="e.g. 100000" placeholderTextColor="#A0AAA3" keyboardType="decimal-pad" style={styles.moneyText} accessibilityLabel="Monthly take-home income" /></View>
        <Text style={styles.note}>Your income and budget settings stay protected on this device. You can change them later in Profile.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} onPress={onContinue} style={[styles.button, busy && styles.buttonDisabled]}>
          <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Create my daily plan'}</Text>
        </Pressable>
        <Text style={styles.privacy}>No bank connection is required. Alert capture is optional and asks for your permission.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F8F5' }, flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 28, maxWidth: 560, width: '100%', alignSelf: 'center' },
  mark: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#E6F4EA', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  markText: { color: '#176B52', fontSize: 27, fontWeight: '800' }, eyebrow: { color: '#176B52', letterSpacing: 1.2, fontSize: 9, fontWeight: '800' },
  title: { color: '#18241F', fontSize: 27, lineHeight: 34, fontWeight: '800', marginTop: 10 }, subtitle: { color: '#738079', fontSize: 13, lineHeight: 20, marginTop: 8, marginBottom: 28 },
  label: { color: '#738079', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 7, marginTop: 14 },
  input: { height: 52, borderRadius: 13, borderWidth: 1, borderColor: '#E4EAE5', backgroundColor: '#FFFFFF', paddingHorizontal: 14, color: '#18241F', fontSize: 15 },
  moneyInput: { height: 56, borderRadius: 13, borderWidth: 1, borderColor: '#E4EAE5', backgroundColor: '#FFFFFF', paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' }, rupee: { color: '#176B52', fontSize: 20, fontWeight: '700', marginRight: 9 }, moneyText: { flex: 1, color: '#18241F', fontSize: 18, fontWeight: '700' },
  note: { color: '#89958D', fontSize: 10, lineHeight: 15, marginTop: 10 }, error: { color: '#AF453D', fontSize: 11, marginTop: 10 },
  button: { height: 52, borderRadius: 14, backgroundColor: '#176B52', alignItems: 'center', justifyContent: 'center', marginTop: 24 }, buttonDisabled: { opacity: 0.65 }, buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  privacy: { color: '#929D96', fontSize: 9, lineHeight: 14, textAlign: 'center', marginTop: 17 },
});
