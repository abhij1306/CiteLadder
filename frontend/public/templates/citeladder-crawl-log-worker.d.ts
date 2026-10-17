declare const worker: {
  fetch(
    request: Request,
    env: { CITELADDER_INGEST_URL: string; CITELADDER_CRAWL_TOKEN: string },
    ctx: { waitUntil(promise: Promise<void>): void },
  ): Promise<Response>;
};
export default worker;
