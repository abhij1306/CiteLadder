type FirehoseRecord = { recordId: string; data: string };
export declare const CATALOG_VERSION: string;
export declare function handler(event: { records: FirehoseRecord[] }): Promise<{
  records: (FirehoseRecord & { result: 'Ok' | 'Dropped' })[];
}>;
