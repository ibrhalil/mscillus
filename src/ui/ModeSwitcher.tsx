import { MODES } from '../visuals/registry';
import type { ModeId } from '../visuals/types';

interface Props {
  active: ModeId;
  onChange: (id: ModeId) => void;
}

export function ModeSwitcher({ active, onChange }: Props) {
  return (
    <div className="modes">
      {MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          className={`chip ${active === mode.id ? 'chip--active' : ''}`}
          onClick={() => onChange(mode.id)}
        >
          {mode.key}. {mode.name}
        </button>
      ))}
    </div>
  );
}
