## 2024-10-28 - CheckoutBoard NameChip Performance
**Learning:** `NameChip` component inside `CheckoutBoard` calls `measureInk`, an expensive operation involving the Canvas API. Because `CheckoutBoard` lists hundreds of chips during checkout and gets re-rendered frequently on each state update, this calculation shouldn't be repeatedly performed for each name that hasn't changed.
**Action:** Wrapped the `NameChip` functional component in `React.memo()`. This avoids re-rendering and executing canvas operations for `NameChip` components when their `name` prop stays the same.
