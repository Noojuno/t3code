import { createContext } from "react";

// Temporarily reveal Markdown disclosures while finding; preserve the user's fold state.
export const MarkdownFindContext = createContext(false);
