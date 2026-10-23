## 2024-05-24 - Provide Context For Disabled Buttons
**Learning:** Adding a `title` to an intentionally disabled button helps users understand why they cannot click the action, while `aria-label`s on repeated buttons (e.g., 'Delete') distinguish identical controls in lists.
**Action:** Identify disabled actions without helper texts and redundant buttons without aria-labels and provide clear hints and accessible names for them.

## 2024-10-23 - Added tooltips to disabled buttons in SlideEditorPanel
**Learning:** For users who see disabled icon-only buttons or primary actions like "Export" without explicit disabled reasons, it's very helpful to provide a native tooltip using the `title` attribute to explain *why* it's disabled.
**Action:** Consistently review new and existing components to ensure that every `disabled={condition}` has a complementary `title={condition ? 'Reason...' : undefined}`.
