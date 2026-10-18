// The record menu's quiet frame, one job per corner: top-left information (what the chosen mode is), bottom-left
// the one instruction, bottom-right control (the mode pills, from the header) with a small staff above them as
// decoration only. Top-right holds the sound toggle and the login status (from the header).
import { SectionBloom } from '@/ui/flowers/SectionBloom';

export function MenuFrame({ sub, modeId }: { sub: string; modeId: string }) {
  return (
    <>
      <div className="menu-about">
        <b>About modes</b>
        <p key={modeId}>{sub}</p>
      </div>
      <div className="menu-rule" aria-hidden="true" />
      {/* the menu's own flower (chrysanthemum): it flicks open on every turn of the records */}
      <SectionBloom key={modeId} section="menu" className="menu-flower beat" />
      <p className="menu-tag">Four ways in. Pick one.</p>
      <svg className="menu-staff" viewBox="0 0 160 30" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((k) => (
          <line key={k} x1="0" x2="160" y1={4 + k * 5.5} y2={4 + k * 5.5} />
        ))}
        {[[22, 15.5], [46, 10], [70, 21], [94, 12.75], [118, 7.25], [142, 18.25]].map(([x, y], k) => (
          <g key={k}>
            <ellipse cx={x} cy={y} rx="3.4" ry="2.4" transform={`rotate(-20 ${x} ${y})`} className={k % 2 ? 'hollow' : ''} />
            <line x1={x + 3.1} x2={x + 3.1} y1={y} y2={y - 13} />
          </g>
        ))}
      </svg>
    </>
  );
}
