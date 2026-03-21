import { useSessionStore } from '../../store/useSessionStore';

export function SessionStats() {
  const { totalAttempts, correctAttempts, currentStreak, bestStreak } = useSessionStore();

  const accuracy = totalAttempts === 0 ? 0 : Math.round((correctAttempts / totalAttempts) * 100);

  return (
    <div className="flex gap-6 justify-center text-sm">
      <Stat label="Attempted" value={totalAttempts} />
      <Stat label="Correct" value={correctAttempts} />
      <Stat
        label="Accuracy"
        value={`${accuracy}%`}
        color={accuracy >= 80 ? 'text-emerald-400' : accuracy >= 50 ? 'text-yellow-400' : 'text-red-400'}
      />
      <Stat label="Streak" value={currentStreak} color={currentStreak >= 5 ? 'text-emerald-400' : undefined} />
      <Stat label="Best" value={bestStreak} />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="text-center">
      <div className={`text-xl font-mono font-bold ${color ?? 'text-white'}`}>{value}</div>
      <div className="text-gray-500 text-xs uppercase tracking-wider">{label}</div>
    </div>
  );
}
