# GitHub Actions Scroll Helper

A lightweight Chrome extension that adds a “jump to bottom” control on GitHub Actions log panes. It keeps the latest output in view while long-running steps stream their logs.

## Features

- Shows an unobtrusive ⏬ button only when a step is expanded, has more than ~50 log lines, and the logs overflow the pane.
- Scrolls to ~99 % of the available log height and enables an auto-stick mode so new log lines stay in view.
- Works with both the legacy Actions layout and the newer “check-step” interface, automatically hiding the control again when the pane collapses or no longer overflows.

## Install

1. Open `chrome://extensions/` in Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and choose the `extension` directory from this repository.

## Using the Button

1. Visit a GitHub Actions job page and expand any step.
2. When the step meets the visibility criteria, the ⏬ button appears in the header.
3. Click once to jump near the end and turn on auto-stick; click again to turn auto-stick off if you need to scroll manually.

## Implementation Notes

- A combination of `MutationObserver` and `ResizeObserver` tracks pane creation, expansion, and streaming output to keep scroll targets up to date.
- Scroll targets are chosen dynamically: an overflowing inner container is preferred, otherwise the document scroller is used.
- Fallback scrolling relies on the final log anchor (or the deepest visible child) to keep the newest lines visible even when GitHub’s DOM structure shifts.
# GitHub Actions Scroll Helper

Chrome extension that adds a quick “scroll to bottom” control on GitHub Actions log panes, optimized for long-running steps.

## Install

1. Open `chrome://extensions/` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` directory from this repository.

## Usage

- Open any GitHub Actions job page and expand a step.
- When the step has overflowed logs, a ⏬ button appears in the header. Click it to jump to ~99% of the log and enable auto-stick so new lines stay in view. Click again to disable the auto-stick mode.
- The button hides automatically if the step is collapsed or if the log fits entirely on screen.

## Implementation Highlights

- A `MutationObserver` and `ResizeObserver` track pane creation, expansion, and streaming output across both legacy and new GitHub Actions layouts.
- Scrollable targets (step containers or the global document) are discovered dynamically; the button only renders while a step is open and has more content than the viewport.
- Fallback scrolling uses the final log anchor to keep the latest lines visible, jumping to roughly 99% of the available height for very long logs.

