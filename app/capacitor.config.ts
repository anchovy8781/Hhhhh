import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.jeonryeoklab.app",
  appName: "전력기기 랩",
  webDir: "dist",
  android: {
    // The 3D view owns the whole surface; let it use the full window.
    backgroundColor: "#0d1117",
  },
};

export default config;
