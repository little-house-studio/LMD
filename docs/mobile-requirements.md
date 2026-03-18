# LTHS Mermaid Editor - Mobile Requirements

## Design Philosophy

This editor is a **pure tool** with no built-in AI. It is designed to be controlled by external AI agents via a clean plaintext API.

## External Control API

### window.MermaidEditor

The editor exposes a global `window.MermaidEditor` object:

```typescript
interface MermaidEditorAPI {
  setSource(code: string): void;      // Set diagram source code
  getSource(): string;                 // Get current source code
  render(): Promise<void>;             // Trigger diagram render
  getSvg(): string | null;             // Get rendered SVG output
}
```

### postMessage API

External scripts can also control the editor via `postMessage`:

**Request:**
```json
{ "type": "mermaid-editor", "action": "setSource", "payload": "graph TD\nA-->B" }
{ "type": "mermaid-editor", "action": "getSource" }
{ "type": "mermaid-editor", "action": "render" }
{ "type": "mermaid-editor", "action": "getSvg" }
```

**Response:**
```json
{ "type": "mermaid-editor-response", "action": "getSource", "payload": "graph TD\nA-->B" }
{ "type": "mermaid-editor-response", "action": "getSvg", "payload": "<svg>...</svg>" }
```

## Mobile Layout (Android Portrait)

- Full-screen immersive layout with safe area insets
- 48px sticky top toolbar
- Bottom action bar for primary actions (thumb zone)
- Swipe left/right to switch editor ↔ preview
- Minimum 44×44px touch targets
- 16px horizontal margins

## Editor

- 16px minimum font size (prevents iOS auto-zoom)
- Keyboard avoidance via `visualViewport` API
- Syntax shortcut toolbar above virtual keyboard
- 500ms debounced render

## Diagram Preview

- Pinch-to-zoom + pan gestures
- Double-tap to fit/reset
- Loading skeleton during render

## Visual

- Dark mode (respects system preference)
- 60fps transitions
- Ripple press feedback
