/** Explicit local fixtures, never commercial policy or provider authority. */
export const devSeed = {
  agencyEmail: 'agency@example.test',
  workspace: 'Acme Outdoor Co.',
  agencyWorkspace: 'Acme Outdoor Co. - Agency',
  budgetSeconds: 600,
  prompts: [
    ['best hiking backpack for a week-long trip', 'discovery', 'active', 'manual'],
    ['what is the most durable travel backpack under $200', 'discovery', 'active', 'manual'],
    ['Acme Outdoor vs Trail Co which is better', 'comparison', 'active', 'manual'],
    ['compare Summit Gear and Acme Outdoor warranties', 'comparison', 'active', 'imported'],
    ['where can I buy a waterproof backpack online', 'purchase', 'active', 'manual'],
    ['best place to buy carry-on travel backpacks', 'purchase', 'active', 'manual'],
    ['does Acme Outdoor offer free returns', 'service', 'active', 'manual'],
    ['how do I file a warranty claim for a torn backpack', 'service', 'archived', 'generated'],
    ['best outdoor gear shops near Denver Colorado', 'local', 'active', 'manual'],
    ['hiking backpack stores in Seattle Washington', 'local', 'archived', 'generated'],
    ['old prompt about discontinued backpack line', 'discovery', 'archived', 'manual'],
  ],
  agencyPrompts: [
    ['best RV awning for hot climates', 'discovery'],
    ['CamperCo vs OutbackShade awnings', 'comparison'],
    ['where to buy a retractable camper awning', 'purchase'],
  ],
  products: [
    {
      name: 'Summit 40L Trail Pack',
      sku: 'WGC-S40-BLK',
      price: 189.99,
      url: 'https://acme-outdoor.example/backpacks/summit-40l',
    },
    {
      name: 'Voyager 25L Carry-On Pack',
      sku: 'WGC-V25-GRY',
      price: 129.99,
      url: 'https://acme-outdoor.example/backpacks/voyager-25l',
    },
  ],
  competitorProduct: {
    name: 'Trail Alpine 45',
    price: 174.99,
    url: 'https://trail-co.example/alpine-45',
  },
} as const;
