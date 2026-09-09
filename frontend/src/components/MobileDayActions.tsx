import { useState } from 'react';
import { BookOpen, CheckSquare, MoreHorizontal, Navigation, NotebookPen, Trash2 } from 'lucide-react';
import { Modal } from './Modal';

export function MobileDayActions({
  dayNumber, notesCount, journalCount, todoCount, focused,
  onNotes, onJournals, onTodos, onFocus, onDelete,
}: {
  dayNumber: number;
  notesCount: number;
  journalCount: number;
  todoCount: number;
  focused: boolean;
  onNotes: () => void;
  onJournals: () => void;
  onTodos: () => void;
  onFocus: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const actions = [
    { label: 'Notes', icon: NotebookPen, count: notesCount, run: onNotes },
    { label: 'Journals', icon: BookOpen, count: journalCount, run: onJournals },
    { label: 'To-dos', icon: CheckSquare, count: todoCount, run: onTodos },
    { label: focused ? 'Show all days' : 'Focus day', icon: Navigation, run: onFocus },
    { label: 'Delete day', icon: Trash2, run: onDelete, danger: true },
  ];

  return (
    <>
      <button
        type="button"
        className={`btn sm show-on-mobile ${focused ? 'primary' : 'ghost'}`}
        aria-label={`Day ${dayNumber} options`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <MoreHorizontal size={16} /> Day options
      </button>
      {open && (
        <Modal title={`Day ${dayNumber} options`} onClose={() => setOpen(false)}>
          <div className="day-options-list">
            {actions.map(({ label, icon: Icon, count, run, danger }) => (
              <button
                type="button"
                key={label}
                className={`day-option ${danger ? 'danger' : ''}`}
                onClick={() => { setOpen(false); run(); }}
              >
                <Icon size={18} />
                <span>{count === undefined ? label : `${label} (${count})`}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
