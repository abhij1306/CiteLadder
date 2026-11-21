import { createContext, type Dispatch, type SetStateAction } from 'react';

export const PageTitleContext = createContext<Dispatch<SetStateAction<string | undefined>> | null>(
  null,
);
