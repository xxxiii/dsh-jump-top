/**
 * dsh-jump-top — browser half.
 *
 * Adds one icon button to the conversation header. A click does two things:
 *
 *   1. asks the Session mirror to load every remaining older page in one
 *      `loadThrough(0)` jump (the same jump loader the search results use),
 *      falling back to `loadOlder()` if that jump makes no progress;
 *   2. holds the chat scroller at `scrollTop = 0` while React prepends the
 *      pages, so the view lands on the true first message instead of drifting
 *      back to where the user was.
 *
 * The button lives in `conversation.session.header.utilities`, next to the
 * other session header controls. It is icon-only and carries a tooltip.
 *
 * Loader contract: `id` must be the package name (not a short alias), and the
 * factory may only require `react`.
 */

window.__ModuleLoader__.load({
  id: 'dsh-jump-top',
  factory: require => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require('react');
    const h = React.createElement;

    const SLOT = 'conversation.session.header.utilities';
    const STYLE_ID = 'dsh-jump-top-style';
    const MIN_HOLD_MS = 400;
    const MIN_SETTLE_MS = 2000;
    const SETTLE_QUIET_MS = 800;
    const SETTLE_MAX_MS = 15000;
    const MAX_JUMP_ROUNDS = 500;
    const MAX_PASSES = 3;

    const CSS = `
.dsh-jump-top {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.72;
  transition: background 120ms ease, opacity 120ms ease;
}
.dsh-jump-top:hover {
  background: rgba(127, 127, 127, 0.16);
  opacity: 1;
}
.dsh-jump-top:active {
  transform: translateY(1px);
}
.dsh-jump-top:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 1px;
}
.dsh-jump-top[disabled] {
  cursor: progress;
  opacity: 0.55;
}
.dsh-jump-top svg {
  display: block;
}
.dsh-jump-top-spin {
  width: 14px;
  height: 14px;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: dsh-jump-top-spin 0.7s linear infinite;
}
@keyframes dsh-jump-top-spin {
  to { transform: rotate(360deg); }
}
`;

    function ensureStyle() {
      if (typeof document === 'undefined') return;
      if (document.getElementById(STYLE_ID) !== null) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function waitUntil(predicate, timeoutMs, intervalMs = 80) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        let ok = false;
        try {
          ok = predicate();
        } catch {
          ok = false;
        }
        if (ok) return true;
        await sleep(intervalMs);
      }
      return false;
    }

    /** Pick the visible chat flow column (several sessions can stay mounted). */
    function pickChatColumn() {
      const columns = Array.from(document.querySelectorAll('[data-chat-flow]'));
      let best = null;
      let bestSpan = -1;
      for (const column of columns) {
        const rect = column.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 40) continue;
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
        if (rect.right <= 0 || rect.left >= window.innerWidth) continue;
        const span = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        if (span > bestSpan) {
          bestSpan = span;
          best = column;
        }
      }
      return best;
    }

    function isScrollable(element) {
      const style = getComputedStyle(element);
      const overflowY = style.overflowY;
      const scrolls = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
      return scrolls && element.scrollHeight > element.clientHeight + 4;
    }

    /** Nearest scroll container above the chat flow column. */
    function findScroller() {
      const column = pickChatColumn();
      if (column === null) return document.scrollingElement || document.documentElement;
      let element = column.parentElement;
      while (element !== null && element !== document.body) {
        if (isScrollable(element)) return element;
        element = element.parentElement;
      }
      if (isScrollable(column)) return column;
      return document.scrollingElement || document.documentElement;
    }

    /**
     * The turn-navigation rail: a right-edge `nav` whose marks are
     * `button[data-index]`. It exists only when the chat has at least two turns.
     */
    function findTurnNavigator() {
      const navs = Array.from(document.querySelectorAll('nav'));
      let best = null;
      let bestSpan = -1;
      for (const nav of navs) {
        if (nav.querySelector('button[data-index]') === null) continue;
        const rect = nav.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        const span = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
        if (span <= 0) continue;
        if (span > bestSpan) {
          bestSpan = span;
          best = nav;
        }
      }
      return best;
    }

    async function waitForElement(getter, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const element = getter();
        if (element !== null && element !== undefined) return element;
        await sleep(40);
      }
      return null;
    }

    /**
     * Click the rail's first mark.
     *
     * This delegates the whole move to the chat's own `navigateToTurn`: an
     * unloaded first turn pages history in with `loadThrough(seq)` and lands
     * through the chat's anchor machinery, a loaded one simply scrolls there.
     * That machinery deliberately treats programmatic scrolling as "reader
     * movement" and can retarget its own anchor afterwards, which is why
     * fighting it from the outside needed a second click.
     */
    async function jumpViaTurnNavigator() {
      const nav = findTurnNavigator();
      if (nav === null) return false;

      // The rail is virtualized around the active turn. Pull it to its start so
      // index 0 is mounted, then give the virtualizer a frame to render it.
      const railScroller = nav.firstElementChild;
      if (railScroller !== null) {
        railScroller.scrollTop = 0;
        railScroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      }

      const mark = await waitForElement(() => nav.querySelector('button[data-index="0"]'), 2500);
      if (mark === null) return false;
      mark.click();
      return true;
    }

    /** Wait for the delegated jump to land, then let the anchor settle. */
    async function waitForTurnNavigation() {
      await sleep(350);

      const startedAt = Date.now();
      let sawBusy = false;
      let landed = false;

      while (Date.now() - startedAt < 30000) {
        const nav = findTurnNavigator();
        const busy =
          nav !== null &&
          Array.from(nav.querySelectorAll('button[data-index]')).some(
            (mark) => mark.getAttribute('aria-busy') === 'true',
          );
        if (busy) sawBusy = true;

        const scroller = findScroller();
        const atTop = scroller !== null && scroller.scrollTop <= 2;
        if (atTop && (!sawBusy || !busy)) {
          landed = true;
          break;
        }
        await sleep(120);
      }

      // A short, gentle hold: the jump has already landed, we are only damping
      // the last measurement pass, not steering the chat's anchor.
      if (landed) {
        for (let i = 0; i < 8; i += 1) {
          const scroller = findScroller();
          if (scroller !== null && scroller.scrollTop > 2) scroller.scrollTop = 0;
          await sleep(80);
        }
      } else {
        const scroller = findScroller();
        if (scroller !== null) scroller.scrollTop = 0;
      }
    }

    /**
     * Hold the best current scroller at the top.
     *
     * The scroller is re-resolved on every tick on purpose: before the older
     * pages are committed the chat column has no scroll range, so the first
     * lookup falls back to <html>; a moment later the real chat scroller gains
     * its range. Resolving once would leave the keeper pinning the wrong
     * element for the rest of the jump.
     */
    function startTopKeeper() {
      let element = findScroller();
      let stopped = false;
      let frame = 0;
      let timer = 0;

      const pin = () => {
        if (stopped) return;
        const next = findScroller();
        if (next !== null) element = next;
        if (element !== null) {
          if (element === document.scrollingElement || element === document.documentElement) {
            window.scrollTo(0, 0);
          }
          element.scrollTop = 0;
        }
      };

      const tick = () => {
        if (stopped) return;
        pin();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      // Background tabs throttle rAF to nothing; a slow timer keeps the pin
      // alive there too without costing anything when rAF is running.
      timer = window.setInterval(pin, 120);

      return () => {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(frame);
        window.clearInterval(timer);
        if (element !== null) element.scrollTop = 0;
      };
    }

    /**
     * Hold the top until the flow stops growing.
     *
     * Prepending a page is only half the work: the chat flow measures rows and
     * runs its own scroll-anchor pass after React commits the new window. That
     * commit can land well after `loadThrough(0)` resolves, and until then the
     * chat still "follows the tail". Pinning through a minimum window (plus a
     * quiet period after the last DOM mutation) is what makes one click enough.
     *
     * @param session - the session mirror whose history is being loaded.
     */
    async function holdTopUntilSettled(session) {
      const stopKeeper = startTopKeeper();
      const startedAt = Date.now();
      let lastMutation = Date.now();
      let observer = null;

      try {
        if (typeof MutationObserver === 'function') {
          observer = new MutationObserver(() => {
            lastMutation = Date.now();
            const scroller = findScroller();
            if (scroller !== null) scroller.scrollTop = 0;
          });
          const column = pickChatColumn();
          if (column !== null) {
            observer.observe(column, { childList: true, subtree: true, characterData: true });
          }
        }

        while (Date.now() - startedAt < SETTLE_MAX_MS) {
          const scroller = findScroller();
          if (scroller !== null) scroller.scrollTop = 0;

          const loaded = session === null || session === undefined || !session.hasMore;
          const elapsed = Date.now() - startedAt;
          const quiet = Date.now() - lastMutation;

          // A short floor covers the commit that follows the loader; after that
          // wait for a genuinely quiet flow before letting go.
          if (loaded && elapsed >= MIN_SETTLE_MS && quiet >= SETTLE_QUIET_MS) break;
          await sleep(100);
        }
      } finally {
        if (observer !== null) observer.disconnect();
        stopKeeper();
      }
    }

    /** Load every older page, preferring the batched jump loader. */
    async function loadAllHistory(session) {
      if (session === null || session === undefined) return;

      if (session.openState === 'loading') {
        await waitUntil(() => session.openState !== 'loading', 20000);
      }
      if (session.openState !== 'open' && typeof session.open === 'function') {
        try {
          await session.open();
        } catch (error) {
          console.error('[dsh-jump-top] session.open() failed', error);
        }
      }
      if (session.loadingOlder) {
        await waitUntil(() => !session.loadingOlder, 120000);
      }

      for (let round = 0; round < MAX_JUMP_ROUNDS && session.hasMore; round += 1) {
        const before = Number(session.baseSeq);

        if (typeof session.loadThrough === 'function') {
          try {
            await session.loadThrough(0);
          } catch (error) {
            console.error('[dsh-jump-top] loadThrough(0) failed', error);
          }
        }

        if (!session.hasMore) return;

        if (session.loadingOlder) {
          await waitUntil(() => !session.loadingOlder, 120000);
          continue;
        }

        // Give the session mirror one beat to publish the committed window
        // before deciding whether the jump actually advanced.
        await sleep(120);

        const afterJump = Number(session.baseSeq);
        if (afterJump < before) continue;

        // The jump loader made no progress: fall back to one ordinary page.
        if (typeof session.loadOlder === 'function') {
          try {
            await session.loadOlder();
          } catch (error) {
            console.error('[dsh-jump-top] loadOlder() failed', error);
          }
        }
        if (session.loadingOlder) {
          await waitUntil(() => !session.loadingOlder, 120000);
        }
        if (Number(session.baseSeq) >= afterJump) {

          console.warn('[dsh-jump-top] history stopped advancing at seq', afterJump);
          return;
        }
      }
    }

    function TopIcon() {
      return h(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M3 3.25h10' }),
        h('path', { d: 'M4.4 8.4 8 4.8l3.6 3.6' }),
        h('path', { d: 'M4.4 12.2 8 8.6l3.6 3.6' }),
      );
    }

    function apply(ctx) {
      ensureStyle();

      // Defined inside apply so the click handler can reach `ctx.sessions`
      // without relying on slot-level prop injection.
      function JumpTopButton(props) {
        const sessionId = props.sessionId;
        const [busy, setBusy] = React.useState(false);
        const alive = React.useRef(true);

        React.useEffect(() => {
          alive.current = true;
          return () => {
            alive.current = false;
          };
        }, []);

        const onClick = async () => {
          if (busy) return;
          setBusy(true);
          let path = 'turn-navigation';

          try {
            // Prefer the chat's own turn navigation. It owns history paging,
            // anchor preservation and the busy indicator, so letting it drive
            // is what makes a single click enough.
            const delegated = await jumpViaTurnNavigator();
            if (delegated) {
              await waitForTurnNavigation();
            } else {
              path = 'fallback';
              let session = null;
              const stopKeeper = startTopKeeper();
              try {
                const binding = ctx.sessions.binding(sessionId);
                session = binding === undefined ? null : binding.session;
                for (let pass = 0; pass < MAX_PASSES; pass += 1) {
                  await loadAllHistory(session);
                  if (session === null || !session.hasMore) break;
                  await sleep(250);
                }
                await sleep(MIN_HOLD_MS);
              } finally {
                stopKeeper();
              }
              await holdTopUntilSettled(session);
            }
          } catch (error) {
            console.error('[dsh-jump-top] jump failed', error);
          } finally {
            const scroller = findScroller();
            console.debug('[dsh-jump-top] done', {
              path,
              scroller: scroller === null ? null : String(scroller.className),
              scrollTop: scroller === null ? null : scroller.scrollTop,
              scrollHeight: scroller === null ? null : scroller.scrollHeight,
            });
            if (alive.current) setBusy(false);
          }
        };

        return h(
          'button',
          {
            type: 'button',
            className: 'dsh-jump-top',
            'data-dsh-jump-top': '',
            'aria-label': '回到会话顶部',
            'aria-busy': busy ? 'true' : 'false',
            title: busy
              ? '正在加载全部更早的消息…'
              : '回到会话顶部（自动加载全部更早的消息）',
            disabled: busy,
            onClick,
          },
          busy ? h('span', { className: 'dsh-jump-top-spin' }) : h(TopIcon),
        );
      }

      ctx.effect(
        () =>
          ctx.slots.inject(SLOT, () =>
            ctx.slots.register(
              {
                name: SLOT,
                key: 'dsh-jump-top',
                id: 'dsh-jump-top',
                order: 40,
              },
              JumpTopButton,
            ),
          ),
        'dsh-jump-top: conversation header button',
      );
    }

    exports.inject = ['slots', 'sessions'];
    exports.apply = apply;

    return module.exports;
  },
});
