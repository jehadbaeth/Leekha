import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android/iOS shell around the apps/web build. There is no second UI here:
 * `webDir` points straight at apps/web's Vite output, so the apps run the exact
 * same React bundle the browser does. See docs/MOBILE-PORT.md.
 */
const config: CapacitorConfig = {
  appId: 'net.leekha.app',
  appName: 'Leekha',
  webDir: '../web/dist',
  // The felt green the app itself paints (index.css `body`), so the strip
  // behind the status bar and any safe-area gap reads as part of the table
  // instead of a black letterbox.
  backgroundColor: '#0b3d2e',
  android: {
    androidScheme: 'https',
  },
  ios: {
    backgroundColor: '#0b3d2e',
    // The webapp never bounces past its own background, and the table is a
    // fixed layout: rubber-banding at the edges just exposes the shell.
    scrollEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#0b3d2e',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      // Light glyphs on the dark felt, and the webview laid out *below* the
      // status bar rather than under it -- the browser behaves the same way.
      style: 'DARK',
      backgroundColor: '#0b3d2e',
      overlaysWebView: false,
    },
  },
};

export default config;
