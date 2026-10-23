/**
 * Notifications are an Android-only feature in this app. Keep the web preview
 * renderable without pulling the native-only expo-notifications entry point
 * into the browser bundle.
 */
export const Notifications = {
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DAILY: 'daily' },
  setNotificationHandler: () => undefined,
  setNotificationChannelAsync: async () => undefined,
  getPermissionsAsync: async () => ({ granted: false }),
  requestPermissionsAsync: async () => ({ granted: false }),
  cancelScheduledNotificationAsync: async () => undefined,
  scheduleNotificationAsync: async () => '',
};
