/** Supported onboarding industries and their subindustry choices. */
export const industryLibrary = {
  industries: {
    General: {
      subindustries: [],
    },
    Ecommerce: {
      subindustries: [
        'Marketplaces',
        'Fashion Retail',
        'Beauty Retail',
        'Consumer Electronics',
        'Home and General Merchandise',
      ],
    },
    Software: {
      subindustries: [
        'Analytics',
        'Data Management',
        'Marketing Technology',
        'Commerce Technology',
        'Collaboration',
        'Developer Tools',
      ],
    },
    'Professional Services': {
      subindustries: ['Consulting', 'Legal', 'Accounting', 'Marketing Services', 'IT Services'],
    },
    'Financial Services': {
      subindustries: ['Banking', 'Payments', 'Insurance', 'Investing', 'Lending'],
    },
    Healthcare: {
      subindustries: ['Clinics', 'Telehealth', 'Health Technology', 'Wellness', 'Pharmacy'],
    },
    'Travel and Hospitality': {
      subindustries: [
        'Hotels',
        'Travel Booking',
        'Tours and Activities',
        'Business Travel',
        'Vacation Rentals',
      ],
    },
    Education: {
      subindustries: [
        'Online Learning',
        'Higher Education',
        'Professional Training',
        'Tutoring',
        'Education Technology',
      ],
    },
  },
};
