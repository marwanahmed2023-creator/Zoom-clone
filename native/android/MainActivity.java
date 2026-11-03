package com.meet.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeCallListenerPlugin.class);
        super.onCreate(savedInstanceState);
        // Keep Capacitor's BridgeWebChromeClient installed. It handles WebRTC
        // camera/microphone permission requests, fullscreen, file pickers and dialogs.
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (getBridge() != null) getBridge().triggerWindowJSEvent("meetNativeResume", "{}");
    }
}
