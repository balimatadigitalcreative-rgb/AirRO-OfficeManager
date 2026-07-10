/* global React */
// AirRO Water — icon set (Phosphor-style line icons). Stroke inherits currentColor.
const Ic = ({ children, s = 20, sw = 1.7, fill = 'none', ...p }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...p}>{children}</svg>
);

// Brand water-drop mark — drop + internal flow (RO membrane)
const Logo = ({ s = 28 }) => (
  <img src="assets/airro-mark.png?v=l4" width={s} height={s} alt="AirRO"
    style={{ display: 'block', objectFit: 'contain' }} />
);

const IconDashboard = (p) => <Ic {...p}><rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></Ic>;
const IconTx = (p) => <Ic {...p}><path d="M4 7h13l-3-3M20 17H7l3 3"/></Ic>;
const IconCustomers = (p) => <Ic {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 19a5.5 5.5 0 0 0-2.2-4.4"/></Ic>;
const IconInvoice = (p) => <Ic {...p}><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h7M9 16h7M9 8h2"/></Ic>;
const IconExpense = (p) => <Ic {...p}><rect x="3" y="6" width="18" height="13" rx="2.2"/><path d="M3 10h18"/><path d="M7 15h4"/></Ic>;
const IconReport = (p) => <Ic {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></Ic>;
const IconTruck = (p) => <Ic {...p}><path d="M3 6h11v9H3z"/><path d="M14 9h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/></Ic>;
const IconSettings = (p) => <Ic {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.2A1.7 1.7 0 0 0 7 19.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 0 1 0-4h.2A1.7 1.7 0 0 0 4.8 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1Z"/></Ic>;

const IconSearch = (p) => <Ic {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></Ic>;
const IconBell = (p) => <Ic {...p}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10.5 19a1.7 1.7 0 0 0 3 0"/></Ic>;
const IconChat = (p) => <Ic {...p}><path d="M20 14a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/></Ic>;
const IconCaret = (p) => <Ic {...p}><path d="m6 9 6 6 6-6"/></Ic>;
const IconPlus = (p) => <Ic {...p}><path d="M12 5v14M5 12h14"/></Ic>;
const IconArrowUp = (p) => <Ic {...p}><path d="M7 17 17 7M9 7h8v8"/></Ic>;
const IconArrowDown = (p) => <Ic {...p}><path d="M17 7 7 17M15 17H7V9"/></Ic>;
const IconTrendUp = (p) => <Ic {...p}><path d="M3 17 9 11l4 4 8-8"/><path d="M15 7h6v6"/></Ic>;
const IconTrendDown = (p) => <Ic {...p}><path d="M3 7 9 13l4-4 8 8"/><path d="M15 17h6v-6"/></Ic>;
const IconClock = (p) => <Ic {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></Ic>;
const IconWallet = (p) => <Ic {...p}><rect x="3" y="6" width="18" height="13" rx="2.4"/><path d="M16 12h3"/><path d="M21 9H6a3 3 0 0 1 0-6h11v3"/></Ic>;
const IconFilter = (p) => <Ic {...p}><path d="M3 5h18M6 12h12M10 19h4"/></Ic>;
const IconDots = (p) => <Ic {...p}><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></Ic>;
const IconMenu = (p) => <Ic {...p}><path d="M3 6h18M3 12h18M3 18h18"/></Ic>;
const IconClose = (p) => <Ic {...p}><path d="M6 6l12 12M18 6 6 18"/></Ic>;
const IconCheck = (p) => <Ic {...p}><path d="M4 12.5 9 17.5 20 6.5"/></Ic>;
const IconCalendar = (p) => <Ic {...p}><rect x="3" y="5" width="18" height="16" rx="2.4"/><path d="M3 9h18M8 3v4M16 3v4"/></Ic>;
const IconDownload = (p) => <Ic {...p}><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></Ic>;
const IconCoinIn = (p) => <Ic {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8v8M9.5 13.5 12 16l2.5-2.5"/></Ic>;
const IconCoinOut = (p) => <Ic {...p}><circle cx="12" cy="12" r="9"/><path d="M12 16V8M9.5 10.5 12 8l2.5 2.5"/></Ic>;
const IconDrop = (p) => <Ic {...p}><path d="M12 3s7 7 7 11a7 7 0 0 1-14 0c0-4 7-11 7-11Z"/></Ic>;
const IconGas = (p) => <Ic {...p}><path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M4 21h12"/><path d="M15 8h2.5L19 9.5V16a1.5 1.5 0 0 1-3 0v-3h-1"/><path d="M7 8h6"/></Ic>;
const IconWrench = (p) => <Ic {...p}><path d="M15 6a4 4 0 0 0-5.2 5.2L4 17l3 3 5.8-5.8A4 4 0 0 0 18 9l-2.3 2.3-2.8-.7-.7-2.8L15 6Z"/></Ic>;
const IconBolt = (p) => <Ic {...p}><path d="M13 3 5 13h6l-1 8 8-10h-6z"/></Ic>;
const IconUsersGroup = (p) => <Ic {...p}><circle cx="9" cy="9" r="3"/><path d="M3.5 18a5.5 5.5 0 0 1 11 0"/><path d="M17 9a3 3 0 1 0-1-5.8M20.5 18a5.5 5.5 0 0 0-3-4.9"/></Ic>;
const IconStore = (p) => <Ic {...p}><path d="M4 9h16v11H4z"/><path d="M3 9l2-5h14l2 5"/><path d="M9 20v-5h6v5"/></Ic>;
const IconFork = (p) => <Ic {...p}><path d="M6 3v7a2 2 0 0 0 4 0V3M8 10v11M16 3c-1.6 0-2.5 2-2.5 5s.9 4 2.5 4m0 0v9"/></Ic>;
const IconHome = (p) => <Ic {...p}><path d="M4 11 12 4l8 7M6 10v10h12V10"/></Ic>;
const IconPin = (p) => <Ic {...p}><path d="M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></Ic>;
const IconLock = (p) => <Ic {...p}><rect x="4.5" y="10.5" width="15" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none"/></Ic>;
const IconLogout = (p) => <Ic {...p}><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M16 8l4 4-4 4M9 12h11"/></Ic>;
const IconShield = (p) => <Ic {...p}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></Ic>;
const IconBackspace = (p) => <Ic {...p}><path d="M9 5h11a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 20 19H9L2.5 12z"/><path d="M17 9.5l-5 5M12 9.5l5 5"/></Ic>;
const IconPencil = (p) => <Ic {...p}><path d="M14 4l6 6L9 21H3v-6z"/><path d="M13 5l6 6"/></Ic>;
const IconUserCircle = (p) => <Ic {...p}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.3 18.5a6 6 0 0 1 11.4 0"/></Ic>;
const IconSparkle = (p) => <Ic {...p}><path d="M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"/></Ic>;
const IconSend = (p) => <Ic {...p}><path d="M4 12l16-8-6 16-3-6-7-2z"/><path d="M11 13l3-3"/></Ic>;
const IconRefresh = (p) => <Ic {...p}><path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v4h-4"/></Ic>;

Object.assign(window, {
  Logo, IconDashboard, IconTx, IconCustomers, IconInvoice, IconExpense, IconReport,
  IconTruck, IconSettings, IconSearch, IconBell, IconChat, IconCaret, IconPlus,
  IconArrowUp, IconArrowDown, IconTrendUp, IconTrendDown, IconClock, IconWallet,
  IconFilter, IconDots, IconMenu, IconClose, IconCheck, IconCalendar, IconDownload,
  IconCoinIn, IconCoinOut, IconDrop, IconGas, IconWrench, IconBolt, IconUsersGroup,
  IconStore, IconFork, IconHome, IconPin,
  IconLock, IconLogout, IconShield, IconBackspace, IconPencil, IconUserCircle,
  IconSparkle, IconSend, IconRefresh,
});
