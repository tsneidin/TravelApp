import { useTimeFormat } from '../lib/time';

interface TimeInputProps {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  label?: string;
}

/** Store HH:mm while presenting the account's chosen clock format on every device. */
export function TimeInput({ value, onChange, label = 'Time' }: TimeInputProps) {
  const format = useTimeFormat();
  const [hours, minutes] = value.split(':');
  const hour = value ? Number(hours) : null;
  const emit = (h: number, m: string) => onChange({ target: { value: `${String(h).padStart(2, '0')}:${m}` } });
  return (
    <div className="time-input" role="group" aria-label={label}>
      <select aria-label={`${label} hour`} value={hour === null ? '' : format === '12' ? hour % 12 || 12 : hour}
        onChange={(e) => {
          if (!e.target.value) return onChange({ target: { value: '' } });
          const selected = Number(e.target.value);
          emit(format === '12' ? selected % 12 + ((hour ?? 0) >= 12 ? 12 : 0) : selected, minutes || '00');
        }}>
        <option value="">Hour</option>
        {Array.from({ length: format === '12' ? 12 : 24 }, (_, i) => format === '12' ? i + 1 : i).map((h) => <option key={h} value={h}>{format === '24' ? String(h).padStart(2, '0') : h}</option>)}
      </select>
      <span aria-hidden="true">:</span>
      <select aria-label={`${label} minute`} value={minutes || ''} onChange={(e) => emit(hour ?? 0, e.target.value || '00')}>
        <option value="" disabled>Min</option>
        {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      {format === '12' && <select aria-label={`${label} AM or PM`} value={(hour ?? 0) >= 12 ? 'PM' : 'AM'} onChange={(e) => emit((hour ?? 0) % 12 + (e.target.value === 'PM' ? 12 : 0), minutes || '00')}>
        <option>AM</option><option>PM</option>
      </select>}
    </div>
  );
}

export function DateTimeInput({ value, onChange, min, label = 'Date and time' }: TimeInputProps & { min?: string }) {
  const [date = '', time = ''] = value.split('T');
  return <div className="date-time-input">
    <input type="date" aria-label={`${label} date`} value={date} min={min?.slice(0, 10)} onChange={(e) => onChange({ target: { value: e.target.value ? `${e.target.value}T${time || '00:00'}` : '' } })} />
    <TimeInput label={label} value={time} onChange={(e) => {
      const nextDate = date || min?.slice(0, 10) || new Date().toLocaleDateString('en-CA');
      onChange({ target: { value: e.target.value ? `${nextDate}T${e.target.value}` : '' } });
    }} />
  </div>;
}
