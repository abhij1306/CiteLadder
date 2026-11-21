const ESCAPED = String.raw`\$&`;

export const containsPattern = (text: string) => `%${text.replaceAll(/[\\%_]/gu, ESCAPED)}%`;
