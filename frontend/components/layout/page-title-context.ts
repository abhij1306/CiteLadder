import { createContext, type Dispatch, type SetStateAction } from 'react';

/**
 * Lets a page that overrides its route title (a record's name) tell the
 * shell, which announces the title on navigation.
 */
export const PageTitleContext = createContext<Dispatch<SetStateAction<string | undefined>> | null>(
  null,
);
