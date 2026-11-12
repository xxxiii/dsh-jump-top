# dsh-jump-top

> One click back to the very top of a DeepSeek Harness conversation. Loads every earlier message automatically — no more repeated "Load earlier" clicks.

[简体中文](./README.md) | English

![DSH](https://img.shields.io/badge/DSH-0.2.x-4B6BFB)
![platform](https://img.shields.io/badge/platform-web-2ea44f)
![license](https://img.shields.io/badge/license-MIT-blue)

DSH loads long conversations page by page. To get back to the first message, you have to click "Load earlier" over and over. This plugin adds a double-chevron button to the right of the conversation title. One click pulls in all remaining history and stops at the real first message.

## Why it exists

- In a long conversation, "Load earlier" may need a dozen clicks;
- History is prepended above the viewport, and the browser keeps the current scroll position, so every page pushes the top further away;
- Setting `scrollTop = 0` from the outside is not reliable: DSH's chat view has its own scroll anchor. It treats programmatic scrolling as "the reader is scrolling", then re-anchors after the content commits. The result is a jump to the top followed by a bounce back to the middle — and a second click is required.

This plugin does not fight that anchor system. Instead, it delegates "jump to turn 1" to DSH's own turn navigation.

## Features

- **One click**: loads all earlier messages and stops at the first one;
- **Native path**: uses DSH's turn navigation to page history and land, avoiding the second bounce;
- **Fallback**: if turn navigation is unavailable, falls back to `loadThrough(0)` plus scroll pinning;
- **No background work, no network requests**: registers one client-side button; never reads or writes conversation content;
- **Progress feedback**: the button spins and is disabled during the jump, then restores itself.

## Installation

### In-app (recommended)

1. Clone or download this repository;
2. Open DSH's "Settings → Plugins", choose install from a local directory, and point it at this repository;
3. Enable `dsh-jump-top` and refresh the page.

### Command line (CLI profile)

```bash
git clone https://github.com/xxxiii/dsh-jump-top.git
dsh plugin --profile web add link:/absolute/path/to/dsh-jump-top
```

> The `desktop` profile is owned exclusively by the desktop app, so the CLI refuses to modify it. On desktop, install from the in-app plugin settings.

Refresh the page after installation. If the host does not hot-load plugins on first enable, restart DSH once.

## Usage

Open any conversation. A double-chevron icon appears in the tools area to the right of the title:

- Click once: load every earlier message and jump to the first one;
- While the button spins, it is paging and landing — usually about a second, longer for very long conversations;
- Clicking while already at the top has no side effects.

## How it works

1. **Prefer turn navigation**: find turn 1 in the "turn navigation" rail on the right and trigger it. If turn 1 is not loaded yet, DSH calls `loadThrough(seq)` itself to page history in, then lands through its own anchor system.
2. **Wait for the landing**: poll the scroll container and the busy markers. Once it is at the top, apply a short, gentle `scrollTop = 0` correction only to damp the last measurement pass.
3. **Fallback path**: if the current view has no turn navigation (for example, too few turns or the rail is hidden), call the Session's `loadThrough(0)` to load all history and use a `MutationObserver` plus scroll pinning to wait for layout to settle.

The key point: **do not fight DSH's scroll anchor from the outside**. Forcing a scroll triggers `movedByReader`, which interrupts DSH's own landing — that is exactly why a second click used to be necessary.

## Compatibility

| Item | Requirement |
| --- | --- |
| DSH | `>=0.2.0-rc.1 <0.3.0-0` |
| Client | Web (including the Electron desktop app) |
| Node.js | Needed only for development/checks, `>=20` |

The plugin depends on these DSH extension points:

- slot `conversation.session.header.utilities`
- the Session's `loadThrough` / `loadOlder` / `hasMore` state, and the turn-navigation DOM

If a DSH upgrade changes those internals, the plugin may need to be adjusted.

## Known limitations

- Web client only; the CLI/TUI has no such button.
- Very long conversations need real paging, so the button spins until loading finishes. Landing through turn navigation waits at most 30 seconds; paging itself can take longer.
- If a conversation has no turn navigation, the fallback path is used, and a very long history can still produce an occasional slight shift.
- This is a UI enhancement. It does not change conversation data, and it never deletes or collapses messages for you.

## Troubleshooting

**The button does not appear**

- Make sure the plugin is enabled and refresh the page;
- Make sure the DSH version is within the supported range;
- Open the console and look for errors starting with `[dsh-jump-top]`.

**The button keeps spinning**

- The normal maximum is about 30 seconds; after that a `[dsh-jump-top]` log is left in the console;
- Open an issue with the `[dsh-jump-top] done` object from the console and your DSH version.

**It still takes two clicks**

- Open the console and note `path` (`turn-navigation` or `fallback`), `scrollTop` and `scrollHeight` from `[dsh-jump-top] done`;
- Include the approximate number of turns and the DSH version.

## Development

No build step — the source is the artifact:

```
dsh-jump-top/
├── lib/
│   ├── client.js      # browser side: button, turn navigation, fallback
│   └── index.js       # empty server entry, only needed by the bundle patch
├── cordis.patch.yml   # inserts the plugin into the profile
├── package.json
├── README.md          # Chinese
└── README.en.md       # English
```

After editing `lib/client.js`:

```bash
node --check lib/client.js
```

Then refresh the page. Client-only changes do not need a host restart; changes to entry points or the manifest in `package.json` do.

## Privacy

The plugin sends no network requests, does not read conversation text, and does not write to conversation storage. It only touches the current page's scroll position and DSH's existing navigation controls.

## License

[MIT](./LICENSE)
