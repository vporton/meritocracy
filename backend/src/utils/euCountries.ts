export const EU_COUNTRY_CODES = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE'
] as const;

export const isEuCountryCode = (countryCode?: string | null): boolean => {
  if (!countryCode) {
    return false;
  }

  return EU_COUNTRY_CODES.includes(countryCode.toUpperCase() as (typeof EU_COUNTRY_CODES)[number]);
};
