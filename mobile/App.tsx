import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, AppState, Modal, NativeModules, Platform, Pressable, SafeAreaView, ScrollView, Share, StatusBar, StyleSheet, Switch,
  Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Notifications } from './lib/notification-service';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import AuthScreen from './AuthScreen';
import OnboardingScreen from './OnboardingScreen';
import SpendingRhythmCard from './SpendingRhythmCard';
import { calculateMonthlyPlan, Obligation } from './lib/budget';
import { isValidClockTime, normalizeClockTime, stepClockTime } from './lib/clock';
import { parseStoredObligations, parseStoredTransactions } from './lib/local-data';
import { apiConfigured, apiConfigurationIssue, classifySpendAlert, createTransaction, deleteAllTransactions, getAiAlertStatus, getMonthlySummary, getTransactions } from './lib/api';
import { authConfigured, supabase } from './lib/supabase';

type Category = string;
type Transaction = { id: string; description: string; category: Category; amount: number; date: string; method: string; icon: string; color: string; transactionType: 'expense' | 'refund' | 'transfer' | 'income' };
type CapturedAlert = { id: string; amount: number; description: string; category?: string; packageName: string; date: string; transactionType?: 'expense' | 'transfer'; aiConfidence?: number; aiEvidence?: string };
type PendingAiAlert = { id: string; source: string; packageName: string; text: string; date: string };
type Tab = 'Home' | 'Activity' | 'Insights' | 'Profile';

const palette = {
  ink: '#18241F', muted: '#738079', forest: '#176B52', mint: '#E6F4EA', paper: '#F6F8F5', white: '#FFFFFF',
  line: '#E8EDE8', amber: '#F4B942', paleAmber: '#FFF4D8', rose: '#C87564', blue: '#5E82B7', lilac: '#9074AF',
};
const categoryMeta: Record<string, { icon: string; color: string }> = {
  'Groceries': { icon: '🥬', color: '#60A779' }, 'Daily essentials': { icon: '🧴', color: '#8DB5A2' },
  'Dining & outings': { icon: '🍜', color: '#E3A657' }, 'Transport': { icon: '🛺', color: '#7798C7' },
  'Entertainment': { icon: '🎬', color: '#A18BB9' }, 'Health & fitness': { icon: '🌿', color: '#6FA895' }, 'Bills & utilities': { icon: '💡', color: '#D3A65D' },
  'Loan & EMI': { icon: '🏠', color: '#7F9B91' }, 'Shopping': { icon: '🛍️', color: '#D28D85' }, 'Other': { icon: '✨', color: '#9CA8A1' },
};
const getCategoryMeta = (category: string) => categoryMeta[category] ?? { icon: '✦', color: '#9CA8A1' };
const money = (n: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2,
}).format(n);
const cloudSyncFailure = (error: any) => `Cloud sync paused · ${error?.message || 'The service is unavailable.'} Your local data remains saved on this device.`;
const transactionStorageKey = (userId: string) => `paisa-pilot-transactions:${userId}`;
const incomeStorageKey = (userId: string) => `paisa-pilot-monthly-income:${userId}`;
const obligationStorageKey = (userId: string) => `paisa-pilot-monthly-obligations:${userId}`;
const profileNameStorageKey = (userId: string) => `paisa-pilot-profile-name:${userId}`;
const preferenceStorageKey = (userId: string, name: string) => `paisa-pilot:${userId}:${name}`;
const notificationStorageKey = (userId: string, name: string) => `paisa-pilot:${userId}:notification-${name}`;
const protectedLocalRead = async (key: string) => {
  const value = await AsyncStorage.getItem(key);
  if (!value) return value;
  const crypto = NativeModules.TransactionCapture;
  if (value.startsWith('enc:v1:')) {
    if (!crypto?.decryptLocalData) throw new Error('Protected local storage is unavailable in this app build.');
    return crypto.decryptLocalData(value);
  }
  if (Platform.OS === 'android' && crypto?.encryptLocalData) {
    await AsyncStorage.setItem(key, await crypto.encryptLocalData(value));
  }
  return value;
};
const protectedLocalWrite = async (key: string, value: string) => {
  const crypto = NativeModules.TransactionCapture;
  const stored = Platform.OS === 'android' && crypto?.encryptLocalData ? await crypto.encryptLocalData(value) : value;
  await AsyncStorage.setItem(key, stored);
};
const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'short' }).toUpperCase();
const dateLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return `Today · ${date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const localDateOnly = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const localMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};
function TimeControl({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  const [hour, minute] = value.split(':');
  const adjust = (unit: 'hour' | 'minute', delta: number) => onChange(stepClockTime(value, unit, delta));
  return <View style={styles.timeField}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <View style={timeControlStyles.picker}>
      <View style={timeControlStyles.unit}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${label.toLowerCase()} hour`} onPress={() => adjust('hour', 1)} style={timeControlStyles.step}><Text style={timeControlStyles.stepText}>+</Text></Pressable>
        <Text style={timeControlStyles.digits}>{hour}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${label.toLowerCase()} hour`} onPress={() => adjust('hour', -1)} style={timeControlStyles.step}><Text style={timeControlStyles.stepText}>−</Text></Pressable>
      </View>
      <Text style={timeControlStyles.colon}>:</Text>
      <View style={timeControlStyles.unit}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${label.toLowerCase()} minute`} onPress={() => adjust('minute', 1)} style={timeControlStyles.step}><Text style={timeControlStyles.stepText}>+</Text></Pressable>
        <Text style={timeControlStyles.digits}>{minute}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${label.toLowerCase()} minute`} onPress={() => adjust('minute', -1)} style={timeControlStyles.step}><Text style={timeControlStyles.stepText}>−</Text></Pressable>
      </View>
    </View>
  </View>;
}

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [authReady, setAuthReady] = useState(!authConfigured);
  const [syncMessage, setSyncMessage] = useState('');
  const [serverInsights, setServerInsights] = useState<{ title: string; body: string }[]>([]);
  const [tab, setTab] = useState<Tab>('Home');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionsLoadedFor, setTransactionsLoadedFor] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showBudgetSettings, setShowBudgetSettings] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deletingData, setDeletingData] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [profileLoadedFor, setProfileLoadedFor] = useState<string | null>(null);
  const [profileSetupComplete, setProfileSetupComplete] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [incomeDraft, setIncomeDraft] = useState('');
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [obligationsDraft, setObligationsDraft] = useState<Obligation[]>([]);
  const [obligationsLoadedFor, setObligationsLoadedFor] = useState<string | null>(null);
  const [obligationNameDraft, setObligationNameDraft] = useState('');
  const [obligationAmountDraft, setObligationAmountDraft] = useState('');
  const [obligationCategoryDraft, setObligationCategoryDraft] = useState<Category>('Bills & utilities');
  const [morningTime, setMorningTime] = useState('08:00');
  const [eveningTime, setEveningTime] = useState('21:00');
  const [morningTimeDraft, setMorningTimeDraft] = useState('08:00');
  const [eveningTimeDraft, setEveningTimeDraft] = useState('21:00');
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [captureOptIn, setCaptureOptIn] = useState(false);
  const [todayKey, setTodayKey] = useState(() => new Date().toDateString());
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseError, setExpenseError] = useState('');
  const [category, setCategory] = useState<Category>('Groceries');
  const [hydrated, setHydrated] = useState(false);
  const [captureEnabled, setCaptureEnabled] = useState(false);
  const [pendingAlerts, setPendingAlerts] = useState<CapturedAlert[]>([]);
  const [captureDiagnostics, setCaptureDiagnostics] = useState<any>(null);
  const [showCaptureReview, setShowCaptureReview] = useState(false);
  const [cloudAiEnabled, setCloudAiEnabled] = useState(false);
  const [aiServiceAvailable, setAiServiceAvailable] = useState(false);
  const [aiStatusMessage, setAiStatusMessage] = useState('Checking optional AI service…');
  const [aiProcessing, setAiProcessing] = useState(false);
  const aiInFlight = React.useRef(false);
  const aiRetryAfter = React.useRef(0);
  const aiRetryCount = React.useRef(0);
  const captureModule = NativeModules.TransactionCapture;
  const userId = session?.user?.id as string | undefined;

  useEffect(() => {
    if (!authReady) return;
    let active = true;
    setProfileLoadedFor(null); setProfileSetupComplete(false); setProfileName(''); setProfileNameDraft('');
    setMonthlyIncome(0); setIncomeDraft(''); setObligations([]); setObligationsDraft([]); setObligationsLoadedFor(null);
    setCaptureOptIn(false); setCaptureEnabled(false); setCloudAiEnabled(false); setRemindersEnabled(false);
    if (!userId) {
      setHydrated(true);
      return () => { active = false; };
    }
    const settingKeys = ['morning-time', 'evening-time', 'reminders-enabled', 'cloud-ai-enabled', 'capture-enabled'];
    const legacyKeys = ['paisa-pilot-morning-time', 'paisa-pilot-evening-time', 'paisa-pilot-reminders-enabled', 'paisa-pilot-cloud-ai-enabled'];
    Promise.all([
      protectedLocalRead(profileNameStorageKey(userId)), protectedLocalRead(incomeStorageKey(userId)),
      protectedLocalRead(obligationStorageKey(userId)), protectedLocalRead(preferenceStorageKey(userId, 'setup-complete')),
      ...settingKeys.map(key => protectedLocalRead(preferenceStorageKey(userId, key))), AsyncStorage.multiGet(legacyKeys),
    ]).then(async ([savedName, income, savedObligations, setupComplete, morning, evening, reminders, aiEnabled, capture, legacy]) => {
      if (!active) return;
      const oldSettings = Object.fromEntries(legacy as [string, string | null][]);
      const resolvedMorning = normalizeClockTime(morning || oldSettings['paisa-pilot-morning-time'], '08:00');
      const resolvedEvening = normalizeClockTime(evening || oldSettings['paisa-pilot-evening-time'], '21:00');
      const resolvedReminders = reminders ?? oldSettings['paisa-pilot-reminders-enabled'];
      const resolvedAi = aiEnabled ?? oldSettings['paisa-pilot-cloud-ai-enabled'];
      await Promise.all([
        ...settingKeys.map((key, index) => {
          const current = [morning, evening, reminders, aiEnabled, capture][index];
          const legacyValue = [oldSettings['paisa-pilot-morning-time'], oldSettings['paisa-pilot-evening-time'], oldSettings['paisa-pilot-reminders-enabled'], oldSettings['paisa-pilot-cloud-ai-enabled'], null][index];
          return !current && legacyValue ? protectedLocalWrite(preferenceStorageKey(userId, key), legacyValue) : Promise.resolve();
        }),
        AsyncStorage.multiRemove(legacyKeys),
      ]);
      if (!active) return;
      const authName = session?.user?.user_metadata?.full_name || session?.user?.user_metadata?.name || '';
      const resolvedName = (savedName || authName).trim();
      setProfileName(resolvedName); setProfileNameDraft(resolvedName);
      setMonthlyIncome(Number(income) || 0); setIncomeDraft(income || '');
      setObligations(parseStoredObligations(savedObligations)); setObligationsLoadedFor(userId);
      setProfileSetupComplete(setupComplete === 'true' || Boolean(resolvedName && Number(income) > 0));
      setMorningTime(resolvedMorning); setEveningTime(resolvedEvening);
      setRemindersEnabled(resolvedReminders === 'true'); setCloudAiEnabled(resolvedAi === 'true'); setCaptureOptIn(capture === 'true');
      setProfileLoadedFor(userId);
    }).catch(() => {
      if (active) {
        Alert.alert('Profile settings unavailable', 'We could not read this account’s protected settings on this device. Please retry or contact support before adding data.');
        setProfileLoadedFor(userId); setObligationsLoadedFor(userId);
      }
    }).finally(() => { if (active) setHydrated(true); });
    return () => { active = false; };
  }, [authReady, userId]);

  useEffect(() => {
    if (!authReady) return;
    let active = true;
    setTransactionsLoadedFor(null);
    if (!userId) {
      setTransactions([]);
      return () => { active = false; };
    }
    protectedLocalRead(transactionStorageKey(userId)).then(saved => {
      const rows = parseStoredTransactions(saved) as Transaction[];
      if (active) {
        setTransactions(rows);
        setTransactionsLoadedFor(userId);
      }
    }).catch(() => {
      if (active) {
        Alert.alert('Local data unavailable', 'Could not read saved expenses for this account from this device.');
        setTransactions([]);
        setTransactionsLoadedFor(userId);
      }
    });
    return () => { active = false; };
  }, [authReady, userId]);

  useEffect(() => {
    if (!session?.access_token || !apiConfigured) {
      setAiServiceAvailable(false);
      setAiStatusMessage(apiConfigurationIssue || (!session?.access_token ? 'Sign in to check optional AI service status.' : 'Cloud AI is unavailable · local matching still works'));
      return;
    }
    let active = true;
    getAiAlertStatus(session.access_token).then(status => {
      if (active) {
        setAiServiceAvailable(Boolean(status.enabled));
        setAiStatusMessage(status.enabled ? 'Ready · used only when local rules are unsure' : 'Not enabled on the API · local matching still works');
      }
    }).catch((error: any) => {
      if (active) {
        setAiServiceAvailable(false);
        const detail = error?.message || 'Could not reach AI status.';
        setAiStatusMessage(/local (?:alert )?matching still works/i.test(detail) ? detail : `${detail} Local alert matching still works.`);
      }
    });
    return () => { active = false; };
  }, [session?.access_token]);

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); })
      .catch(() => { setSession(null); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.access_token || !apiConfigured || !userId || transactionsLoadedFor !== userId) return;
    let active = true;
    const sync = async () => {
      try {
        const saved = await protectedLocalRead(transactionStorageKey(userId));
        const local: Transaction[] = saved ? JSON.parse(saved) : [];
        const [initialRemote, initialSummary] = await Promise.all([
          getTransactions(session.access_token), getMonthlySummary(session.access_token, localMonthKey()),
        ]);
        const knownRefs = new Set(initialRemote.map(row => row.client_ref).filter((reference): reference is string => Boolean(reference)));
        let uploadedLocalRows = false;
        for (const item of local) {
          if (knownRefs.has(item.id)) continue;
          await createTransaction(session.access_token, { id: item.id, amount: item.amount, description: item.description, category: item.category, paymentMethod: item.method, transactionType: item.transactionType || 'expense', date: localDateOnly(item.date), transactionAt: item.date });
          uploadedLocalRows = true;
        }
        const [remote, summary] = uploadedLocalRows
          ? await Promise.all([getTransactions(session.access_token), getMonthlySummary(session.access_token, localMonthKey())])
          : [initialRemote, initialSummary];
        if (active) {
          const mapped = remote.map(row => {
            const name = typeof row.category === 'string' && row.category.trim() ? row.category.trim() : 'Other';
            return { id: row.client_ref || String(row.id), description: row.description, category: name, amount: Number(row.amount_paise) / 100,
              date: row.transaction_at || `${row.transaction_date}T12:00:00`, method: row.payment_method, transactionType: row.transaction_type || 'expense', ...getCategoryMeta(name) };
          });
          setTransactions(mapped);
          setServerInsights(summary.insights);
          setSyncMessage('Synced to your private account');
        }
      } catch (error: any) { if (active) setSyncMessage(cloudSyncFailure(error)); }
    };
    sync();
    const channel = supabase?.channel(`spend-${session.user.id}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${session.user.id}`,
    }, () => { Promise.all([getTransactions(session.access_token), getMonthlySummary(session.access_token, localMonthKey())]).then(([rows, summary]) => {
      if (active) setTransactions(rows.map(row => {
        const name = typeof row.category === 'string' && row.category.trim() ? row.category.trim() : 'Other';
        return { id: row.client_ref || String(row.id), description: row.description, category: name, amount: Number(row.amount_paise) / 100,
          date: row.transaction_at || `${row.transaction_date}T12:00:00`, method: row.payment_method, transactionType: row.transaction_type || 'expense', ...getCategoryMeta(name) };
      }));
      if (active) setServerInsights(summary.insights);
    }).catch(() => {}); }).subscribe();
    return () => { active = false; if (channel) supabase?.removeChannel(channel); };
  }, [session?.access_token, userId, transactionsLoadedFor]);
  useEffect(() => {
    if (hydrated && userId && transactionsLoadedFor === userId) protectedLocalWrite(transactionStorageKey(userId), JSON.stringify(transactions)).catch(() =>
      Alert.alert('Could not save', 'Check available storage on your device.'));
  }, [hydrated, transactions, userId, transactionsLoadedFor]);

  useEffect(() => {
    if (hydrated && userId && obligationsLoadedFor === userId) protectedLocalWrite(obligationStorageKey(userId), JSON.stringify(obligations)).catch(() =>
      Alert.alert('Could not save commitments', 'Your daily plan settings could not be saved on this device.'));
  }, [hydrated, obligations, userId, obligationsLoadedFor]);

  const refreshCapture = async () => {
    if (!captureModule || !authReady) return;
    // Do not disable capture while account-scoped preferences are still loading:
    // the native module clears pending review candidates when capture is disabled.
    if (userId && profileLoadedFor !== userId) return;
    try {
      const hasAccess = await captureModule.hasAccess();
      const enabled = Boolean(userId && profileLoadedFor === userId && profileName.trim() && captureOptIn && hasAccess);
      await captureModule.setCaptureActive?.(enabled);
      if (enabled && cloudAiEnabled && aiServiceAvailable) await captureModule.setAiFallbackEnabled?.(true);
      setCaptureEnabled(enabled);
      if (enabled) {
        const [pending, diagnostics] = await Promise.all([
          captureModule.getPendingTransactions(),
          captureModule.getCaptureDiagnostics?.(),
        ]);
        const pendingItems = pending as CapturedAlert[];
        setPendingAlerts(current => {
          const savedAi = current.filter(alert => alert.aiConfidence != null && !pendingItems.some((item: CapturedAlert) => item.id === alert.id));
          return [...pendingItems, ...savedAi];
        });
        if (diagnostics) setCaptureDiagnostics(diagnostics);
        if (pendingItems.length) setShowCaptureReview(true);
      } else {
        setPendingAlerts([]);
        setCaptureDiagnostics(null);
      }
    } catch { /* Capture is optional; manual tracking remains available. */ }
  };
  useEffect(() => {
    refreshCapture();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') { refreshCapture(); setTodayKey(new Date().toDateString()); } });
    return () => subscription.remove();
  }, [authReady, session?.user?.id, profileLoadedFor, profileName, captureOptIn, cloudAiEnabled, aiServiceAvailable]);

  const processAiAlertQueue = async () => {
    if (aiInFlight.current || Date.now() < aiRetryAfter.current || AppState.currentState !== 'active') return;
    if (!userId || profileLoadedFor !== userId || !profileSetupComplete || !captureOptIn) return;
    if (!captureModule?.getPendingAiAlerts || !session?.access_token || !cloudAiEnabled || !aiServiceAvailable) return;
    aiInFlight.current = true;
    try {
      const alerts: PendingAiAlert[] = await captureModule.getPendingAiAlerts();
      const item = alerts[0];
      if (!item) return;
      setAiProcessing(true);
      const classification = await classifySpendAlert(session.access_token, { text: item.text, source: item.source });
      await captureModule.dismissAiAlert(item.id);
      if (classification.shouldReview && classification.amount && classification.amount > 0) {
        const suggestion: CapturedAlert = {
          id: item.id,
          amount: classification.amount,
          description: classification.merchant || (item.source?.toLowerCase().includes('gmail') ? 'Bank / UPI alert' : item.source) || 'Possible purchase',
          category: classification.category,
          packageName: item.packageName || item.source,
          date: item.date || new Date().toISOString(),
          aiConfidence: classification.confidence,
          aiEvidence: classification.evidence,
        };
        setPendingAlerts(current => current.some(alert => alert.id === suggestion.id) ? current : [...current, suggestion]);
        setShowCaptureReview(true);
      }
      aiRetryAfter.current = 0;
      aiRetryCount.current = 0;
    } catch (error: any) {
      // Keep the encrypted alert queued for retry; raw text is not logged or displayed.
      const backoffSeconds = Math.min(900, 60 * (2 ** Math.min(aiRetryCount.current, 4)));
      aiRetryCount.current += 1;
      const retrySeconds = error?.status === 429 ? Math.max(60, Number(error.retryAfterSeconds) || 60) : backoffSeconds;
      aiRetryAfter.current = Date.now() + retrySeconds * 1000;
    } finally {
      setAiProcessing(false);
      aiInFlight.current = false;
    }
  };

  useEffect(() => {
    if (!captureEnabled || !cloudAiEnabled || !aiServiceAvailable || Platform.OS !== 'android') return;
    processAiAlertQueue();
    const timer = setInterval(processAiAlertQueue, 10_000);
    return () => clearInterval(timer);
  }, [captureEnabled, cloudAiEnabled, aiServiceAvailable, session?.access_token, userId, profileLoadedFor, profileSetupComplete, captureOptIn]);
  useEffect(() => {
    const timer = setInterval(() => {
      const key = new Date().toDateString();
      setTodayKey(current => current === key ? current : key);
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  const monthlyTransactions = transactions.filter(item => {
    const date = new Date(item.date);
    const today = new Date();
    return !Number.isNaN(date.getTime()) && date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
  });
  const totals = useMemo(() => monthlyTransactions.reduce<Record<string, number>>((a, t) => {
    if (t.transactionType !== 'expense' && t.transactionType !== 'refund') return a;
    const signedAmount = t.transactionType === 'refund' ? -t.amount : t.amount;
    return { ...a, [t.category]: (a[t.category] ?? 0) + signedAmount };
  }, {}), [monthlyTransactions]);
  const total = useMemo(() => Math.max(0, monthlyTransactions.reduce((sum, t) => sum + (t.transactionType === 'expense' ? t.amount : t.transactionType === 'refund' ? -t.amount : 0), 0)), [monthlyTransactions]);
  const sortedCategories = Object.entries(totals).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  const discretionary = (totals['Dining & outings'] ?? 0) + (totals.Entertainment ?? 0) + (totals.Shopping ?? 0);
  const today = new Date();
  const dailyPlan = calculateMonthlyPlan(monthlyIncome, obligations, transactions, today);
  const dailyBudget = dailyPlan.dailyGuide;
  const todaySpent = dailyPlan.todayNetSpend;
  const todayActualSpent = transactions.filter(item => new Date(item.date).toDateString() === todayKey)
    .reduce((sum, item) => sum + (item.transactionType === 'expense' ? item.amount : item.transactionType === 'refund' ? -item.amount : 0), 0);
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const draftMonthlyIncome = Math.max(0, Number(incomeDraft.replace(/,/g, '') || 0));
  const plannedCommitmentTotal = obligations.reduce((sum, item) => sum + item.amount, 0);
  const draftCommitmentTotal = obligationsDraft.reduce((sum, item) => sum + item.amount, 0);
  const flexibleMonthlyAmount = Math.max(0, draftMonthlyIncome - draftCommitmentTotal);
  const startingDailyGuide = flexibleMonthlyAmount / daysInMonth;
  const monthFinished = today.getDate() === daysInMonth;
  const weekSpend = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (6 - index));
    const plan = calculateMonthlyPlan(monthlyIncome, obligations, transactions, day);
    return { label: day.toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 2), spend: plan.todayNetSpend, guide: plan.dailyGuide };
  });
  const maxWeekSpend = Math.max(dailyBudget, ...weekSpend.flatMap(day => [day.spend, day.guide]), 1);

  const requestReminders = async () => {
    if (!userId || profileLoadedFor !== userId || !profileSetupComplete) return;
    if (Platform.OS !== 'android') {
      Alert.alert('Android reminders', 'Daily local reminders are available in the Android app build.');
      return;
    }
    try {
      await Notifications.setNotificationChannelAsync('daily-spending', { name: 'Daily spending reminders', importance: Notifications.AndroidImportance.DEFAULT, sound: 'default' });
      const current = await Notifications.getPermissionsAsync();
      const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Notifications are off', 'Allow notifications in Android Settings to receive your daily spending reminders.');
        return;
      }
      await protectedLocalWrite(preferenceStorageKey(userId, 'reminders-enabled'), 'true');
      setRemindersEnabled(true);
    } catch (error: any) {
      Alert.alert('Could not enable reminders', error?.message || 'Please check notification permissions and try again.');
    }
  };

  const setReminderPreference = async (enabled: boolean) => {
    if (enabled) await requestReminders();
    else {
      try { await disableReminders(); }
      catch (error: any) { Alert.alert('Could not disable reminders', error?.message || 'Please try again.'); }
    }
  };

  const saveBudgetSettings = async () => {
    const value = Number(incomeDraft.replace(/,/g, ''));
    if (!Number.isFinite(value) || value < 0 || value > 100_000_000) { Alert.alert('Check monthly income', 'Enter an amount between ₹0 and ₹10 crore, or leave it at zero to skip the budget.'); return; }
    if (obligationsDraft.length > 20) { Alert.alert('Too many commitments', 'Keep up to 20 monthly commitments in this plan.'); return; }
    if (!isValidClockTime(morningTimeDraft) || !isValidClockTime(eveningTimeDraft)) { Alert.alert('Check reminder times', 'Use 24-hour time, for example 08:00 and 21:00.'); return; }
    try {
      await Promise.all([
        userId ? protectedLocalWrite(incomeStorageKey(userId), String(value)) : Promise.resolve(),
        userId ? protectedLocalWrite(obligationStorageKey(userId), JSON.stringify(obligationsDraft)) : Promise.resolve(),
        userId ? protectedLocalWrite(preferenceStorageKey(userId, 'morning-time'), morningTimeDraft) : Promise.resolve(),
        userId ? protectedLocalWrite(preferenceStorageKey(userId, 'evening-time'), eveningTimeDraft) : Promise.resolve(),
      ]);
    } catch {
      Alert.alert('Could not save daily plan', 'Your income, commitments, and reminder times were not fully saved. Please try again.');
      return;
    }
    setMonthlyIncome(value);
    setObligations(obligationsDraft);
    setMorningTime(morningTimeDraft);
    setEveningTime(eveningTimeDraft);
    setShowBudgetSettings(false);
    if (value <= 0 && remindersEnabled) await disableReminders();
  };

  const addMonthlyObligation = () => {
    const obligationAmount = Number(obligationAmountDraft.replace(/,/g, ''));
    if (!obligationNameDraft.trim() || obligationNameDraft.trim().length < 3 || !Number.isFinite(obligationAmount) || obligationAmount <= 0) {
      Alert.alert('Add a monthly commitment', 'Enter a name with at least three characters and a positive monthly amount.');
      return;
    }
    if (obligationsDraft.length >= 20) { Alert.alert('Commitment limit', 'The daily plan supports up to 20 monthly commitments.'); return; }
    if (obligationsDraft.some(item => item.name.trim().toLowerCase() === obligationNameDraft.trim().toLowerCase())) { Alert.alert('Commitment already added', 'Use one row per monthly payment. Edit its amount instead of adding a duplicate.'); return; }
    setObligationsDraft(current => [...current, { id: `obligation-${Date.now()}`, name: obligationNameDraft.trim(), amount: obligationAmount, category: obligationCategoryDraft }]);
    setObligationNameDraft('');
    setObligationAmountDraft('');
  };

  const disableReminders = async () => {
    const keys = userId ? [notificationStorageKey(userId, 'morning'), notificationStorageKey(userId, 'evening')] : [];
    const ids = await AsyncStorage.multiGet([...keys, 'paisa-pilot-morning-notification', 'paisa-pilot-evening-notification']);
    await Promise.all(ids.map(([, id]) => id ? Notifications.cancelScheduledNotificationAsync(id) : Promise.resolve()));
    await AsyncStorage.multiSet([...keys.map(key => [key, ''] as [string, string]), ['paisa-pilot-morning-notification', ''], ['paisa-pilot-evening-notification', '']]);
    if (userId) await protectedLocalWrite(preferenceStorageKey(userId, 'reminders-enabled'), 'false');
    setRemindersEnabled(false);
  };

  useEffect(() => {
    if (!hydrated || !userId || profileLoadedFor !== userId || !profileSetupComplete || !remindersEnabled || monthlyIncome <= 0 || Platform.OS !== 'android') return;
    let cancelled = false;
    const schedule = async () => {
      try {
        await Notifications.setNotificationChannelAsync('daily-spending', { name: 'Daily spending reminders', importance: Notifications.AndroidImportance.DEFAULT, sound: 'default' });
        const idKeys = userId ? [notificationStorageKey(userId, 'morning'), notificationStorageKey(userId, 'evening')] : [];
        const oldIds = await AsyncStorage.multiGet([...idKeys, 'paisa-pilot-morning-notification', 'paisa-pilot-evening-notification']);
        await Promise.all(oldIds.map(([, id]) => id ? Notifications.cancelScheduledNotificationAsync(id) : Promise.resolve()));
        if (cancelled) return;
        const [morningHour, morningMinute] = morningTime.split(':').map(Number);
        const [eveningHour, eveningMinute] = eveningTime.split(':').map(Number);
        const morningId = await Notifications.scheduleNotificationAsync({
          content: { title: 'A gentle plan for today', body: `After planned bills and carryover, your daily guide is ${money(dailyBudget)}. Spend at your own pace.`, sound: 'default' },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: morningHour, minute: morningMinute, channelId: 'daily-spending' },
        });
        const eveningId = await Notifications.scheduleNotificationAsync({
          content: { title: 'Your day in review', body: `You have tracked ${money(Math.max(0, todayActualSpent))} in expenses today. Open Paisa Pilot for the details.`, sound: 'default' },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: eveningHour, minute: eveningMinute, channelId: 'daily-spending' },
        });
        if (cancelled) {
          await Promise.all([Notifications.cancelScheduledNotificationAsync(morningId), Notifications.cancelScheduledNotificationAsync(eveningId)]);
          return;
        }
        await AsyncStorage.multiSet([...idKeys.map((key, index) => [key, index === 0 ? morningId : eveningId] as [string, string]), ['paisa-pilot-morning-notification', morningId], ['paisa-pilot-evening-notification', eveningId]]);
      } catch { /* The dashboard remains usable if the OS declines local scheduling. */ }
    };
    void schedule();
    return () => { cancelled = true; };
  }, [hydrated, remindersEnabled, monthlyIncome, obligations, dailyBudget, morningTime, eveningTime, todayActualSpent, todayKey, userId, profileLoadedFor, profileSetupComplete]);

  const saveExpense = () => {
    if (!session?.access_token) {
      setExpenseError('Sign in to start tracking expenses.');
      return;
    }
    const value = Number(amount.replace(/[ ,]/g, ''));
    if (!amount.trim() || !Number.isFinite(value) || value <= 0) {
      setExpenseError('Enter an amount greater than ₹0.');
      return;
    }
    const amountPaise = Math.round(value * 100);
    if (!Number.isSafeInteger(amountPaise) || Math.abs(value * 100 - amountPaise) > 1e-7) {
      setExpenseError('Enter an amount with no more than two decimal places.');
      return;
    }
    if (!description.trim()) {
      setExpenseError('Add a short description so you can recognize this expense later.');
      return;
    }
    if (description.trim().length > 240) {
      setExpenseError('Keep the description to 240 characters or fewer.');
      return;
    }
    const meta = getCategoryMeta(category);
    const localTransaction: Transaction = { id: `${Date.now()}`, description: description.trim(), category, amount: value, date: new Date().toISOString(), method: 'Manual', transactionType: 'expense', ...meta };
    setTransactions(current => [localTransaction, ...current.filter(item => item.id !== localTransaction.id)]);
    if (session?.access_token && apiConfigured) createTransaction(session.access_token, { id: localTransaction.id, amount: value, description: localTransaction.description, category, paymentMethod: 'Manual', transactionType: 'expense', date: localDateOnly(localTransaction.date), transactionAt: localTransaction.date })
      .catch(error => setSyncMessage(cloudSyncFailure(error)));
    setDescription(''); setAmount(''); setShowAdd(false);
  };

  const enableCapture = async () => {
    if (Platform.OS !== 'android' || !captureModule) {
      Alert.alert('Android build required', 'Notification capture is available in the Android development build, not Expo Go.');
      return;
    }
    if (await captureModule.hasAccess()) {
      if (userId) await protectedLocalWrite(preferenceStorageKey(userId, 'capture-enabled'), 'true');
      setCaptureOptIn(true);
      await captureModule.setCaptureActive?.(true);
      await captureModule.setAiFallbackEnabled?.(cloudAiEnabled && aiServiceAvailable);
      setCaptureEnabled(true);
      setPendingAlerts(await captureModule.getPendingTransactions());
      setCaptureDiagnostics(await captureModule.getCaptureDiagnostics?.());
      setShowCaptureReview(true); return;
    }
    Alert.alert('Allow transaction alerts?', 'Android notification access can expose notification contents from other apps. Paisa Pilot checks visible notifications for spending and cost alerts on this device, stores only matched candidates locally, and asks you to review before tracking them. You can turn access off in Android Settings.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Android settings', onPress: () => {
        if (userId) void protectedLocalWrite(preferenceStorageKey(userId, 'capture-enabled'), 'true').then(() => setCaptureOptIn(true));
        captureModule.openSettings();
      } },
    ]);
  };

  const disableCapture = async () => {
    try {
      await captureModule?.setCaptureActive?.(false);
      await captureModule?.setAiFallbackEnabled?.(false);
      if (userId) await protectedLocalWrite(preferenceStorageKey(userId, 'capture-enabled'), 'false');
      setCaptureOptIn(false); setCaptureEnabled(false); setCloudAiEnabled(false); setPendingAlerts([]); setCaptureDiagnostics(null);
      if (userId) await protectedLocalWrite(preferenceStorageKey(userId, 'cloud-ai-enabled'), 'false');
    } catch { Alert.alert('Could not turn off alert capture', 'Please try again. Notification access remains under Android Settings.'); }
  };

  const setCloudAiPreference = async (enabled: boolean) => {
    if (enabled && !aiServiceAvailable) {
      Alert.alert('Optional AI review is unavailable', aiStatusMessage);
      return;
    }
    if (enabled && !captureEnabled) {
      Alert.alert('Set up alert capture first', 'Enable Android notification access before turning on optional AI review.');
      return;
    }
    try {
      if (!userId) return;
      await protectedLocalWrite(preferenceStorageKey(userId, 'cloud-ai-enabled'), String(enabled));
      await captureModule?.setAiFallbackEnabled?.(enabled);
      setCloudAiEnabled(enabled);
    } catch {
      Alert.alert('Could not update AI preference', 'Please try again.');
    }
  };

  const saveCapturedAlert = async (alert: CapturedAlert) => {
    if (!session?.access_token) {
      Alert.alert('Sign in required', 'Log in before adding captured alerts to your spending.');
      return;
    }
    const description = alert.description || 'Card / UPI purchase';
    const match = typeof alert.category === 'string' && alert.category.trim() && alert.category.trim().length <= 40 ? alert.category.trim() : 'Other';
    const meta = getCategoryMeta(match);
    const transactionId = `notification-${alert.id}`;
    const transactionType = alert.transactionType ?? 'expense';
    setTransactions(current => [{ id: transactionId, description, category: match as Category, amount: alert.amount,
      date: alert.date, method: 'Android app alert', transactionType, ...meta }, ...current.filter(item => item.id !== transactionId)]);
    if (session?.access_token && apiConfigured) createTransaction(session.access_token, { id: `notification-${alert.id}`, amount: alert.amount, description, category: match, paymentMethod: 'Android app alert', transactionType, date: localDateOnly(alert.date), transactionAt: alert.date })
      .catch(error => setSyncMessage(cloudSyncFailure(error)));
    try {
      await captureModule?.dismissTransaction(alert.id);
      setPendingAlerts(current => current.filter(item => item.id !== alert.id));
    } catch { Alert.alert('Could not clear alert', 'This expense was added, but its pending alert remains on the device.'); }
  };

  const acceptCaptured = (alert: CapturedAlert) => {
    const amountPaise = Math.round(alert.amount * 100);
    const alertTime = new Date(alert.date).getTime();
    const normalizedDescription = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const genericDescriptions = /^(bank\s*\/?\s*upi alert|payment alert|card\s*\/?\s*upi purchase)$/i;
    const possibleDuplicate = transactions.find(item => {
      if (Math.round(item.amount * 100) !== amountPaise || !Number.isFinite(alertTime)) return false;
      const existingTime = new Date(item.date).getTime();
      if (!Number.isFinite(existingTime) || Math.abs(existingTime - alertTime) > 3 * 60_000) return false;
      const candidateDescription = alert.description || 'Card / UPI purchase';
      return (item.transactionType ?? 'expense') === (alert.transactionType ?? 'expense') && (
        normalizedDescription(item.description) === normalizedDescription(candidateDescription)
        || genericDescriptions.test(item.description) || genericDescriptions.test(candidateDescription));
    });
    if (!possibleDuplicate) { void saveCapturedAlert(alert); return; }
    Alert.alert('Possible duplicate payment', `A similar ${money(alert.amount)} expense appears near this alert (${possibleDuplicate.description}). Keep both if these were separate payments.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Add anyway', onPress: () => { void saveCapturedAlert(alert); } },
    ]);
  };

  if (!authReady) return <SafeAreaView style={styles.safe} />;
  if (!session) return <AuthScreen />;
  if (profileLoadedFor !== userId || transactionsLoadedFor !== userId) return <SafeAreaView style={styles.safe} />;
  if (!profileSetupComplete) return <OnboardingScreen name={profileNameDraft} income={incomeDraft} error={profileError} busy={profileSaving}
    onNameChange={value => { setProfileNameDraft(value); if (profileError) setProfileError(''); }}
    onIncomeChange={value => { setIncomeDraft(value.replace(/[^\d,]/g, '')); if (profileError) setProfileError(''); }}
    onContinue={() => { void completeOnboarding(); }} />;

  const signOut = async () => {
    try {
      await captureModule?.setCaptureActive?.(false);
      await captureModule?.setAiFallbackEnabled?.(false);
      if (userId) {
        await protectedLocalWrite(preferenceStorageKey(userId, 'capture-enabled'), 'false');
        await protectedLocalWrite(preferenceStorageKey(userId, 'cloud-ai-enabled'), 'false');
      }
      setCaptureOptIn(false); setCloudAiEnabled(false);
      await disableReminders();
      setCaptureEnabled(false);
      setPendingAlerts([]);
      setShowCaptureReview(false);
      const { error } = await supabase!.auth.signOut();
      if (error) Alert.alert('Could not sign out', error.message);
    } catch (error: any) {
      Alert.alert('Could not sign out', error?.message || 'Please try again.');
    }
  };
  const confirmSignOut = () => Alert.alert('Sign out?', 'Alert capture, AI review, and daily reminders will pause on this device until you sign in and enable them again.', [
    { text: 'Stay signed in', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => { void signOut(); } },
  ]);

  const ignoreCaptured = async (alert: CapturedAlert) => {
    try {
      await captureModule?.dismissTransaction(alert.id);
      setPendingAlerts(current => current.filter(item => item.id !== alert.id));
    } catch { Alert.alert('Could not dismiss alert', 'Try again in a moment.'); }
  };

  const exportSpendingData = async () => {
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      ['date', 'description', 'category', 'amount_inr', 'transaction_type', 'payment_method'].map(escape).join(','),
      ...transactions.map(item => [item.date, item.description, item.category, item.amount.toFixed(2), item.transactionType || 'expense', item.method].map(escape).join(',')),
    ].join('\n');
    try { await Share.share({ title: 'Paisa Pilot spending data', message: csv }); }
    catch { Alert.alert('Export unavailable', 'The device could not open its share menu.'); }
  };

  const confirmDeleteSpendingData = () => { setDeleteError(''); setShowDeleteConfirm(true); };

  const deleteSpendingData = async () => {
    if (deletingData) return;
    setDeletingData(true);
    setDeleteError('');
    try {
      if (!apiConfigured || !session?.access_token) throw new Error('Connect the signed-in account API before deleting all data, so cloud records are removed too.');
      await deleteAllTransactions(session.access_token);
    } catch (error: any) {
      setDeleteError(error?.message || 'Cloud deletion did not complete. Local data was left in place.');
      setDeletingData(false);
      return;
    }
    try {
      await captureModule?.setCaptureActive?.(false);
      await captureModule?.setAiFallbackEnabled?.(false);
      await disableReminders();
      if (userId) await AsyncStorage.multiRemove([
        transactionStorageKey(userId), incomeStorageKey(userId), obligationStorageKey(userId), profileNameStorageKey(userId),
        preferenceStorageKey(userId, 'setup-complete'), preferenceStorageKey(userId, 'morning-time'), preferenceStorageKey(userId, 'evening-time'),
        preferenceStorageKey(userId, 'reminders-enabled'), preferenceStorageKey(userId, 'cloud-ai-enabled'), preferenceStorageKey(userId, 'capture-enabled'),
      ]);
      setTransactions([]);
      setTransactionsLoadedFor(userId ?? null);
      setMonthlyIncome(0);
      setIncomeDraft('');
      setObligations([]); setObligationsDraft([]);
      setProfileName(''); setProfileNameDraft(''); setProfileSetupComplete(false);
      setPendingAlerts([]);
      setCaptureEnabled(false); setCaptureOptIn(false);
      setCloudAiEnabled(false);
      setServerInsights([]);
      setShowDeleteConfirm(false);
    } catch (error: any) {
      setDeleteError(`Cloud transactions were deleted, but local cleanup needs attention: ${error?.message || 'open app settings and retry'}.`);
    } finally {
      setDeletingData(false);
    }
  };

  async function completeOnboarding() {
    const name = profileNameDraft.trim().replace(/\s+/g, ' ');
    const income = Number(incomeDraft.replace(/,/g, ''));
    if (name.length < 2 || name.length > 60) { setProfileError('Enter a name between 2 and 60 characters.'); return; }
    if (!Number.isFinite(income) || income <= 0 || income > 100_000_000) { setProfileError('Enter a monthly take-home income greater than ₹0.'); return; }
    if (!userId) { setProfileError('Sign in again to finish setting up your profile.'); return; }
    setProfileSaving(true); setProfileError('');
    try {
      const { error } = await supabase!.auth.updateUser({ data: { full_name: name } });
      if (error) throw error;
      await Promise.all([
        protectedLocalWrite(profileNameStorageKey(userId), name),
        protectedLocalWrite(incomeStorageKey(userId), String(income)),
        protectedLocalWrite(obligationStorageKey(userId), JSON.stringify(obligations)),
        protectedLocalWrite(preferenceStorageKey(userId, 'setup-complete'), 'true'),
      ]);
      setProfileName(name); setProfileNameDraft(name); setMonthlyIncome(income); setIncomeDraft(String(income));
      setProfileSetupComplete(true); setProfileLoadedFor(userId); setObligationsLoadedFor(userId);
    } catch (error: any) {
      setProfileError(error?.message || 'Your profile could not be saved. Check your connection and try again.');
    } finally { setProfileSaving(false); }
  }

  const saveProfileName = async () => {
    const name = profileNameDraft.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 60) { Alert.alert('Check your name', 'Enter a name between 2 and 60 characters.'); return; }
    if (!userId) return;
    setProfileSaving(true);
    try {
      const { error } = await supabase!.auth.updateUser({ data: { full_name: name } });
      if (error) throw error;
      await protectedLocalWrite(profileNameStorageKey(userId), name);
      setProfileName(name);
      Alert.alert('Profile updated', 'Your name has been saved.');
    } catch (error: any) { Alert.alert('Could not update profile', error?.message || 'Try again when you are connected.'); }
    finally { setProfileSaving(false); }
  };

  const openBudgetSettings = () => {
    setIncomeDraft(monthlyIncome ? String(monthlyIncome) : '');
    setObligationsDraft(obligations.map(item => ({ ...item })));
    setMorningTimeDraft(morningTime);
    setEveningTimeDraft(eveningTime);
    setShowBudgetSettings(true);
  };

  const Header = () => <View style={styles.header}>
    <View style={{ flex: 1 }}><Text style={styles.eyebrow}>{dateLabel}</Text><Text style={styles.greeting}>Namaste, {profileName.trim().split(/\s+/)[0] || 'there'}</Text></View>
    <Pressable style={styles.profileButton} accessibilityRole="button" accessibilityLabel="Open profile and settings" onPress={() => setTab('Profile')}><Text style={styles.profileButtonText}>{(profileName.trim()[0] || 'P').toUpperCase()}</Text></Pressable>
  </View>;

  const TransactionRow = ({ item }: { item: Transaction }) => <View style={styles.transactionRow}>
    <View style={[styles.transactionIcon, { backgroundColor: `${item.color}1C` }]}><Text style={{ fontSize: 21 }}>{item.icon}</Text></View>
    <View style={styles.transactionInfo}><Text style={styles.transactionTitle}>{item.description}</Text><Text style={styles.transactionMeta}>{item.category} · {formatDate(item.date)}</Text></View>
    <View style={styles.amountBlock}><Text style={[styles.transactionAmount, item.transactionType === 'refund' && { color: palette.forest }]}>{item.transactionType === 'transfer' ? '↔ ' : item.transactionType === 'income' ? '+ ' : item.transactionType === 'refund' ? '+ ' : '−'}{money(item.amount)}</Text><Text style={styles.paymentMeta}>{item.transactionType === 'transfer' ? 'Transfer · excluded from spend' : item.method}</Text></View>
  </View>;

  const CategoryBreakdown = () => <View style={styles.card}>
    <View style={styles.cardHeading}><View><Text style={styles.sectionTitle}>Where it goes</Text><Text style={styles.sectionSubtitle}>Your tracked spend by category</Text></View><Text style={styles.monthTag}>{monthLabel}</Text></View>
    {sortedCategories.length === 0 && <Text style={styles.emptyCopy}>Your category breakdown will appear after you add an expense.</Text>}
    {sortedCategories.slice(0, 5).map(([name, value]) => {
      const meta = getCategoryMeta(name);
      return <View key={name} style={styles.categoryRow}>
        <Text style={styles.categoryIcon}>{meta.icon}</Text><Text style={styles.categoryName}>{name}</Text>
        <View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.max(5, value / Math.max(total, 1) * 100)}%`, backgroundColor: meta.color }]} /></View>
        <Text style={styles.categoryAmount}>{money(value)}</Text>
      </View>;
    })}
    <Pressable style={styles.textButton} onPress={() => setTab('Activity')}><Text style={styles.textButtonLabel}>See all categories  →</Text></Pressable>
  </View>;

  const InsightCard = () => <View style={styles.insightCard}>
    <View style={styles.insightTop}><View style={styles.sparkle}><Text style={{ fontSize: 17 }}>✦</Text></View><Text style={styles.insightLabel}>A PATTERN TO REVIEW</Text><View style={{ flex: 1 }} /><Text style={styles.aiTag}>OPTIONAL IDEA</Text></View>
    <Text style={styles.insightTitle}>{session && serverInsights.length ? serverInsights[0].title : total === 0 ? 'Track a few purchases first' : discretionary / total > 0.28 ? 'Review flexible spending' : sortedCategories[0] ? `Review ${sortedCategories[0][0].toLowerCase()}` : 'Keep tracking to spot a pattern'}</Text>
    <Text style={styles.insightBody}>{session && serverInsights.length ? serverInsights[0].body : total === 0 ? 'There is not enough recorded spending to suggest a pattern yet. Add a few purchases; ideas use only the entries you track.' : discretionary / total > 0.28
      ? `${money(discretionary)} (${Math.round(discretionary / total * 100)}%) of your ${money(total)} tracked spend this month is in dining, entertainment, or shopping. If lowering it is a goal, choose one category and try a weekly limit. This is an optional prompt, not a savings forecast.`
      : sortedCategories[0] ? `${money(sortedCategories[0][1])} (${Math.round(sortedCategories[0][1] / total * 100)}%) of your tracked spend is currently in ${sortedCategories[0][0].toLowerCase()}. If useful, review a few entries for accuracy and decide whether any part is flexible. Keep required bills and repayments protected.`
        : 'Keep recording purchases to see how your spending mix changes. Unrecorded spending is not included.'}</Text>
    <Text style={styles.insightFoot}>Based on tracked purchases · categories can be approximate · your choice</Text>
  </View>;

  const DailyPlanCard = () => <View style={styles.card}>
    <View style={styles.cardHeading}><View><Text style={styles.sectionTitle}>Your daily plan</Text><Text style={styles.sectionSubtitle}>Income after planned monthly commitments</Text></View><Text style={styles.planMark}>◷</Text></View>
    {monthlyIncome > 0 ? <>
      <View style={styles.budgetNumbers}><View><Text style={styles.budgetLabel}>GUIDE FOR TODAY</Text><Text style={styles.budgetAmount}>{money(dailyBudget)}</Text></View><View style={styles.budgetRight}><Text style={styles.budgetLabel}>DISCRETIONARY SPEND</Text><Text style={styles.budgetAmount}>{money(todaySpent)}</Text></View></View>
      <View style={styles.budgetTrack}><View style={[styles.budgetFill, { width: `${Math.min(100, todaySpent / Math.max(dailyBudget, 1) * 100)}%`, backgroundColor: todaySpent > dailyBudget ? palette.rose : palette.forest }]} /></View>
      <Text style={styles.budgetHint}>{todaySpent <= dailyBudget ? `${money(dailyPlan.todayRemaining)} left in today’s guide` : `${money(todaySpent - dailyBudget)} above today’s guide · no judgment, just a signal`}</Text>
      <View style={styles.weekHeader}><Text style={styles.weekTitle}>LAST 7 DAYS · EVERYDAY SPEND</Text><Text style={styles.weekLegend}>line = that day’s guide</Text></View>
      <View style={styles.weekBars}>{weekSpend.map((day, index) => <View key={`${day.label}-${index}`} style={styles.weekDay}><View style={styles.weekBarArea}><View style={[styles.weekBudgetLine, { bottom: `${Math.min(100, day.guide / maxWeekSpend * 100)}%` }]} /><View style={[styles.weekBar, { height: `${Math.max(4, day.spend / maxWeekSpend * 100)}%`, backgroundColor: day.spend > day.guide ? '#D28D85' : '#8DB5A2' }]} /></View><Text style={styles.weekDayLabel}>{day.label}</Text></View>)}</View>
      <Text style={styles.budgetFoot}>{money(dailyPlan.outstandingObligations)} in commitments remain reserved · leftover budget rolls across {dailyPlan.daysRemaining} remaining days. Manage commitments and reminders in Profile.</Text>
    </> : <View style={styles.setupBudget}><Text style={styles.setupBudgetTitle}>Your plan is paused</Text><Text style={styles.setupBudgetBody}>Add monthly income and commitments in Profile to create a daily guide.</Text></View>}
  </View>;

  const MonthReviewCard = () => monthlyIncome > 0 ? <View style={styles.monthReview}>
    <View style={styles.cardHeading}><View><Text style={styles.monthReviewEyebrow}>{monthFinished ? 'MONTH COMPLETE' : 'MONTH TO DATE'}</Text><Text style={styles.monthReviewTitle}>{monthFinished ? 'Your month, in view' : `${today.toLocaleDateString('en-IN', { month: 'long' })} so far`}</Text></View><Text style={styles.monthReviewIcon}>◷</Text></View>
    <Text style={styles.monthReviewAmount}>{money(total)} <Text style={styles.monthReviewOf}>of {money(monthlyIncome)}</Text></Text>
    <Text style={styles.monthReviewBody}>{monthFinished ? `You tracked ${money(total)} in purchases this month. After planned commitments, about ${money(dailyPlan.budgetRemaining)} remains.` : `About ${money(dailyPlan.budgetRemaining)} remains after tracked purchases and planned commitments. ${daysInMonth - today.getDate() + 1} calendar days remain, including today.`}</Text>
    <View style={styles.monthProgressTrack}><View style={[styles.monthProgressFill, { width: `${Math.min(100, total / Math.max(monthlyIncome, 1) * 100)}%` }]} /></View>
    <Text style={styles.monthReviewFoot}>Based on tracked transactions · profile settings control your budget</Text>
  </View> : null;

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
      <Pressable onPress={() => { setExpenseError(''); setShowAdd(true); }} style={styles.primaryAction}><Text style={styles.actionPlus}>＋</Text><Text style={styles.primaryActionLabel}>Add expense</Text></Pressable>
      <Pressable onPress={() => setTab('Activity')} style={styles.secondaryAction}><Text style={styles.actionIcon}>◷</Text><Text style={styles.secondaryActionLabel}>View activity</Text></Pressable>
    </View>
    <DailyPlanCard />
    <MonthReviewCard />
    <CategoryBreakdown />
    <InsightCard />
    <View style={styles.card}>
      <View style={styles.cardHeading}><View><Text style={styles.sectionTitle}>Recent activity</Text><Text style={styles.sectionSubtitle}>Your latest expenses</Text></View><Pressable onPress={() => setTab('Activity')}><Text style={styles.textButtonLabel}>See all</Text></Pressable></View>
      {transactions.length ? transactions.slice(0, 4).map(item => <TransactionRow key={item.id} item={item} />) : <Text style={styles.emptyCopy}>No expenses yet. Add one manually or set up notification capture.</Text>}
    </View>
    <Text style={styles.footerNote}>{apiConfigured ? syncMessage || 'Syncing to your private account…' : `${apiConfigurationIssue} Local data stays on this device.`}</Text>
  </>;

  const Activity = () => <>
    <Header /><View style={styles.pageTitle}><Text style={styles.pageHeading}>Your activity</Text><Text style={styles.pageSubheading}>{transactions.length} tracked transactions</Text></View>
    <View style={styles.totalStrip}><Text style={styles.totalStripLabel}>TOTAL THIS MONTH</Text><Text style={styles.totalStripValue}>{money(total)}</Text></View>
    <View style={styles.card}>{transactions.length ? transactions.map(item => <TransactionRow key={item.id} item={item} />) : <Text style={styles.emptyCopy}>Your activity will show here when you add expenses.</Text>}</View>
    <CategoryBreakdown />
    <Pressable onPress={() => { setExpenseError(''); setShowAdd(true); }} style={styles.wideAction}><Text style={styles.primaryActionLabel}>＋   Add an expense</Text></Pressable>
  </>;

  const Insights = () => <>
    <Header /><View style={styles.pageTitle}><Text style={styles.pageHeading}>Gentle money ideas</Text><Text style={styles.pageSubheading}>Small changes, chosen by you.</Text></View>
    <InsightCard />
    <SpendingRhythmCard transactions={transactions} monthlyIncome={monthlyIncome} obligations={obligations} categoryMeta={categoryMeta} todayKey={todayKey} />
    <CategoryBreakdown />
    <View style={styles.card}><Text style={styles.sectionTitle}>A few places to look</Text><Text style={styles.sectionSubtitle}>Based on what you have tracked so far</Text>
      {[
        { icon: '🔁', title: 'Subscriptions', body: 'Check for services you no longer use or duplicate memberships.' },
        { icon: '🍽️', title: 'Eating out', body: 'Planning one meal at home can make room for an outing you care about.' },
        { icon: '🛒', title: 'Small frequent buys', body: 'Combining a few daily essentials into one planned shop may help.' },
      ].map(item => <View key={item.title} style={styles.ideaRow}><Text style={styles.ideaIcon}>{item.icon}</Text><View style={{ flex: 1 }}><Text style={styles.ideaTitle}>{item.title}</Text><Text style={styles.ideaBody}>{item.body}</Text></View></View>)}
    </View>
    <View style={styles.kindNote}><Text style={styles.kindTitle}>No shame, just signals.</Text><Text style={styles.kindBody}>These are simple prompts, not financial advice. Keep the spending that matters to you.</Text></View>
  </>;

  const Profile = () => <>
    <Header /><View style={styles.pageTitle}><Text style={styles.pageHeading}>Your profile</Text><Text style={styles.pageSubheading}>Your details, budget, and app settings.</Text></View>
    <View style={styles.card}>
      <View style={styles.profileIdentity}><View style={styles.profileAvatarLarge}><Text style={styles.profileAvatarLargeText}>{(profileName.trim()[0] || 'P').toUpperCase()}</Text></View><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Account details</Text><Text style={styles.sectionSubtitle}>{session?.user?.email || 'Signed-in account'}</Text></View></View>
      <Text style={styles.fieldLabel}>YOUR NAME</Text><TextInput value={profileNameDraft} onChangeText={setProfileNameDraft} placeholder="Your name" placeholderTextColor="#A9B3AD" autoCapitalize="words" style={styles.textInput} />
      <Pressable disabled={profileSaving || profileNameDraft.trim() === profileName} onPress={() => { void saveProfileName(); }} style={[styles.profileSaveButton, (profileSaving || profileNameDraft.trim() === profileName) && styles.profileSaveDisabled]}><Text style={styles.profileSaveText}>{profileSaving ? 'Saving…' : 'Save name'}</Text></Pressable>
      <Text style={styles.profileFoot}>Your name also updates your signed-in profile. Budget details remain protected on this device.</Text>
    </View>

    <View style={styles.card}>
      <View style={styles.cardHeading}><View><Text style={styles.sectionTitle}>Budget and commitments</Text><Text style={styles.sectionSubtitle}>Tune your daily guide and required payments.</Text></View><Text style={styles.planMark}>◷</Text></View>
      <View style={styles.profileMetricRow}><View><Text style={styles.budgetLabel}>MONTHLY TAKE-HOME</Text><Text style={styles.profileMetric}>{money(monthlyIncome)}</Text></View><View style={styles.budgetRight}><Text style={styles.budgetLabel}>COMMITMENTS</Text><Text style={styles.profileMetric}>{money(plannedCommitmentTotal)}</Text></View></View>
      <Text style={styles.profileFoot}>{obligations.length} planned payment{obligations.length === 1 ? '' : 's'} · {money(dailyPlan.outstandingObligations)} still reserved this month</Text>
      <Pressable onPress={openBudgetSettings} style={styles.profileAction}><Text style={styles.profileActionText}>Edit budget and commitments</Text><Text style={styles.profileActionArrow}>›</Text></Pressable>
    </View>

    <View style={styles.card}>
      <View style={styles.cardHeading}><View><Text style={styles.sectionTitle}>Daily reminders</Text><Text style={styles.sectionSubtitle}>{morningTime} morning · {eveningTime} evening · this Android device</Text></View><Switch value={remindersEnabled} onValueChange={value => { void setReminderPreference(value); }} trackColor={{ false: '#DCE4DE', true: '#9BCDB8' }} thumbColor={remindersEnabled ? palette.forest : '#FFFFFF'} accessibilityLabel="Daily reminders" /></View>
      <Text style={styles.profileFoot}>The morning note uses your remaining flexible budget. The evening note reports tracked outflow. Set the times in Budget and commitments.</Text>
    </View>

    <View style={styles.captureCard}>
      <View style={styles.captureHeader}><Text style={styles.captureIcon}>◉</Text><View style={{ flex: 1 }}><Text style={styles.captureTitle}>Transaction alerts</Text><Text style={styles.captureSubtitle}>{captureEnabled ? 'On · matched locally on this phone' : captureOptIn ? 'Waiting for Android notification access' : 'Optional · Android notification access'}</Text></View><View style={[styles.captureStatus, captureEnabled && styles.captureStatusOn]}><Text style={[styles.captureStatusText, captureEnabled && styles.captureStatusTextOn]}>{captureEnabled ? 'ON' : 'OFF'}</Text></View></View>
      <Text style={styles.captureBody}>Match bank, payment, shopping, delivery, travel, ticketing, and subscription alerts. Possible purchases stay on this device until you review them. Notification access can see the content of notifications from other apps.</Text>
      {captureEnabled && <Text style={styles.captureDiagnostic}>{captureDiagnostics?.active === false ? 'Capture is paused. Tap Review alerts to resume.' : captureDiagnostics?.checks ? `${captureDiagnostics.checks} notifications checked · Last: ${captureDiagnostics.lastSource || 'App'} — ${captureDiagnostics.lastResult || 'checking'}` : 'Waiting for a transaction notification. Notification text is not saved to your account.'}</Text>}
      <View style={styles.aiToggleRow}><View style={{ flex: 1 }}><Text style={styles.aiToggleTitle}>Optional AI review</Text><Text style={styles.aiToggleStatus}>{!aiServiceAvailable ? aiStatusMessage : cloudAiEnabled ? (aiProcessing ? 'Reviewing a redacted alert…' : 'On · only if local rules are unsure') : 'Off · alert parsing stays on this phone'}</Text></View><Switch value={cloudAiEnabled && aiServiceAvailable} disabled={!captureEnabled || !aiServiceAvailable} onValueChange={setCloudAiPreference} trackColor={{ false: '#DCE4DE', true: '#9BCDB8' }} thumbColor={cloudAiEnabled ? palette.forest : '#FFFFFF'} accessibilityLabel="Optional AI review" /></View>
      <Text style={styles.aiPrivacy}>If enabled, an unmatched alert is redacted before AI review. Usage is limited per account. Turn this off any time.</Text>
      <View style={styles.captureButtons}><Pressable onPress={() => { if (captureEnabled) setShowCaptureReview(true); else void enableCapture(); }} style={styles.capturePrimary}><Text style={styles.capturePrimaryText}>{captureEnabled ? `Review alerts${pendingAlerts.length ? ` · ${pendingAlerts.length}` : ''}` : 'Set up alert capture'}</Text></Pressable>{captureEnabled && <Pressable onPress={() => { void disableCapture(); }} style={styles.captureSecondary}><Text style={styles.captureSecondaryText}>Turn off</Text></Pressable>}</View>
      {Platform.OS === 'android' && <Pressable onPress={() => captureModule?.openSettings?.()} style={styles.profileLinkButton}><Text style={styles.profileLinkText}>Android notification access settings</Text></Pressable>}
    </View>

    <View style={styles.card}><Text style={styles.sectionTitle}>Your data</Text><Text style={styles.sectionSubtitle}>Export a copy or remove your spending history.</Text>
      <View style={styles.captureButtons}><Pressable onPress={() => { void exportSpendingData(); }} style={styles.captureSecondary}><Text style={styles.captureSecondaryText}>Export CSV</Text></Pressable><Pressable onPress={confirmDeleteSpendingData} style={[styles.captureSecondary, { borderColor: '#E8C9C4' }]}><Text style={[styles.captureSecondaryText, { color: palette.rose }]}>Delete my data</Text></Pressable></View>
      <Text style={styles.aiPrivacy}>Delete removes account transactions and this device’s profile and plan settings. Your login remains active; review an account deletion request separately with support.</Text>
    </View>
    <View style={styles.signOutCard}><Text style={styles.sectionTitle}>Session</Text><Text style={styles.sectionSubtitle}>Signing out pauses alert capture, AI review, and reminders.</Text><Pressable onPress={confirmSignOut} style={styles.signOutAction}><Text style={styles.signOutActionText}>Sign out</Text></Pressable></View>
  </>;

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="dark-content" backgroundColor={palette.paper} /><ExpoStatusBar style="dark" />
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {tab === 'Home' ? <Home /> : tab === 'Activity' ? <Activity /> : tab === 'Insights' ? <Insights /> : <Profile />}
    </ScrollView>
    <View style={styles.tabBar}>{([
      ['Home', '⌂'], ['Activity', '◷'], ['Insights', '✧'], ['Profile', '○'],
    ] as [Tab, string][]).map(([name, icon]) => <Pressable key={name} onPress={() => setTab(name)} style={styles.tabItem}>
      <Text style={[styles.tabIcon, tab === name && styles.tabIconActive]}>{icon}</Text><Text style={[styles.tabLabel, tab === name && styles.tabLabelActive]}>{name}</Text>
      {tab === name && <View style={styles.tabIndicator} />}
    </Pressable>)}</View>
    <Modal visible={showAdd} animationType="slide" transparent onRequestClose={() => setShowAdd(false)}>
      <View style={styles.modalBackdrop}><View style={styles.sheet}>
        <View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Add an expense</Text><Text style={styles.sheetSubtitle}>A quick note is all you need.</Text></View><Pressable onPress={() => setShowAdd(false)} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable></View>
        <Text style={styles.fieldLabel}>HOW MUCH?</Text><View style={styles.moneyInputWrap}><Text style={styles.rupee}>₹</Text><TextInput value={amount} onChangeText={value => { setAmount(value); if (expenseError) setExpenseError(''); }} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#A9B3AD" style={styles.moneyInput} autoFocus accessibilityLabel="Expense amount" /></View>
        <Text style={styles.fieldLabel}>WHAT WAS IT FOR?</Text><TextInput value={description} onChangeText={value => { setDescription(value); if (expenseError) setExpenseError(''); }} placeholder="e.g. Vegetables from the market" placeholderTextColor="#A9B3AD" style={styles.textInput} accessibilityLabel="Expense description" />
        <Text style={styles.fieldLabel}>CATEGORY</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryPicker}>{(Object.keys(categoryMeta) as Category[]).map(name => <Pressable onPress={() => setCategory(name)} key={name} style={[styles.categoryChip, category === name && styles.categoryChipSelected]}><Text style={styles.chipIcon}>{categoryMeta[name].icon}</Text><Text style={[styles.chipLabel, category === name && styles.chipLabelSelected]}>{name}</Text></Pressable>)}</ScrollView>
        {expenseError ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.expenseValidationError}>{expenseError}</Text> : null}
        <Pressable onPress={saveExpense} style={styles.saveButton}><Text style={styles.saveButtonText}>Save expense</Text></Pressable>
        <Text style={styles.modalPrivacy}>{apiConfigured ? 'Saved on this device. Cloud sync status appears on Home.' : 'Saved on this device · Cloud sync is not configured.'}</Text>
      </View></View>
    </Modal>
    <Modal visible={showBudgetSettings} animationType="slide" transparent onRequestClose={() => setShowBudgetSettings(false)}>
      <View style={styles.modalBackdrop}><View style={[styles.sheet, { maxHeight: '94%' }]}><ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Your daily plan</Text><Text style={styles.sheetSubtitle}>A flexible guide, made for your month.</Text></View><Pressable onPress={() => setShowBudgetSettings(false)} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable></View>
        <Text style={styles.fieldLabel}>MONTHLY TAKE-HOME INCOME</Text><View style={styles.moneyInputWrap}><Text style={styles.rupee}>₹</Text><TextInput value={incomeDraft} onChangeText={setIncomeDraft} keyboardType="decimal-pad" placeholder="100000" placeholderTextColor="#A9B3AD" style={styles.moneyInput} /></View>
        <Text style={styles.fieldLabel}>MONTHLY COMMITMENTS</Text>
        {obligationsDraft.map(item => { const paid = Number(dailyPlan.paidById[item.id] || 0); return <View key={item.id} style={styles.obligationRow}><View style={{ flex: 1 }}><Text style={styles.obligationName}>{item.name}</Text><Text style={styles.obligationMeta}>{item.category} · {money(item.amount)} / month · {money(paid)} matched this month</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`} onPress={() => setObligationsDraft(current => current.filter(entry => entry.id !== item.id))} style={styles.ignoreAlertButton}><Text style={styles.ignoreAlertText}>×</Text></Pressable></View>; })}
        <View style={styles.obligationInputs}><TextInput value={obligationNameDraft} onChangeText={setObligationNameDraft} placeholder="e.g. House rent, Airtel, LIC" placeholderTextColor="#A9B3AD" style={[styles.textInput, { flex: 1 }]} /><TextInput value={obligationAmountDraft} onChangeText={setObligationAmountDraft} keyboardType="decimal-pad" placeholder="₹ amount" placeholderTextColor="#A9B3AD" style={[styles.textInput, { width: 92 }]} /></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryPicker}>{(['Bills & utilities', 'Loan & EMI', 'Other'] as Category[]).map(name => <Pressable onPress={() => setObligationCategoryDraft(name)} key={name} style={[styles.categoryChip, obligationCategoryDraft === name && styles.categoryChipSelected]}><Text style={[styles.chipLabel, obligationCategoryDraft === name && styles.chipLabelSelected]}>{name}</Text></Pressable>)}</ScrollView>
        <Pressable onPress={addMonthlyObligation} style={styles.captureSecondary}><Text style={styles.captureSecondaryText}>＋ Add commitment</Text></Pressable>
        <View style={styles.budgetExplain}>
          <Text style={styles.budgetExplainTitle}>How your daily guide is worked out</Text>
          <Text style={styles.budgetExplainLine}>{money(draftMonthlyIncome)} take-home income − {money(draftCommitmentTotal)} planned commitments = {money(flexibleMonthlyAmount)} for everyday spending.</Text>
          <Text style={styles.budgetExplainLine}>{money(flexibleMonthlyAmount)} ÷ {daysInMonth} days this month = about {money(startingDailyGuide)} per day to start.</Text>
          <Text style={styles.budgetExplainBody}>Each day, tracked everyday purchases are taken from the remaining pool and the balance is shared across the days left. Spend below the guide and the spare amount rolls forward; spend above it and future daily guides adjust down.</Text>
          <Text style={styles.budgetExplainBody}>Bills are reserved at the start. When a matching bill or loan debit is recorded, it marks that commitment as paid without subtracting it twice.</Text>
          <Text style={styles.budgetExplainExample}>Example: ₹1,00,000 income − ₹40,000 commitments = ₹60,000 ÷ 30 days = ₹2,000/day to start.</Text>
          <Text style={styles.budgetExplainFine}>Bill and loan matches use category; other commitments need a matching name and similar amount. Add a credit-card bill only if its underlying purchases are not already tracked.</Text>
        </View>
        <View style={styles.timeFields}><TimeControl label="MORNING REMINDER" value={morningTimeDraft} onChange={setMorningTimeDraft} /><TimeControl label="EVENING REVIEW" value={eveningTimeDraft} onChange={setEveningTimeDraft} /></View>
        <Text style={styles.timeHint}>24-hour clock · hours 00–23 · minutes 00–59. Tap + or − to adjust. Reminders and commitments are saved on this device.</Text>
        <View style={styles.budgetSheetActions}><Pressable onPress={() => setShowBudgetSettings(false)} style={styles.cancelPlanButton}><Text style={styles.cancelPlanText}>Cancel</Text></Pressable><Pressable onPress={saveBudgetSettings} style={[styles.saveButton, styles.savePlanButton]}><Text style={styles.saveButtonText}>Save daily plan</Text></Pressable></View>
        <Text style={styles.modalPrivacy}>Income and commitments are protected in Android local storage.</Text>
      </ScrollView></View></View>
    </Modal>
    <Modal visible={showCaptureReview} animationType="slide" transparent onRequestClose={() => setShowCaptureReview(false)}>
      <View style={styles.modalBackdrop}><View style={styles.sheet}>
        <View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Review transaction alerts</Text><Text style={styles.sheetSubtitle}>Add only the purchases you recognize.</Text></View><Pressable onPress={() => setShowCaptureReview(false)} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable></View>
        {pendingAlerts.length ? pendingAlerts.map(item => <View key={item.id} style={styles.pendingRow}><View style={{ flex: 1 }}><Text style={styles.pendingDescription}>{item.description || 'Payment alert'}</Text><Text style={styles.pendingSource}>{item.transactionType === 'transfer' ? 'Transfer · excluded from spend until reviewed' : item.aiConfidence != null ? `AI suggestion · please verify · ${item.category || 'Other'}` : `${item.packageName.replace(/^.*\./, '')} · ${new Date(item.date).toLocaleString()}`}</Text></View><Text style={styles.pendingAmount}>{money(item.amount)}</Text><Pressable onPress={() => acceptCaptured(item)} style={styles.addAlertButton}><Text style={styles.addAlertText}>{item.transactionType === 'transfer' ? 'Add transfer' : 'Add'}</Text></Pressable><Pressable onPress={() => ignoreCaptured(item)} style={styles.ignoreAlertButton}><Text style={styles.ignoreAlertText}>×</Text></Pressable></View>) : <Text style={styles.emptyAlerts}>No matching alerts yet. Payment and app notifications will appear here when they include readable spending details.</Text>}
        <Text style={styles.modalPrivacy}>Candidate alerts stay on this device until you add or dismiss them.</Text>
      </View></View>
    </Modal>
    <Modal visible={showDeleteConfirm} animationType="fade" transparent onRequestClose={() => { if (!deletingData) setShowDeleteConfirm(false); }}>
      <View style={[styles.modalBackdrop, { justifyContent: 'center', padding: 22 }]}>
        <View style={{ backgroundColor: palette.white, borderRadius: 20, padding: 20, width: '100%', maxWidth: 460, alignSelf: 'center' }}>
          <Text style={styles.sheetTitle}>Delete spending history?</Text>
          <Text style={[styles.sheetSubtitle, { fontSize: 12, lineHeight: 19, marginTop: 9 }]}>This permanently deletes this account’s cloud transactions and this device’s saved transactions, income, commitments, reminder settings, and alert preferences. Your sign-in remains active. This cannot be undone.</Text>
          {deleteError ? <Text accessibilityRole="alert" style={styles.expenseValidationError}>{deleteError}</Text> : null}
          <View style={[styles.budgetSheetActions, { marginTop: 18 }]}>
            <Pressable accessibilityRole="button" onPress={() => { if (!deletingData) setShowDeleteConfirm(false); }} style={styles.cancelPlanButton}><Text style={styles.cancelPlanText}>Keep my data</Text></Pressable>
            <Pressable accessibilityRole="button" disabled={deletingData} onPress={() => { void deleteSpendingData(); }} style={[styles.saveButton, { flex: 1, marginTop: 0, backgroundColor: palette.rose, opacity: deletingData ? 0.65 : 1 }]}><Text style={styles.saveButtonText}>{deletingData ? 'Deleting…' : 'Delete data'}</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.paper }, content: { paddingHorizontal: 20, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, paddingBottom: 20 },
  eyebrow: { fontSize: 10, letterSpacing: 1.4, color: palette.muted, fontWeight: '700' }, greeting: { color: palette.ink, fontSize: 21, fontWeight: '700', marginTop: 4 },
  profileButton: { width: 42, height: 42, borderRadius: 15, backgroundColor: palette.mint, borderWidth: 1, borderColor: '#D5E9DB', alignItems: 'center', justifyContent: 'center' }, profileButtonText: { color: palette.forest, fontSize: 16, fontWeight: '800' },
  hero: { backgroundColor: '#155B47', borderRadius: 24, paddingHorizontal: 22, paddingTop: 21, paddingBottom: 18, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, heroCaption: { fontSize: 10, letterSpacing: 1.4, fontWeight: '700', color: '#C2DDD0' },
  livePill: { backgroundColor: '#FFFFFF1A', borderRadius: 20, flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 9 }, liveDot: { width: 6, height: 6, backgroundColor: '#9FD2A9', borderRadius: 4, marginRight: 6 }, liveText: { fontSize: 9, letterSpacing: 1, color: '#DDEDE3', fontWeight: '700' },
  heroAmount: { color: '#FFFFFF', fontSize: 38, fontWeight: '700', letterSpacing: -1.1, marginTop: 13 }, heroDivider: { height: 1, backgroundColor: '#FFFFFF25', marginTop: 17, marginBottom: 15 },
  heroBottom: { flexDirection: 'row', justifyContent: 'space-between' }, heroRight: { alignItems: 'flex-end' }, heroFootLabel: { color: '#B3D4C4', fontSize: 9, letterSpacing: 1.15, fontWeight: '700' }, heroFootValue: { color: '#FFFFFF', fontWeight: '600', fontSize: 13, marginTop: 4 }, heroOrb: { position: 'absolute', width: 140, height: 140, borderRadius: 100, borderWidth: 24, borderColor: '#FFFFFF08', right: -63, top: 50 },
  quickActions: { flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 17 }, primaryAction: { flex: 1, height: 48, backgroundColor: palette.forest, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  actionPlus: { fontSize: 20, color: '#FFFFFF', fontWeight: '400', marginRight: 8, marginTop: -2 }, primaryActionLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  secondaryAction: { flex: 1, height: 48, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.line, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }, actionIcon: { color: palette.forest, fontSize: 17, marginRight: 8 }, secondaryActionLabel: { color: palette.ink, fontWeight: '700', fontSize: 12 },
  editPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: palette.mint }, editPillText: { color: palette.forest, fontSize: 9, fontWeight: '800', letterSpacing: .6 }, planMark: { color: palette.forest, backgroundColor: palette.mint, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5, fontSize: 14, fontWeight: '700' }, budgetNumbers: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 1 }, budgetRight: { alignItems: 'flex-end' }, budgetLabel: { color: '#89958D', fontSize: 8, fontWeight: '800', letterSpacing: .8 }, budgetAmount: { color: palette.ink, fontSize: 20, fontWeight: '700', marginTop: 4 }, budgetTrack: { height: 7, borderRadius: 5, overflow: 'hidden', backgroundColor: '#EDF1ED', marginTop: 12 }, budgetFill: { height: '100%', borderRadius: 5 }, budgetHint: { color: palette.muted, fontSize: 10, marginTop: 7 }, weekHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 19, marginBottom: 8 }, weekTitle: { color: '#77847C', fontSize: 8, fontWeight: '800', letterSpacing: .8 }, weekLegend: { color: '#9AA49E', fontSize: 8 }, weekBars: { height: 72, flexDirection: 'row', justifyContent: 'space-around', gap: 9 }, weekDay: { flex: 1, alignItems: 'center' }, weekBarArea: { width: '100%', height: 51, justifyContent: 'flex-end', alignItems: 'center', borderBottomWidth: 1, borderColor: '#E9EEEA', position: 'relative' }, weekBudgetLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#E5B84C' }, weekBar: { width: '58%', borderTopLeftRadius: 4, borderTopRightRadius: 4, minHeight: 2 }, weekDayLabel: { color: '#8A968E', fontSize: 8, marginTop: 5 }, budgetFoot: { color: '#98A29C', fontSize: 8, lineHeight: 12, marginTop: 11 }, setupBudget: { borderRadius: 14, padding: 14, backgroundColor: '#F4F8F4' }, setupBudgetTitle: { color: palette.ink, fontSize: 13, fontWeight: '700' }, setupBudgetBody: { color: palette.muted, fontSize: 10, lineHeight: 15, marginTop: 5 }, monthReview: { backgroundColor: '#EFF6F0', borderColor: '#DDEBE0', borderWidth: 1, borderRadius: 20, padding: 17, marginBottom: 14 }, monthReviewEyebrow: { color: palette.forest, fontSize: 8, fontWeight: '800', letterSpacing: 1 }, monthReviewTitle: { color: palette.ink, fontSize: 15, fontWeight: '700', marginTop: 5 }, monthReviewIcon: { color: palette.forest, fontSize: 22 }, monthReviewAmount: { color: palette.forest, fontSize: 25, fontWeight: '800', marginTop: 11 }, monthReviewOf: { color: '#688477', fontSize: 12, fontWeight: '600' }, monthReviewBody: { color: '#5F7066', fontSize: 10, lineHeight: 16, marginTop: 5 }, monthProgressTrack: { height: 6, backgroundColor: '#DCE8DF', borderRadius: 5, marginTop: 12, overflow: 'hidden' }, monthProgressFill: { height: '100%', borderRadius: 5, backgroundColor: palette.forest }, monthReviewFoot: { color: '#87978C', fontSize: 8, marginTop: 8 }, budgetExplain: { backgroundColor: '#F4F8F4', borderRadius: 12, padding: 12, marginTop: 8 }, budgetExplainTitle: { color: palette.forest, fontSize: 11, fontWeight: '800', marginBottom: 5 }, budgetExplainLine: { color: palette.ink, fontSize: 10, lineHeight: 15, marginTop: 3 }, budgetExplainBody: { color: '#66736B', fontSize: 9, lineHeight: 14, marginTop: 7 }, budgetExplainExample: { color: palette.forest, fontSize: 9, lineHeight: 14, fontWeight: '700', marginTop: 8 }, budgetExplainFine: { color: '#929D96', fontSize: 8, lineHeight: 12, marginTop: 7 }, timeFields: { flexDirection: 'row', gap: 10 }, timeField: { flex: 1 }, timeInput: { height: 48, backgroundColor: palette.white, borderRadius: 12, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 13, color: palette.ink, fontSize: 14, fontWeight: '600' }, timeHint: { color: palette.muted, fontSize: 9, lineHeight: 14, marginTop: 10 },
  card: { backgroundColor: palette.white, borderRadius: 20, paddingHorizontal: 16, paddingTop: 17, paddingBottom: 12, marginBottom: 14, borderWidth: 1, borderColor: '#EEF1EE' }, cardHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }, sectionTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' }, sectionSubtitle: { color: palette.muted, fontSize: 11, marginTop: 4 }, monthTag: { color: palette.forest, backgroundColor: palette.mint, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 13 }, categoryIcon: { width: 23, fontSize: 15 }, categoryName: { width: 107, fontSize: 11, color: '#44514A', fontWeight: '600' }, barTrack: { flex: 1, height: 6, borderRadius: 5, backgroundColor: '#F0F3F0', overflow: 'hidden' }, barFill: { height: 6, borderRadius: 5 }, categoryAmount: { width: 54, textAlign: 'right', fontSize: 10, color: palette.ink, fontWeight: '700' },
  textButton: { alignSelf: 'flex-start', paddingTop: 4, paddingBottom: 2 }, textButtonLabel: { color: palette.forest, fontSize: 11, fontWeight: '700' },
  insightCard: { backgroundColor: '#FFF9E9', borderColor: '#F7EBC8', borderWidth: 1, borderRadius: 20, padding: 17, marginBottom: 14 }, insightTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 }, sparkle: { backgroundColor: '#F8E9B8', width: 27, height: 27, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginRight: 8 }, insightLabel: { color: '#8E7134', fontSize: 9, fontWeight: '800', letterSpacing: 1.05 }, aiTag: { color: '#9A7C36', backgroundColor: '#F8EBC7', fontSize: 8, fontWeight: '800', letterSpacing: .7, paddingHorizontal: 7, paddingVertical: 5, borderRadius: 6 },
  insightTitle: { color: palette.ink, fontSize: 16, fontWeight: '700', marginBottom: 6 }, insightBody: { color: '#5F6257', fontSize: 12, lineHeight: 18 }, insightFoot: { color: '#9A8C69', fontSize: 9, marginTop: 12 },
  transactionRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0F2F0' }, transactionIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 11 }, transactionInfo: { flex: 1 }, transactionTitle: { fontSize: 12, color: palette.ink, fontWeight: '700' }, transactionMeta: { fontSize: 10, color: palette.muted, marginTop: 5 }, amountBlock: { alignItems: 'flex-end', marginLeft: 5 }, transactionAmount: { color: palette.ink, fontSize: 12, fontWeight: '700' }, paymentMeta: { color: '#95A098', fontSize: 9, marginTop: 4 }, footerNote: { textAlign: 'center', color: '#98A29C', fontSize: 9, lineHeight: 14, marginHorizontal: 15, marginTop: 1 }, emptyCopy: { color: palette.muted, fontSize: 11, lineHeight: 16, paddingVertical: 8 },
  tabBar: { height: 64, backgroundColor: palette.white, borderTopWidth: 1, borderColor: palette.line, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingHorizontal: 15 }, tabItem: { width: 76, alignItems: 'center', justifyContent: 'center', height: 58 }, tabIcon: { fontSize: 21, color: '#8B9890', height: 25 }, tabIconActive: { color: palette.forest }, tabLabel: { fontSize: 9, color: '#8B9890', marginTop: 1 }, tabLabelActive: { color: palette.forest, fontWeight: '800' }, tabIndicator: { position: 'absolute', top: 0, width: 22, height: 3, borderRadius: 3, backgroundColor: palette.forest },
  pageTitle: { paddingTop: 2, paddingBottom: 17 }, pageHeading: { color: palette.ink, fontSize: 25, fontWeight: '700', letterSpacing: -.5 }, pageSubheading: { color: palette.muted, fontSize: 12, marginTop: 5 }, totalStrip: { backgroundColor: palette.mint, borderRadius: 15, paddingHorizontal: 16, paddingVertical: 13, marginBottom: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, totalStripLabel: { color: palette.forest, fontWeight: '800', letterSpacing: 1, fontSize: 9 }, totalStripValue: { color: palette.forest, fontSize: 16, fontWeight: '800' }, wideAction: { height: 49, borderRadius: 14, backgroundColor: palette.forest, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  profileIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }, profileAvatarLarge: { width: 48, height: 48, borderRadius: 17, backgroundColor: palette.mint, alignItems: 'center', justifyContent: 'center' }, profileAvatarLargeText: { color: palette.forest, fontSize: 20, fontWeight: '800' }, profileSaveButton: { alignSelf: 'flex-start', backgroundColor: palette.mint, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, marginTop: 9 }, profileSaveDisabled: { opacity: .5 }, profileSaveText: { color: palette.forest, fontSize: 10, fontWeight: '800' }, profileFoot: { color: '#89958D', fontSize: 9, lineHeight: 14, marginTop: 8 }, profileMetricRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }, profileMetric: { color: palette.ink, fontSize: 17, fontWeight: '700', marginTop: 4 }, profileAction: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderRadius: 11, backgroundColor: '#F4F8F4', marginTop: 13 }, profileActionText: { color: palette.forest, fontSize: 11, fontWeight: '700' }, profileActionArrow: { color: palette.forest, fontSize: 20 }, profileLinkButton: { alignSelf: 'flex-start', paddingVertical: 7 }, profileLinkText: { color: palette.forest, fontSize: 9, fontWeight: '700' }, signOutCard: { backgroundColor: palette.white, borderColor: palette.line, borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 20 }, signOutAction: { marginTop: 12, borderWidth: 1, borderColor: '#E8C9C4', borderRadius: 10, alignItems: 'center', paddingVertical: 10 }, signOutActionText: { color: palette.rose, fontSize: 11, fontWeight: '800' },
  ideaRow: { flexDirection: 'row', paddingTop: 16, borderTopWidth: 1, borderColor: '#F0F2F0', marginTop: 15 }, ideaIcon: { fontSize: 20, marginRight: 12, width: 28 }, ideaTitle: { fontSize: 12, fontWeight: '700', color: palette.ink }, ideaBody: { fontSize: 11, lineHeight: 16, color: palette.muted, marginTop: 4 }, kindNote: { backgroundColor: '#EEF3F0', borderRadius: 16, padding: 16, marginTop: 0 }, kindTitle: { fontSize: 13, color: palette.forest, fontWeight: '800' }, kindBody: { color: '#65736B', fontSize: 11, lineHeight: 16, marginTop: 5 },
  captureCard: { backgroundColor: palette.white, borderColor: palette.line, borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 14 }, captureHeader: { flexDirection: 'row', alignItems: 'center' }, captureIcon: { color: palette.forest, fontSize: 23, marginRight: 11 }, captureTitle: { color: palette.ink, fontWeight: '700', fontSize: 13 }, captureSubtitle: { color: palette.muted, fontSize: 10, marginTop: 3 }, captureStatus: { backgroundColor: '#EEF1EF', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5 }, captureStatusOn: { backgroundColor: palette.mint }, captureStatusText: { fontSize: 8, color: '#748078', fontWeight: '800', letterSpacing: .7 }, captureStatusTextOn: { color: palette.forest }, captureBody: { color: '#66736B', fontSize: 10, lineHeight: 15, marginTop: 12 }, captureDiagnostic: { color: palette.forest, fontSize: 9, lineHeight: 14, marginTop: 9 }, aiToggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 13, paddingTop: 11, borderTopWidth: 1, borderColor: palette.line }, aiToggleTitle: { color: palette.ink, fontSize: 11, fontWeight: '700' }, aiToggleStatus: { color: palette.muted, fontSize: 9, lineHeight: 13, marginTop: 3, paddingRight: 8 }, aiPrivacy: { color: palette.muted, fontSize: 9, lineHeight: 13, marginTop: 4 }, captureButtons: { flexDirection: 'row', marginTop: 12, gap: 8 }, capturePrimary: { backgroundColor: palette.forest, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9 }, capturePrimaryText: { color: palette.white, fontWeight: '700', fontSize: 10 }, captureSecondary: { borderColor: palette.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9 }, captureSecondaryText: { color: palette.ink, fontWeight: '700', fontSize: 10 }, pendingNote: { color: palette.forest, fontSize: 10, fontWeight: '700', marginTop: 10 }, pendingRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: palette.line, paddingVertical: 12, gap: 9 }, pendingDescription: { color: palette.ink, fontSize: 11, fontWeight: '700' }, pendingSource: { color: palette.muted, fontSize: 9, marginTop: 4 }, pendingAmount: { color: palette.ink, fontSize: 11, fontWeight: '700' }, addAlertButton: { backgroundColor: palette.mint, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }, addAlertText: { color: palette.forest, fontSize: 10, fontWeight: '800' }, ignoreAlertButton: { width: 27, height: 27, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#F0F2F0' }, ignoreAlertText: { color: palette.muted, fontSize: 16, marginTop: -2 }, emptyAlerts: { color: palette.muted, fontSize: 11, lineHeight: 17, paddingVertical: 12 },
  modalBackdrop: { flex: 1, backgroundColor: '#101B1680', justifyContent: 'flex-end' }, sheet: { backgroundColor: palette.paper, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 21, paddingTop: 11, paddingBottom: 28 }, sheetHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 4, backgroundColor: '#CCD4CE', marginBottom: 15 }, sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }, sheetTitle: { fontSize: 21, color: palette.ink, fontWeight: '700' }, sheetSubtitle: { fontSize: 11, color: palette.muted, marginTop: 4 }, closeButton: { width: 31, height: 31, borderRadius: 16, backgroundColor: '#E8EEE9', alignItems: 'center', justifyContent: 'center' }, closeText: { color: palette.ink, fontSize: 23, marginTop: -3 }, fieldLabel: { color: '#77847C', fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginTop: 14, marginBottom: 8 }, moneyInputWrap: { height: 58, backgroundColor: palette.white, borderRadius: 13, borderWidth: 1, borderColor: palette.line, alignItems: 'center', flexDirection: 'row', paddingHorizontal: 15 }, rupee: { color: palette.forest, fontSize: 25, fontWeight: '600', marginRight: 9 }, moneyInput: { flex: 1, color: palette.ink, fontSize: 27, fontWeight: '700', paddingVertical: 0 }, textInput: { height: 49, backgroundColor: palette.white, borderRadius: 12, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 13, fontSize: 12, color: palette.ink }, categoryPicker: { flexGrow: 0, marginRight: -21 }, categoryChip: { height: 33, flexDirection: 'row', alignItems: 'center', backgroundColor: palette.white, borderRadius: 18, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 10, marginRight: 7 }, categoryChipSelected: { backgroundColor: palette.mint, borderColor: '#AED3BA' }, chipIcon: { fontSize: 12, marginRight: 5 }, chipLabel: { color: '#68746D', fontSize: 10, fontWeight: '600' }, chipLabelSelected: { color: palette.forest, fontWeight: '800' }, budgetSheetActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22 }, cancelPlanButton: { height: 49, minWidth: 86, borderRadius: 13, borderWidth: 1, borderColor: palette.line, alignItems: 'center', justifyContent: 'center' }, cancelPlanText: { color: palette.muted, fontWeight: '700', fontSize: 12 }, savePlanButton: { flex: 1, marginTop: 0 }, saveButton: { height: 51, borderRadius: 14, backgroundColor: palette.forest, alignItems: 'center', justifyContent: 'center', marginTop: 23 }, saveButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 }, modalPrivacy: { textAlign: 'center', color: '#929D96', fontSize: 9, marginTop: 11 },
  expenseValidationError: { color: '#A43D32', backgroundColor: '#FFF0ED', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, fontSize: 11, lineHeight: 16, fontWeight: '600', marginTop: 12 },
  obligationRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderColor: palette.line }, obligationName: { color: palette.ink, fontSize: 11, fontWeight: '700' }, obligationMeta: { color: palette.muted, fontSize: 9, marginTop: 3 }, obligationInputs: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8 },
});

const timeControlStyles = StyleSheet.create({
  picker: { minHeight: 106, backgroundColor: palette.white, borderRadius: 13, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  unit: { alignItems: 'center', justifyContent: 'center', width: 46 },
  step: { width: 34, height: 27, borderRadius: 8, backgroundColor: '#F1F6F2', alignItems: 'center', justifyContent: 'center' },
  stepText: { color: palette.forest, fontSize: 17, fontWeight: '700', lineHeight: 20 },
  digits: { color: palette.ink, fontSize: 21, fontWeight: '700', paddingVertical: 2, fontVariant: ['tabular-nums'] },
  colon: { color: palette.muted, fontSize: 19, fontWeight: '600' },
});
