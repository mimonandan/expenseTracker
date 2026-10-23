import React, { useMemo } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { calculateMonthlyPlan, Obligation, BudgetTransaction } from './lib/budget';

type CategoryMeta = { icon: string; color: string };
type SpendingRhythmCardProps = {
  transactions: BudgetTransaction[];
  monthlyIncome: number;
  obligations: Obligation[];
  categoryMeta: Record<string, CategoryMeta>;
  todayKey: string;
};
type TrafficLevel = 'Light' | 'Moderate' | 'High';
type SpendingDay = {
  key: string;
  dayName: string;
  dayNumber: number;
  totalOutflow: number;
  flexibleSpend: number;
  commitmentsPaid: number;
  guide: number;
  topCategory: string | null;
  level: TrafficLevel;
};

const money = (value: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2,
}).format(value);
const levelColor: Record<TrafficLevel, string> = { Light: '#43845F', Moderate: '#C08A27', High: '#C87564' };

export default function SpendingRhythmCard({ transactions, monthlyIncome, obligations, categoryMeta, todayKey }: SpendingRhythmCardProps) {
  const days = useMemo(() => {
    const today = new Date();
    const recentDays = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - index));
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const rows = transactions.filter(row => new Date(row.date).toDateString() === date.toDateString());
      const plan = calculateMonthlyPlan(monthlyIncome, obligations, transactions, date);
      const totalExpenses = rows.reduce((sum, row) => {
        if (row.transactionType === 'expense') return sum + row.amount;
        if (row.transactionType === 'refund') return sum - row.amount;
        return sum;
      }, 0);
      const byCategory = rows.reduce<Record<string, number>>((totals, row) => {
        if (row.transactionType !== 'expense' && row.transactionType !== 'refund') return totals;
        const matchedCommitment = plan.matchedExpenseAmountsByTransactionId[row.id] ?? 0;
        const signed = row.transactionType === 'refund' ? -row.amount : Math.max(0, row.amount - matchedCommitment);
        totals[row.category] = (totals[row.category] ?? 0) + signed;
        return totals;
      }, {});
      const topCategory = Object.entries(byCategory).filter(([, total]) => total > 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const commitmentsPaid = rows.reduce((sum, row) => sum
        + (plan.matchedExpenseAmountsByTransactionId[row.id] ?? 0)
        + (plan.matchedTransferAmountsByTransactionId[row.id] ?? 0), 0);
      const matchedCommitmentTransfers = rows.reduce((sum, row) => sum
        + (plan.matchedTransferAmountsByTransactionId[row.id] ?? 0), 0);
      return {
        key,
        dayName: date.toLocaleDateString('en-IN', { weekday: 'short' }),
        dayNumber: date.getDate(),
        // Expense commitments are already part of totalExpenses. Add only
        // matched transfer commitments so the total never double-counts them.
        totalOutflow: Math.max(0, totalExpenses + matchedCommitmentTransfers),
        flexibleSpend: Math.max(0, plan.todayNetSpend),
        commitmentsPaid,
        guide: monthlyIncome > 0 ? plan.dailyGuide : 0,
        topCategory,
      };
    });

    const activeDays = recentDays.filter(day => day.flexibleSpend > 0);
    const averageTrackedDay = activeDays.length ? activeDays.reduce((sum, day) => sum + day.flexibleSpend, 0) / activeDays.length : 0;
    return recentDays.map(day => {
      let level: TrafficLevel;
      if (day.flexibleSpend === 0) level = 'Light';
      else if (monthlyIncome > 0) {
        level = day.flexibleSpend > day.guide ? 'High' : day.flexibleSpend <= day.guide * 0.7 ? 'Light' : 'Moderate';
      } else {
        level = day.flexibleSpend > averageTrackedDay * 1.3 ? 'High' : day.flexibleSpend <= averageTrackedDay * 0.7 ? 'Light' : 'Moderate';
      }
      return { ...day, level };
    });
  }, [transactions, monthlyIncome, obligations, todayKey]);

  const largestDay = days.reduce<SpendingDay | null>((largest, day) => day.totalOutflow > (largest?.totalOutflow ?? 0) ? day : largest, null);
  const largestAmount = Math.max(1, ...days.map(day => day.flexibleSpend));
  const counts = days.reduce((result, day) => ({ ...result, [day.level]: result[day.level] + 1 }), { Light: 0, Moderate: 0, High: 0 });

  return <View style={styles.card}>
    <View style={styles.heading}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Spending rhythm</Text>
        <Text style={styles.subtitle}>Last 7 days · total outflow and everyday spend</Text>
      </View>
      <Text style={styles.icon}>▥</Text>
    </View>

    <View style={styles.legend}>
      {(['Light', 'Moderate', 'High'] as TrafficLevel[]).map(level => <View key={level} style={styles.legendItem}>
        <View style={[styles.dot, { backgroundColor: levelColor[level] }]} />
        <Text style={styles.legendText}>{level} · {counts[level]}</Text>
      </View>)}
    </View>

    {days.map(day => {
      const meta = day.topCategory ? categoryMeta[day.topCategory] ?? { icon: '✦', color: '#9CA8A1' } : null;
      const width: `${number}%` = day.flexibleSpend > 0 ? `${Math.max(4, day.flexibleSpend / largestAmount * 100)}%` : '0%';
      return <View key={day.key} style={styles.dayRow}>
        <View style={styles.dateBlock}>
          <Text style={styles.dayName}>{day.dayName}</Text>
          <Text style={styles.dayNumber}>{day.dayNumber}</Text>
        </View>
        <View style={styles.dayDetails}>
          <View style={styles.barTrack}>
            <View style={[styles.bar, { width, backgroundColor: levelColor[day.level] }]} />
          </View>
          <Text numberOfLines={1} style={styles.categoryText}>
            {meta && day.topCategory ? `Everyday: ${meta.icon} ${day.topCategory}` : day.flexibleSpend > 0 ? 'Everyday: category not identified' : 'No everyday spend'}
            {day.commitmentsPaid > 0 ? ` · bills paid ${money(day.commitmentsPaid)}` : ''}
          </Text>
        </View>
        <View style={styles.amountBlock}>
          <Text style={styles.amount}>{money(day.totalOutflow)}</Text>
          <Text style={styles.flexibleAmount}>{money(day.flexibleSpend)} flexible</Text>
          <Text style={[styles.level, { color: levelColor[day.level] }]}>{day.level.toUpperCase()}</Text>
        </View>
      </View>;
    })}

    <View style={styles.noteBox}>
      {largestDay && largestDay.totalOutflow > 0 ? <Text style={styles.noteText}>
        Largest tracked outflow day: {largestDay.dayName}, {largestDay.dayNumber} · {money(largestDay.totalOutflow)} including {money(largestDay.commitmentsPaid)} in matched commitments.
      </Text> : <Text style={styles.noteText}>No expenses were tracked in these 7 days yet. Add or review a purchase to start seeing your pattern.</Text>}
    </View>
    <Text style={styles.footnote}>
      {monthlyIncome > 0
        ? 'Traffic color compares flexible purchases with that day’s guide. Matched commitments are shown separately and do not make a bill-payment day look like overspending. Transfers and income are excluded; refunds reduce spending.'
        : 'Without a monthly plan, traffic compares flexible purchases with your average tracked day. Set income and commitments for a personal daily guide.'}
    </Text>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 16, paddingTop: 17, paddingBottom: 14, marginBottom: 14, borderWidth: 1, borderColor: '#EEF1EE' },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  title: { color: '#18241F', fontSize: 16, fontWeight: '700' },
  subtitle: { color: '#738079', fontSize: 11, marginTop: 4 },
  icon: { color: '#176B52', fontSize: 22, marginLeft: 10 },
  legend: { flexDirection: 'row', gap: 13, paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#F0F2F0', marginBottom: 3 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { color: '#65736B', fontSize: 9, fontWeight: '700' },
  dayRow: { flexDirection: 'row', alignItems: 'center', minHeight: 51, borderBottomWidth: 1, borderColor: '#F3F4F3' },
  dateBlock: { width: 37 },
  dayName: { color: '#738079', fontSize: 9, fontWeight: '700' },
  dayNumber: { color: '#18241F', fontSize: 11, fontWeight: '700', marginTop: 2 },
  dayDetails: { flex: 1, paddingRight: 9 },
  barTrack: { height: 7, borderRadius: 5, backgroundColor: '#F0F3F0', overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 5 },
  categoryText: { color: '#7A8780', fontSize: 9, marginTop: 5 },
  amountBlock: { width: 88, alignItems: 'flex-end' },
  amount: { color: '#18241F', fontSize: 10, fontWeight: '700' },
  flexibleAmount: { color: '#738079', fontSize: 8, marginTop: 2 },
  level: { fontSize: 7, fontWeight: '800', letterSpacing: 0.6, marginTop: 3 },
  noteBox: { backgroundColor: '#F4F8F4', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, marginTop: 12 },
  noteText: { color: '#52645A', fontSize: 10, lineHeight: 15 },
  footnote: { color: '#929D96', fontSize: 8, lineHeight: 12, marginTop: 9 },
});
