# GitHub Actions Scroll Helper

A lightweight Chrome extension that adds a “jump to bottom” control on GitHub Actions log panes so you can keep the newest output in view while long-running steps stream their logs.

## Features
<img width="1599" height="721" alt="scroll-to-bottom" src="https://github.com/user-attachments/assets/c5057e8e-1c4e-4c8e-8115-ad620c4fcd75" />

- Shows an unobtrusive ⏬ button only when a step is expanded, has more than ~50 log lines, and the logs overflow the pane.
- Scrolls to ~99 % of the available log height and enables an auto-stick mode so new log lines stay in view.
- Works across the legacy Actions layout and the newer “check-step” interface, hiding itself again when the pane collapses or the log fits on screen.

## Usage

1. Visit a GitHub Actions job page and expand any step.
2. When the step meets the visibility criteria, the ⏬ button appears in the header.
3. Click once to jump near the end and turn on auto-stick; click again to turn auto-stick off if you need to scroll manually.

## Install

1. Open `chrome://extensions/` in Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and choose the `extension` directory from this repository.

## Implementation Notes

- A combination of `MutationObserver` and `ResizeObserver` tracks pane creation, expansion, window resize, and streaming output to keep scroll targets up to date.
- Scroll targets are chosen dynamically: an overflowing inner container is preferred; otherwise the document scroller is used.
- Fallback scrolling relies on the final log anchor (or the deepest visible child) to keep the newest lines visible even when GitHub’s DOM structure shifts. The scroll button is hidden whenever the pane is closed or the logs no longer overflow.

