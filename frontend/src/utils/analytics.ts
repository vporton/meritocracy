type AnalyticsEventParams = Record<string, string | number | boolean | null | undefined>;

type AnalyticsWindow = Window & {
  gtag?: (...args: unknown[]) => void;
  dataLayer?: unknown[];
};

export const trackAnalyticsEvent = (eventName: string, params: AnalyticsEventParams = {}): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const analyticsWindow = window as AnalyticsWindow;

  try {
    if (typeof analyticsWindow.gtag === 'function') {
      analyticsWindow.gtag('event', eventName, params);
      return;
    }

    if (Array.isArray(analyticsWindow.dataLayer)) {
      analyticsWindow.dataLayer.push({ event: eventName, ...params });
    }
  } catch (error) {
    console.warn('Analytics tracking failed:', error);
  }
};
