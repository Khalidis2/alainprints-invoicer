export const AED = (n) =>
  `AED ${Number(n || 0).toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const uid = () => Math.random().toString(36).slice(2, 10);

export const today = () => new Date().toISOString().slice(0, 10);

export const CATEGORIES = ["3D Print", "Sublimation", "Filament", "Custom"];

export const CAT_STYLE = {
  "3D Print": { fg: "#1B2A3D", bg: "#E4E9EF" },
  Sublimation: { fg: "#8A3B14", bg: "#FBE6D3" },
  Filament: { fg: "#0F5B57", bg: "#DCEEEC" },
  Custom: { fg: "#5B3E7A", bg: "#EAE1F2" },
};

export const seedItems = () => [
  {
    id: uid(),
    name: "Keychain — UAE Plate Style",
    category: "3D Print",
    price: 25,
    description: "Custom parametric keychain, single or multi-color AMS print.",
  },
  {
    id: uid(),
    name: "Sublimation Mug — 11oz",
    category: "Sublimation",
    price: 45,
    description: "Full-wrap custom print, dishwasher-safe coating.",
  },
  {
    id: uid(),
    name: "Filament Spool — 1kg PLA+",
    category: "Filament",
    price: 65,
    description: "Retail resale spool, various colors.",
  },
];
