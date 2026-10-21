import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, AppState, Modal, NativeModules, Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import AuthScreen from './AuthScreen';
import { apiConfigured, createTransaction, getMonthlySummary, getTransactions } from './lib/api';
import { authConfigured, supabase } from './lib/supabase';

type Category = 'Groceries' | 'Daily essentials' | 'Dining & outings' | 'Transport' | 'Entertainment' | 'Bills & utilities' | 'Loan & EMI' | 'Shopping' | 'Other';
type Transaction = { id: string; description: string; category: Category; amount: number; date: string; method: string; icon: string; color: string };
type CapturedAlert = { id: string; amount: number; description: string; category?: string; packageName: string; date: string };
type Tab = 'Home' | 'Activity' | 'Insights';

const palette = {
  ink: '#18241F', muted: '#738079', forest: '#176B52', mint: '#E6F4EA', paper: '#F6F8F5', white: '#FFFFFF',
  line: '#E8EDE8', amber: '#F4B942', paleAmber: '#FFF4D8', rose: '#C87564', blue: '#5E82B7', lilac: '#9074AF',
};
const categoryMeta: Record<string, { icon: string; color: string }> = {
  'Groceries': { icon: '🥬', color: '#60A779' }, 'Daily essentials': { icon: '🧴', color: '#8DB5A2' },
  'Dining & outings': { icon: '🍜', color: '#E3A657' }, 'Transport': { icon: '🛺', color: '#7798C7' },
  'Entertainment': { icon: '🎬', color: '#A18BB9' }, 'Bills & utilities': { icon: '💡', color: '#D3A65D' },
  'Loan & EMI': { icon: '🏠', color: '#7F9B91' }, 'Shopping': { icon: '🛍️', color: '#D28D85' }, 'Other': { icon: '✨', color: '#9CA8A1' },
};
const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'short' }).toUpperCase();
const dateLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return `Today · ${date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [authReady, setAuthReady] = useState(!authConfigured);
  const [syncMessage, setSyncMessage] = useState('');
  const [serverInsights, setServerInsights] = useState<{ title: string; body: string }[]>([]);
  const [tab, setTab] = useState<Tab>('Home');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<Category>('Groceries');
  const [hydrated, setHydrated] = useState(false);
  const [captureEnabled, setCaptureEnabled] = useState(false);
  const [pendingAlerts, setPendingAlerts] = useState<CapturedAlert[]>([]);
  const [showCaptureReview, setShowCaptureReview] = useState(false);
  const captureModule = NativeModules.TransactionCapture;

  useEffect(() => {
    AsyncStorage.getItem('paisa-pilot-transactions').then(saved => {
      if (saved) setTransactions(JSON.parse(saved));
    }).catch(() => Alert.alert('Local data unavailable', 'Could not read saved expenses from this device.'))
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.access_token || !apiConfigured) return;
    let active = true;
    const sync = async () => {
      try {
        const saved = await AsyncStorage.getItem('paisa-pilot-transactions');
        const local: Transaction[] = saved ? JSON.parse(saved) : [];
        for (const item of local) {
          await createTransaction(session.access_token, { id: item.id, amount: item.amount, description: item.description, category: item.category, paymentMethod: item.method, date: item.date.slice(0, 10) });
        }
        const [remote, summary] = await Promise.all([getTransactions(session.access_token), getMonthlySummary(session.access_token)]);
        if (active) {
          const mapped = remote.map(row => {
            const name = row.category in categoryMeta ? row.category : 'Other';
            return { id: row.client_ref || String(row.id), description: row.description, category: name as Category, amount: Number(row.amount_paise) / 100,
              date: `${row.transaction_date}T12:00:00`, method: row.payment_method, ...categoryMeta[name] };
          });
          setTransactions(mapped);
          setServerInsights(summary.insights);
          setSyncMessage('Synced to your private account');
        }
      } catch (error: any) { if (active) setSyncMessage(error?.message || 'Sync is unavailable'); }
    };
    sync();
    const channel = supabase?.channel(`spend-${session.user.id}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${session.user.id}`,
    }, () => { Promise.all([getTransactions(session.access_token), getMonthlySummary(session.access_token)]).then(([rows, summary]) => {
      if (active) setTransactions(rows.map(row => {
        const name = row.category in categoryMeta ? row.category : 'Other';
        return { id: row.client_ref || String(row.id), description: row.description, category: name as Category, amount: Number(row.amount_paise) / 100,
          date: `${row.transaction_date}T12:00:00`, method: row.payment_method, ...categoryMeta[name] };
      }));
      if (active) setServerInsights(summary.insights);
    }).catch(() => {}); }).subscribe();
    return () => { active = false; if (channel) supabase?.removeChannel(channel); };
  }, [session?.access_token, session?.user?.id]);
  useEffect(() => {
    if (hydrated) AsyncStorage.setItem('paisa-pilot-transactions', JSON.stringify(transactions)).catch(() =>
      Alert.alert('Could not save', 'Check available storage on your device.'));
  }, [hydrated, transactions]);

  const refreshCapture = async () => {
    if (!captureModule || !authReady) return;
    try {
      const hasAccess = await captureModule.hasAccess();
      const enabled = Boolean(session?.user?.id && hasAccess);
      await captureModule.setCaptureActive?.(enabled);
      setCaptureEnabled(enabled);
      if (enabled) setPendingAlerts(await captureModule.getPendingTransactions());
      else setPendingAlerts([]);
    } catch { /* Capture is optional; manual tracking remains available. */ }
  };
  useEffect(() => {
    refreshCapture();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refreshCapture(); });
    return () => subscription.remove();
  }, [authReady, session?.user?.id]);

  const monthlyTransactions = transactions.filter(item => {
    const date = new Date(item.date);
    const today = new Date();
    return !Number.isNaN(date.getTime()) && date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
  });
  const totals = useMemo(() => monthlyTransactions.reduce<Record<string, number>>((a, t) => ({ ...a, [t.category]: (a[t.category] ?? 0) + t.amount }), {}), [monthlyTransactions]);
  const total = useMemo(() => monthlyTransactions.reduce((sum, t) => sum + t.amount, 0), [monthlyTransactions]);
  const sortedCategories = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const discretionary = (totals['Dining & outings'] ?? 0) + (totals.Entertainment ?? 0) + (totals.Shopping ?? 0);

  const saveExpense = () => {
    if (!session?.access_token) {
      Alert.alert('Sign in required', 'Log in to start tracking expenses.');
      return;
    }
    const value = Number(amount.replace(/,/g, ''));
    if (!description.trim() || !Number.isFinite(value) || value <= 0) {
      Alert.alert('Add a little more detail', 'Enter a description and an amount greater than zero.');
      return;
    }
    const meta = categoryMeta[category];
    const localTransaction: Transaction = { id: `${Date.now()}`, description: description.trim(), category, amount: value, date: new Date().toISOString(), method: 'Manual', ...meta };
    setTransactions([localTransaction, ...transactions]);
    if (session?.access_token && apiConfigured) createTransaction(session.access_token, { id: localTransaction.id, amount: value, description: localTransaction.description, category, paymentMethod: 'Manual', date: localTransaction.date.slice(0, 10) })
      .catch(error => setSyncMessage(error.message || 'Could not sync expense'));
    setDescription(''); setAmount(''); setShowAdd(false);
  };

  const enableCapture = async () => {
    if (Platform.OS !== 'android' || !captureModule) {
      Alert.alert('Android build required', 'Notification capture is available in the Android development build, not Expo Go.');
      return;
    }
    if (await captureModule.hasAccess()) {
      await captureModule.setCaptureActive?.(true);
      setCaptureEnabled(true); setPendingAlerts(await captureModule.getPendingTransactions()); setShowCaptureReview(true); return;
    }
    Alert.alert('Allow transaction alerts?', 'Android notification access can expose notification contents from other apps. Paisa Pilot filters likely debit alerts on this device, stores only matched candidates locally, and asks you to review before tracking them. You can turn access off in Android Settings.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Android settings', onPress: () => captureModule.openSettings() },
    ]);
  };

  const acceptCaptured = async (alert: CapturedAlert) => {
    if (!session?.access_token) {
      Alert.alert('Sign in required', 'Log in before adding captured alerts to your spending.');
      return;
    }
    const description = alert.description || 'Card / UPI purchase';
    const match = alert.category && alert.category in categoryMeta ? alert.category : 'Other';
    const meta = categoryMeta[match];
    setTransactions(current => [{ id: `notification-${alert.id}`, description, category: match as Category, amount: alert.amount,
      date: alert.date, method: 'UPI / card alert', ...meta }, ...current]);
    if (session?.access_token && apiConfigured) createTransaction(session.access_token, { id: `notification-${alert.id}`, amount: alert.amount, description, category: match, paymentMethod: 'UPI / card alert', date: alert.date.slice(0, 10) })
      .catch(error => setSyncMessage(error.message || 'Could not sync expense'));
    try {
      await captureModule?.dismissTransaction(alert.id);
      setPendingAlerts(current => current.filter(item => item.id !== alert.id));
    } catch { Alert.alert('Could not clear alert', 'This expense was added, but its pending alert remains on the device.'); }
  };

  if (!authReady) return <SafeAreaView style={styles.safe} />;
  if (!session) return <AuthScreen />;

  const signOut = async () => {
    try {
      await captureModule?.setCaptureActive?.(false);
      setCaptureEnabled(false);
      setPendingAlerts([]);
      setShowCaptureReview(false);
      const { error } = await supabase!.auth.signOut();
      if (error) Alert.alert('Could not sign out', error.message);
    } catch (error: any) {
      Alert.alert('Could not sign out', error?.message || 'Please try again.');
    }
  };

  const ignoreCaptured = async (alert: CapturedAlert) => {
    try {
      await captureModule?.dismissTransaction(alert.id);
      setPendingAlerts(current => current.filter(item => item.id !== alert.id));
    } catch { Alert.alert('Could not dismiss alert', 'Try again in a moment.'); }
  };

  const Header = () => <View style={styles.header}>
    <View><Text style={styles.eyebrow}>{dateLabel}</Text><Text style={styles.greeting}>Good morning 👋</Text></View>
    <Pressable style={styles.signOutButton} accessibilityRole="button" accessibilityLabel="Sign out" onPress={signOut}><Text style={styles.signOutText}>Sign out</Text></Pressable>
  </View>;

  const TransactionRow = ({ item }: { item: Transaction }) => <View style={styles.transactionRow}>
    <View style={[styles.transactionIcon, { backgroundColor: `${item.color}1C` }]}><Text style={{ fontSize: 21 }}>{item.icon}</Text></View>
    <View style={styles.transactionInfo}><Text style={styles.transactionTitle}>{item.description}</Text><Text style={styles.transactionMeta}>{item.category} · {formatDate(item.date)}</Text></View>
    <View style={styles.amountBlock}><Text style={styles.transactionAmount}>−{money(item.amount)}</Text><Text style={styles.paymentMeta}>{item.method}</Text></View>
  </View>;

  const CategoryBreakdown = () => <View style={styles.card}>
    <View style={styles.cardHeading}><View><Text style={styles.sectionTitle}>Where it goes</Text><Text style={styles.sectionSubtitle}>Your tracked spend by category</Text></View><Text style={styles.monthTag}>{monthLabel}</Text></View>
    {sortedCategories.length === 0 && <Text style={styles.emptyCopy}>Your category breakdown will appear after you add an expense.</Text>}
    {sortedCategories.slice(0, 5).map(([name, value]) => {
      const meta = categoryMeta[name];
      return <View key={name} style={styles.categoryRow}>
        <Text style={styles.categoryIcon}>{meta.icon}</Text><Text style={styles.categoryName}>{name}</Text>
        <View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.max(5, value / Math.max(total, 1) * 100)}%`, backgroundColor: meta.color }]} /></View>
        <Text style={styles.categoryAmount}>{money(value)}</Text>
      </View>;
    })}
    <Pressable style={styles.textButton} onPress={() => setTab('Activity')}><Text style={styles.textButtonLabel}>See all categories  →</Text></Pressable>
  </View>;

  const InsightCard = () => <View style={styles.insightCard}>
    <View style={styles.insightTop}><View style={styles.sparkle}><Text style={{ fontSize: 17 }}>✦</Text></View><Text style={styles.insightLabel}>A THOUGHT FOR YOU</Text><View style={{ flex: 1 }} /><Text style={styles.aiTag}>SMART TIP</Text></View>
    <Text style={styles.insightTitle}>{session && serverInsights.length ? serverInsights[0].title : total === 0 ? 'Your spending story starts here' : discretionary / total > 0.28 ? 'Make room for the fun stuff' : 'Small habits add up'}</Text>
    <Text style={styles.insightBody}>{session && serverInsights.length ? serverInsights[0].body : total === 0 ? 'Add a few expenses to see helpful patterns. Your purchases are your choice; suggestions are only prompts.' : discretionary / total > 0.28
      ? `${Math.round(discretionary / total * 100)}% of your tracked spending is dining, entertainment, and shopping. Try setting a weekly “fun” limit so you can enjoy plans without surprises.`
      : 'A quick look at recurring subscriptions or duplicate purchases can reveal easy savings. Your tracked spending is still building a pattern.'}</Text>
    <Text style={styles.insightFoot}>{session ? 'From your account’s monthly summary · You’re in control' : 'Based on expenses you’ve added · You’re in control'}</Text>
  </View>;

  const Home = () => <>
    <Header />
    <View style={styles.hero}>
      <View style={styles.heroTop}><Text style={styles.heroCaption}>{monthLabel} SPENDING</Text><View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>THIS MONTH</Text></View></View>
      <Text style={styles.heroAmount}>{money(total)}</Text>
      <View style={styles.heroDivider} />
      <View style={styles.heroBottom}><View><Text style={styles.heroFootLabel}>TRANSACTIONS</Text><Text style={styles.heroFootValue}>{transactions.length} tracked</Text></View><View style={styles.heroRight}><Text style={styles.heroFootLabel}>TOP CATEGORY</Text><Text style={styles.heroFootValue}>{sortedCategories[0]?.[0] ?? '—'}</Text></View></View>
      <View style={styles.heroOrb} />
    </View>
    <View style={styles.quickActions}>
      <Pressable onPress={() => setShowAdd(true)} style={styles.primaryAction}><Text style={styles.actionPlus}>＋</Text><Text style={styles.primaryActionLabel}>Add expense</Text></Pressable>
      <Pressable onPress={() => Alert.alert('Import statement', 'Statement import is coming next. For now, add expenses manually to get your insights.')} style={styles.secondaryAction}><Text style={styles.actionIcon}>↥</Text><Text style={styles.secondaryActionLabel}>Import statement</Text></Pressable>
    </View>
    <CategoryBreakdown />
    <InsightCard />
    <View style={styles.card}>
      <View style={styles.cardHeading}><View><Text style={styles.sectionTitle}>Recent activity</Text><Text style={styles.sectionSubtitle}>Your latest expenses</Text></View><Pressable onPress={() => setTab('Activity')}><Text style={styles.textButtonLabel}>See all</Text></Pressable></View>
      {transactions.length ? transactions.slice(0, 4).map(item => <TransactionRow key={item.id} item={item} />) : <Text style={styles.emptyCopy}>No expenses yet. Add one manually or set up notification capture.</Text>}
    </View>
    <Text style={styles.footerNote}>{session ? (apiConfigured ? syncMessage || 'Syncing your private account…' : 'Add EXPO_PUBLIC_API_URL to connect your Node API') : 'Local preview · Sign in to sync expenses across devices'}</Text>
  </>;

  const Activity = () => <>
    <Header /><View style={styles.pageTitle}><Text style={styles.pageHeading}>Your activity</Text><Text style={styles.pageSubheading}>{transactions.length} expenses saved on this device</Text></View>
    <View style={styles.totalStrip}><Text style={styles.totalStripLabel}>TOTAL THIS MONTH</Text><Text style={styles.totalStripValue}>{money(total)}</Text></View>
    <View style={styles.card}>{transactions.length ? transactions.map(item => <TransactionRow key={item.id} item={item} />) : <Text style={styles.emptyCopy}>Your activity will show here when you add expenses.</Text>}</View>
    <CategoryBreakdown />
    <Pressable onPress={() => setShowAdd(true)} style={styles.wideAction}><Text style={styles.primaryActionLabel}>＋   Add an expense</Text></Pressable>
  </>;

  const Insights = () => <>
    <Header /><View style={styles.pageTitle}><Text style={styles.pageHeading}>Gentle money ideas</Text><Text style={styles.pageSubheading}>Small changes, chosen by you.</Text></View>
    <InsightCard />
    <View style={styles.card}><Text style={styles.sectionTitle}>A few places to look</Text><Text style={styles.sectionSubtitle}>Based on what you have tracked so far</Text>
      {[
        { icon: '🔁', title: 'Subscriptions', body: 'Check for services you no longer use or duplicate memberships.' },
        { icon: '🍽️', title: 'Eating out', body: 'Planning one meal at home can make room for an outing you care about.' },
        { icon: '🛒', title: 'Small frequent buys', body: 'Combining a few daily essentials into one planned shop may help.' },
      ].map(item => <View key={item.title} style={styles.ideaRow}><Text style={styles.ideaIcon}>{item.icon}</Text><View style={{ flex: 1 }}><Text style={styles.ideaTitle}>{item.title}</Text><Text style={styles.ideaBody}>{item.body}</Text></View></View>)}
    </View>
    <View style={styles.captureCard}>
      <View style={styles.captureHeader}><Text style={styles.captureIcon}>◉</Text><View style={{ flex: 1 }}><Text style={styles.captureTitle}>UPI & card alerts</Text><Text style={styles.captureSubtitle}>{captureEnabled ? 'On · filtered on this device' : 'Optional Android notification capture'}</Text></View><View style={[styles.captureStatus, captureEnabled && styles.captureStatusOn]}><Text style={[styles.captureStatusText, captureEnabled && styles.captureStatusTextOn]}>{captureEnabled ? 'ON' : 'OFF'}</Text></View></View>
      <Text style={styles.captureBody}>Match bank and payment alerts on this phone, then review them before they enter your spending. Notification access can see other apps’ notification content; matched candidates stay on this device.</Text>
      <View style={styles.captureButtons}><Pressable onPress={enableCapture} style={styles.capturePrimary}><Text style={styles.capturePrimaryText}>{captureEnabled ? 'Review alerts' : 'Set up capture'}</Text></Pressable>{captureEnabled && <Pressable onPress={() => { setCaptureEnabled(false); captureModule?.openSettings(); }} style={styles.captureSecondary}><Text style={styles.captureSecondaryText}>Manage</Text></Pressable>}</View>
      {pendingAlerts.length > 0 && <Text style={styles.pendingNote}>{pendingAlerts.length} possible transaction{pendingAlerts.length === 1 ? '' : 's'} to review</Text>}
    </View>
    <View style={styles.kindNote}><Text style={styles.kindTitle}>No shame, just signals.</Text><Text style={styles.kindBody}>These are simple prompts, not financial advice. Keep the spending that matters to you.</Text></View>
  </>;

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="dark-content" backgroundColor={palette.paper} /><ExpoStatusBar style="dark" />
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {tab === 'Home' ? <Home /> : tab === 'Activity' ? <Activity /> : <Insights />}
    </ScrollView>
    <View style={styles.tabBar}>{([
      ['Home', '⌂'], ['Activity', '◷'], ['Insights', '✧'],
    ] as [Tab, string][]).map(([name, icon]) => <Pressable key={name} onPress={() => setTab(name)} style={styles.tabItem}>
      <Text style={[styles.tabIcon, tab === name && styles.tabIconActive]}>{icon}</Text><Text style={[styles.tabLabel, tab === name && styles.tabLabelActive]}>{name}</Text>
      {tab === name && <View style={styles.tabIndicator} />}
    </Pressable>)}</View>
    <Modal visible={showAdd} animationType="slide" transparent onRequestClose={() => setShowAdd(false)}>
      <View style={styles.modalBackdrop}><View style={styles.sheet}>
        <View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Add an expense</Text><Text style={styles.sheetSubtitle}>A quick note is all you need.</Text></View><Pressable onPress={() => setShowAdd(false)} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable></View>
        <Text style={styles.fieldLabel}>HOW MUCH?</Text><View style={styles.moneyInputWrap}><Text style={styles.rupee}>₹</Text><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#A9B3AD" style={styles.moneyInput} autoFocus /></View>
        <Text style={styles.fieldLabel}>WHAT WAS IT FOR?</Text><TextInput value={description} onChangeText={setDescription} placeholder="e.g. Vegetables from the market" placeholderTextColor="#A9B3AD" style={styles.textInput} />
        <Text style={styles.fieldLabel}>CATEGORY</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryPicker}>{(Object.keys(categoryMeta) as Category[]).map(name => <Pressable onPress={() => setCategory(name)} key={name} style={[styles.categoryChip, category === name && styles.categoryChipSelected]}><Text style={styles.chipIcon}>{categoryMeta[name].icon}</Text><Text style={[styles.chipLabel, category === name && styles.chipLabelSelected]}>{name}</Text></Pressable>)}</ScrollView>
        <Pressable onPress={saveExpense} style={styles.saveButton}><Text style={styles.saveButtonText}>Save expense</Text></Pressable>
        <Text style={styles.modalPrivacy}>Saved on this device · No account sync</Text>
      </View></View>
    </Modal>
    <Modal visible={showCaptureReview} animationType="slide" transparent onRequestClose={() => setShowCaptureReview(false)}>
      <View style={styles.modalBackdrop}><View style={styles.sheet}>
        <View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Review transaction alerts</Text><Text style={styles.sheetSubtitle}>Add only the purchases you recognize.</Text></View><Pressable onPress={() => setShowCaptureReview(false)} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable></View>
        {pendingAlerts.length ? pendingAlerts.map(item => <View key={item.id} style={styles.pendingRow}><View style={{ flex: 1 }}><Text style={styles.pendingDescription}>{item.description || 'Payment alert'}</Text><Text style={styles.pendingSource}>{item.packageName.replace(/^.*\./, '')} · {new Date(item.date).toLocaleString()}</Text></View><Text style={styles.pendingAmount}>{money(item.amount)}</Text><Pressable onPress={() => acceptCaptured(item)} style={styles.addAlertButton}><Text style={styles.addAlertText}>Add</Text></Pressable><Pressable onPress={() => ignoreCaptured(item)} style={styles.ignoreAlertButton}><Text style={styles.ignoreAlertText}>×</Text></Pressable></View>) : <Text style={styles.emptyAlerts}>No matching alerts yet. When a bank or payment app posts a debit alert, it will appear here for review.</Text>}
        <Text style={styles.modalPrivacy}>Candidate alerts stay on this device until you add or dismiss them.</Text>
      </View></View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.paper }, content: { paddingHorizontal: 20, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, paddingBottom: 20 },
  eyebrow: { fontSize: 10, letterSpacing: 1.4, color: palette.muted, fontWeight: '700' }, greeting: { color: palette.ink, fontSize: 21, fontWeight: '700', marginTop: 4 },
  signOutButton: { minHeight: 40, paddingHorizontal: 14, borderRadius: 12, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line, alignItems: 'center', justifyContent: 'center' }, signOutText: { color: palette.forest, fontSize: 12, fontWeight: '800' },
  hero: { backgroundColor: '#155B47', borderRadius: 24, paddingHorizontal: 22, paddingTop: 21, paddingBottom: 18, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, heroCaption: { fontSize: 10, letterSpacing: 1.4, fontWeight: '700', color: '#C2DDD0' },
  livePill: { backgroundColor: '#FFFFFF1A', borderRadius: 20, flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 9 }, liveDot: { width: 6, height: 6, backgroundColor: '#9FD2A9', borderRadius: 4, marginRight: 6 }, liveText: { fontSize: 9, letterSpacing: 1, color: '#DDEDE3', fontWeight: '700' },
  heroAmount: { color: '#FFFFFF', fontSize: 38, fontWeight: '700', letterSpacing: -1.1, marginTop: 13 }, heroDivider: { height: 1, backgroundColor: '#FFFFFF25', marginTop: 17, marginBottom: 15 },
  heroBottom: { flexDirection: 'row', justifyContent: 'space-between' }, heroRight: { alignItems: 'flex-end' }, heroFootLabel: { color: '#B3D4C4', fontSize: 9, letterSpacing: 1.15, fontWeight: '700' }, heroFootValue: { color: '#FFFFFF', fontWeight: '600', fontSize: 13, marginTop: 4 }, heroOrb: { position: 'absolute', width: 140, height: 140, borderRadius: 100, borderWidth: 24, borderColor: '#FFFFFF08', right: -63, top: 50 },
  quickActions: { flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 17 }, primaryAction: { flex: 1, height: 48, backgroundColor: palette.forest, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  actionPlus: { fontSize: 20, color: '#FFFFFF', fontWeight: '400', marginRight: 8, marginTop: -2 }, primaryActionLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  secondaryAction: { flex: 1, height: 48, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }, actionIcon: { color: palette.forest, fontSize: 17, marginRight: 8 }, secondaryActionLabel: { color: palette.ink, fontWeight: '700', fontSize: 12 },
  card: { backgroundColor: palette.white, borderRadius: 20, paddingHorizontal: 16, paddingTop: 17, paddingBottom: 12, marginBottom: 14, borderWidth: 1, borderColor: '#EEF1EE' }, cardHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }, sectionTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' }, sectionSubtitle: { color: palette.muted, fontSize: 11, marginTop: 4 }, monthTag: { color: palette.forest, backgroundColor: palette.mint, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 13 }, categoryIcon: { width: 23, fontSize: 15 }, categoryName: { width: 107, fontSize: 11, color: '#44514A', fontWeight: '600' }, barTrack: { flex: 1, height: 6, borderRadius: 5, backgroundColor: '#F0F3F0', overflow: 'hidden' }, barFill: { height: 6, borderRadius: 5 }, categoryAmount: { width: 54, textAlign: 'right', fontSize: 10, color: palette.ink, fontWeight: '700' },
  textButton: { alignSelf: 'flex-start', paddingTop: 4, paddingBottom: 2 }, textButtonLabel: { color: palette.forest, fontSize: 11, fontWeight: '700' },
  insightCard: { backgroundColor: '#FFF9E9', borderColor: '#F7EBC8', borderWidth: 1, borderRadius: 20, padding: 17, marginBottom: 14 }, insightTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 }, sparkle: { backgroundColor: '#F8E9B8', width: 27, height: 27, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginRight: 8 }, insightLabel: { color: '#8E7134', fontSize: 9, fontWeight: '800', letterSpacing: 1.05 }, aiTag: { color: '#9A7C36', backgroundColor: '#F8EBC7', fontSize: 8, fontWeight: '800', letterSpacing: .7, paddingHorizontal: 7, paddingVertical: 5, borderRadius: 6 },
  insightTitle: { color: palette.ink, fontSize: 16, fontWeight: '700', marginBottom: 6 }, insightBody: { color: '#5F6257', fontSize: 12, lineHeight: 18 }, insightFoot: { color: '#9A8C69', fontSize: 9, marginTop: 12 },
  transactionRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0F2F0' }, transactionIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 11 }, transactionInfo: { flex: 1 }, transactionTitle: { fontSize: 12, color: palette.ink, fontWeight: '700' }, transactionMeta: { fontSize: 10, color: palette.muted, marginTop: 5 }, amountBlock: { alignItems: 'flex-end', marginLeft: 5 }, transactionAmount: { color: palette.ink, fontSize: 12, fontWeight: '700' }, paymentMeta: { color: '#95A098', fontSize: 9, marginTop: 4 }, footerNote: { textAlign: 'center', color: '#98A29C', fontSize: 9, lineHeight: 14, marginHorizontal: 15, marginTop: 1 }, emptyCopy: { color: palette.muted, fontSize: 11, lineHeight: 16, paddingVertical: 8 },
  tabBar: { height: 64, backgroundColor: palette.white, borderTopWidth: 1, borderColor: palette.line, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingHorizontal: 15 }, tabItem: { width: 76, alignItems: 'center', justifyContent: 'center', height: 58 }, tabIcon: { fontSize: 21, color: '#8B9890', height: 25 }, tabIconActive: { color: palette.forest }, tabLabel: { fontSize: 9, color: '#8B9890', marginTop: 1 }, tabLabelActive: { color: palette.forest, fontWeight: '800' }, tabIndicator: { position: 'absolute', top: 0, width: 22, height: 3, borderRadius: 3, backgroundColor: palette.forest },
  pageTitle: { paddingTop: 2, paddingBottom: 17 }, pageHeading: { color: palette.ink, fontSize: 25, fontWeight: '700', letterSpacing: -.5 }, pageSubheading: { color: palette.muted, fontSize: 12, marginTop: 5 }, totalStrip: { backgroundColor: palette.mint, borderRadius: 15, paddingHorizontal: 16, paddingVertical: 13, marginBottom: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, totalStripLabel: { color: palette.forest, fontWeight: '800', letterSpacing: 1, fontSize: 9 }, totalStripValue: { color: palette.forest, fontSize: 16, fontWeight: '800' }, wideAction: { height: 49, borderRadius: 14, backgroundColor: palette.forest, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  ideaRow: { flexDirection: 'row', paddingTop: 16, borderTopWidth: 1, borderColor: '#F0F2F0', marginTop: 15 }, ideaIcon: { fontSize: 20, marginRight: 12, width: 28 }, ideaTitle: { fontSize: 12, fontWeight: '700', color: palette.ink }, ideaBody: { fontSize: 11, lineHeight: 16, color: palette.muted, marginTop: 4 }, kindNote: { backgroundColor: '#EEF3F0', borderRadius: 16, padding: 16, marginTop: 0 }, kindTitle: { fontSize: 13, color: palette.forest, fontWeight: '800' }, kindBody: { color: '#65736B', fontSize: 11, lineHeight: 16, marginTop: 5 },
  captureCard: { backgroundColor: palette.white, borderColor: palette.line, borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 14 }, captureHeader: { flexDirection: 'row', alignItems: 'center' }, captureIcon: { color: palette.forest, fontSize: 23, marginRight: 11 }, captureTitle: { color: palette.ink, fontWeight: '700', fontSize: 13 }, captureSubtitle: { color: palette.muted, fontSize: 10, marginTop: 3 }, captureStatus: { backgroundColor: '#EEF1EF', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5 }, captureStatusOn: { backgroundColor: palette.mint }, captureStatusText: { fontSize: 8, color: '#748078', fontWeight: '800', letterSpacing: .7 }, captureStatusTextOn: { color: palette.forest }, captureBody: { color: '#66736B', fontSize: 10, lineHeight: 15, marginTop: 12 }, captureButtons: { flexDirection: 'row', marginTop: 12, gap: 8 }, capturePrimary: { backgroundColor: palette.forest, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9 }, capturePrimaryText: { color: palette.white, fontWeight: '700', fontSize: 10 }, captureSecondary: { borderColor: palette.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9 }, captureSecondaryText: { color: palette.ink, fontWeight: '700', fontSize: 10 }, pendingNote: { color: palette.forest, fontSize: 10, fontWeight: '700', marginTop: 10 }, pendingRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: palette.line, paddingVertical: 12, gap: 9 }, pendingDescription: { color: palette.ink, fontSize: 11, fontWeight: '700' }, pendingSource: { color: palette.muted, fontSize: 9, marginTop: 4 }, pendingAmount: { color: palette.ink, fontSize: 11, fontWeight: '700' }, addAlertButton: { backgroundColor: palette.mint, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }, addAlertText: { color: palette.forest, fontSize: 10, fontWeight: '800' }, ignoreAlertButton: { width: 27, height: 27, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#F0F2F0' }, ignoreAlertText: { color: palette.muted, fontSize: 16, marginTop: -2 }, emptyAlerts: { color: palette.muted, fontSize: 11, lineHeight: 17, paddingVertical: 12 },
  modalBackdrop: { flex: 1, backgroundColor: '#101B1680', justifyContent: 'flex-end' }, sheet: { backgroundColor: palette.paper, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 21, paddingTop: 11, paddingBottom: 28 }, sheetHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 4, backgroundColor: '#CCD4CE', marginBottom: 15 }, sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }, sheetTitle: { fontSize: 21, color: palette.ink, fontWeight: '700' }, sheetSubtitle: { fontSize: 11, color: palette.muted, marginTop: 4 }, closeButton: { width: 31, height: 31, borderRadius: 16, backgroundColor: '#E8EEE9', alignItems: 'center', justifyContent: 'center' }, closeText: { color: palette.ink, fontSize: 23, marginTop: -3 }, fieldLabel: { color: '#77847C', fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginTop: 14, marginBottom: 8 }, moneyInputWrap: { height: 58, backgroundColor: palette.white, borderRadius: 13, borderWidth: 1, borderColor: palette.line, alignItems: 'center', flexDirection: 'row', paddingHorizontal: 15 }, rupee: { color: palette.forest, fontSize: 25, fontWeight: '600', marginRight: 9 }, moneyInput: { flex: 1, color: palette.ink, fontSize: 27, fontWeight: '700', paddingVertical: 0 }, textInput: { height: 49, backgroundColor: palette.white, borderRadius: 12, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 13, fontSize: 12, color: palette.ink }, categoryPicker: { flexGrow: 0, marginRight: -21 }, categoryChip: { height: 33, flexDirection: 'row', alignItems: 'center', backgroundColor: palette.white, borderRadius: 18, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 10, marginRight: 7 }, categoryChipSelected: { backgroundColor: palette.mint, borderColor: '#AED3BA' }, chipIcon: { fontSize: 12, marginRight: 5 }, chipLabel: { color: '#68746D', fontSize: 10, fontWeight: '600' }, chipLabelSelected: { color: palette.forest, fontWeight: '800' }, saveButton: { height: 51, borderRadius: 14, backgroundColor: palette.forest, alignItems: 'center', justifyContent: 'center', marginTop: 23 }, saveButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 }, modalPrivacy: { textAlign: 'center', color: '#929D96', fontSize: 9, marginTop: 11 },
});
