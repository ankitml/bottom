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

