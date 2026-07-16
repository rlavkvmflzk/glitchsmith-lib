# Changelog

## [Unreleased]

### ✨ New Features
- **Shared currency exchange API**: Added `currency.getExchangeQuote()` and `currency.exchangeBalance()` for rate-based conversion across shared currency definitions. Quotes support virtual, sheet, and mixed storage types; direct commits are atomic for virtual wallets and path-backed sheet currency pairs, while mixed-storage callers receive a quote to coordinate in their own store.
- **Atomic virtual balance batches**: Added `currency.modifyBalances()` so shared modules can validate several virtual-currency deltas and persist them in one wallet write.

### 🔒 Reliability
- **Authoritative exchange execution**: Exchange amounts are recalculated by the active GM, validated against each currency increment, rounded down without creating base-unit value, and serialized with other balance and definition mutations.

## [0.9.0] - 2026-07-06

### ✨ New Features
- **Game time facade**: New read-only `api.time` service that gives GlitchSmith modules one way to ask "what game time is it?". It delegates to Smartphone Widget's time system when the phone is active, and otherwise adapts Simple Calendar (Reborn), Calendaria, Seasons & Stars, Simple Timekeeping, or core `game.time.worldTime` directly. Provides `now()`, `sourceId()`, calendar-aware `getDateParts()`/`format()` (custom month and weekday names surface via `MMMM`/`MMM`/`ddd` tokens), picker-ready `getCalendarStructure()`, `partsToTimestamp()` for calendar date selection, `addDuration()`, `remaining()`, and an `onChange()` subscription across every supported source. Timestamps are game-milliseconds on the active source's axis; persist `sourceId()` next to stored timestamps to detect axis changes. The facade never writes or advances world time.
### 🛠 Notifier
- **Cinematic Cut-ins migration**: Cinematic Cut-ins v2.0.0 and newer are handled by the shared notification board instead of the module's own update dialog. Older Cinematic Cut-ins versions keep using their built-in notifier without duplicate dialogs.

## [0.8.3] - 2026-06-21

### 🛠 UI
- **Notification Board**: Added `OK all` and `Disable all notifications` controls for pending GlitchSmith updates and announcements. Announcement acknowledgements are saved before the board clears, and the disable action applies once per listed module.
- **Virtual wallet header button**: Added a client setting to hide the GlitchSmith Library virtual wallet button from Actor sheet headers. The setting affects both legacy and Application V2 Actor sheets, while wallet balances and APIs remain available.

## [0.8.2] - 2026-06-19

### 🛠 UI
- **Currency Definitions Dialog**: Embedded Item actor scan results now have per-row search, a live result count, a filtered empty state, and a bounded scrollable list, so actors with many item-based currency candidates no longer stretch the dialog.

## [0.8.1] - 2026-06-15

### 🐛 Fixes
- **Currency Definitions Dialog**: The Actor Path field is now disabled while a sheet currency uses Embedded Item storage, so it no longer looks editable when the value is ignored.

## [0.8.0] - 2026-06-15

### ✨ New Features
- **Embedded item sheet currencies**: Sheet currencies can now map to an actor-owned item's quantity instead of a single actor data path. A new `storage: { type: "embeddedItem" }` option matches items by type and field filters, reads and writes the configured `quantityPath`, and can optionally create the currency item from a source UUID when an actor lacks one. Systems that track currency as inventory items now work through configuration alone, with no per-system driver. Existing `actorPath` sheet currencies and the `getSheetBalance` / `setSheetBalance` / `modifySheetBalance(s)` APIs are unchanged.
- **Currency item scanning**: The Currency Definitions dialog can scan the selected token or assigned character to list its item-based currency candidates, infer a quantity path and stable identifying filters from the item, apply a candidate to the row, and test the configured filter against an actor.
- **Drag-and-drop configuration**: A currency item can be dragged from the Items sidebar or a compendium onto the embedded-item panel to auto-fill its item type, quantity path, filters, and creation source.

### 🔒 Security
- **Socket requester authorization**: Currency socket requests now derive the requesting user from Foundry's authenticated socket sender instead of a client-supplied id. Definition and virtual wallet writes require the original requester to be a GM, and sheet writes continue to enforce GM or actor OWNER permission, so a non-GM client can no longer spoof a privileged requester.

## [0.7.1] - 2026-06-14

### 🔄 Integrations
- Stylish Action HUD 2.5.1 and later now use the shared Notification Board after its standalone update dialog was retired.

## [0.7.0] - 2026-06-01

### 🐛 Fixes
- **Currency exchange rates**: Currency definitions now accept positive fractional rates below 1, such as `0.625`, for sheet and virtual currencies. The rate field no longer treats decimal conversion values as whole-number-only input.
- **Sheet currency permissions**: GM-mediated sheet currency writes now preserve the requesting user and require either GM status or OWNER permission on the actor.
- **Decimal currency increments**: Currency definitions now preserve optional increment metadata, so systems with fixed decimal steps can keep their configured rounding behavior.

### 🔄 Integrations
- Added a built-in Cosmere RPG sheet-currency preset and money-item driver for spheres, using the system's loot-based money items and `0.2` mark chip increments instead of writing to the derived actor total.
- Visual Novel Maker is now auto-discovered by the notifier subsystem after its standalone UpdateNotifier was retired.

## [0.6.1] - 2026-05-20

### 🐛 Fixes
- **Notification Board**: Update notes now render inline HTML formatting instead of displaying tags such as `<b>`, `<br>`, and `<code>` as text.

## [0.6.0] - 2026-05-19

### ✨ New Features
- **Decimal currencies**: Currency definitions can now mark individual entries as decimal-friendly. Decimal sheet and virtual balances are stored at the configured precision instead of being floored, so single-currency systems like SWADE can use fractional amounts (e.g. `0.5`) without losing data on grant, deduct, or transfer.
- **SWADE preset decimal default**: The built-in SWADE `Currency` preset now ships with `integer: false`, `precision: 2` so new SWADE worlds pick up decimal support automatically.
- **Notification Board**: GlitchSmith updates and announcements now surface through a single board instead of one dialog per module. The board uses tabs for Updates and Announcements, with per-module sub-tabs when more than one entry is available. Skip, disable, and acknowledge actions stay per module.
- **Library self-notifications**: The library now publishes its own update entries through the same board, fetched from `glitchsmith-lib-update.json` on the shared updates feed.

### 🛠 UI
- **Currency Definitions Dialog**: Added a `Whole` toggle to both sheet and virtual currency rows so GMs can opt individual currencies into decimal precision without touching code. The toggle is enabled by default to preserve existing integer behavior.

### 🔄 Migrations
- **SWADE decimal backfill**: Existing SWADE worlds whose currency entry predates decimal support automatically gain `integer: false` and `precision: 2` on next load. Runs once per world and skips currencies the GM has already configured.

### 🔄 Integrations
- **Smartphone Widget and Unboxing the Mystery** are now full notifier targets and appear in the new board alongside other GlitchSmith modules.
- Added `api.notifier.openBoard()` for modules that want to surface the board manually.

## [0.5.0] - 2026-05-16

### ✨ New Features
- Added shared sheet currency APIs under `glitchsmith-lib.currency`: `getSheetCurrencies`, `getSheetBalance`, `setSheetBalance`, `modifySheetBalance`, `setSheetBalances`, and `registerSheetCurrencyDriver`.
- Added `modifySheetBalances` for batch sheet currency deltas, so multi-denomination rewards and transactions can validate once and write once.
- Added built-in sheet currency drivers for actor data paths, PF2e/SF2e coin inventory APIs, and WFRP4e money items.
- Added the `glitchsmith-lib.registerSheetCurrencyDrivers` hook so external systems can register sheet currency drivers during `init`.

### 🔄 Integrations
- Unboxing the Mystery, Smartphone Widget, and Stylish Shop can now share the same sheet currency driver layer while keeping their existing virtual wallet integrations.
- Smartphone Widget and Unboxing the Mystery are now handled by the shared notifier subsystem after their standalone update notifiers were retired.

### 🔧 Compatibility
- Preserved the existing virtual wallet APIs and currency definition schema so older GlitchSmith modules can continue using the 0.3/0.4 API surface.

## [0.4.0] - 2026-05-13

### ✨ New Features
- **SFRPG preset**: Built-in currency defaults for Starfinder 1e. Exposes Credits (primary) and UPB at `system.currency.credit` / `system.currency.upb`, matching the active Starfinder 1e actor sheet.
- **SWADE preset**: Built-in currency defaults for Savage Worlds Adventure Edition. Exposes a single currency at `system.details.currency` (SWADE's configurable currency field) with name "Currency" and symbol "$" — customize per campaign via the Currency Dialog.
- **External system preset registration**: Other modules can now register currency presets for game systems the library does not ship by default.
  - Hook: `glitchsmith-lib.registerSystemPresets` fires at `init`. Listener receives `{ register(systemId, preset) }`.
  - Direct API: `game.modules.get("glitchsmith-lib").api.currency.registerSystemPreset(systemId, preset)`.
  - Registered presets override built-ins for the same system id, with a console warning.
- **`lib.currency.getRegisteredSystemIds()`**: Returns all registered system ids (built-in + externally registered).

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
