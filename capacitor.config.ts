import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.meet.app',
  appName: 'Meet',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  plugins: {
    // Route fetch() through Android's native HTTP stack to avoid WebView CORS failures.
    CapacitorHttp: { enabled: true }
  }
};

export default config;
