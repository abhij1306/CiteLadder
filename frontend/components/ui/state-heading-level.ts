import { createContext } from 'react';

export type HeadingLevel = 1 | 2 | 3;

export const StateHeadingLevelContext = createContext<HeadingLevel>(2);
