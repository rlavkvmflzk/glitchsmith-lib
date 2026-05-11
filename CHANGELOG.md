# Changelog

## [Unreleased]

## [0.3.0] - 2026-05-11

### ✨ New Features
- **Currency Definitions Dialog**: New world-level settings menu (`Configure Currencies`) for editing sheet and virtual currencies in one place. Sheet currencies map to actor data paths; virtual currencies are wallet-backed by the library. Supports per-currency icons via FilePicker and a primary radio per section that drives the default price/payout unit.
- **System Presets**: Built-in defaults for D&D 5e, Daggerheart, PF1e, PF2e, SF2e, Cyberpunk RED, Shadowrun (5e/6e Eden), Fabula Ultima (projectfu), and WFRP4e. The dialog's "Reset to System Defaults" button populates the sheet section from the active system's preset.
- **System Presets now prefill empty sheet currency rows** when the dialog first opens, so a clean world immediately shows active-system defaults without requiring a manual reset.
- **SF2e preset** exposes only the currencies used by the active Starfinder 2e sheet (`credits` and `upb`).
- **WFRP4e preset** exposes Gold Crowns, Silver Shillings, and Brass Pennies using the system's BP exchange rates.
- **Daggerheart preset** exposes Chests, Bags, Handfuls, and Coins using the system's 10:1 gold ladder, with Handfuls as the primary display unit.
- **`lib.currency.getSystemPreset(systemId)` API**: Consumers can read the built-in preset for any registered system without hardcoding their own copies.
- **Wallet Dialog**: Per-actor dialog (`fas fa-wallet` button in the actor sheet header) for adjusting virtual currency balances. GM-only.

### 🔧 API Changes
- Currency definition schema gains optional `icon` (image path) and `primary` (boolean) fields. Existing definitions remain valid — both fields default safely.
- `setDefinitions()` now accepts an empty currency map (no `base` required when no currencies exist). When currencies are present, `base` validation is unchanged.

### 🔄 Notifier
- Stylish Shop is now auto-discovered by the notifier subsystem. Removed from the legacy skip list as it ships without a self-contained UpdateNotifier.
