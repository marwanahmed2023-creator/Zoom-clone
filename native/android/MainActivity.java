package com.meet.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeCallListenerPlugin.class);
        super.onCreate(savedInstanceState);

        // Capacitor's default handler denies the entire WebRTC request if either
        // camera OR microphone is denied. Convo grants each approved media
        // resource independently, so microphone-only meetings still work.
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setWebChromeClient(new ConvoWebChromeClient(getBridge()));
        }
    }

    private static class ConvoWebChromeClient extends BridgeWebChromeClient {
        private final Bridge bridge;

        ConvoWebChromeClient(Bridge bridge) {
            super(bridge);
            this.bridge = bridge;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            List<String> allowed = new ArrayList<>();
            boolean microphoneGranted =
                ContextCompat.checkSelfPermission(bridge.getContext(), Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(bridge.getContext(), Manifest.permission.MODIFY_AUDIO_SETTINGS)
                    == PackageManager.PERMISSION_GRANTED;
            boolean cameraGranted =
                ContextCompat.checkSelfPermission(bridge.getContext(), Manifest.permission.CAMERA)
                    == PackageManager.PERMISSION_GRANTED;

            for (String resource : request.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) && microphoneGranted) {
                    allowed.add(resource);
                } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) && cameraGranted) {
                    allowed.add(resource);
                }
            }

            if (allowed.isEmpty()) {
                request.deny();
            } else {
                request.grant(allowed.toArray(new String[0]));
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (getBridge() != null) getBridge().triggerWindowJSEvent("meetNativeResume", "{}");
    }
}