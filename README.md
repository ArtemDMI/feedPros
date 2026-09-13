# feedPros

SillyTavern UI extension for **Feedback + Undo** only. The Roll system is not part of this extension.

## Requirements

- SillyTavern **1.17.0** or newer

## Install

Install from the SillyTavern extension manager:

1. Open SillyTavern → **Extensions** → **Install Extension**.
2. Paste the git URL of this repository and install.
3. Enable **feedPros**.

For local development, copy or clone this repository into `public/scripts/extensions/third-party/feedPros` (install for all users) or `data/<user>/extensions/feedPros`, then enable it in the extension manager.

## Scope

- **Feedback** opens an empty four-line instruction field. `Enter` submits and
  `Shift+Enter` inserts a new line. The entire current chat is sent, with the
  selected message moved to the final rewrite block.
- A successful result replaces only the message text and its active swipe.
  Repeated Feedback works from the already rewritten text.
- **Undo** on any message restores the most recent successful Feedback in the
  current chat. The shared buffer survives reload and is cleared on chat switch.
- Feedback times out after 30 seconds. Errors, late responses, chat switches,
  and messages edited while waiting are not applied.
- Optional Connection Profile and API Preset selections are applied temporarily
  and restored after every outcome.

The full chat is never shortened automatically. If it exceeds the provider's
context limit, generation fails without changing the message.

This extension does not add a server plugin, API proxy, secret storage, or a separate database.
