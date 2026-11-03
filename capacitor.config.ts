import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.meet.app',
  appName: 'Meet',
  webDir: 'dist',
  server: { androidScheme: 'https' }
};

export default config;
