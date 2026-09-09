import { useEffect, useState } from 'react';
import { formatClock, useTimeFormat, type TimeFormat } from '../lib/time';

interface TimeInputProps {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  label?: string;
}

function parseClock(value: string, format: TimeFormat): string | null {
  const match = value.trim().match(/^(\d{1,2})\s*:?\s*(\d{2})(?:\s*([ap])\.?m?\.?)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59) return null;
  if (format === '12') {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (match[3]?.toLowerCase() === 'p' ? 12 : 0);
  } else if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function ClockField({ value, onChange, label, mobile }: TimeInputProps & { mobile: boolean }) {
  const format = useTimeFormat();
  const displayValue = value ? formatClock(value, format) : '';
  const [draft, setDraft] = useState(displayValue);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => setDraft(displayValue), [displayValue]);

  const commit = () => {
    if (!draft.trim()) {
      setInvalid(false);
      onChange({ target: { value: '' } });
      return;
    }
    const parsed = parseClock(draft, format);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange({ target: { value: parsed } });
    setDraft(formatClock(parsed, format));
  };

  return (
    <div className={`clock-field ${mobile ? 'clock-field-mobile' : 'clock-field-desktop'}`}>
      <input
        type="text"
        inputMode={mobile && format === '24' ? 'numeric' : 'text'}
        aria-label={label}
        aria-invalid={invalid}
        value={draft}
        placeholder={format === '24' ? 'HH:MM' : 'HH:MM AM'}
        maxLength={format === '24' ? 5 : 8}
        onChange={(event) => { setDraft(event.target.value.toUpperCase()); setInvalid(false); }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); commit(); }
        }}
      />
      {invalid && <span className="clock-field-error">Use {format === '24' ? 'HH:MM' : 'HH:MM AM/PM'}</span>}
    </div>
  );
}

/** Store HH:mm while rendering dedicated compact controls for desktop and mobile. */
export function TimeInput({ value, onChange, label = 'Time' }: TimeInputProps) {
  return <div className="time-input" role="group" aria-label={label}>
    <ClockField value={value} onChange={onChange} label={label} mobile={false} />
    <ClockField value={value} onChange={onChange} label={label} mobile />
  </div>;
}

export function DateTimeInput({ value, onChange, min, label = 'Date and time' }: TimeInputProps & { min?: string }) {
  const [date = '', time = ''] = value.split('T');
  return <div className="date-time-input">
    <input type="date" aria-label={`${label} date`} value={date} min={min?.slice(0, 10)} onChange={(e) => onChange({ target: { value: e.target.value ? `${e.target.value}T${time || '00:00'}` : '' } })} />
    <TimeInput label={`${label} time`} value={time} onChange={(e) => {
      const nextDate = date || min?.slice(0, 10) || new Date().toLocaleDateString('en-CA');
      onChange({ target: { value: e.target.value ? `${nextDate}T${e.target.value}` : '' } });
    }} />
  </div>;
}
