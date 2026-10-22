// App navigation: sidebar on desktop, bottom tab bar on phones. "More" is a normal page, not a pop-up.

const PATHS = {
  home: <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  box: <><path d="M21 8l-9-5-9 5v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  bars: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
  bag: <><path d="M3 7h18l-2 12H5z" /><path d="M8 7a4 4 0 0 1 8 0" /></>,
  tag: <><path d="M20 13l-7 7-9-9V4h7z" /><circle cx="8" cy="8" r="1.5" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
  users: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6" /></>,
  card: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 11h18M7 15h4" /></>,
  calc: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 7h6M9 12h2M13 12h2M9 16h2M13 16h2" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
};

export function Icon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

const BOTTOM = [
  { id: "dashboard", label: "Home", icon: "home" },
  { id: "history", label: "Invoices", icon: "receipt" },
  { id: "invoice", label: "New", icon: "plus", main: true },
  { id: "filament", label: "Stock", icon: "box" },
  { id: "more", label: "More", icon: "menu" },
];

export default function Navigation({ tab, groups, onGo, userEmail, onSignOut }) {
  const bottomIds = BOTTOM.map((entry) => entry.id);
  return (
    <>
      <aside className="side-nav no-print" aria-label="Sections">
        <div className="side-brand">
          <img src="/logo-round.png" alt="" width="44" height="44" />
          <span>alainprints</span>
        </div>
        <button type="button" className="side-new" onClick={() => onGo("invoice", { fresh: true })}>
          <Icon name="plus" size={18} />New invoice
        </button>
        {groups.map((group) => (
          <div className="side-group" key={group.label}>
            <div className="side-label">{group.label}</div>
            {group.tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`side-link${tab === entry.id ? " is-active" : ""}`}
                aria-current={tab === entry.id ? "page" : undefined}
                onClick={() => onGo(entry.id)}
              >
                <Icon name={entry.icon} size={18} />
                <span>{entry.label}</span>
                {entry.badge ? <em>{entry.badge}</em> : null}
              </button>
            ))}
          </div>
        ))}
        <div className="side-foot">
          <span title={userEmail}>{userEmail}</span>
          <button type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </aside>

      <header className="phone-bar no-print">
        <img src="/logo-round.png" alt="" width="36" height="36" />
        <span>alainprints</span>
      </header>

      <nav className="bottom-nav no-print" aria-label="Main">
        {BOTTOM.map((entry) => {
          const active = entry.id === "more" ? !bottomIds.includes(tab) || tab === "more" : tab === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              className={`bottom-link${active ? " is-active" : ""}${entry.main ? " is-main" : ""}`}
              aria-current={active ? "page" : undefined}
              onClick={() => onGo(entry.id, entry.main ? { fresh: true } : undefined)}
            >
              <span className="bottom-icon"><Icon name={entry.icon} size={entry.main ? 22 : 22} /></span>
              <span>{entry.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

// The "More" tab on phones: every section in one plain page.
export function MoreMenu({ groups, onGo, userEmail, onSignOut }) {
  return (
    <section className="more-page">
      <h2>All sections</h2>
      {groups.map((group) => (
        <div key={group.label}>
          <div className="more-label">{group.label}</div>
          <div className="more-grid">
            {group.tabs.map((entry) => (
              <button key={entry.id} type="button" onClick={() => onGo(entry.id)}>
                <Icon name={entry.icon} size={20} />
                <span>{entry.label}</span>
                {entry.badge ? <em>{entry.badge}</em> : null}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="more-account">
        <span>{userEmail}</span>
        <button type="button" onClick={onSignOut}>Sign out</button>
      </div>
    </section>
  );
}
