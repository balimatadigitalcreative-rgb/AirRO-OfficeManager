/* MODE LAPANGAN — ICONS: the 24-grid stroke icons drawn in the approved Liquid Glass mockup (45, taken
   verbatim from its boards). One component draws any of them; stroke width follows the mockup (dock: 2.3
   active / 1.9 idle). Bundle scope: top-level names are FLD_ICONS and FldSvg only. */
const FLD_ICONS = {
  lock: [["rect",{"x":5,"y":11,"width":14,"height":10,"rx":2}],["path",{"d":"M8 11V8a4 4 0 0 1 8 0v3"}]],
  minus: [["path",{"d":"M5 12h14"}]],
  plus: [["path",{"d":"M12 5v14M5 12h14"}]],
  back: [["path",{"d":"m15 5-7 7 7 7"}]],
  locate: [["path",{"d":"M20.5 3.5 3 11l7.5 2.5L13 21z"}]],
  hand: [["path",{"d":"M9 11V5a1.5 1.5 0 0 1 3 0v5M12 10V4a1.5 1.5 0 0 1 3 0v6M15 10V6a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-2.5-4a1.5 1.5 0 0 1 2.5-1.6L9 13"}]],
  camera: [["path",{"d":"M4 8h3l2-3h6l2 3h3v11H4z"}],["circle",{"cx":12,"cy":13,"r":3.5}]],
  close: [["path",{"d":"M6 6l12 12M18 6 6 18"}]],
  warn: [["path",{"d":"M12 3 2 20h20z"}],["path",{"d":"M12 10v4M12 17.5v.01"}]],
  route: [["circle",{"cx":6,"cy":18,"r":2.2}],["circle",{"cx":18,"cy":6,"r":2.2}],["path",{"d":"M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6"}]],
  receipt: [["path",{"d":"M6 3h12v18l-3-2-3 2-3-2-3 2z"}],["path",{"d":"M9 8h6M9 12h6M9 16h3"}]],
  cash: [["rect",{"x":3,"y":6,"width":18,"height":12,"rx":2}],["circle",{"cx":12,"cy":12,"r":2.5}]],
  fuel: [["path",{"d":"M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 9h2.5a1.5 1.5 0 0 1 1.5 1.5V17a1.5 1.5 0 0 0 3 0V8l-3-3"}]],
  pinPlus: [["path",{"d":"M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"}],["path",{"d":"M12 7v6M9 10h6"}]],
  adjust: [["path",{"d":"M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3"}]],
  bottleBroken: [["path",{"d":"M9 3h6v3l2 2v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8l2-2z"}],["path",{"d":"m10 11 2 3-2 2 3 3"}]],
  truck: [["path",{"d":"M2.5 6.5h11v10h-11zM13.5 9.5h4.2l3.3 3.4v3.6h-7.5z"}],["circle",{"cx":7,"cy":18,"r":2}],["circle",{"cx":17,"cy":18,"r":2}]],
  map: [["path",{"d":"m9 4-6 2.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z"}],["path",{"d":"M9 4v13.5M15 6.5V20"}]],
  users: [["circle",{"cx":9,"cy":8,"r":3.5}],["path",{"d":"M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"}]],
  clipboard: [["path",{"d":"M9 4h6v3H9zM6 5.5H5v15h14v-15h-1"}],["path",{"d":"m9 14 2 2 4-4"}]],
  userMove: [["circle",{"cx":9,"cy":8,"r":3.5}],["path",{"d":"M2.5 20a6.5 6.5 0 0 1 13 0M16 9h6M19 6l3 3-3 3"}]],
  bottlePlus: [["path",{"d":"M9 3h6v3l2 2v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8l2-2z"}],["path",{"d":"M10 13h4M12 11v4"}]],
  ban: [["circle",{"cx":12,"cy":12,"r":9}],["path",{"d":"m6 6 12 12"}]],
  search: [["circle",{"cx":11,"cy":11,"r":7}],["path",{"d":"m20 20-3.5-3.5"}]],
  arrowRight: [["path",{"d":"M5 12h14M13 6l6 6-6 6"}]],
  crosshair: [["circle",{"cx":12,"cy":12,"r":3}],["path",{"d":"M12 2v3M12 19v3M2 12h3M19 12h3"}]],
  pinMove: [["path",{"d":"M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"}],["path",{"d":"M9 10h6M12 7v6"}]],
  pinOff: [["path",{"d":"M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"}],["path",{"d":"m4 4 16 16"}]],
  chevron: [["path",{"d":"m9 6 6 6-6 6"}]],
  exclam: [["path",{"d":"M12 7v6M12 17v.01"}]],
  navigate: [["path",{"d":"M3 11 21 3l-8 18-2-8z"}]],
  check: [["path",{"d":"M5 12.5 10 17 19 7"}]],
  exclamThin: [["path",{"d":"M12 6v7M12 17.5v.01"}]],
  parking: [["rect",{"x":4,"y":3,"width":16,"height":18,"rx":3}],["path",{"d":"M9 17V7h4a3 3 0 0 1 0 6H9"}]],
  wrench: [["path",{"d":"M14.5 6.5a4 4 0 0 0 5 5L12 19l-3 1 1-3 7.5-7.5M14.5 6.5 17 4l3 3-2.5 2.5"}],["path",{"d":"M4 20l5-5"}]],
  food: [["path",{"d":"M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1-3 4-3 8h3"}]],
  dots: [["circle",{"cx":5,"cy":12,"r":1.8}],["circle",{"cx":12,"cy":12,"r":1.8}],["circle",{"cx":19,"cy":12,"r":1.8}]],
  info: [["circle",{"cx":12,"cy":12,"r":9}],["path",{"d":"M12 8v.01M11 12h1v5h1"}]],
  home: [["path",{"d":"M3 12 12 4l9 8v8H3z"}]],
  pen: [["path",{"d":"M4 20h4L19 9l-4-4L4 16z"}],["path",{"d":"m13 7 4 4"}]],
  chevDown: [["path",{"d":"m7 10 5 5 5-5"}]],
  phone: [["path",{"d":"M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"}]],
  wa: [["path",{"d":"M4 20l1.3-4A8 8 0 1 1 8 18.7z"}]],
  note: [["path",{"d":"M4 5h16v11H9l-5 4z"}]],
  clock: [["circle",{"cx":12,"cy":12,"r":9}],["path",{"d":"M12 7v5l3 2"}]],
};
function FldSvg({ n, s, sw, style, label }) {
  const parts = FLD_ICONS[n];
  if (!parts) return null;
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' };
  return (
    <svg width={s || 20} height={s || 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw || 2} strokeLinecap="round" strokeLinejoin="round" style={style} {...a11y}>
      {parts.map(([tag, a], i) => React.createElement(tag, Object.assign({ key: i }, a)))}
    </svg>
  );
}
