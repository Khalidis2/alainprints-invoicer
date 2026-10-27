import { useEffect, useRef, useState } from "react";

// Customer name field with a list of every saved customer and an "Add new customer" row.
// The list opens in the page (not as a pop-up), filters as you type, and works with touch and keyboard.
export default function CustomerPicker({ options, name, onType, onPick, onNext }) {
  const [open, setOpen] = useState(false);
  // "Add a new customer" with nothing typed yet: keep the list closed and let them type.
  const [adding, setAdding] = useState(false);
  const wrap = useRef(null);
  const input = useRef(null);
  // Focusing the field by code (after tapping "Add a new customer") must not re-open the list.
  const skipOpen = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (wrap.current && !wrap.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const typed = name.trim();
  const needle = typed.toLowerCase();
  const digits = needle.replace(/[^\d]/g, "");
  const matches = !needle
    ? options
    : options.filter((option) => option.name.toLowerCase().includes(needle) || (digits.length >= 3 && String(option.phone || "").replace(/[^\d]/g, "").includes(digits)));
  const exact = options.some((option) => option.name.toLowerCase() === needle);
  const isNew = Boolean(typed) && !exact;

  const pick = (option) => {
    setOpen(false);
    setAdding(false);
    onPick(option);
  };
  const addNew = () => {
    setOpen(false);
    if (typed) {
      onNext?.();
    } else {
      setAdding(true);
      skipOpen.current = true;
      input.current?.focus();
      window.setTimeout(() => { skipOpen.current = false; }, 0);
    }
  };

  return (
    <div className="cust-combo" ref={wrap}>
      <div className="cust-field">
        <input
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls="customer-options"
          aria-autocomplete="list"
          aria-label="Customer name"
          name="invoice-customer-search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          value={name}
          placeholder="Search or choose a customer"
          onFocus={() => { if (!adding && !skipOpen.current) setOpen(true); }}
          onChange={(event) => {
            setAdding(false);
            onType(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter") {
              event.preventDefault();
              if (open && matches.length === 1 && !exact) pick(matches[0]);
              else if (isNew) addNew();
              else setOpen(false);
            }
          }}
        />
        <button
          type="button"
          className={`cust-chevron${open ? " is-open" : ""}`}
          aria-label={open ? "Hide saved customers" : "Show saved customers"}
          onClick={() => { setAdding(false); setOpen((value) => !value); }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </div>

      {!open && exact && <div className="cust-status is-saved">Saved customer</div>}
      {!open && isNew && <div className="cust-status is-new">New customer: saved automatically with this invoice</div>}
      {!open && adding && !typed && <div className="cust-status is-new">Type the new customer's name, then add their phone or email below.</div>}

      {open && (
        <div className="cust-list" id="customer-options" role="listbox" aria-label="Saved customers">
          {!exact && (
            <button type="button" role="option" aria-selected="false" className="cust-opt is-add" onClick={addNew}>
              <span aria-hidden="true">+</span>
              <b>{typed ? `Add "${typed}" as a new customer` : "Add a new customer"}</b>
            </button>
          )}
          <div className="cust-head">{needle ? `${matches.length} match${matches.length === 1 ? "" : "es"}` : `Saved customers (${options.length})`}</div>
          {matches.map((option) => (
            <button key={option.name} type="button" role="option" aria-selected={option.name.toLowerCase() === needle} className="cust-opt" onClick={() => pick(option)}>
              <b>{option.name}</b>
              <span>{option.phone || "No phone saved"}</span>
            </button>
          ))}
          {matches.length === 0 && (
            <div className="cust-empty">
              {options.length === 0 ? "No saved customers yet. They are saved automatically when you create an invoice." : "No saved customer matches. Use the add row above."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
